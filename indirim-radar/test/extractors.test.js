'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ex = require('../src/extractors');
const { parsePrice } = require('../src/extractors/common');

const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

test('parsePrice Türkçe ve İngilizce biçimler', () => {
  assert.equal(parsePrice('1.299,90 TL'), 1299.9);
  assert.equal(parsePrice('1.299 TL'), 1299);
  assert.equal(parsePrice('20.499,00TL'), 20499);
  assert.equal(parsePrice('1299.90'), 1299.9);
  assert.equal(parsePrice('1,299.90'), 1299.9);
  assert.equal(parsePrice('12,5'), 12.5);
  assert.equal(parsePrice('1.234.567,89'), 1234567.89);
  assert.equal(parsePrice(2499), 2499);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice('Ücretsiz'), null);
});

test('pazaryeri tespiti ve URL normalizasyonu', () => {
  assert.equal(ex.detectMarketplace('https://www.trendyol.com/x-p-1'), 'trendyol');
  assert.equal(ex.detectMarketplace('https://www.hepsiburada.com/x-p-HBC1'), 'hepsiburada');
  assert.equal(ex.detectMarketplace('https://www.amazon.com.tr/dp/B0ABCDEFGH'), 'amazon');
  assert.equal(ex.detectMarketplace('https://www.n11.com/urun/x'), 'n11');
  assert.equal(ex.detectMarketplace('https://www.teknosa.com/x'), 'generic');
  assert.equal(ex.detectMarketplace('https://faketrendyol.com/x'), 'generic');
  assert.equal(
    ex.normalizeUrl('https://www.amazon.com.tr/Telefon-Model/dp/b0abcdefgh/ref=sr_1?keywords=x'),
    'https://www.amazon.com.tr/dp/B0ABCDEFGH'
  );
  assert.equal(ex.normalizeUrl('https://www.trendyol.com/a/b-p-1?boutiqueId=2#x'), 'https://www.trendyol.com/a/b-p-1');
});

test('Trendyol: sepette indirimli fiyat ve orijinal fiyat', () => {
  const r = ex.extractProduct(fx('trendyol.html'), 'https://www.trendyol.com/marka-x/kulaklik-p-123456');
  assert.equal(r.marketplace, 'trendyol');
  assert.equal(r.title, 'Marka X Kablosuz Kulaklık');
  assert.equal(r.price, 1849);
  assert.equal(r.listPrice, 2499);
  assert.equal(r.seller, 'Ses Dünyası');
  assert.equal(r.brand, 'Marka X');
  assert.equal(r.inStock, true);
});

test('Hepsiburada: JSON-LD + önceki fiyat', () => {
  const r = ex.extractProduct(fx('hepsiburada.html'), 'https://www.hepsiburada.com/robot-p-HBC0000ABCDE');
  assert.equal(r.title, 'Robot Süpürge & Paspas');
  assert.equal(r.price, 4999);
  assert.equal(r.listPrice, 6999);
  assert.equal(r.seller, 'Teknoloji Mağazası');
});

test('Amazon TR: ödenecek fiyat ve üstü çizili fiyat', () => {
  const r = ex.extractProduct(fx('amazon.html'), 'https://www.amazon.com.tr/dp/B0ABCDEFGH');
  assert.equal(r.title, 'Akıllı Telefon 256 GB');
  assert.equal(r.price, 20499);
  assert.equal(r.listPrice, 29999);
  assert.equal(r.externalId, 'B0ABCDEFGH');
  assert.equal(r.image, 'https://m.media-amazon.example/t.jpg');
});

test('N11: AggregateOffer + oldPrice', () => {
  const r = ex.extractProduct(fx('n11.html'), 'https://www.n11.com/urun/airfryer-123');
  assert.equal(r.price, 3299);
  assert.equal(r.listPrice, 5499);
  assert.equal(r.seller, 'evmarket');
});

test('kampanya sayfasından ürün keşfi (tekilleştirme + site filtresi)', () => {
  const links = ex.discoverProductLinks(fx('trendyol-liste.html'), 'https://www.trendyol.com/sr?q=kulaklik');
  assert.deepEqual(links, [
    'https://www.trendyol.com/marka-x/kulaklik-p-111',
    'https://www.trendyol.com/marka-y/supurge-p-222',
  ]);
  const az = ex.discoverProductLinks(fx('amazon.html'), 'https://www.amazon.com.tr/s?k=telefon');
  assert.deepEqual(az, ['https://www.amazon.com.tr/dp/B0ABCDEFGH', 'https://www.amazon.com.tr/dp/B0ZZZZZZZZ']);
});
