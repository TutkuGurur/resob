'use strict';

/**
 * Toplu çalışma: kullanıcının istediği ürünleri bulur, takip listesi + Akakçe kampanya
 * sayfalarını tarar ve paylaşılabilir HTML raporu üretir. Zamanlanmış görevden çağrılır.
 */

const fs = require('node:fs');
const db = require('./db');
const tracker = require('./tracker');
const ex = require('./extractors');
const akakce = require('./extractors/akakce');
const { buildData, renderHtml } = require('./report');

const DEFAULT_LISTS = [
  ['https://www.akakce.com/fiyati-dusen-urunler/', 'Fiyatı düşen ürünler'],
  ['https://www.akakce.com/sepette-indirimle-en-ucuz/', 'Sepette indirim'],
  ['https://www.akakce.com/black-friday-indirimleri/', 'Black Friday'],
  ['https://www.akakce.com/11-11-indirimi/', '11.11 indirimi'],
];

/** Mağaza linkinin yolundan ürün adı tahmini */
function nameFromUrl(url) {
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean);
  const dp = parts.findIndex((x) => x === 'dp' || x === 'gp');
  let seg = dp > 0 ? parts[dp - 1] : parts[parts.length - 1] || '';
  // Trendyol: /<marka>/<ürün-adı>-p-123 -> markayı da ekle
  if (dp < 0 && /trendyol\.com$/.test(u.hostname) && parts.length >= 2) seg = parts[parts.length - 2] + '-' + seg;
  seg = decodeURIComponent(seg)
    .replace(/\.html?$/i, '')
    .replace(/-p[m]?-[A-Za-z0-9]+$/i, '') // trendyol/hepsiburada ürün kodu
    .replace(/-(kc[m]?\d+|\d{5,})$/i, '')
    .replace(/[-_+]+/g, ' ')
    .trim();
  return seg.split(' ').filter(Boolean).length >= 2 ? seg : null;
}

/**
 * Kullanıcının yazdığı metni (ürün adı veya link) takip edilecek ürün linkine çevirir.
 * @returns {Promise<{ok:boolean, url?:string, title?:string, alternatives?:Array, error?:string}>}
 */
async function resolveQuery(q, { fetcher = tracker.politeFetch } = {}) {
  const text = String(q || '').trim();
  if (!text) return { ok: false, error: 'Boş istek' };
  if (/^https?:\/\//i.test(text)) {
    let url;
    try {
      url = ex.normalizeUrl(text);
    } catch {
      return { ok: false, error: 'Geçersiz link' };
    }
    const mp = ex.detectMarketplace(url);
    if (mp === 'akakce') {
      if (!akakce.productLink.test(url)) return { ok: false, error: 'Bu bir Akakçe ürün sayfası değil' };
      return { ok: true, url };
    }
    // Mağaza linki: ürün adını sayfadan çıkarıp Akakçe'de ara (6 aylık geçmiş için)
    try {
      const { html } = await fetcher(url);
      const info = ex.extractProduct(html, url);
      if (info.title) return resolveQuery(info.title, { fetcher });
    } catch {
      /* mağaza sayfası açılamadı */
    }
    // Sayfa açılamadıysa ürün adını linkin kendisinden çıkar (ör. .../roborock/s8-pro-robot-supurge-p-123)
    const slug = nameFromUrl(url);
    if (slug) return resolveQuery(slug, { fetcher });
    return { ok: false, error: 'Mağaza linkinden ürün okunamadı; ürün adını yazmayı deneyin' };
  }
  const { html } = await fetcher('https://www.akakce.com/arama/?q=' + encodeURIComponent(text));
  const results = akakce.parseSearch(html);
  const [best] = akakce.pickSearchResults(results, 1);
  if (!best) return { ok: false, error: `Akakçe'de "${text}" için ürün bulunamadı` };
  return {
    ok: true,
    url: best.url,
    title: best.title,
    alternatives: results.filter((r) => r.url !== best.url && r.sellers >= 3).slice(0, 3),
  };
}

/**
 * @param {object} o
 * @param {string[]} o.takip  takip edilen Akakçe ürün linkleri
 * @param {string} o.out      HTML çıktı dosyası
 * @param {number} [o.listMax] her kampanya sayfasından en fazla kaç ürün
 */
async function runBatch({ takip = [], out, listMax = 20, log = console.log, fetcher = tracker.politeFetch }) {
  db.open();
  const stats = { takip: 0, kesif: 0, hata: 0 };
  for (const url of takip) {
    const r = await tracker.addProductByUrl(url, { source: 'takip', fetcher });
    r.ok ? stats.takip++ : stats.hata++;
    log(`${r.ok ? '✓' : '✗'} [takip] ${r.ok ? r.data.title : url + ' ' + r.error}`);
  }
  for (const [url, label] of DEFAULT_LISTS) {
    const id = db.addWatchlist({ marketplace: 'akakce', url, label, maxProducts: listMax });
    const w = db.listWatchlists().find((x) => x.id === id);
    const r = await tracker.runWatchlist(w, { fetcher });
    stats.kesif += r.added;
    log(`${label}: ${r.found} bulundu, ${r.added} eklendi${r.error ? ' — ' + r.error : ''}`);
  }
  // Takip listesindeki ürünler önceden eklenmişse de güncel fiyat al
  const pinned = new Set(takip.map((u) => ex.normalizeUrl(u)));
  const items = buildData({ pinned });
  if (out) fs.writeFileSync(out, renderHtml({ items }));
  return { ...stats, urun: items.length };
}

module.exports = { nameFromUrl, resolveQuery, runBatch, DEFAULT_LISTS };
