'use strict';

const db = require('./db');
const tracker = require('./tracker');
const ex = require('./extractors');
const { seedDemo } = require('./demo');

const HELP = `İndirim Radarı — komutlar
  guncelle                Vakti gelen tüm ürünleri ve kampanya sayfalarını tara (cron için)
  guncelle --hepsi        Hepsini şimdi tara
  ekle <url> [url...]     Ürün(ler)i takibe al
  kesif <url> [etiket]    Kampanya/kategori/arama sayfasını keşif listesine ekle
  rapor [--hepsi]         Gerçek indirimleri (veya tüm ürünleri) listele
  rapor-html [dosya]      Tek dosyalık, paylaşılabilir HTML rapor üret
  demo                    Örnek senaryolarla demo verisi yükle
  demo-sil                Demo verisini sil`;

const fmt = (n) => (n == null ? '-' : n.toLocaleString('tr-TR', { maximumFractionDigits: 2 }));

async function main([cmd, ...args]) {
  db.open();
  switch (cmd) {
    case 'guncelle': {
      const s = await tracker.refreshAll({ due: !args.includes('--hepsi') });
      console.log(`Bitti: ${s.ok}/${s.checked} başarılı, ${s.failed} hata, ${s.discovered} yeni ürün keşfedildi.`);
      break;
    }
    case 'ekle':
      if (!args.length) return console.log(HELP);
      for (const u of args) {
        const r = await tracker.addProductByUrl(u);
        console.log(r.ok ? `✓ ${r.data.title} — ${fmt(r.data.price)} TL` : `✗ ${u} — ${r.error}`);
      }
      break;
    case 'kesif': {
      if (!args[0]) return console.log(HELP);
      const marketplace = ex.detectMarketplace(args[0]);
      const id = db.addWatchlist({ marketplace, url: args[0], label: args[1] });
      const w = db.listWatchlists().find((x) => x.id === id);
      const r = await tracker.runWatchlist(w, { log: console.log });
      console.log(r.error ? `✗ ${r.error}` : `✓ ${r.found} ürün linki bulundu, ${r.added} yeni ürün eklendi.`);
      break;
    }
    case 'rapor': {
      const all = args.includes('--hepsi');
      const items = tracker
        .allSummaries()
        .filter((x) => all || ['GERCEK_INDIRIM', 'ABARTILI_INDIRIM'].includes(x.analysis.status))
        .sort((a, b) => b.analysis.dealScore - a.analysis.dealScore);
      console.table(
        items.map((x) => ({
          Durum: x.analysis.statusLabel,
          Site: x.marketplaceName,
          Ürün: (x.title || x.url).slice(0, 40),
          Fiyat: fmt(x.analysis.price),
          '30g en düşük (ref)': fmt(x.analysis.referencePrice),
          'Gerçek %': fmt(x.analysis.realDiscountPct),
          'İddia %': fmt(x.analysis.claimedDiscountPct),
        }))
      );
      break;
    }
    case 'rapor-html': {
      const out = args[0] || 'indirim-raporu.html';
      const { buildData, renderHtml } = require('./report');
      const items = buildData();
      require('node:fs').writeFileSync(out, renderHtml({ items }));
      console.log(`✓ ${items.length} ürün → ${out}`);
      break;
    }
    case 'demo':
      console.log(seedDemo());
      break;
    case 'demo-sil':
      db.deleteDemo();
      console.log('Demo verisi silindi.');
      break;
    default:
      console.log(HELP);
  }
  db.close();
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e);
  process.exit(1);
});
