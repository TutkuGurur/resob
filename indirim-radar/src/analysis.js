'use strict';

/**
 * İndirim analizi.
 *
 * Temel fikir (Ticaret Bakanlığı Haksız Ticari Uygulamalar Yönetmeliği ile uyumlu):
 *   Bir indirimin "gerçek" olup olmadığı, satıcının gösterdiği üstü çizili fiyata göre değil,
 *   İNDİRİMİN BAŞLADIĞI ANDAN ÖNCEKİ SON 30 GÜNDE UYGULANAN EN DÜŞÜK FİYATA göre ölçülür.
 *
 * Tanımlar
 *   güncel fiyat (p)         : son gözlemlenen satış fiyatı
 *   indirim başlangıcı       : fiyatın p seviyesine (veya altına) indiği ilk an
 *   referans fiyat (ref)     : [başlangıç - 30 gün, başlangıç) aralığındaki en düşük fiyat
 *   gerçek indirim %         : (ref - p) / ref
 *   iddia edilen indirim %   : (üstü çizili fiyat - p) / üstü çizili fiyat
 */

const config = require('./config');

const DAY = 24 * 60 * 60 * 1000;

const STATUS = {
  GERCEK: 'GERCEK_INDIRIM',
  ABARTILI: 'ABARTILI_INDIRIM',
  SAHTE: 'SAHTE_INDIRIM',
  YOK: 'INDIRIM_YOK',
  VERI_YOK: 'YETERSIZ_VERI',
};

const STATUS_LABEL = {
  GERCEK_INDIRIM: 'Gerçek indirim',
  ABARTILI_INDIRIM: 'Gerçek ama abartılı',
  SAHTE_INDIRIM: 'Sahte indirim',
  INDIRIM_YOK: 'İndirim yok',
  YETERSIZ_VERI: 'Yetersiz veri',
};

const round2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const pct = (from, to) => (from > 0 ? ((from - to) / from) * 100 : 0);
const tl = (n) =>
  n == null ? '-' : n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL';

function isInStock(s) {
  return !(s.inStock === 0 || s.inStock === false);
}

/**
 * @param {Array<{price:number, listPrice?:number|null, capturedAt:number, inStock?:number|boolean}>} snapshots
 * @param {object} [opts]  config.analysis değerlerini geçersiz kılmak için
 */
