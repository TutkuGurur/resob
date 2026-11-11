'use strict';

/**
 * Demo verisi: gerçek tarama yapmadan paneli ve analiz motorunu görmek için
 * farklı indirim senaryolarını (gerçek / sahte / abartılı ...) simüle eder.
 * Tüm demo ürünler is_demo=1 ile işaretlenir ve panelde "DEMO" rozetiyle görünür.
 */

const db = require('./db');
const { DAY } = require('./analysis');

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// segments: [gün_sayısı, fiyat, üstü_çizili?]; gürültü (noise) % olarak
const SCENARIOS = [
  { mp: 'trendyol', title: 'Kablosuz Kulak Üstü Kulaklık ANC', cat: 'Elektronik', noise: 0,
    seg: [[57, 2499, null], [3, 1899, 2499]] },
  { mp: 'hepsiburada', title: 'Robot Süpürge 3000Pa Haritalamalı', cat: 'Ev Aletleri', noise: 2,
    seg: [[40, 4999, null], [12, 6999, null], [8, 4999, 6999]] },
  { mp: 'n11', title: 'Airfryer 6.2 L Dijital', cat: 'Mutfak', noise: 0,
    seg: [[60, 3299, 5499]] },
  { mp: 'amazon', title: 'Akıllı Telefon 256 GB', cat: 'Telefon', noise: 0.5,
    seg: [[54, 22999, 24999], [6, 20499, 29999]] },
  { mp: 'trendyol', title: 'Dikey Şarjlı Süpürge', cat: 'Ev Aletleri', noise: 3,
    seg: [[56, 9250, null], [4, 7499, 9999]] },
  { mp: 'amazon', title: 'Roman — Ciltli Özel Baskı', cat: 'Kitap', noise: 0,
    seg: [[60, 189, null]] },
  { mp: 'hepsiburada', title: 'Espresso Makinesi 15 Bar', cat: 'Mutfak', noise: 0,
    seg: [[50, 1099, null], [10, 1079, 1299]] },
  { mp: 'n11', title: 'Kahve Değirmeni Elektrikli', cat: 'Mutfak', noise: 0,
    seg: [[2, 649, 899]] },
  { mp: 'trendyol', title: 'Sıvı Çamaşır Deterjanı 60 Yıkama', cat: 'Süpermarket', noise: 2,
    seg: [[55, 429, 429], [5, 359, 429]] },
  { mp: 'hepsiburada', title: 'Akıllı Saat GPS', cat: 'Elektronik', noise: 0,
    seg: [[45, 5999, null], [10, 4799, 5999], [5, 5399, 5999]] },
  { mp: 'trendyol', title: 'Kışlık Şişme Mont', cat: 'Moda', noise: 0,
    seg: [[45, 1999, null], [15, 2299, 3499]] },
  { mp: 'amazon', title: '55" 4K QLED Televizyon', cat: 'Elektronik', noise: 1,
    seg: [[52, 34999, 39999], [8, 27999, 39999]] },
];

function seedDemo({ perDay = 2 } = {}) {
  db.deleteDemo();
  const nowT = Date.now();
  const rand = rng(42);
  let n = 0;
  for (const [idx, sc] of SCENARIOS.entries()) {
    const totalDays = sc.seg.reduce((a, s) => a + s[0], 0);
    const id = db.upsertProduct({
      marketplace: sc.mp,
      url: `https://demo.indirim-radar.local/${sc.mp}/urun-${idx + 1}`,
      title: sc.title,
      category: sc.cat,
      isDemo: true,
      source: 'demo',
      createdAt: nowT - totalDays * DAY,
    });
    let t = nowT - totalDays * DAY;
    const step = DAY / perDay;
    for (const [days, price, list] of sc.seg) {
      for (let k = 0; k < days * perDay; k++) {
        const jitter = sc.noise ? 1 + ((rand() - 0.5) * 2 * sc.noise) / 100 : 1;
        const p = Math.round(price * jitter * 100) / 100;
        db.addSnapshot(id, { price: p, listPrice: list, capturedAt: Math.round(t), seller: 'Demo Mağaza' });
        t += step;
        n++;
      }
    }
    // son kayıt tam "şimdi" olsun ve gürültüsüz
    const [, lp, ll] = sc.seg[sc.seg.length - 1];
    db.addSnapshot(id, { price: lp, listPrice: ll, capturedAt: nowT, seller: 'Demo Mağaza' });
    db.markChecked(id, null);
  }
  return { products: SCENARIOS.length, snapshots: n };
}

module.exports = { seedDemo, SCENARIOS };
