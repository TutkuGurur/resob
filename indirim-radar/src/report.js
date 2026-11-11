'use strict';

/**
 * Takip edilen ürünlerin analizini tek dosyalık, bağımlılıksız bir HTML rapora dönüştürür.
 * Sunucu çalıştırmadan paylaşılabilir / tarayıcıda açılabilir.
 *   node src/cli.js rapor-html cikti.html
 */

const db = require('./db');
const tracker = require('./tracker');

const DAY = 864e5;

function buildData({ historyDays = 120 } = {}) {
  const now = Date.now();
  return tracker
    .allSummaries()
    .filter((x) => !x.isDemo && x.analysis && x.analysis.price)
    .map((x) => {
      const hist = db.getSnapshots(x.id, now - historyDays * DAY).filter((s) => s.inStock !== 0);
      // Günlük tek değer (o günün en düşüğü) — dosya boyutunu küçük tutar
      const byDay = new Map();
      for (const s of hist) {
        const d = Math.floor(s.capturedAt / DAY);
        const cur = byDay.get(d);
        if (!cur || s.price < cur[1]) byDay.set(d, [d, s.price, s.listPrice || 0]);
      }
      const a = x.analysis;
      return {
        id: x.id,
        t: x.title,
        mp: x.marketplaceName,
        u: x.url,
        cat: x.category,
        img: x.image,
        offers: (x.offers || []).slice(0, 6).map((o) => [o.seller || o.store, o.price, o.url]),
        a: {
          status: a.status,
          label: a.statusLabel,
          conf: a.confidence,
          reasons: a.reasons,
          flags: a.flags,
          price: a.price,
          list: a.listPrice,
          claim: a.claimedDiscountPct,
          ref: a.referencePrice,
          real: a.realDiscountPct,
          savings: a.savings,
          start: a.discountStartedAt,
          min30: a.min30,
          max30: a.max30,
          avg30: a.avg30,
          atl: a.allTimeLow,
          days: a.historyDays,
          score: a.dealScore,
        },
        h: [...byDay.values()].sort((p, q) => p[0] - q[0]),
      };
    });
}

const esc = (s) => String(s).replace(/</g, '\\u003c');