function analyze(snapshots, opts = {}) {
  const o = { ...config.analysis, ...opts };
  const windowMs = o.windowDays * DAY;

  const s = (snapshots || [])
    .filter((x) => isInStock(x) && Number.isFinite(x.price) && x.price > 0)
    .sort((a, b) => a.capturedAt - b.capturedAt);

  if (!s.length) {
    return {
      status: STATUS.VERI_YOK,
      statusLabel: STATUS_LABEL[STATUS.VERI_YOK],
      reasons: ['Stokta olan ürün için henüz fiyat kaydı yok.'],
      snapshotCount: 0,
      dealScore: 0,
    };
  }

  const last = s[s.length - 1];
  const p = last.price;
  const nowT = last.capturedAt;
  const tol = (p * o.priceTolerancePct) / 100;
  const firstT = s[0].capturedAt;
  const historyDays = (nowT - firstT) / DAY;

  // --- İndirim başlangıcını bul: geriye doğru, fiyat güncel seviyenin belirgin şekilde
  // (minRealDiscountPct kadar) üstüne çıkana kadar yürü. Kampanya süresince oluşan küçük
  // dalgalanmalar (ör. %1-3) indirimi "yeniden başlatmaz".
  const band = (p * Math.max(o.priceTolerancePct, o.minRealDiscountPct)) / 100;
  let i = s.length - 1;
  while (i > 0 && s[i - 1].price < p + band) i--;
  const discountStart = s[i].capturedAt;
  const priorExists = i > 0;

  // --- Referans pencere: indirimden önceki 30 gün
  const refWindowStart = discountStart - windowMs;
  const refSnaps = s.filter((x) => x.capturedAt >= refWindowStart && x.capturedAt < discountStart);
  const refPrice = refSnaps.length ? Math.min(...refSnaps.map((x) => x.price)) : null;
  const coverageDays = refSnaps.length ? (discountStart - Math.max(refWindowStart, firstT)) / DAY : 0;

  // --- Son 30 gün istatistikleri (bugün dahil) — kullanıcıya gösterilecek "30 günün en düşüğü"
  const last30 = s.filter((x) => x.capturedAt >= nowT - windowMs);
  const last30Prices = last30.map((x) => x.price);
  const min30 = Math.min(...last30Prices);
  const max30 = Math.max(...last30Prices);
  const avg30 = last30Prices.reduce((a, b) => a + b, 0) / last30Prices.length;
  const allTimeLow = Math.min(...s.map((x) => x.price));
  const allTimeHigh = Math.max(...s.map((x) => x.price));

  // --- Satıcının iddiası
  const listPrice = last.listPrice && last.listPrice > p ? last.listPrice : null;
  const claimedPct = listPrice ? pct(listPrice, p) : 0;
  const claims = claimedPct >= o.minClaimPct;

  // --- Gerçek indirim
  const realPct = refPrice != null ? pct(refPrice, p) : 0;

  const reasons = [];
  const flags = {
    zamSonrasiIndirim: false, // önce zam, sonra indirim
    ustuCiziliHicUygulanmadi: false, // üstü çizili fiyat hiç gerçekten uygulanmamış
    son30GundeDahaUcuzdu: false,
    tarihiDip: false, // takip başladığından beri en düşük fiyat
  };

  if (refPrice != null && refPrice <= p + tol) {
    // Pencerede p'den ucuz/eşit fiyat var ama hemen öncesinde fiyat yüksekti -> zam yapılıp indirilmiş
    flags.zamSonrasiIndirim = true;
    reasons.push(
      `İndirimden önceki ${o.windowDays} günde ürün zaten ${tl(refPrice)} fiyatla satılmış; ` +
        `fiyat önce artırılıp sonra "indirim" yapılmış görünüyor.`
    );
  }

  if (listPrice && historyDays >= o.minCoverageDays && listPrice > max30 * 1.02) {
    flags.ustuCiziliHicUygulanmadi = true;
    reasons.push(
      `Üstü çizili fiyat (${tl(listPrice)}) son ${o.windowDays} günde hiç uygulanmamış; ` +
        `bu sürede görülen en yüksek fiyat ${tl(max30)}.`
    );
  }

  if (min30 < p - tol) {
    flags.son30GundeDahaUcuzdu = true;
    reasons.push(`Son ${o.windowDays} günde fiyat ${tl(min30)} seviyesine kadar inmişti; şu an daha pahalı.`);
  }

  if (historyDays >= 14 && p <= allTimeLow + tol) {
    flags.tarihiDip = true;
    reasons.push(`Takip başladığından (${Math.round(historyDays)} gün) beri görülen en düşük fiyat.`);
  }

  // --- Sınıflandırma
  let status;
  if (refPrice == null) {
    if (historyDays < o.minCoverageDays) {
      status = STATUS.VERI_YOK;
      reasons.unshift(
        `Fiyat geçmişi ${historyDays.toFixed(1)} gün; karar vermek için en az ${o.minCoverageDays} gün gerekiyor.`
      );
    } else if (claims || (claimedPct >= o.minorClaimPct && min30 < p - tol)) {
      status = STATUS.SAHTE;
      reasons.unshift(
        `%${claimedPct.toFixed(0)} indirim iddia ediliyor ama ${Math.round(historyDays)} günlük takipte fiyat kayda değer (%${o.minRealDiscountPct}+) düşmemiş.`
      );
    } else {
      status = STATUS.YOK;
      reasons.unshift(`Fiyat ${Math.round(historyDays)} gündür sabit veya yükselişte.`);
    }
  } else if (realPct >= o.minRealDiscountPct) {
    if (claims && claimedPct - realPct >= o.exaggerationGapPct) {
      status = STATUS.ABARTILI;
      reasons.unshift(
        `Gerçek indirim %${realPct.toFixed(1)} (30 günlük en düşük ${tl(refPrice)} referans alındı), ` +
          `ancak satıcı %${claimedPct.toFixed(0)} indirim gösteriyor.`
      );
    } else {
      status = STATUS.GERCEK;
      reasons.unshift(
        `İndirim öncesi 30 günün en düşük fiyatı ${tl(refPrice)}; şimdi ${tl(p)} → gerçek indirim %${realPct.toFixed(1)}.`
      );
    }
  } else if (claims || (claimedPct >= o.minorClaimPct && realPct <= o.priceTolerancePct)) {
    // Büyük bir indirim iddiası gerçek indirimle desteklenmiyorsa, ya da küçük de olsa
    // "fiyat düştü" denip fiyat 30 günlük en düşüğün altına hiç inmemişse: sahte
    status = STATUS.SAHTE;
    reasons.unshift(
      `%${claimedPct.toFixed(0)} indirim iddia ediliyor ama 30 günlük en düşük fiyata (${tl(refPrice)}) göre ` +
        (realPct > 0 ? `yalnızca %${realPct.toFixed(1)} ucuz.` : `ucuzlama yok.`)
    );
  } else {
    status = STATUS.YOK;
    reasons.unshift(
      realPct > 0
        ? `Fiyat 30 günlük en düşüğe göre yalnızca %${realPct.toFixed(1)} düşük (eşik %${o.minRealDiscountPct}).`
        : `Fiyat 30 günlük en düşük fiyatın (${tl(refPrice)}) üzerinde veya eşit.`
    );
  }

  let confidence = 'düşük';
  if (status !== STATUS.VERI_YOK) {
    const cov = refPrice != null ? coverageDays : historyDays;
    if (cov >= o.windowDays * 0.8) confidence = 'yüksek';
    else if (cov >= o.minCoverageDays) confidence = 'orta';
  }

  const isDeal = status === STATUS.GERCEK || status === STATUS.ABARTILI;
  const dealScore = isDeal ? round2(realPct + (flags.tarihiDip ? 5 : 0) + (confidence === 'yüksek' ? 2 : 0)) : 0;

  return {
    status,
    statusLabel: STATUS_LABEL[status],
    confidence,
    reasons,
    flags,
    price: round2(p),
    listPrice: round2(listPrice),
    claimedDiscountPct: round2(claimedPct),
    referencePrice: round2(refPrice),
    realDiscountPct: round2(realPct),
    savings: refPrice != null && refPrice > p ? round2(refPrice - p) : 0,
    discountStartedAt: priorExists ? discountStart : null,
    daysInDiscount: priorExists ? round2((nowT - discountStart) / DAY) : null,
    min30: round2(min30),
    max30: round2(max30),
    avg30: round2(avg30),
    allTimeLow: round2(allTimeLow),
    allTimeHigh: round2(allTimeHigh),
    historyDays: round2(historyDays),
    refCoverageDays: round2(coverageDays),
    snapshotCount: s.length,
    lastSeenAt: nowT,
    dealScore,
  };
}

module.exports = { analyze, STATUS, STATUS_LABEL, DAY };
