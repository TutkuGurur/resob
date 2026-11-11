'use strict';

/** Türkçe/İngilizce fiyat metnini sayıya çevirir: "1.299,90 TL" -> 1299.9, "1299.90" -> 1299.9 */
function parsePrice(input) {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : null;
  let s = String(input).replace(/&nbsp;| /g, ' ').replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastComma !== -1) {
    const parts = s.split(',');
    const after = parts[parts.length - 1];
    s = parts.length > 2 || after.length === 3 ? parts.join('') : parts.join('.');
  } else if (lastDot !== -1) {
    const parts = s.split('.');
    const after = parts[parts.length - 1];
    s = parts.length > 2 || after.length === 3 ? parts.join('') : s;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9#]+);/gi, (m, k) => ENTITIES[k.toLowerCase()] ?? m);
}

const cleanText = (s) => (s ? decodeEntities(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : null);

/** Sayfadaki tüm application/ld+json bloklarını ayrıştırır */
function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    try {
      out.push(JSON.parse(raw));
    } catch {
      try {
        // Bazı siteler kontrol karakteri / sondaki virgül bırakır
        out.push(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ').replace(/,\s*([}\]])/g, '$1')));
      } catch {
        /* yoksay */
      }
    }
  }
  return out;
}

function hasType(node, type) {
  const t = node && node['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

/** JSON-LD ağacında ilk Product düğümünü bulur */
function findLdProduct(ldList) {
  const stack = [...ldList];
  while (stack.length) {
    const n = stack.shift();
    if (!n || typeof n !== 'object') continue;
    if (Array.isArray(n)) {
      stack.push(...n);
      continue;
    }
    if (hasType(n, 'Product') || hasType(n, 'ProductGroup')) return n;
    if (n['@graph']) stack.push(n['@graph']);
    if (n.mainEntity) stack.push(n.mainEntity);
  }
  return null;
}

function fromLdProduct(prod) {
  if (!prod) return {};
  let offers = prod.offers;
  if (!offers && Array.isArray(prod.hasVariant) && prod.hasVariant[0]) offers = prod.hasVariant[0].offers;
  if (Array.isArray(offers)) offers = offers[0];
  offers = offers || {};

  let price = parsePrice(offers.price ?? offers.lowPrice);
  let listPrice = null;
  const specs = [].concat(offers.priceSpecification || []);
  for (const sp of specs) {
    const v = parsePrice(sp && sp.price);
    if (!v) continue;
    const type = String(sp.priceType || '');
    if (/StrikethroughPrice|ListPrice|MSRP/i.test(type)) listPrice = v;
    else if (!price) price = v;
  }
  const availability = String(offers.availability || '');
  const image = Array.isArray(prod.image) ? prod.image[0] : prod.image;
  const brand = typeof prod.brand === 'object' && prod.brand ? prod.brand.name : prod.brand;
  const seller = offers.seller && typeof offers.seller === 'object' ? offers.seller.name : offers.seller;

  return {
    title: cleanText(prod.name),
    image: typeof image === 'object' && image ? image.url || image.contentUrl : image || null,
    brand: cleanText(brand),
    externalId: prod.sku || prod.productID || prod.gtin13 || null,
    price,
    listPrice,
    seller: cleanText(seller),
    inStock: availability ? !/OutOfStock|SoldOut|Discontinued/i.test(availability) : undefined,
  };
}

function meta(html, name) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name|itemprop)=["']${name.replace(/[.:]/g, '\\$&')}["'][^>]*>`,
    'i'
  );
  const tag = html.match(re);
  if (!tag) return null;
  const c = tag[0].match(/content=["']([^"']*)["']/i);
  return c ? decodeEntities(c[1]) : null;
}

/**
 * Gömülü JSON durumlarında sık geçen anahtarları yakalar:
 *   "originalPrice": 1599   |   "originalPrice": {"text": "...", "value": 1599}
 */
function keyPrice(html, keys) {
  const k = keys.join('|');
  const re = new RegExp(
    `"(?:${k})"\\s*:\\s*(?:\\{[^{}]*?"(?:value|amount|price)"\\s*:\\s*)?"?(\\d+(?:[.,]\\d+)*)`,
    'gi'
  );
  const vals = [];
  let m;
  while ((m = re.exec(html))) {
    const v = parsePrice(m[1]);
    if (v) vals.push(v);
  }
  return vals;
}

function firstMatch(html, re, group = 1) {
  const m = html.match(re);
  return m ? m[group] : null;
}

/** Tüm sitelerde ortak taban çıkarım */
function extractBase(html) {
  const ld = fromLdProduct(findLdProduct(extractJsonLd(html)));
  return {
    title: ld.title || cleanText(meta(html, 'og:title')) || cleanText(firstMatch(html, /<title>([\s\S]*?)<\/title>/i)),
    image: ld.image || meta(html, 'og:image'),
    brand: ld.brand || null,
    externalId: ld.externalId || null,
    price: ld.price || parsePrice(meta(html, 'product:price:amount')) || parsePrice(meta(html, 'og:price:amount')),
    listPrice: ld.listPrice || null,
    seller: ld.seller || null,
    inStock: ld.inStock,
  };
}

/** Sonucu doğrular ve tutarlı hale getirir */
function finalize(r) {
  const price = parsePrice(r.price);
  let listPrice = parsePrice(r.listPrice);
  if (listPrice && price && listPrice <= price) listPrice = null;
  return {
    title: r.title || null,
    image: r.image || null,
    brand: r.brand || null,
    externalId: r.externalId != null ? String(r.externalId) : null,
    price,
    listPrice,
    seller: r.seller || null,
    inStock: r.inStock === undefined ? true : !!r.inStock,
  };
}

/** Liste/kampanya sayfasından ürün linklerini toplar */
function collectLinks(html, baseUrl, pattern, normalize) {
  const out = new Set();
  const re = /href=["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = decodeEntities(m[1]);
    if (!pattern.test(href)) continue;
    try {
      out.add(normalize(new URL(href, baseUrl).toString()));
    } catch {
      /* geçersiz link */
    }
  }
  return [...out];
}

module.exports = {
  parsePrice,
  decodeEntities,
  cleanText,
  extractJsonLd,
  findLdProduct,
  fromLdProduct,
  meta,
  keyPrice,
  firstMatch,
  extractBase,
  finalize,
  collectLinks,
};
