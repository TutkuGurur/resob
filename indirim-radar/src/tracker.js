'use strict';

const config = require('./config');
const db = require('./db');
const { analyze } = require('./analysis');
const ex = require('./extractors');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastHit = new Map(); // host -> zaman; aynı siteye art arda istek atmamak için

async function politeFetch(url) {
  const host = new URL(url).hostname;
  const wait = (lastHit.get(host) || 0) + config.requestDelayMs + Math.random() * 1500 - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());

  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(config.requestTimeoutMs),
    headers: {
      'User-Agent': config.userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.6',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { html: await res.text(), finalUrl: res.url || url };
}

/** Bir ürün sayfasını çeker, fiyatı kaydeder */
async function checkProduct(product, fetcher = politeFetch) {
  try {
    const { html } = await fetcher(product.url);
    const data = ex.extractProduct(html, product.url);
    if (!data.price) throw new Error('Fiyat sayfada bulunamadı (site yapısı değişmiş veya bot koruması olabilir)');
    db.upsertProduct({ ...product, ...data, url: product.url });
    db.addSnapshot(product.id, data);
    db.markChecked(product.id, null);
    return { ok: true, data };
  } catch (err) {
    db.markChecked(product.id, String(err.message || err));
    return { ok: false, error: String(err.message || err) };
  }
}

/** URL'den yeni ürün ekler ve ilk fiyatı çeker */
async function addProductByUrl(rawUrl, { source = 'manual', fetcher = politeFetch } = {}) {
  const url = ex.normalizeUrl(rawUrl);
  const marketplace = ex.detectMarketplace(url);
  const id = db.upsertProduct({ marketplace, url, source });
  const product = db.getProduct(id);
  const result = await checkProduct(product, fetcher);
  return { id, url, marketplace, ...result };
}

/** Kampanya/kategori sayfasındaki ürünleri keşfeder ve takibe alır */
async function runWatchlist(w, { fetcher = politeFetch, log = () => {} } = {}) {
  try {
    const { html, finalUrl } = await fetcher(w.url);
    const links = ex.discoverProductLinks(html, finalUrl).slice(0, w.max_products);
    const known = new Set(db.listProducts().map((p) => p.url));
    let added = 0;
    for (const link of links) {
      if (known.has(link)) continue;
      const r = await addProductByUrl(link, { source: `watchlist:${w.id}`, fetcher });
      if (r.ok) added++;
      log(`  + ${link} ${r.ok ? r.data.price + ' TL' : 'HATA: ' + r.error}`);
    }
    db.markWatchlistRun(w.id, links.length ? null : 'Sayfada ürün linki bulunamadı');
    return { found: links.length, added };
  } catch (err) {
    db.markWatchlistRun(w.id, String(err.message || err));
    return { found: 0, added: 0, error: String(err.message || err) };
  }
}

let running = false;
/** Tüm aktif ürünleri günceller; due=true ise yalnızca vakti gelenleri */
async function refreshAll({ due = true, log = console.log, fetcher = politeFetch } = {}) {
  if (running) return { skipped: true };
  running = true;
  const stats = { checked: 0, ok: 0, failed: 0, discovered: 0 };
  try {
    const nowT = Date.now();
    for (const w of db.listWatchlists().filter((x) => x.active)) {
      if (due && w.last_run && nowT - w.last_run < config.discoverHours * 3600e3) continue;
      log(`Keşif: ${w.label || w.url}`);
      const r = await runWatchlist(w, { fetcher, log });
      stats.discovered += r.added;
    }
    const products = db.listProducts({ activeOnly: true }).filter((p) => !p.is_demo);
    for (const p of products) {
      if (due && p.last_checked && nowT - p.last_checked < config.refreshHours * 3600e3 * 0.9) continue;
      const r = await checkProduct(p, fetcher);
      stats.checked++;
      r.ok ? stats.ok++ : stats.failed++;
      log(`${r.ok ? '✓' : '✗'} [${p.marketplace}] ${p.title || p.url} ${r.ok ? r.data.price + ' TL' : r.error}`);
    }
  } finally {
    running = false;
  }
  return stats;
}

/** Ürün + analiz özetini döner */
function productSummary(p) {
  const snaps = db.getSnapshots(p.id, Date.now() - 400 * 24 * 3600e3);
  return {
    id: p.id,
    marketplace: p.marketplace,
    marketplaceName: ex.marketplaceName(p.marketplace),
    url: p.url,
    title: p.title,
    image: p.image,
    brand: p.brand,
    category: p.category,
    active: !!p.active,
    isDemo: !!p.is_demo,
    lastChecked: p.last_checked,
    lastError: p.last_error,
    analysis: analyze(snaps),
  };
}

function allSummaries() {
  return db.listProducts().map(productSummary);
}

module.exports = { politeFetch, checkProduct, addProductByUrl, runWatchlist, refreshAll, productSummary, allSummaries };
