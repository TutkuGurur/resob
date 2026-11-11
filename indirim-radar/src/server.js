'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const db = require('./db');
const tracker = require('./tracker');
const users = require('./users');
const alerts = require('./alerts');
const push = require('./push');
const ex = require('./extractors');
const { resolveQuery, DEFAULT_LISTS } = require('./batch');
const { seedDemo } = require('./demo');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e5) throw new HttpError(413, 'İstek çok büyük');
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Geçersiz JSON');
  }
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;

function sessionCookie(req, token, maxAgeSec) {
  return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`;
}

function clientIp(req) {
  if (process.env.TRUST_PROXY) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf) return xf;
  }
  return req.socket.remoteAddress || '?';
}

// Basit bellek içi hız sınırı: key -> { n, reset }
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) buckets.set(key, (b = { n: 0, reset: now + windowMs }));
  if (++b.n > max) throw new HttpError(429, 'Çok fazla deneme yaptınız, biraz sonra tekrar deneyin');
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
}

/** Başka siteden gelen değiştirici istekleri reddet (CSRF) */
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Geçersiz kaynak');
  }
  if (host !== req.headers.host) throw new HttpError(403, 'Geçersiz kaynak');
}

const SORTS = {
  skor: (a, b) => b.analysis.dealScore - a.analysis.dealScore || (b.analysis.realDiscountPct || 0) - (a.analysis.realDiscountPct || 0),
  gercek: (a, b) => (b.analysis.realDiscountPct || 0) - (a.analysis.realDiscountPct || 0),
  iddia: (a, b) => (b.analysis.claimedDiscountPct || 0) - (a.analysis.claimedDiscountPct || 0),
  fiyat: (a, b) => (a.analysis.price || 0) - (b.analysis.price || 0),
  yeni: (a, b) => (b.analysis.discountStartedAt || 0) - (a.analysis.discountStartedAt || 0),
};

/** Liste görünümü için hafif ürün kaydı */
function listItem(s, favs) {
  const { offers, ...rest } = s;
  return { ...rest, fav: favs.has(s.id) };
}

function productDetail(p, user) {
  const s = tracker.productSummary(p);
  return {
    ...s,
    fav: users.followedIds(user.id).has(p.id),
    alerts: users.listAlerts(user.id).filter((a) => a.productId === p.id),
    history: db.getSnapshots(p.id, Date.now() - 200 * 864e5),
  };
}

/** Ürün adı veya linkinden ürünü bul, gerekiyorsa şimdi çek, analizle döndür */
async function findAndTrack(q, source) {
  const r = await resolveQuery(q);
  if (!r.ok) throw new HttpError(404, r.error);
  const existing = db.listProducts().find((p) => p.url === r.url);
  let id;
  if (existing && existing.last_checked && Date.now() - existing.last_checked < 3600e3 && !existing.last_error) {
    id = existing.id;
  } else {
    const added = await tracker.addProductByUrl(r.url, { source });
    if (!added.ok) throw new HttpError(502, 'Ürün sayfası okunamadı: ' + added.error);
    id = added.id;
  }
  return { id, alternatives: (r.alternatives || []).map((a) => ({ url: a.url, title: a.title })) };
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const m = req.method;
  const mutating = m !== 'GET' && m !== 'HEAD';
  if (mutating) checkOrigin(req);
  const token = cookies(req).sid;

  if (m === 'GET' && parts[1] === 'health') return send(res, 200, { ok: true });

  // ---- Üyelik ----
  if (parts[1] === 'auth' && m === 'POST') {
    if (parts[2] === 'logout') {
      users.destroySession(token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }
    rateLimit('auth:' + clientIp(req), 10, 10 * 60e3);
    const body = await readJson(req);
    let user;
    try {
      if (parts[2] === 'register') user = users.register(body);
      else if (parts[2] === 'login') user = users.login(body);
      else throw new HttpError(404, 'Bulunamadı');
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, err.message);
    }
    return send(res, 200, { user }, { 'Set-Cookie': sessionCookie(req, users.createSession(user.id), 60 * 86400) });
  }

  const user = users.userFromToken(token);
  if (!user) throw new HttpError(401, 'Giriş yapmanız gerekiyor');
  const admin = () => {
    if (!user.isAdmin) throw new HttpError(403, 'Bu işlem için yönetici olmanız gerekiyor');
  };

  if (m === 'GET' && parts[1] === 'me') {
    return send(res, 200, { user, unread: users.unreadCount(user.id), vapidKey: push.vapidKeys().publicKey });
  }

  // GET /api/deals?status=A,B&category=&q=&sort=&mine=1
  if (m === 'GET' && parts[1] === 'deals') {
    const favs = users.followedIds(user.id);
    const q = (url.searchParams.get('q') || '').toLocaleLowerCase('tr-TR');
    const cat = url.searchParams.get('category');
    const mine = url.searchParams.get('mine') === '1';
    let items = tracker.allSummaries().filter((x) => x.analysis.price);
    if (mine) items = items.filter((x) => favs.has(x.id));
    const cats = {};
    for (const it of items) if (it.category) cats[it.category] = (cats[it.category] || 0) + 1;
    if (cat) items = items.filter((x) => x.category === cat);
    if (q) items = items.filter((x) => (x.title || x.url).toLocaleLowerCase('tr-TR').includes(q));
    const counts = {};
    for (const it of items) counts[it.analysis.status] = (counts[it.analysis.status] || 0) + 1;
    const status = url.searchParams.get('status');
    if (status) {
      const set = new Set(status.split(','));
      items = items.filter((x) => set.has(x.analysis.status));
    }
    items.sort(SORTS[url.searchParams.get('sort')] || SORTS.skor);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 120, 300);
    return send(res, 200, {
      counts,
      categories: Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })),
      total: items.length,
      items: items.slice(0, limit).map((s) => listItem(s, favs)),
      generatedAt: Date.now(),
    });
  }

  // GET /api/search?q=ürün adı veya link  -> ürünü bulur, 6 aylık geçmişiyle hemen analiz eder
  if (m === 'GET' && parts[1] === 'search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2 || q.length > 300) throw new HttpError(400, 'Aranacak ürün adını veya linkini yazın');
    rateLimit('search:' + user.id, 20, 60e3);
    const { id, alternatives } = await findAndTrack(q, `arama:${user.id}`);
    return send(res, 200, { product: productDetail(db.getProduct(id), user), alternatives });
  }

  if (parts[1] === 'products') {
    const id = parts[2] ? Number(parts[2]) : null;
    if (m === 'POST' && !id) {
      const body = await readJson(req);
      rateLimit('search:' + user.id, 20, 60e3);
      const r = await findAndTrack(String(body.url || ''), `kullanici:${user.id}`);
      return send(res, 201, { product: productDetail(db.getProduct(r.id), user) });
    }
    const p = id ? db.getProduct(id) : null;
    if (!p) throw new HttpError(404, 'Ürün bulunamadı');
    if (m === 'GET' && !parts[3]) return send(res, 200, productDetail(p, user));
    if (m === 'POST' && parts[3] === 'refresh') {
      if (p.last_checked && Date.now() - p.last_checked < 10 * 60e3)
        throw new HttpError(429, 'Bu ürün az önce güncellendi; 10 dakika sonra tekrar deneyin');
      const r = await tracker.checkProduct(p);
      if (!r.ok) throw new HttpError(502, 'Fiyat çekilemedi: ' + r.error);
      return send(res, 200, productDetail(db.getProduct(id), user));
    }
    if (parts[3] === 'follow') {
      if (m === 'POST') users.follow(user.id, id);
      else if (m === 'DELETE') users.unfollow(user.id, id);
      else throw new HttpError(405, 'Desteklenmeyen yöntem');
      return send(res, 200, { ok: true, fav: m === 'POST' });
    }
    if (m === 'DELETE' && !parts[3]) {
      admin();
      db.deleteProduct(id);
      return send(res, 200, { ok: true });
    }
  }

  if (parts[1] === 'alerts') {
    if (m === 'GET') return send(res, 200, users.listAlerts(user.id));
    if (m === 'POST') {
      const body = await readJson(req);
      let alertId;
      try {
        alertId = users.addAlert(user.id, { productId: Number(body.productId), type: body.type, targetPrice: body.targetPrice });
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      // Koşul şu an zaten sağlanıyorsa hemen bildir
      await alerts.evaluate(tracker.productSummary(db.getProduct(Number(body.productId))));
      return send(res, 201, { id: alertId });
    }
    if (m === 'DELETE' && parts[2]) {
      users.deleteAlert(user.id, Number(parts[2]));
      return send(res, 200, { ok: true });
    }
  }

  if (parts[1] === 'notifications') {
    if (m === 'GET') return send(res, 200, { items: users.listNotifications(user.id), unread: users.unreadCount(user.id) });
    if (m === 'POST' && parts[2] === 'read') {
      users.markAllRead(user.id);
      return send(res, 200, { ok: true });
    }
  }

  if (parts[1] === 'push' && m === 'POST') {
    const body = await readJson(req);
    if (parts[2] === 'subscribe') {
      const k = body.keys || {};
      if (!push.validEndpoint(body.endpoint) || !k.p256dh || !k.auth) throw new HttpError(400, 'Geçersiz bildirim aboneliği');
      users.addPushSub(user.id, { endpoint: body.endpoint, p256dh: String(k.p256dh), auth: String(k.auth) });
      return send(res, 200, { ok: true });
    }
    if (parts[2] === 'unsubscribe') {
      const mine = users.pushSubs(user.id).some((s) => s.endpoint === body.endpoint);
      if (mine) users.removePushSub(body.endpoint);
      return send(res, 200, { ok: true });
    }
    if (parts[2] === 'test') {
      rateLimit('pushtest:' + user.id, 5, 60e3);
      const subs = users.pushSubs(user.id);
      const results = [];
      for (const sub of subs) {
        const r = await push.send(sub, { title: 'İndirim Radarı', body: 'Bildirimler çalışıyor.', url: '/#/bildirimler' });
        if (r.gone) users.removePushSub(sub.endpoint);
        results.push(r);
      }
      return send(res, 200, { sent: results.filter((r) => r.ok).length, total: subs.length, results });
    }
  }

  // ---- Yönetici ----
  if (parts[1] === 'admin') {
    admin();
    if (m === 'GET' && !parts[2]) {
      const products = db.listProducts();
      return send(res, 200, {
        inviteCode: users.inviteCode(),
        watchlists: db.listWatchlists(),
        products: products.length,
        failing: products.filter((p) => p.last_error).length,
        refreshHours: config.refreshHours,
      });
    }
    if (parts[2] === 'watchlists') {
      if (m === 'POST') {
        const body = await readJson(req);
        let marketplace;
        try {
          marketplace = ex.detectMarketplace(body.url);
        } catch {
          throw new HttpError(400, 'Geçerli bir sayfa linki girin');
        }
        if (marketplace === 'generic') throw new HttpError(400, 'Keşif Akakçe, Trendyol, Hepsiburada, Amazon TR ve N11 sayfaları için destekleniyor');
        const wid = db.addWatchlist({ marketplace, url: body.url, label: body.label, maxProducts: 30 });
        return send(res, 201, { id: wid });
      }
      if (m === 'DELETE' && parts[3]) {
        db.deleteWatchlist(Number(parts[3]));
        return send(res, 200, { ok: true });
      }
    }
    if (m === 'POST' && parts[2] === 'refresh') {
      tracker.refreshAll({ due: false, log: () => {} }).catch((e) => console.error(e));
      return send(res, 202, { started: true });
    }
    if (parts[2] === 'demo') {
      if (m === 'POST') return send(res, 200, seedDemo());
      if (m === 'DELETE') {
        db.deleteDemo();
        return send(res, 200, { ok: true });
      }
    }
  }

  throw new HttpError(404, 'Bulunamadı');
}

function serveStatic(req, res, url) {
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, SECURITY_HEADERS);
    return res.end('Bulunamadı');
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    // Servis çalışanı ve sayfa her zaman güncel gelsin
    'Cache-Control': 'no-cache',
    ...SECURITY_HEADERS,
  });
  fs.createReadStream(file).pipe(res);
}

function createServer() {
  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return serveStatic(req, res, url);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'Sunucu hatası' });
    }
  });
}

function startScheduler() {
  const tick = () =>
    tracker
      .refreshAll({ due: true, log: () => {} })
      .then((s) => s.checked && console.log(`[zamanlayıcı] ${s.ok}/${s.checked} ürün güncellendi, ${s.discovered} yeni ürün`))
      .catch((e) => console.error('[zamanlayıcı]', e));
  setTimeout(tick, 5000);
  // Her 15 dakikada bir vakti gelen ürün var mı bakılır
  return setInterval(tick, 15 * 60 * 1000);
}

/** İlk açılışta Akakçe kampanya sayfalarını keşif listesine ekler */
function ensureDefaultWatchlists() {
  if (process.env.NO_DEFAULT_LISTS || db.getSetting('defaults_added')) return;
  for (const [url, label] of DEFAULT_LISTS) db.addWatchlist({ marketplace: 'akakce', url, label, maxProducts: 30 });
  db.setSetting('defaults_added', '1');
}

if (require.main === module) {
  db.open();
  ensureDefaultWatchlists();
  createServer().listen(config.port, () => {
    console.log(`İndirim Radarı: http://localhost:${config.port}`);
    console.log(`Davet kodu (kayıt için gerekli): ${users.inviteCode()}`);
    console.log(`Ürünler her ${config.refreshHours} saatte bir, kampanya sayfaları her ${config.discoverHours} saatte bir taranır.`);
  });
  if (!process.argv.includes('--no-scheduler')) startScheduler();
}

module.exports = { createServer, ensureDefaultWatchlists };
