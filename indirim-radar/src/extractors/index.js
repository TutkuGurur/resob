'use strict';

const c = require('./common');

const stripQuery = (u) => {
  const x = new URL(u);
  x.search = '';
  x.hash = '';
  return x.toString();
};

const minOf = (...vals) => {
  const v = vals.flat().filter((n) => Number.isFinite(n) && n > 0);
  return v.length ? Math.min(...v) : null;
};
const maxOf = (...vals) => {
  const v = vals.flat().filter((n) => Number.isFinite(n) && n > 0);
  return v.length ? Math.max(...v) : null;
};

const OUT_OF_STOCK_TR = /(stokta yok|tükendi|şu anda mevcut değil|satışta değil|currently unavailable)/i;

/**
 * Her pazaryeri için:
 *   match(host)        -> bu site mi?
 *   normalize(url)     -> kanonik ürün URL'si (aynı ürün iki kez eklenmesin)
 *   extract(html, url) -> { title, price, listPrice, ... }
 *   productLink        -> kampanya/kategori sayfasında ürün linki deseni
 */
const MARKETPLACES = {
  trendyol: {
    name: 'Trendyol',
    match: (h) => /(^|\.)trendyol\.com$/.test(h),
    normalize: stripQuery,
    productLink: /-p-\d+/,
    extract(html) {
      const b = c.extractBase(html);
      // Ürün detay sayfasındaki gömülü state: "price":{"sellingPrice":{..."value":X},"originalPrice":{..."value":Y},"discountedPrice":{...}}
      const selling = c.keyPrice(html, ['discountedPrice', 'sellingPrice']);
      const original = c.keyPrice(html, ['originalPrice']);
      const price = minOf(b.price, selling.slice(0, 2));
      const listPrice = maxOf(b.listPrice, original.slice(0, 1));
      const seller = c.firstMatch(html, /"merchant"\s*:\s*\{[^{}]*?"name"\s*:\s*"([^"]+)"/) || b.seller;
      const soldOut = /"(?:isSoldOut|soldOut)"\s*:\s*true/.test(html) || /"inStock"\s*:\s*false/.test(html);
      const id = c.firstMatch(html, /"(?:contentId|productId)"\s*:\s*"?(\d+)/);
      return { ...b, price, listPrice, seller, externalId: b.externalId || id, inStock: soldOut ? false : b.inStock };
    },
  },

  hepsiburada: {
    name: 'Hepsiburada',
    match: (h) => /(^|\.)hepsiburada\.com$/.test(h),
    normalize: stripQuery,
    productLink: /-p[m]?-[A-Z0-9]{6,}/i,
    extract(html) {
      const b = c.extractBase(html);
      const cur = c.parsePrice(
        c.firstMatch(html, /data-test-id=["'](?:price-current-price|default-price)["'][^>]*>([\s\S]{0,120}?)<\//)
      );
      const prev = c.parsePrice(c.firstMatch(html, /data-test-id=["']prev-price["'][^>]*>([\s\S]{0,200}?)<\/(?:div|span)>/));
      const original = c.keyPrice(html, ['originalPrice', 'listPrice', 'oldPrice']);
      const seller = c.firstMatch(html, /"merchantName"\s*:\s*"([^"]+)"/) || b.seller;
      return {
        ...b,
        price: b.price || cur,
        listPrice: maxOf(b.listPrice, prev, original.slice(0, 1)),
        seller,
        inStock: /"isOutOfStock"\s*:\s*true/.test(html) ? false : b.inStock,
      };
    },
  },

  amazon: {
    name: 'Amazon TR',
    match: (h) => /(^|\.)amazon\.com\.tr$/.test(h),
    normalize(u) {
      const asin = (u.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i) || [])[1];
      return asin ? `https://www.amazon.com.tr/dp/${asin.toUpperCase()}` : stripQuery(u);
    },
    productLink: /\/(?:dp|gp\/product)\/[A-Z0-9]{10}/i,
    extract(html, url) {
      const b = c.extractBase(html);
      const title = c.cleanText(c.firstMatch(html, /id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i)) || b.title;
      const toPay =
        c.firstMatch(html, /class=["'][^"']*priceToPay[^"']*["'][^>]*>\s*<span class=["']a-offscreen["']>([^<]+)</i) ||
        c.firstMatch(
          html,
          /id=["']corePrice(?:Display_desktop|_desktop|_feature)_div["'][\s\S]{0,3000}?class=["']a-offscreen["']>([^<]+)</i
        );
      const priceAmount = c.keyPrice(html, ['priceAmount']);
      const strike = c.firstMatch(html, /data-a-strike=["']true["'][^>]*>\s*<span class=["']a-offscreen["']>([^<]+)</i);
      const basis = c.firstMatch(html, /class=["'][^"']*basisPrice[^"']*["'][\s\S]{0,400}?class=["']a-offscreen["']>([^<]+)</i);
      const avail = c.cleanText(c.firstMatch(html, /id=["']availability["'][^>]*>([\s\S]{0,400}?)<\/div>/i)) || '';
      const image = c.firstMatch(html, /id=["']landingImage["'][^>]*?(?:data-old-hires|src)=["']([^"']+)["']/i) || b.image;
      return {
        ...b,
        title,
        image,
        externalId: (url.match(/\/dp\/([A-Z0-9]{10})/i) || [])[1] || b.externalId,
        price: c.parsePrice(toPay) || priceAmount[0] || b.price,
        listPrice: maxOf(c.parsePrice(strike), c.parsePrice(basis), b.listPrice),
        seller: c.cleanText(c.firstMatch(html, /id=["']sellerProfileTriggerId["'][^>]*>([\s\S]*?)<\/a>/i)) || b.seller,
        inStock: OUT_OF_STOCK_TR.test(avail) ? false : b.inStock,
      };
    },
  },

  n11: {
    name: 'N11',
    match: (h) => /(^|\.)n11\.com$/.test(h),
    normalize: stripQuery,
    productLink: /\/urun\/[^/?#]+/,
    extract(html) {
      const b = c.extractBase(html);
      const old = c.parsePrice(c.firstMatch(html, /class=["'][^"']*\boldPrice\b[^"']*["'][^>]*>([\s\S]{0,200}?)<\/(?:div|span|del|ins)>/i));
      const cur = c.parsePrice(c.firstMatch(html, /class=["'][^"']*\bnewPrice\b[^"']*["'][^>]*>([\s\S]{0,200}?)<\/(?:div|span|ins)>/i));
      const keyOld = c.keyPrice(html, ['oldPrice', 'originalPrice']);
      return {
        ...b,
        price: b.price || cur,
        listPrice: maxOf(b.listPrice, old, keyOld.slice(0, 1)),
        seller: c.firstMatch(html, /"(?:sellerNickName|shopName)"\s*:\s*"([^"]+)"/) || b.seller,
      };
    },
  },

  ciceksepeti: {
    name: 'Çiçeksepeti',
    match: (h) => /(^|\.)ciceksepeti\.com$/.test(h),
    normalize: stripQuery,
    productLink: /-kc[m]?\d+/i,
    extract(html) {
      const b = c.extractBase(html);
      const keyOld = c.keyPrice(html, ['oldPrice', 'originalPrice', 'listPrice']);
      return { ...b, listPrice: maxOf(b.listPrice, keyOld.slice(0, 1)) };
    },
  },

  // JSON-LD / og meta yayınlayan diğer siteler (Pazarama, Teknosa, MediaMarkt, Vatan vb.)
  generic: {
    name: 'Diğer',
    match: () => true,
    normalize: stripQuery,
    productLink: null,
    extract(html) {
      const b = c.extractBase(html);
      const keyOld = c.keyPrice(html, ['originalPrice', 'listPrice', 'oldPrice', 'strikeThroughPrice', 'regularPrice']);
      return { ...b, listPrice: maxOf(b.listPrice, keyOld.slice(0, 1)) };
    },
  },
};

function detectMarketplace(url) {
  const host = new URL(url).hostname.toLowerCase();
  for (const [key, m] of Object.entries(MARKETPLACES)) {
    if (key !== 'generic' && m.match(host)) return key;
  }
  return 'generic';
}

function normalizeUrl(url) {
  const key = detectMarketplace(url);
  return MARKETPLACES[key].normalize(url);
}

function extractProduct(html, url) {
  const key = detectMarketplace(url);
  return { marketplace: key, ...c.finalize(MARKETPLACES[key].extract(html, url)) };
}

function discoverProductLinks(html, listUrl) {
  const key = detectMarketplace(listUrl);
  const m = MARKETPLACES[key];
  if (!m.productLink) return [];
  // Yalnızca aynı pazaryerinin ürünleri
  return c
    .collectLinks(html, listUrl, m.productLink, m.normalize)
    .filter((u) => detectMarketplace(u) === key);
}

const marketplaceName = (key) => (MARKETPLACES[key] || MARKETPLACES.generic).name;

module.exports = { MARKETPLACES, detectMarketplace, normalizeUrl, extractProduct, discoverProductLinks, marketplaceName };
