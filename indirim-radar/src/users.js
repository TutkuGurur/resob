'use strict';

/**
 * Üyelik, oturum, kişisel takip listesi, alarmlar ve bildirim kayıtları.
 * Kayıt yalnızca davet koduyla yapılır (site yakın çevre için kapalı devre).
 */

const crypto = require('node:crypto');
const db = require('./db');

const SESSION_DAYS = 60;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashPass = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');

/** Davet kodu: INVITE_CODE ortam değişkeni, yoksa ilk açılışta üretilip saklanır */
function inviteCode() {
  if (process.env.INVITE_CODE) return process.env.INVITE_CODE;
  let code = db.getSetting('invite_code');
  if (!code) {
    code = crypto.randomBytes(9).toString('base64url');
    db.setSetting('invite_code', code);
  }
  return code;
}

function publicUser(u) {
  return u ? { id: u.id, email: u.email, name: u.name, isAdmin: !!u.is_admin } : null;
}

function register({ email, name, password, invite }) {
  email = String(email || '').trim().toLowerCase();
  name = String(name || '').trim().slice(0, 60);
  password = String(password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new Error('Geçerli bir e-posta girin');
  if (!name) throw new Error('Adınızı girin');
  if (password.length < 8 || password.length > 200) throw new Error('Şifre en az 8 karakter olmalı');
  const a = Buffer.from(sha(String(invite || '')));
  const b = Buffer.from(sha(inviteCode()));
  if (!crypto.timingSafeEqual(a, b)) throw new Error('Davet kodu hatalı');
  const d = db.open();
  if (d.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new Error('Bu e-posta zaten kayıtlı');
  const salt = crypto.randomBytes(16).toString('hex');
  const first = d.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  const r = d
    .prepare('INSERT INTO users (email, name, pass_hash, salt, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(email, name, hashPass(password, salt), salt, first ? 1 : 0, Date.now());
  return publicUser(d.prepare('SELECT * FROM users WHERE id = ?').get(Number(r.lastInsertRowid)));
}

function login({ email, password }) {
  const u = db.open().prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  // Kullanıcı yoksa da aynı süreyi harca (e-posta var/yok ayrımı sızmasın)
  const salt = u ? u.salt : '00';
  const h = Buffer.from(hashPass(String(password || ''), salt));
  if (!u || !crypto.timingSafeEqual(h, Buffer.from(u.pass_hash))) throw new Error('E-posta veya şifre hatalı');
  return publicUser(u);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.open()
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha(token), userId, Date.now() + SESSION_DAYS * 864e5);
  return token;
}

function userFromToken(token) {
  if (!token) return null;
  const d = db.open();
  const s = d.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha(token));
  if (!s) return null;
  if (s.expires_at < Date.now()) {
    d.prepare('DELETE FROM sessions WHERE token_hash = ?').run(s.token_hash);
    return null;
  }
  return publicUser(d.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id));
}

function destroySession(token) {
  if (token) db.open().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

// ---- Kişisel takip listesi ----
function follow(userId, productId) {
  db.open()
    .prepare('INSERT OR IGNORE INTO user_products (user_id, product_id, created_at) VALUES (?, ?, ?)')
    .run(userId, productId, Date.now());
}
function unfollow(userId, productId) {
  db.open().prepare('DELETE FROM user_products WHERE user_id = ? AND product_id = ?').run(userId, productId);
}
function followedIds(userId) {
  return new Set(
    db.open().prepare('SELECT product_id FROM user_products WHERE user_id = ?').all(userId).map((r) => r.product_id)
  );
}
/** En az bir kullanıcının takip ettiği ürünler (güncellemede öncelikli) */
function allFollowedIds() {
  return new Set(db.open().prepare('SELECT DISTINCT product_id FROM user_products').all().map((r) => r.product_id));
}

// ---- Alarmlar ----
function addAlert(userId, { productId, type, targetPrice }) {
  if (!['fiyat', 'gercek'].includes(type)) throw new Error('Geçersiz alarm türü');
  let target = null;
  if (type === 'fiyat') {
    target = Number(targetPrice);
    if (!Number.isFinite(target) || target <= 0) throw new Error('Geçerli bir hedef fiyat girin');
  }
  const d = db.open();
  if (!d.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) throw new Error('Ürün bulunamadı');
  if (d.prepare('SELECT COUNT(*) AS n FROM alerts WHERE user_id = ?').get(userId).n >= 200)
    throw new Error('En fazla 200 alarm kurulabilir');
  // Aynı ürün + tür için tek alarm: varsa hedefi güncelle
  const ex = d.prepare('SELECT id FROM alerts WHERE user_id = ? AND product_id = ? AND type = ?').get(userId, productId, type);
  if (ex) {
    d.prepare('UPDATE alerts SET target_price = ?, triggered = 0 WHERE id = ?').run(target, ex.id);
    follow(userId, productId);
    return ex.id;
  }
  const r = d
    .prepare('INSERT INTO alerts (user_id, product_id, type, target_price, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, productId, type, target, Date.now());
  follow(userId, productId);
  return Number(r.lastInsertRowid);
}
function listAlerts(userId) {
  return db
    .open()
    .prepare(
      `SELECT a.id, a.product_id AS productId, a.type, a.target_price AS targetPrice, a.triggered,
              a.last_fired_at AS lastFiredAt, a.created_at AS createdAt, p.title
       FROM alerts a JOIN products p ON p.id = a.product_id WHERE a.user_id = ? ORDER BY a.id DESC`
    )
    .all(userId);
}
function deleteAlert(userId, id) {
  db.open().prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?').run(id, userId);
}
function alertsForProduct(productId) {
  return db.open().prepare('SELECT * FROM alerts WHERE product_id = ?').all(productId);
}
function setAlertState(id, triggered, fired) {
  db.open()
    .prepare('UPDATE alerts SET triggered = ?, last_fired_at = COALESCE(?, last_fired_at) WHERE id = ?')
    .run(triggered ? 1 : 0, fired ? Date.now() : null, id);
}

// ---- Bildirimler ----
function addNotification(userId, { productId, title, body }) {
  db.open()
    .prepare('INSERT INTO notifications (user_id, product_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, productId ?? null, title, body, Date.now());
}
function listNotifications(userId, limit = 50) {
  return db
    .open()
    .prepare(
      `SELECT id, product_id AS productId, title, body, created_at AS createdAt, read_at AS readAt
       FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(userId, limit);
}
function unreadCount(userId) {
  return db.open().prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;
}
function markAllRead(userId) {
  db.open().prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(Date.now(), userId);
}

// ---- Push abonelikleri ----
function addPushSub(userId, { endpoint, p256dh, auth }) {
  db.open()
    .prepare(
      `INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
    )
    .run(userId, endpoint, p256dh, auth, Date.now());
}
function removePushSub(endpoint) {
  db.open().prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
}
function pushSubs(userId) {
  return db.open().prepare('SELECT * FROM push_subs WHERE user_id = ?').all(userId);
}

module.exports = {
  inviteCode,
  register,
  login,
  createSession,
  userFromToken,
  destroySession,
  follow,
  unfollow,
  followedIds,
  allFollowedIds,
  addAlert,
  listAlerts,
  deleteAlert,
  alertsForProduct,
  setAlertState,
  addNotification,
  listNotifications,
  unreadCount,
  markAllRead,
  addPushSub,
  removePushSub,
  pushSubs,
};
