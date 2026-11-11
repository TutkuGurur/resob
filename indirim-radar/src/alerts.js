'use strict';

/**
 * Alarm değerlendirme: bir ürünün fiyatı her güncellendiğinde çağrılır.
 *  - 'fiyat'  : güncel fiyat hedef fiyata eşit veya altındaysa
 *  - 'gercek' : ürün gerçek indirime girdiyse (30 günlük en düşüğün en az %5 altı)
 * Koşul sağlandığı sürece tekrar bildirmez; koşul bozulup yeniden sağlanınca tekrar bildirir.
 */

const users = require('./users');
const push = require('./push');

const tl = (n) => n.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + ' TL';

function conditionMet(alert, analysis) {
  if (!analysis || !analysis.price) return false;
  if (alert.type === 'fiyat') return analysis.price <= alert.target_price;
  if (alert.type === 'gercek') return ['GERCEK_INDIRIM', 'ABARTILI_INDIRIM'].includes(analysis.status);
  return false;
}

function messageFor(alert, summary) {
  const a = summary.analysis;
  const name = summary.title || 'Ürün';
  if (alert.type === 'fiyat') {
    return {
      title: `${name}: ${tl(a.price)}`,
      body: `Hedef fiyatın (${tl(alert.target_price)}) altına indi.` +
        (a.status === 'SAHTE_INDIRIM' ? ' Dikkat: 30 günlük en düşük fiyata göre gerçek bir indirim değil.' : ''),
    };
  }
  return {
    title: `Gerçek indirim: ${name}`,
    body: `${tl(a.price)} — indirim öncesi 30 günün en düşüğüne (${tl(a.referencePrice)}) göre %${a.realDiscountPct.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} ucuz.`,
  };
}

/** @returns {Promise<number>} gönderilen bildirim sayısı */
async function evaluate(summary, { sender = push.send } = {}) {
  let fired = 0;
  for (const alert of users.alertsForProduct(summary.id)) {
    const met = conditionMet(alert, summary.analysis);
    if (met && !alert.triggered) {
      const msg = messageFor(alert, summary);
      users.addNotification(alert.user_id, { productId: summary.id, ...msg });
      users.setAlertState(alert.id, true, true);
      fired++;
      for (const sub of users.pushSubs(alert.user_id)) {
        const r = await sender(sub, { ...msg, url: `/#/urun/${summary.id}` });
        if (r.gone) users.removePushSub(sub.endpoint);
      }
    } else if (!met && alert.triggered) {
      users.setAlertState(alert.id, false, false);
    }
  }
  return fired;
}

module.exports = { evaluate, conditionMet, messageFor };
