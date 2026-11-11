'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DB_PATH = ':memory:';
const batch = require('../src/batch');
const akakce = require('../src/extractors/akakce');

const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

test('Akakçe arama: asıl ürün seçilir, aksesuarlar elenir', () => {
  const r = akakce.parseSearch(fx('akakce-arama.html'));
  assert.ok(r.length >= 3);
  const [best] = akakce.pickSearchResults(r);
  assert.match(best.title, /Dyson V15 Detect Absolute/);
  assert.match(best.url, /fiyati,1380157850\.html$/);
});

test('mağaza linkinden ürün adı', () => {
  assert.equal(
    batch.nameFromUrl('https://www.trendyol.com/roborock/s8-pro-akilli-robot-supurge-p-930469542'),
    'roborock s8 pro akilli robot supurge'
  );
  assert.equal(
    batch.nameFromUrl('https://www.hepsiburada.com/roborock-s8-pro-akilli-robot-supurge-beyaz-p-HBCV00008MAIV2'),
    'roborock s8 pro akilli robot supurge beyaz'
  );
  assert.equal(batch.nameFromUrl('https://www.amazon.com.tr/Apple-iPhone-17-Pro-Max/dp/B0FQ123456'), 'Apple iPhone 17 Pro Max');
});

test('resolveQuery: ad -> Akakçe araması, Akakçe linki doğrudan, mağaza linki -> ad', async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.includes('/arama/')) return { html: fx('akakce-arama.html'), finalUrl: url };
    throw new Error('HTTP 403');
  };
  const a = await batch.resolveQuery('dyson v15', { fetcher });
  assert.equal(a.ok, true);
  assert.match(calls[0], /arama\/\?q=dyson%20v15/);

  const b = await batch.resolveQuery('https://www.akakce.com/x/en-ucuz-y-fiyati,123.html?a=1', { fetcher });
  assert.deepEqual(b, { ok: true, url: 'https://www.akakce.com/x/en-ucuz-y-fiyati,123.html' });

  const c = await batch.resolveQuery('https://www.trendyol.com/dyson/v15-detect-absolute-p-1', { fetcher });
  assert.equal(c.ok, true);
  assert.match(calls.at(-1), /arama\/\?q=dyson%20v15%20detect%20absolute/);

  const d = await batch.resolveQuery('https://www.akakce.com/brosurler', { fetcher });
  assert.equal(d.ok, false);
});
