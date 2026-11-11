'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, STATUS, DAY } = require('../src/analysis');

const NOW = Date.UTC(2026, 10, 11);
/** segments: [[gün, fiyat, üstüÇizili], ...] -> günde 1 kayıt, son kayıt NOW */
function series(segments) {
  const total = segments.reduce((a, s) => a + s[0], 0);
  const out = [];
  let t = NOW - (total - 1) * DAY;
  for (const [days, price, listPrice] of segments) {
    for (let i = 0; i < days; i++, t += DAY) out.push({ price, listPrice, capturedAt: t });
  }
  return out;
}

test('gerçek indirim: 30 günlük en düşüğün altına inmiş', () => {
  const r = analyze(series([[40, 1000, null], [3, 800, 1000]]));
  assert.equal(r.status, STATUS.GERCEK);
  assert.equal(r.referencePrice, 1000);
  assert.equal(r.realDiscountPct, 20);
  assert.equal(r.claimedDiscountPct, 20);
  assert.equal(r.savings, 200);
  assert.equal(r.confidence, 'yüksek');
});

test('sahte: önce zam sonra indirim', () => {
  const r = analyze(series([[30, 500, null], [10, 700, null], [5, 500, 700]]));
  assert.equal(r.status, STATUS.SAHTE);
  assert.equal(r.referencePrice, 500);
  assert.equal(r.realDiscountPct, 0);
  assert.equal(r.flags.zamSonrasiIndirim, true);
});

test('sahte: üstü çizili fiyat hiç uygulanmamış, fiyat sabit', () => {
  const r = analyze(series([[45, 3299, 5499]]));
  assert.equal(r.status, STATUS.SAHTE);
  assert.equal(r.flags.ustuCiziliHicUygulanmadi, true);
  assert.ok(r.claimedDiscountPct > 39);
});

test('abartılı: gerçek %10, iddia %33', () => {
  const r = analyze(series([[40, 1000, 1000], [5, 900, 1350]]));
  assert.equal(r.status, STATUS.ABARTILI);
  assert.equal(r.realDiscountPct, 10);
});

test('indirim yok: sabit fiyat, iddia yok', () => {
  assert.equal(analyze(series([[40, 189, null]])).status, STATUS.YOK);
});

test('yetersiz veri: 2 günlük geçmiş', () => {
  const r = analyze(series([[2, 649, 899]]));
  assert.equal(r.status, STATUS.VERI_YOK);
});

test('küçük düşüş + büyük iddia = sahte', () => {
  const r = analyze(series([[40, 1099, null], [5, 1079, 1299]]));
  assert.equal(r.status, STATUS.SAHTE);
});

test('kademeli kampanya: referans kampanya başlangıcından önceki 30 gün', () => {
  const r = analyze(series([[40, 100, null], [10, 80, 100], [5, 90, 100]]));
  assert.equal(r.status, STATUS.GERCEK);
  assert.equal(r.referencePrice, 100);
  assert.equal(r.min30, 80);
  assert.equal(r.flags.son30GundeDahaUcuzdu, true);
});

test('kampanya sırasındaki küçük dalgalanmalar indirimi bozmaz', () => {
  const s = series([[40, 1000, null], [6, 800, 1000]]);
  s[s.length - 3].price = 815; // %1.9 dalgalanma
  s[s.length - 5].price = 790;
  const r = analyze(s);
  assert.equal(r.status, STATUS.GERCEK);
  assert.equal(r.referencePrice, 1000);
});

test('referans pencere 30 günle sınırlı: 60 gün önceki düşük fiyat sayılmaz', () => {
  const r = analyze(series([[10, 700, null], [50, 1000, null], [3, 850, 1000]]));
  assert.equal(r.status, STATUS.GERCEK);
  assert.equal(r.referencePrice, 1000);
});

test('stokta olmayan kayıtlar yok sayılır', () => {
  const s = series([[40, 1000, null], [3, 800, 1000]]);
  s[10] = { ...s[10], price: 500, inStock: 0 };
  assert.equal(analyze(s).referencePrice, 1000);
});

test('fiyat arttı + indirim etiketi = sahte', () => {
  const r = analyze(series([[30, 1999, null], [15, 2299, 3499]]));
  assert.equal(r.status, STATUS.SAHTE);
  assert.equal(r.flags.ustuCiziliHicUygulanmadi, true);
});
