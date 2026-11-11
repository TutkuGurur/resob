'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DB_PATH = ':memory:';
const db = require('../src/db');
const tracker = require('../src/tracker');
const { seedDemo } = require('../src/demo');

const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

test('URL ekleme, fiyat kaydı ve keşif (sahte fetcher ile)', async () => {
  db.open(':memory:');
  const pages = {
    'https://www.trendyol.com/sr?q=k': fx('trendyol-liste.html'),
  };
  const fetcher = async (url) => ({ html: pages[url] || fx('trendyol.html'), finalUrl: url });

  const r = await tracker.addProductByUrl('https://www.trendyol.com/marka-x/kulaklik-p-123456?boutiqueId=9', { fetcher });
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://www.trendyol.com/marka-x/kulaklik-p-123456');
  const p = db.getProduct(r.id);
  assert.equal(p.title, 'Marka X Kablosuz Kulaklık');
  assert.equal(db.getSnapshots(r.id).length, 1);

  const wid = db.addWatchlist({ marketplace: 'trendyol', url: 'https://www.trendyol.com/sr?q=k' });
  const w = db.listWatchlists().find((x) => x.id === wid);
  const res = await tracker.runWatchlist(w, { fetcher });
  assert.deepEqual(res, { found: 2, added: 2 });

  const failing = async () => { throw new Error('HTTP 403'); };
  const bad = await tracker.checkProduct(db.getProduct(r.id), failing);
  assert.equal(bad.ok, false);
  assert.equal(db.getProduct(r.id).last_error, 'HTTP 403');
});

test('demo senaryoları beklenen sınıflara düşer', () => {
  seedDemo();
  const byTitle = Object.fromEntries(
    tracker.allSummaries().filter((x) => x.isDemo).map((x) => [x.title, x.analysis.status])
  );
  assert.equal(byTitle['Kablosuz Kulak Üstü Kulaklık ANC'], 'GERCEK_INDIRIM');
  assert.equal(byTitle['Robot Süpürge 3000Pa Haritalamalı'], 'SAHTE_INDIRIM');
  assert.equal(byTitle['Airfryer 6.2 L Dijital'], 'SAHTE_INDIRIM');
  assert.equal(byTitle['Akıllı Telefon 256 GB'], 'ABARTILI_INDIRIM');
  assert.equal(byTitle['Dikey Şarjlı Süpürge'], 'GERCEK_INDIRIM');
  assert.equal(byTitle['Roman — Ciltli Özel Baskı'], 'INDIRIM_YOK');
  assert.equal(byTitle['Espresso Makinesi 15 Bar'], 'SAHTE_INDIRIM');
  assert.equal(byTitle['Kahve Değirmeni Elektrikli'], 'YETERSIZ_VERI');
  assert.equal(byTitle['Sıvı Çamaşır Deterjanı 60 Yıkama'], 'GERCEK_INDIRIM');
  assert.equal(byTitle['Akıllı Saat GPS'], 'GERCEK_INDIRIM');
  assert.equal(byTitle['Kışlık Şişme Mont'], 'SAHTE_INDIRIM');
  assert.equal(byTitle['55" 4K QLED Televizyon'], 'GERCEK_INDIRIM');
});
