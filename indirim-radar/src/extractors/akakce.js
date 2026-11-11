'use strict';

/**
 * Akakçe (fiyat karşılaştırma) desteği.
 *
 * Akakçe ürün sayfası şunları sunar:
 *  - schema.org ProductGroup/AggregateOffer: tüm satıcıların (Trendyol, Hepsiburada, Amazon, N11 ...) güncel fiyatları ve linkleri
 *  - "son 6 aylık fiyat değişim tablosu": tarih + o günkü en ucuz fiyat (yalnızca fiyatın değiştiği günler)
 *
 * Bu sayede bir ürün ilk eklendiği anda 6 aylık geçmişe sahip olur; 30 gün veri toplamayı beklemek gerekmez.
 */

const c = require('./common');

const DAY = 24 * 60 * 60 * 1000;

/** "11.11.2026" -> o günün öğle saati (TR, UTC+3) */
function parseTrDate(s) {
  const m = String(s).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 9) : null;
}

/** Fiyat değişim tablosundaki satırlar: [{ t, price }] (eskiden yeniye) */
function parseHistoryTable(html) {
  const table = (html.match(/<table class="graph_table">[\s\S]*?<\/table>/) || [])[0];
  if (!table) return [];
  const out = [];
  const re = /<tr>\s*<td>(\d{2}\.\d{2}\.\d{4})<\/td>\s*<td>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(table))) {
    const t = parseTrDate(m[1]);
    const price = c.parsePrice(c.cleanText(m[2]));
    if (t && price) out.push({ t, price });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Değişim noktalarını günlük kayda çevirir (fiyat bir sonraki değişime kadar geçerli) */
function expandDaily(points, untilT) {
  const out = [];
  if (!points.length) return out;
  let k = 0;
  for (let t = points[0].t; t <= untilT; t += DAY) {
    while (k + 1 < points.length && points[k + 1].t <= t) k++;
    out.push({ capturedAt: t, price: points[k].price });
  }
  return out;
}

function storeFromOffer(o) {
  try {
    const host = new URL(o.url).hostname.replace(/^www\./, '');
    return host;
  } catch {
    return null;
  }
}

function extract(html, url, now = Date.now()) {
  const ldNode = c.findLdProduct(c.extractJsonLd(html)) || {};
  const agg = ldNode.offers || {};
  const offers = (Array.isArray(agg.offers) ? agg.offers : [])
    .map((o) => ({
      seller: o.seller && o.seller.name ? c.cleanText(o.seller.name) : null,
      store: storeFromOffer(o),
      price: c.parsePrice(o.price),
      url: o.url || null,
      inStock: !/OutOfStock/i.test(String(o.availability || '')),
    }))
    .filter((o) => o.price)
    .sort((a, b) => a.price - b.price);

  const history = parseHistoryTable(html);
  const cpAttr = c.firstMatch(html, /id="priceTitle"[^>]*data-o="[^"]*\bcp:([\d.]+)/);
  const price = c.parsePrice(agg.lowPrice) || (offers[0] && offers[0].price) || c.parsePrice(cpAttr) ||
    (history.length ? history[history.length - 1].price : null);

  // "Gösterilen indirim": son fiyat değişimi bir düşüşse ve son 7 gün içindeyse, önceki fiyat
  // akakçe ve mağazaların "fiyatı düştü %X" diye gösterdiği referanstır.
  let listPrice = null;
  if (history.length >= 2) {
    const last = history[history.length - 1];
    const prev = history[history.length - 2];
    if (prev.price > last.price && now - last.t < 7 * DAY) listPrice = prev.price;
  }

  const image = Array.isArray(ldNode.image) ? ldNode.image[0] : ldNode.image;
  return {
    title: c.cleanText(ldNode.name) || c.cleanText(c.firstMatch(html, /data-product-name="([^"]+)"/)),
    image: image && typeof image === 'object' ? image.contentUrl || image.url : image || null,
    brand: ldNode.brand && typeof ldNode.brand === 'object' ? ldNode.brand.name : ldNode.brand || null,
    category: ldNode.category ? String(ldNode.category).split('>').pop().trim() : null,
    externalId: ldNode.sku || ldNode.productGroupID || null,
    price,
    listPrice,
    seller: offers[0] ? offers[0].seller : null,
    inStock: !/OutOfStock/i.test(String(agg.availability || '')),
    offers: offers.slice(0, 15),
    history,
  };
}

module.exports = {
  name: 'Akakçe',
  match: (h) => /(^|\.)akakce\.com$/.test(h),
  normalize(u) {
    const x = new URL(u);
    x.search = '';
    x.hash = '';
    return x.toString();
  },
  productLink: /fiyati,\d+\.html/,
  extract,
  parseHistoryTable,
  expandDaily,
  parseTrDate,
};
