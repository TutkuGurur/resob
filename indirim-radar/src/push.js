'use strict';

/**
 * Web Push (RFC 8030 / 8291 / 8292) — harici paket olmadan.
 * Tarayıcı/telefon bildirimleri için: VAPID kimliği + aes128gcm içerik şifreleme.
 */

const crypto = require('node:crypto');
const db = require('./db');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

// Abonelik adresi kullanıcıdan geldiği için yalnızca bilinen bildirim servislerine istek atılır (SSRF önlemi)
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

function validEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** VAPID anahtar çifti: ilk kullanımda üretilir, veritabanında saklanır */
function vapidKeys() {
  let raw = db.getSetting('vapid');
  if (!raw) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    const pub = Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]);
    raw = JSON.stringify({ publicKey: b64u(pub), privateJwk: privateKey.export({ format: 'jwk' }) });
    db.setSetting('vapid', raw);
  }
  return JSON.parse(raw);
}

function vapidHeader(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: keys.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** RFC 8291 aes128gcm şifreleme. Dönen gövde doğrudan POST edilir. */
function encrypt(payload, p256dh, auth, { salt = crypto.randomBytes(16), ecdh } = {}) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('Geçersiz abonelik anahtarı');
  const as = ecdh || crypto.createECDH('prime256v1');
  if (!ecdh) as.generateKeys();
  const asPublic = as.getPublicKey();
  const shared = as.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const data = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, data]);
}

/** Tek aboneliğe gönderir. { ok, gone } — gone: abonelik artık geçersiz, silinmeli */
async function send(sub, message, { fetcher = fetch } = {}) {
  if (!validEndpoint(sub.endpoint)) return { ok: false, gone: true };
  const keys = vapidKeys();
  const body = encrypt(JSON.stringify(message), sub.p256dh, sub.auth);
  try {
    const res = await fetcher(sub.endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
        Authorization: vapidHeader(sub.endpoint, keys, process.env.VAPID_SUBJECT || 'mailto:admin@example.com'),
      },
      body,
    });
    return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
  } catch (err) {
    return { ok: false, gone: false, error: String(err.message || err) };
  }
}

module.exports = { vapidKeys, vapidHeader, encrypt, send, validEndpoint };