function renderHtml({ items, generatedAt = Date.now(), sources = [] }) {
  const data = esc(JSON.stringify({ items, generatedAt, sources }));
  return `<title>İndirim Radarı</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap">
<style>
/* Layout: üstte durum özeti + filtre çubuğu, altında fırsat kartları ızgarası; detay alt panelde açılır */
:root{
  --bg:#f4f6f8;--surface:#ffffff;--ink:#14181f;--muted:#5a6473;--line:#dfe3e9;--accent:#2552d9;
  --good:#0f7a52;--good-bg:#e3f4ec;--warn:#9a5a00;--warn-bg:#fdf0da;--bad:#c02f28;--bad-bg:#fce7e5;--neutral:#525d73;--neutral-bg:#eceff4;
  --display:"Space Grotesk",ui-sans-serif,system-ui,sans-serif;--body:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#101318;--surface:#191d24;--ink:#e9ecf1;--muted:#9aa3b2;--line:#2a303a;--accent:#7d9cff;
  --good:#3fcf93;--good-bg:#12302a;--warn:#f1ae4f;--warn-bg:#352a15;--bad:#ff736b;--bad-bg:#3a1b1a;--neutral:#a9b2c5;--neutral-bg:#242a35;color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#101318;--surface:#191d24;--ink:#e9ecf1;--muted:#9aa3b2;--line:#2a303a;--accent:#7d9cff;
  --good:#3fcf93;--good-bg:#12302a;--warn:#f1ae4f;--warn-bg:#352a15;--bad:#ff736b;--bad-bg:#3a1b1a;--neutral:#a9b2c5;--neutral-bg:#242a35;color-scheme:dark}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{background:var(--bg);color:var(--ink);font:15px/1.5 var(--body);margin:0}
.wrap{max-width:1180px;margin:0 auto;padding-block:24px 48px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:16px}
h1{font:700 26px/1.15 var(--display);margin:0;text-wrap:balance}
.sub{color:var(--muted);margin:4px 0 0;max-width:70ch}
.stamp{font-size:13px;color:var(--muted)}
.tabs{display:flex;flex-wrap:wrap;gap:6px}
.tab{border:1px solid var(--line);background:var(--surface);color:var(--ink);padding:7px 12px;border-radius:999px;cursor:pointer;font:500 14px var(--body)}
.tab[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.tab .n{opacity:.65;margin-left:6px;font-variant-numeric:tabular-nums}
.tab:focus-visible,.card:focus-visible,select:focus-visible,input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.filters{display:flex;flex-wrap:wrap;gap:8px}
.filters input,.filters select{font:inherit;border:1px solid var(--line);background:var(--surface);color:var(--ink);padding:8px 10px;border-radius:8px;min-width:0}
.filters input{flex:1 1 220px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:12px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;cursor:pointer;min-width:0;text-align:left;color:inherit;font:inherit}
.card:hover{border-color:var(--accent)}
.top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.site{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.title{font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.badge{font-size:12px;font-weight:600;padding:3px 8px;border-radius:999px;white-space:nowrap}
.GERCEK_INDIRIM{background:var(--good-bg);color:var(--good)}
.ABARTILI_INDIRIM{background:var(--warn-bg);color:var(--warn)}
.SAHTE_INDIRIM{background:var(--bad-bg);color:var(--bad)}
.INDIRIM_YOK,.YETERSIZ_VERI{background:var(--neutral-bg);color:var(--neutral)}
.prices{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.now{font:700 22px var(--display);font-variant-numeric:tabular-nums}
.strike{text-decoration:line-through;color:var(--muted);font-variant-numeric:tabular-nums}
.kv{display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-size:13px}
.kv span{color:var(--muted)} .kv b{font-variant-numeric:tabular-nums;text-align:right}
.real{color:var(--good)} .fake{color:var(--bad)}
.reason{font-size:13px;color:var(--muted);margin:0}
.flags{display:flex;flex-wrap:wrap;gap:4px}
.flag{font-size:11px;padding:2px 6px;border-radius:4px;background:var(--neutral-bg);color:var(--neutral)}
.flag.bad{background:var(--bad-bg);color:var(--bad)} .flag.good{background:var(--good-bg);color:var(--good)}
svg.spark{width:100%;height:44px;display:block}
.empty{padding:36px;text-align:center;color:var(--muted);background:var(--surface);border:1px dashed var(--line);border-radius:12px;grid-column:1/-1}
.detail{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:10px}
.detail h2{font:700 20px/1.2 var(--display);margin:0;text-wrap:balance}
.chartbox{overflow-x:auto}
svg.chart{width:100%;min-width:520px;height:260px;display:block}
.chart text{fill:var(--muted);font:11px var(--body)}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted)}
.legend i{display:inline-block;width:14px;height:3px;vertical-align:middle;margin-right:4px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}
.stat{border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.stat span{display:block;font-size:12px;color:var(--muted)} .stat b{font-variant-numeric:tabular-nums}
.offers{display:flex;flex-direction:column}
.offers div{display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding:6px 0;font-size:14px}
.offers a{color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
ul.reasons{margin:0;padding-left:18px}
.btnrow{display:flex;gap:8px;flex-wrap:wrap}
.btn{border:1px solid var(--line);background:var(--surface);color:var(--ink);padding:8px 14px;border-radius:8px;cursor:pointer;font:inherit;text-decoration:none}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--surface)}
.info{font-size:13px;color:var(--muted);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px;max-width:none}
.info b{color:var(--ink)}
</style>
<div class="wrap">
  <header>
    <h1>İndirim Radarı</h1>
    <p class="sub">Akakçe'de listelenen tüm mağazaların fiyatları, her ürünün <b>indirim öncesi son 30 günün en düşük fiyatına</b> göre değerlendirildi. Sahte ve abartılı indirimler ayrıldı.</p>
    <p class="stamp" id="stamp"></p>
  </header>
  <div class="tabs" id="tabs" role="toolbar" aria-label="Durum filtresi"></div>
  <div class="filters">
    <input id="q" type="search" placeholder="Ürün ara…" aria-label="Ürün ara">
    <select id="cat" aria-label="Kategori"></select>
    <select id="sort" aria-label="Sıralama">
      <option value="score">Sırala: En iyi fırsat</option>
      <option value="real">Gerçek indirim %</option>
      <option value="claim">Gösterilen indirim %</option>
      <option value="price">Fiyat (artan)</option>
    </select>
  </div>
  <section id="detail" class="detail" hidden></section>
  <div class="grid" id="list"></div>
  <p class="info"><b>Nasıl hesaplandı?</b> İndirimin başladığı günden önceki 30 günde uygulanan en düşük fiyat referans alınır (Ticaret Bakanlığı Haksız Ticari Uygulamalar Yönetmeliği'ndeki ölçüt). Gerçek indirim = (referans − güncel) / referans. <b>Gösterilen indirim</b>, son fiyat düşüşünün bir önceki fiyata göre oranıdır (“fiyatı %X düştü”). <b>Sahte</b>: gösterilen indirim var ama 30 günlük en düşüğe göre anlamlı (%5+) ucuzlama yok. <b>Abartılı</b>: gerçek indirim var ama gösterilen oran 15+ puan fazla. Fiyatlar tüm satıcılar arasındaki en ucuz fiyattır; geçmiş veriler Akakçe'nin 6 aylık fiyat değişim tablosundan alındı.</p>
</div>
<script>
const DATA = ${data};
const DAY = 864e5;
const TABS = [
  ['GERCEK_INDIRIM,ABARTILI_INDIRIM', 'Gerçek indirimler'],
  ['SAHTE_INDIRIM', 'Sahte indirimler'],
  ['ABARTILI_INDIRIM', 'Abartılı'],
  ['INDIRIM_YOK', 'İndirim yok'],
  ['', 'Tümü'],
];
const FLAGS = {
  zamSonrasiIndirim: ['Önce zam, sonra indirim', 'bad'],
  ustuCiziliHicUygulanmadi: ['Gösterilen eski fiyat hiç uygulanmamış', 'bad'],
  son30GundeDahaUcuzdu: ['30 günde daha ucuzdu', ''],
  tarihiDip: ['6 ayın en düşüğü', 'good'],
};
const st = { tab: TABS[0][0], q: '', cat: '', sort: 'score', open: null };
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tl = (n) => n == null ? '–' : n.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + ' TL';
const pc = (n) => n == null || n <= 0 ? 'yok' : '%' + n.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
const safeUrl = (u) => /^https:\\/\\//.test(u || '') ? u : '#';

$('#stamp').textContent = DATA.items.length + ' ürün · son güncelleme ' + new Date(DATA.generatedAt).toLocaleString('tr-TR', { dateStyle: 'long', timeStyle: 'short' });
const cats = [...new Set(DATA.items.map(i => i.cat).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
$('#cat').innerHTML = '<option value="">Tüm kategoriler</option>' + cats.map(c => '<option>' + esc(c) + '</option>').join('');

function spark(h) {
  if (!h || h.length < 2) return '';
  const xs = h.map(p => p[0]), ys = h.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = x => (x1 === x0 ? 0 : (x - x0) / (x1 - x0)) * 300, Y = y => 40 - (y1 === y0 ? .5 : (y - y0) / (y1 - y0)) * 36;
  let d = '';
  h.forEach((p, i) => { d += i ? ' H' + X(p[0]).toFixed(1) + ' V' + Y(p[1]).toFixed(1) : 'M' + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); });
  const last = h[h.length - 1];
  return '<svg class="spark" viewBox="0 0 300 44" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + ' V44 H0 Z" fill="var(--accent)" opacity=".08"/><path d="' + d + '" fill="none" stroke="var(--accent)" stroke-width="1.6" vector-effect="non-scaling-stroke"/><circle cx="' + X(last[0]) + '" cy="' + Y(last[1]) + '" r="2.5" fill="var(--accent)"/></svg>';
}
const flagsHtml = (a) => Object.entries(a.flags || {}).filter(([, v]) => v).map(([k]) => '<span class="flag ' + FLAGS[k][1] + '">' + FLAGS[k][0] + '</span>').join('');

function card(it) {
  const a = it.a;
  return '<button class="card" data-id="' + it.id + '"><div class="top"><div><div class="site">' + esc(it.cat || it.mp) + '</div><div class="title">' + esc(it.t) + '</div></div><span class="badge ' + a.status + '">' + esc(a.label) + '</span></div>'
    + '<div class="prices"><span class="now">' + tl(a.price) + '</span>' + (a.list ? '<span class="strike">' + tl(a.list) + '</span>' : '') + '</div>'
    + spark(it.h)
    + '<div class="kv"><span>30 günün en düşüğü</span><b>' + tl(a.min30) + '</b><span>İndirim öncesi 30 gün en düşük</span><b>' + tl(a.ref) + '</b>'
    + '<span>Gerçek indirim</span><b class="' + (a.status === 'SAHTE_INDIRIM' ? 'fake' : 'real') + '">' + pc(a.real) + '</b><span>Gösterilen indirim</span><b>' + pc(a.claim) + '</b></div>'
    + '<div class="flags">' + flagsHtml(a) + '</div><p class="reason">' + esc((a.reasons || [])[0]) + '</p></button>';
}

function chart(it) {
  const h = it.h, a = it.a;
  if (h.length < 2) return '';
  const W = 760, H = 260, L = 64, R = 12, T = 12, B = 28;
  const xs = h.map(p => p[0] * DAY);
  const ys = h.flatMap(p => [p[1], p[2]].filter(Boolean)).concat(a.ref ? [a.ref] : []);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = (y1 - y0) * .08 || y1 * .05; y0 -= pad; y1 += pad;
  const X = x => L + (x1 === x0 ? 0 : (x - x0) / (x1 - x0)) * (W - L - R), Y = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  let d = ''; h.forEach((p, i) => { d += (i ? ' H' + X(p[0] * DAY).toFixed(1) + ' V' : 'M' + X(p[0] * DAY).toFixed(1) + ' ') + Y(p[1]).toFixed(1); });
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = y0 + (y1 - y0) * i / 4; g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="var(--line)"/><text x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + Math.round(v).toLocaleString('tr-TR') + '</text>'; }
  for (let i = 0; i <= 4; i++) { const x = x0 + (x1 - x0) * i / 4; g += '<text x="' + X(x) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : i === 4 ? 'end' : 'middle') + '">' + new Date(x).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) + '</text>'; }
  let ref = '';
  if (a.ref && a.start) {
    const ws = Math.max(x0, a.start - 30 * DAY), we = Math.min(x1, a.start);
    ref = '<rect x="' + X(ws) + '" y="' + T + '" width="' + Math.max(0, X(we) - X(ws)) + '" height="' + (H - T - B) + '" fill="var(--accent)" opacity=".07"/>'
      + '<line x1="' + X(ws) + '" x2="' + (W - R) + '" y1="' + Y(a.ref) + '" y2="' + Y(a.ref) + '" stroke="var(--good)" stroke-width="1.5" stroke-dasharray="3 3"/>';
  }
  const last = h[h.length - 1];
  return '<div class="chartbox"><svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Fiyat geçmişi grafiği">' + g + ref
    + '<path d="' + d + '" fill="none" stroke="var(--accent)" stroke-width="2.2"/><circle cx="' + X(last[0] * DAY) + '" cy="' + Y(last[1]) + '" r="4" fill="var(--accent)"/></svg></div>'
    + '<div class="legend"><span><i style="background:var(--accent)"></i>En ucuz fiyat (tüm satıcılar)</span><span><i style="background:var(--good)"></i>İndirim öncesi 30 gün en düşük</span><span>Gölgeli alan: referans penceresi</span></div>';
}

function openDetail(id) {
  const it = DATA.items.find(x => x.id === id);
  if (!it) return;
  st.open = id;
  const a = it.a, el = $('#detail');
  el.innerHTML = '<div class="top"><div><div class="site">' + esc(it.cat || it.mp) + '</div><h2>' + esc(it.t) + '</h2></div><span class="badge ' + a.status + '">' + esc(a.label) + '</span></div>'
    + '<div class="prices"><span class="now">' + tl(a.price) + '</span>' + (a.list ? '<span class="strike">' + tl(a.list) + '</span>' : '') + '</div>'
    + chart(it)
    + '<div class="stats">'
    + [['30 gün en düşük', tl(a.min30)], ['30 gün en yüksek', tl(a.max30)], ['30 gün ortalama', tl(a.avg30)], ['6 ayın en düşüğü', tl(a.atl)],
       ['Gerçek indirim', pc(a.real)], ['Gösterilen indirim', pc(a.claim)], ['Gerçek tasarruf', tl(a.savings)], ['Güven', esc(a.conf)]]
      .map(([k, v]) => '<div class="stat"><span>' + k + '</span><b>' + v + '</b></div>').join('')
    + '</div><div class="flags">' + flagsHtml(a) + '</div>'
    + '<ul class="reasons">' + (a.reasons || []).map(r => '<li>' + esc(r) + '</li>').join('') + '</ul>'
    + (it.offers.length ? '<div class="offers"><b>Satıcılar (en ucuzdan)</b>' + it.offers.map(o => '<div><a href="' + esc(safeUrl(o[2])) + '" target="_blank" rel="noopener noreferrer">' + esc(o[0]) + '</a><b>' + tl(o[1]) + '</b></div>').join('') + '</div>' : '')
    + '<div class="btnrow"><a class="btn primary" href="' + esc(safeUrl(it.u)) + '" target="_blank" rel="noopener noreferrer">Akakçe\\'de aç</a><button class="btn" id="close">Kapat</button></div>';
  el.hidden = false;
  $('#close').onclick = () => { el.hidden = true; st.open = null; };
  el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

const SORT = {
  score: (a, b) => b.a.score - a.a.score || (b.a.real || 0) - (a.a.real || 0),
  real: (a, b) => (b.a.real || 0) - (a.a.real || 0),
  claim: (a, b) => (b.a.claim || 0) - (a.a.claim || 0),
  price: (a, b) => a.a.price - b.a.price,
};

function render() {
  const base = DATA.items.filter(i => (!st.cat || i.cat === st.cat) && (!st.q || i.t.toLocaleLowerCase('tr').includes(st.q)));
  const count = (k) => k ? base.filter(i => k.split(',').includes(i.a.status)).length : base.length;
  $('#tabs').innerHTML = TABS.map(([k, l]) => '<button class="tab" aria-pressed="' + (k === st.tab) + '" data-k="' + k + '">' + l + '<span class="n">' + count(k) + '</span></button>').join('');
  const items = base.filter(i => !st.tab || st.tab.split(',').includes(i.a.status)).sort(SORT[st.sort]);
  $('#list').innerHTML = items.length ? items.map(card).join('') : '<div class="empty">Bu filtrede ürün yok.</div>';
}

$('#tabs').onclick = (e) => { const b = e.target.closest('.tab'); if (b) { st.tab = b.dataset.k; render(); } };
$('#list').onclick = (e) => { const c = e.target.closest('.card'); if (c) openDetail(Number(c.dataset.id)); };
$('#q').oninput = (e) => { st.q = e.target.value.trim().toLocaleLowerCase('tr'); render(); };
$('#cat').onchange = (e) => { st.cat = e.target.value; render(); };
$('#sort').onchange = (e) => { st.sort = e.target.value; render(); };
render();
</script>
`;
}

module.exports = { buildData, renderHtml };
