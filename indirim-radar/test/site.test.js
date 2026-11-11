'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DB_PATH = ':memory:';
process.env.INVITE_CODE = 'test-davet';
process.env.NO_DEFAULT_LISTS = '1';
const db = require('../src/db');
const users = require('../src/users');
const alerts = require('../src/alerts');
const push = require('../src/push');
const tracker = require('../src/tracker');
const { createServer } = require('../src/server');
const { DAY } = require('../src/analysis');

db.open(':memory:');

function seedProduct(url, segments) {
  const id = db.upsertProduct({ marketplace: 'akakce', url, title: 'Test Ürün', category: 'Test' });
  let t = Date.now() - segments.reduce((a, s) => a + s[0], 0) * DAY;
  for (const [days, price] of segments) for (let i = 0; i < days; i++, t += DAY) db.addSnapshot(id, { price, capturedAt: t });
  db.addSnapshot(id, { price: segments.at(-1)[1], capturedAt: Date.now() });
  db.markChecked(id, null);
  return id;
}

test('kayıt: davet kodu, şifre kuralı, tekrar e-posta; giriş ve oturum', () => {
  assert.throws(() => users.register({ email: 'a@b.co', name: 'A', password: 'uzun-sifre-1', invite: 'yanlis' }), /Davet kodu/);
  assert.throws(() => users.register({ email: 'a@b.co', name: 'A', password: 'kisa', invite: 'test-davet' }), /en az 8/);
  const u = users.register({ email: 'A@B.co', name: 'A', password: 'uzun-sifre-1', invite: 'test-davet' });
  assert.equal(u.email, 'a@b.co');
  assert.equal(u.isAdmin, true); // ilk kullanıcı yönetici
  assert.throws(() => users.register({ email: 'a@b.co', name: 'A', password: 'uzun-sifre-1', invite: 'test-davet' }), /zaten kayıtlı/);
  assert.equal(users.register({ email: 'c@d.co', name: 'C', password: 'uzun-sifre-2', invite: 'test-davet' }).isAdmin, false);
  assert.throws(() => users.login({ email: 'a@b.co', password: 'yanlis-sifre' }), /hatalı/);
  assert.throws(() => users.login({ email: 'yok@b.co', password: 'uzun-sifre-1' }), /hatalı/);
  const token = users.createSession(users.login({ email: 'a@b.co', password: 'uzun-sifre-1' }).id);
  assert.equal(users.userFromToken(token).email, 'a@b.co');
  assert.equal(users.userFromToken('sahte'), null);
  users.destroySession(token);
  assert.equal(users.userFromToken(token), null);
});

test('alarm: koşul sağlanınca bir kez bildirir, bozulup yeniden sağlanınca tekrar bildirir', async () => {
  const u = users.register({ email: 'alarm@x.co', name: 'Alarm', password: 'uzun-sifre-3', invite: 'test-davet' });
  const id = seedProduct('https://www.akakce.com/t/en-ucuz-a-fiyati,1.html', [[40, 1000]]);
  users.addAlert(u.id, { productId: id, type: 'fiyat', targetPrice: 900 });
  users.addAlert(u.id, { productId: id, type: 'gercek' });
  users.addPushSub(u.id, { endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'k', auth: 'a' });
  const sent = [];
  const sender = async (sub, msg) => { sent.push(msg); return { ok: true }; };
  const summary = () => tracker.productSummary(db.getProduct(id));

  assert.equal(await alerts.evaluate(summary(), { sender }), 0); // 1000 TL: koşul yok

  db.addSnapshot(id, { price: 850, capturedAt: Date.now() + 1 });
  db.markChecked(id, null);
  assert.equal(await alerts.evaluate(summary(), { sender }), 2); // hedefin altı + gerçek indirim (%15)
  assert.equal(sent.length, 2);
  assert.match(sent[0].url, new RegExp(`/#/urun/${id}$`));
  assert.equal(await alerts.evaluate(summary(), { sender }), 0); // aynı durumda tekrar bildirmez
  assert.equal(users.unreadCount(u.id), 2);

  db.addSnapshot(id, { price: 1000, capturedAt: Date.now() + 2 });
  db.markChecked(id, null);
  await alerts.evaluate(summary(), { sender }); // koşul bozuldu -> sıfırlanır
  assert.equal(users.listAlerts(u.id).every((a) => !a.triggered), true);

  // Geçersiz abonelik (410) silinir
  db.addSnapshot(id, { price: 800, capturedAt: Date.now() + 3 });
  db.markChecked(id, null);
  await alerts.evaluate(summary(), { sender: async () => ({ ok: false, gone: true }) });
  assert.equal(users.pushSubs(u.id).length, 0);
});

