'use strict';

const path = require('node:path');

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

module.exports = {
  port: num(process.env.PORT, 3000),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'indirim.db'),

  // Takip edilen ürünlerin fiyatı kaç saatte bir kontrol edilsin
  refreshHours: num(process.env.REFRESH_HOURS, 6),
  // Kampanya / kategori sayfaları kaç saatte bir yeni ürün için taransın
  discoverHours: num(process.env.DISCOVER_HOURS, 24),
  // Aynı siteye ardışık iki istek arasındaki bekleme (ms) — siteleri yormamak için
  requestDelayMs: num(process.env.REQUEST_DELAY_MS, 4000),
  requestTimeoutMs: num(process.env.REQUEST_TIMEOUT_MS, 20000),
  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',

  analysis: {
    // Referans pencere: 6502 sayılı kanun / Haksız Ticari Uygulamalar Yönetmeliği
    // indirim öncesi son 30 günün en düşük fiyatını esas alır.
    windowDays: num(process.env.WINDOW_DAYS, 30),
    // Bu oranın altındaki düşüşler "gerçek indirim" sayılmaz (%)
    minRealDiscountPct: num(process.env.MIN_REAL_DISCOUNT_PCT, 5),
    // Satıcı bu orandan fazla indirim iddia ediyorsa "indirim iddiası var" kabul edilir (%)
    minClaimPct: num(process.env.MIN_CLAIM_PCT, 5),
    // İddia edilen indirim, gerçek indirimden bu kadar puan fazlaysa "abartılı"
    exaggerationGapPct: num(process.env.EXAGGERATION_GAP_PCT, 15),
    // Fiyat seviyesi eşitliği toleransı (kuruş yuvarlamaları vb.)
    priceTolerancePct: num(process.env.PRICE_TOLERANCE_PCT, 0.5),
    // Referans penceresinde bu kadar günden az veri varsa güven "düşük"
    minCoverageDays: num(process.env.MIN_COVERAGE_DAYS, 7),
  },
};
