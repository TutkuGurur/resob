'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ex = require('../src/extractors');
const akakce = require('../src/extractors/akakce');
const { analyze } = require('../src/analysis');

const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const URL_ = 'https://www.akakce.com/robot-supurge/en-ucuz-roborock-s8-pro-akilli-fiyati,1029737359.html';
const NOW = Date.UTC(2026, 10, 11, 12);

test('Akakçe ürün sayfası: satıcılar, en ucuz fiyat, 6 aylık geçmiş', () => {
  const r = akakce.extract(fx('akakce-urun.html'), URL_, NOW);
  assert.equal(r.title, 'Roborock S8 Pro Akıllı Robot Süpürge');
  assert.equal(r.brand, 'Roborock');
  assert.equal(r.category, 'Robot Süpürge');
  assert.equal(akakce.categoryOf(null, 'https://www.akakce.com/cep-telefonu/en-ucuz-x-fiyati,1.html'), 'Cep Telefonu');
  assert.equal(r.price, 12999);
  assert.equal(r.offers.length, 4);
  assert.equal(r.offers[0].price, 12999);
  assert.match(r.offers[0].store, /hepsiburada|trendyol/);
  assert.equal(r.history.length, 25);
  assert.deepEqual(r.history.at(-1), { t: Date.UTC(2026, 10, 11, 9), price: 12999 });
  assert.equal(r.history.at(-2).price, 14890);
  assert.equal(r.listPrice, 14890); // son değişim bir düşüş -> "önceki fiyat" gösterilen referans
});

test('Akakçe: eski değişimde gösterilen indirim yok', () => {
  const r = akakce.extract(fx('akakce-urun.html'), URL_, NOW + 30 * 864e5);
  assert.equal(r.listPrice, null);
});

test('Akakçe geçmişi günlük kayda açılır ve analiz edilir', () => {
  const r = akakce.extract(fx('akakce-urun.html'), URL_, NOW);
  const daily = akakce.expandDaily(r.history, NOW);
  assert.equal(daily[0].capturedAt, r.history[0].t);
  assert.equal(daily.at(-1).price, 12999);
  // 20.10'dan 22.10'a kadar 14.499 geçerli olmalı (sonraki değişim 22.10)
  const d21 = daily.find((d) => d.capturedAt === Date.UTC(2026, 9, 21, 9));
  assert.equal(d21.price, 14499);
  const snaps = daily.map((d) => ({ ...d }));
  snaps[snaps.length - 1].listPrice = r.listPrice;
  const a = analyze(snaps);
  // 19.10'da 13.228,10 TL görülmüş: 12.999 TL bunun yalnızca ~%1,7 altında
  assert.equal(a.referencePrice, 13228.1);
  assert.equal(a.status, 'SAHTE_INDIRIM');
});

test('Akakçe liste sayfasından ürün keşfi', () => {
  const links = ex.discoverProductLinks(fx('akakce-liste.html'), 'https://www.akakce.com/fiyati-dusen-urunler/');
  assert.equal(links.length, 4);
  assert.ok(links.every((l) => /^https:\/\/www\.akakce\.com\/.+fiyati,\d+\.html$/.test(l)));
  assert.equal(ex.detectMarketplace(links[0]), 'akakce');
});