test('web push: RFC 8291 şifreleme alıcı tarafında çözülür, VAPID imzası geçerli', () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const body = push.encrypt('{"title":"Merhaba"}', ua.getPublicKey().toString('base64url'), auth.toString('base64url'));

  const salt = body.subarray(0, 16);
  const keyLen = body.readUInt8(20);
  const asPub = body.subarray(21, 21 + keyLen);
  const cipherText = body.subarray(21 + keyLen);
  const shared = ua.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipherText.subarray(cipherText.length - 16));
  const plain = Buffer.concat([d.update(cipherText.subarray(0, cipherText.length - 16)), d.final()]);
  assert.equal(plain.toString(), '{"title":"Merhaba"}\x02');

  const keys = push.vapidKeys();
  const header = push.vapidHeader('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:a@b.co');
  const jwt = header.match(/t=([^,]+)/)[1];
  const [h, p, s] = jwt.split('.');
  const raw = Buffer.from(keys.publicKey, 'base64url');
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.equal(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), true);
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, 'https://fcm.googleapis.com');

  assert.equal(push.validEndpoint('https://fcm.googleapis.com/fcm/send/x'), true);
  assert.equal(push.validEndpoint('https://web.push.apple.com/x'), true);
  assert.equal(push.validEndpoint('http://fcm.googleapis.com/x'), false);
  assert.equal(push.validEndpoint('https://localhost/x'), false);
  assert.equal(push.validEndpoint('https://169.254.169.254/latest'), false);
  assert.equal(push.validEndpoint('https://evilfcm.googleapis.com.example.org/x'), false);
});

test('HTTP API: giriş zorunlu, kişisel liste/alarm ayrımı, yönetici ve kaynak kontrolü', async () => {
  const server = createServer().listen(0);
  const base = `http://localhost:${server.address().port}`;
  const call = async (path, { method = 'GET', body, cookie, origin } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})), cookie: (res.headers.get('set-cookie') || '').split(';')[0], headers: res.headers };
  };
  try {
    assert.equal((await call('/api/deals')).status, 401);
    assert.equal((await call('/api/products/1')).status, 401);
    assert.equal((await call('/api/health')).status, 200);

    const admin = await call('/api/auth/login', { method: 'POST', body: { email: 'a@b.co', password: 'uzun-sifre-1' } });
    assert.equal(admin.status, 200);
    assert.match(admin.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    const member = await call('/api/auth/login', { method: 'POST', body: { email: 'c@d.co', password: 'uzun-sifre-2' } });

    const id = seedProduct('https://www.akakce.com/t/en-ucuz-b-fiyati,2.html', [[40, 500], [3, 400]]);
    const deals = await call('/api/deals?status=GERCEK_INDIRIM', { cookie: member.cookie });
    assert.ok(deals.json.items.some((x) => x.id === id && x.fav === false && x.spark.length > 10));
    assert.ok(deals.json.categories.some((c) => c.name === 'Test'));

    // Takip + alarm üyeye özel
    assert.equal((await call(`/api/products/${id}/follow`, { method: 'POST', cookie: member.cookie })).status, 200);
    assert.equal((await call('/api/alerts', { method: 'POST', cookie: member.cookie, body: { productId: id, type: 'fiyat', targetPrice: 350 } })).status, 201);
    assert.equal((await call('/api/alerts', { method: 'POST', cookie: member.cookie, body: { productId: id, type: 'fiyat', targetPrice: -5 } })).status, 400);
    assert.equal((await call('/api/deals?mine=1', { cookie: member.cookie })).json.total, 1);
    assert.equal((await call('/api/deals?mine=1', { cookie: admin.cookie })).json.items.some((x) => x.id === id), false);
    const memberAlerts = (await call('/api/alerts', { cookie: member.cookie })).json;
    assert.equal(memberAlerts.length, 1);
    assert.equal((await call('/api/alerts', { cookie: admin.cookie })).json.some((a) => a.id === memberAlerts[0].id), false);
    // Başkasının alarmını silemez
    await call('/api/alerts/' + memberAlerts[0].id, { method: 'DELETE', cookie: admin.cookie });
    assert.equal((await call('/api/alerts', { cookie: member.cookie })).json.length, 1);

    // Yönetici uçları
    assert.equal((await call('/api/admin', { cookie: member.cookie })).status, 403);
    assert.equal((await call(`/api/products/${id}`, { method: 'DELETE', cookie: member.cookie })).status, 403);
    assert.equal((await call('/api/admin', { cookie: admin.cookie })).json.inviteCode, 'test-davet');

    // Başka siteden gelen değiştirici istek reddedilir
    assert.equal((await call(`/api/products/${id}/follow`, { method: 'DELETE', cookie: member.cookie, origin: 'https://kotu.example' })).status, 403);

    // Bildirim aboneliği yalnızca bilinen servis adreslerine
    assert.equal((await call('/api/push/subscribe', { method: 'POST', cookie: member.cookie, body: { endpoint: 'https://ic-sunucu.local/x', keys: { p256dh: 'a', auth: 'b' } } })).status, 400);

    // Statik dosyalar ve dizin dışına çıkma
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal((await fetch(base + '/..%2Fpackage.json')).status, 404);

    // Çıkış
    await call('/api/auth/logout', { method: 'POST', cookie: member.cookie });
    assert.equal((await call('/api/me', { cookie: member.cookie })).status, 401);
  } finally {
    server.close();
  }
});
