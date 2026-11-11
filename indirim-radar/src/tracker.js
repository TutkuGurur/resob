'use strict';

const config = require('./config');
const db = require('./db');
const { analyze } = require('./analysis');
const ex = require('./extractors');
const akakce = require('./extractors/akakce');
const users = require('./users');
const alerts = require('./alerts');

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
    const nowT = Date.now();
    if (data.history && data.history.length) {
      // Kaynak sitenin geçmiş fiyatlarını (ör. Akakçe 6 aylık tablo) günlük kayıt olarak içe aktar
      const since = db.lastSnapshotTime(product.id);
      for (const h of akakce.expandDaily(data.history, nowT - 3600e3)) {
        if (h.capturedAt > since) db.addSnapshot(product.id, { price: h.price, capturedAt: h.capturedAt, seller: 'geçmiş' });
      }
    }
    db.addSnapshot(product.id, { ...data, capturedAt: nowT });
    db.markChecked(product.id, null);
    try {
      await alerts.evaluate(productSummary(db.getProduct(product.id)));
    } catch (err) {
      console.error('[alarm]', err);
    }
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
    // Kullanıcıların takip ettiği ürünler önce güncellenir
    const followed = users.allFollowedIds();
    const products = db
      .listProducts({ activeOnly: true })
      .filter((p) => !p.is_demo)
      .sort((a, b) => Number(followed.has(b.id)) - Number(followed.has(a.id)));
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

const safeJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const summaryCache = new Map(); // id -> { key, value }

/** Ürün + analiz özetini döner (son kontrolden beri değişmediyse önbellekten) */
function productSummary(p) {
  const key = `${p.last_checked}|${p.last_error}|${p.active}`;
  const hit = summaryCache.get(p.id);
  if (hit && hit.key === key) return hit.value;
  const value = computeSummary(p);
  summaryCache.set(p.id, { key, value });
  return value;
}

/** Kart grafiği için son 90 günün günlük en düşük fiyatları: [[gün, fiyat], ...] */
function sparkOf(snaps) {
  const since = Date.now() - 90 * 864e5;
  const byDay = new Map();
  for (const s of snaps) {
    if (s.capturedAt < since || s.inStock === 0) continue;
    const d = Math.floor(s.capturedAt / 864e5);
    const cur = byDay.get(d);
    if (cur === undefined || s.price < cur) byDay.set(d, s.price);
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]);
}

function computeSummary(p) {
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
    spark: sparkOf(snaps),
    offers: p.offers_json ? safeJson(p.offers_json) : null,
  };
}

function allSummaries() {
  return db.listProducts().map(productSummary);
}

module.exports = { politeFetch, checkProduct, addProductByUrl, runWatchlist, refreshAll, productSummary, allSummaries };
