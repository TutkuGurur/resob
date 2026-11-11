'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const db = require('./db');
const tracker = require('./tracker');
const ex = require('./extractors');
const { seedDemo } = require('./demo');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e6) throw new Error('İstek çok büyük');
  }
  return raw ? JSON.parse(raw) : {};
}

function validUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || x.protocol === 'http:';
  } catch {
    return false;
  }
}

const SORTS = {
  skor: (a, b) => b.analysis.dealScore - a.analysis.dealScore,
  gercek: (a, b) => (b.analysis.realDiscountPct || 0) - (a.analysis.realDiscountPct || 0),
  fiyat: (a, b) => (a.analysis.price || 0) - (b.analysis.price || 0),
  yeni: (a, b) => (b.analysis.discountStartedAt || 0) - (a.analysis.discountStartedAt || 0),
};

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const m = req.method;

  // GET /api/deals?status=GERCEK_INDIRIM,ABARTILI_INDIRIM&marketplace=trendyol&q=...&sort=skor
  if (m === 'GET' && parts[1] === 'deals') {
    const status = url.searchParams.get('status');
    const mp = url.searchParams.get('marketplace');
    const q = (url.searchParams.get('q') || '').toLocaleLowerCase('tr-TR');
    let items = tracker.allSummaries();
    const counts = {};
    for (const it of items) counts[it.analysis.status] = (counts[it.analysis.status] || 0) + 1;
    if (status) {
      const set = new Set(status.split(','));
      items = items.filter((x) => set.has(x.analysis.status));
    }
    if (mp) items = items.filter((x) => x.marketplace === mp);
    if (q) items = items.filter((x) => (x.title || x.url).toLocaleLowerCase('tr-TR').includes(q));
    items.sort(SORTS[url.searchParams.get('sort')] || SORTS.skor);
    return send(res, 200, { counts, total: items.length, items, generatedAt: Date.now() });
  }

  if (parts[1] === 'products') {
    const id = parts[2] ? Number(parts[2]) : null;
    if (m === 'GET' && id) {
      const p = db.getProduct(id);
      if (!p) return send(res, 404, { error: 'Ürün bulunamadı' });
      return send(res, 200, { ...tracker.productSummary(p), history: db.getSnapshots(id) });
    }
    if (m === 'POST' && !id) {
      const body = await readJson(req);
      if (!validUrl(body.url)) return send(res, 400, { error: 'Geçerli bir ürün URL\'si girin' });
      const r = await tracker.addProductByUrl(body.url);
      return send(res, r.ok ? 201 : 202, r);
    }
    if (m === 'POST' && id && parts[3] === 'refresh') {
      const p = db.getProduct(id);
      if (!p) return send(res, 404, { error: 'Ürün bulunamadı' });
      return send(res, 200, await tracker.checkProduct(p));
    }
    if (m === 'PATCH' && id) {
      const body = await readJson(req);
      db.setProductActive(id, !!body.active);
      return send(res, 200, { ok: true });
    }
    if (m === 'DELETE' && id) {
      db.deleteProduct(id);
      return send(res, 200, { ok: true });
    }
  }

  if (parts[1] === 'watchlists') {
    const id = parts[2] ? Number(parts[2]) : null;
    if (m === 'GET') return send(res, 200, db.listWatchlists());
    if (m === 'POST' && !id) {
      const body = await readJson(req);
      if (!validUrl(body.url)) return send(res, 400, { error: 'Geçerli bir sayfa URL\'si girin' });
      const marketplace = ex.detectMarketplace(body.url);
      if (marketplace === 'generic')
        return send(res, 400, { error: 'Keşif şu an Trendyol, Hepsiburada, Amazon TR, N11 ve Çiçeksepeti için destekleniyor' });
      const wid = db.addWatchlist({ marketplace, url: body.url, label: body.label, maxProducts: body.maxProducts });
      const w = db.listWatchlists().find((x) => x.id === wid);
      const r = await tracker.runWatchlist(w);
      return send(res, 201, { id: wid, ...r });
    }
    if (m === 'DELETE' && id) {
      db.deleteWatchlist(id);
      return send(res, 200, { ok: true });
    }
  }

  if (m === 'POST' && parts[1] === 'refresh') {
    tracker.refreshAll({ due: false }).catch((e) => console.error(e));
    return send(res, 202, { started: true });
  }

  if (m === 'POST' && parts[1] === 'demo') {
    return send(res, 200, seedDemo());
  }
  if (m === 'DELETE' && parts[1] === 'demo') {
    db.deleteDemo();
    return send(res, 200, { ok: true });
  }

  if (m === 'GET' && parts[1] === 'config') {
    return send(res, 200, { analysis: config.analysis, refreshHours: config.refreshHours, discoverHours: config.discoverHours });
  }

  return send(res, 404, { error: 'Bulunamadı' });
}

function serveStatic(req, res, url) {
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('Bulunamadı');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return serveStatic(req, res, url);
    } catch (err) {
      console.error(err);
      send(res, 500, { error: String(err.message || err) });
    }
  });
}

function startScheduler() {
  const tick = () =>
    tracker
      .refreshAll({ due: true })
      .then((s) => s.checked && console.log(`[zamanlayıcı] ${s.ok}/${s.checked} ürün güncellendi, ${s.discovered} yeni ürün`))
      .catch((e) => console.error('[zamanlayıcı]', e));
  setTimeout(tick, 5000);
  // Her 15 dakikada bir vakti gelen ürün var mı bakılır
  return setInterval(tick, 15 * 60 * 1000);
}

if (require.main === module) {
  db.open();
  createServer().listen(config.port, () => {
    console.log(`İndirim Radarı: http://localhost:${config.port}`);
    console.log(`Ürünler her ${config.refreshHours} saatte bir, kampanya sayfaları her ${config.discoverHours} saatte bir taranır.`);
  });
  if (!process.argv.includes('--no-scheduler')) startScheduler();
}

module.exports = { createServer };
