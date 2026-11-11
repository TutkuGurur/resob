'use strict';
/* İndirim Radarı — tek sayfalık arayüz (bağımlılıksız). Yönlendirme: #/, #/listem, #/alarmlar, #/bildirimler, #/urun/ID, #/yonetim */

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tl = (n) => (n == null ? '–' : n.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + ' TL');
const pc = (n) => (n == null || n <= 0 ? 'yok' : '%' + n.toLocaleString('tr-TR', { maximumFractionDigits: 1 }));
const safeUrl = (u) => (/^https:\/\//.test(u || '') ? u : '#');
const when = (t) => (t ? new Date(t).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
const DAY = 864e5;

const state = { user: null, unread: 0, vapidKey: null, tab: 'GERCEK_INDIRIM,ABARTILI_INDIRIM', cat: '', q: '', sort: 'skor' };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.user) {
    state.user = null;
    renderAuth();
  }
  if (!res.ok) throw new Error(data.error || 'Bir hata oluştu (HTTP ' + res.status + ')');
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ---------- Giriş / kayıt ----------
function renderAuth(mode = 'login') {
  const reg = mode === 'register';
  app.innerHTML = `<div class="auth"><div class="panel">
    <h1>İndirim <span style="color:var(--accent)">Radarı</span></h1>
    <p class="muted small" style="margin:0">İndirimleri son 30 günün en düşük fiyatına göre doğrular, sahte indirimleri ayırır.</p>
    <form id="authForm">
      ${reg ? '<label>Adın<input type="text" id="aName" required maxlength="60" autocomplete="name"></label>' : ''}
      <label>E-posta<input type="email" id="aEmail" required autocomplete="email"></label>
      <label>Şifre<input type="password" id="aPass" required minlength="8" autocomplete="${reg ? 'new-password' : 'current-password'}"></label>
      ${reg ? '<label>Davet kodu<input type="text" id="aInvite" required autocomplete="off"></label>' : ''}
      <p class="err" id="aErr"></p>
      <button class="btn primary">${reg ? 'Kayıt ol' : 'Giriş yap'}</button>
    </form>
    <button class="btn" id="aSwitch">${reg ? 'Hesabım var, giriş yap' : 'Davet kodum var, kayıt ol'}</button>
  </div></div>`;
  $('#aSwitch').onclick = () => renderAuth(reg ? 'login' : 'register');
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#authForm button');
    btn.disabled = true;
    try {
      const body = { email: $('#aEmail').value, password: $('#aPass').value };
      if (reg) Object.assign(body, { name: $('#aName').value, invite: $('#aInvite').value.trim() });
      await api('/auth/' + (reg ? 'register' : 'login'), { method: 'POST', body });
      await boot();
    } catch (err) {
      $('#aErr').textContent = err.message;
      btn.disabled = false;
    }
  };
}

// ---------- Kabuk ----------
const NAV = [['#/', 'Fırsatlar'], ['#/listem', 'Listem'], ['#/alarmlar', 'Alarmlar'], ['#/bildirimler', 'Bildirimler']];
function shell(inner) {
  const cur = location.hash.replace(/^#\/urun.*/, '#/') || '#/';
  const nav = NAV.concat(state.user.isAdmin ? [['#/yonetim', 'Yönetim']] : []);
  app.innerHTML = `<header class="top"><div class="in">
      <a class="brand" href="#/">İndirim <b>Radarı</b></a>
      <nav class="nav" aria-label="Ana menü">${nav.map(([h, l]) =>
        `<a href="${h}" ${cur === h ? 'aria-current="page"' : ''}>${l}${h === '#/bildirimler' && state.unread ? `<span class="dot">${state.unread}</span>` : ''}</a>`).join('')}
      </nav></div></header><main>${inner}</main>`;
}

// ---------- Ortak parçalar ----------
const FLAGS = {
  zamSonrasiIndirim: ['Önce zam, sonra indirim', 'bad'],
  ustuCiziliHicUygulanmadi: ['Gösterilen eski fiyat hiç uygulanmamış', 'bad'],
  son30GundeDahaUcuzdu: ['30 günde daha ucuzdu', ''],
  tarihiDip: ['En düşük fiyat', 'good'],
};
const flagsHtml = (a) => Object.entries(a.flags || {}).filter(([, v]) => v).map(([k]) => `<span class="flag ${FLAGS[k][1]}">${FLAGS[k][0]}</span>`).join('');

function spark(h) {
  if (!h || h.length < 2) return '';
  const xs = h.map((p) => p[0]), ys = h.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (x) => (x1 === x0 ? 0 : (x - x0) / (x1 - x0)) * 300, Y = (y) => 40 - (y1 === y0 ? 0.5 : (y - y0) / (y1 - y0)) * 36;
  let d = '';
  h.forEach((p, i) => { d += i ? ` H${X(p[0]).toFixed(1)} V${Y(p[1]).toFixed(1)}` : `M${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`; });
  return `<svg class="spark" viewBox="0 0 300 44" preserveAspectRatio="none" aria-hidden="true"><path d="${d} V44 H0 Z" fill="var(--accent)" opacity=".08"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

function card(it) {
  const a = it.analysis;
  return `<a class="card" href="#/urun/${it.id}">
    <div class="head"><div><div class="site">${esc(it.category || it.marketplaceName)}${it.isDemo ? ' · demo' : ''}</div>
      <div class="title">${it.fav ? '<span class="star" title="Listende">★ </span>' : ''}${esc(it.title || it.url)}</div></div>
      <span class="badge ${a.status}">${esc(a.statusLabel)}</span></div>
    <div class="prices"><span class="now">${tl(a.price)}</span>${a.listPrice ? `<span class="strike">${tl(a.listPrice)}</span>` : ''}</div>
    ${spark(it.spark)}
    <div class="kv"><span>30 günün en düşüğü</span><b>${tl(a.min30)}</b>
      <span>İndirim öncesi 30 gün en düşük</span><b>${tl(a.referencePrice)}</b>
      <span>Gerçek indirim</span><b class="${a.status === 'SAHTE_INDIRIM' ? 'fake' : 'real'}">${pc(a.realDiscountPct)}</b>
      <span>Gösterilen indirim</span><b>${pc(a.claimedDiscountPct)}</b></div>
    <div class="flags">${flagsHtml(a)}</div>
    <p class="reason">${esc((a.reasons || [])[0] || '')}</p></a>`;
}

const searchBox = (placeholder) => `<form class="panel" id="findForm">
    <h2>Ürün ara, hemen analiz et</h2>
    <div class="row"><input class="grow" type="text" id="findQ" maxlength="300" autocomplete="off" placeholder="${placeholder}" aria-label="Ürün adı veya linki">
      <button class="btn primary">Bul ve analiz et</button></div>
    <p class="muted small" id="findMsg" style="margin:0">Ürün Akakçe'de bulunur; tüm mağazaların fiyatı ve 6 aylık fiyat geçmişiyle birkaç saniyede analiz edilir.</p></form>`;

function wireSearch() {
  const f = $('#findForm');
  if (!f) return;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const q = $('#findQ').value.trim();
    if (q.length < 2) return;
    const btn = $('button', f);
    btn.disabled = true;
    $('#findMsg').textContent = 'Aranıyor ve fiyat geçmişi çekiliyor…';
    try {
      const r = await api('/search?q=' + encodeURIComponent(q));
      sessionStorage.setItem('alts', JSON.stringify({ id: r.product.id, list: r.alternatives || [] }));
      location.hash = '#/urun/' + r.product.id;
    } catch (err) {
      $('#findMsg').textContent = err.message;
      btn.disabled = false;
    }
  };
}

// ---------- Fırsatlar / Listem ----------
const TABS = [
  ['GERCEK_INDIRIM,ABARTILI_INDIRIM', 'Gerçek indirimler'],
  ['SAHTE_INDIRIM', 'Sahte indirimler'],
  ['INDIRIM_YOK', 'İndirim yok'],
  ['', 'Tümü'],
];

async function renderDeals(mine) {
  shell(`${searchBox('Ürün adı (ör. Dyson V15 Detect) veya Akakçe / Trendyol / Hepsiburada linki')}
    <div class="row" style="justify-content:space-between"><h1>${mine ? 'Takip listem' : 'Fırsatlar'}</h1><span class="muted small" id="stamp"></span></div>
    <div class="tabs" id="tabs"></div>
    <div class="chips" id="cats"></div>
    <div class="row"><input class="grow" type="search" id="q" placeholder="Listede filtrele…" aria-label="Listede filtrele" value="${esc(state.q)}">
      <select id="sort" aria-label="Sıralama">
        <option value="skor">En iyi fırsat</option><option value="gercek">Gerçek indirim %</option>
        <option value="iddia">Gösterilen indirim %</option><option value="yeni">En yeni indirim</option><option value="fiyat">Fiyat (artan)</option>
      </select></div>
    <div class="grid" id="list"><div class="empty">Yükleniyor…</div></div>`);
  wireSearch();
  $('#sort').value = state.sort;
  if (mine && state.tab === TABS[0][0]) state.tab = '';

  const load = async () => {
    const p = new URLSearchParams({ sort: state.sort });
    if (state.tab) p.set('status', state.tab);
    if (state.cat) p.set('category', state.cat);
    if (state.q) p.set('q', state.q);
    if (mine) p.set('mine', '1');
    let d;
    try {
      d = await api('/deals?' + p);
    } catch (err) {
      $('#list').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
      return;
    }
    if (!$('#list')) return;
    const c = d.counts || {};
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    $('#tabs').innerHTML = TABS.map(([k, l]) => {
      const n = k ? k.split(',').reduce((s, x) => s + (c[x] || 0), 0) : total;
      return `<button class="tab" aria-pressed="${k === state.tab}" data-k="${k}">${l}<span class="n">${n}</span></button>`;
    }).join('');
    $('#cats').innerHTML = d.categories.length > 1
      ? `<button class="chip" aria-pressed="${!state.cat}" data-c="">Tüm kategoriler</button>` +
        d.categories.slice(0, 40).map((x) => `<button class="chip" aria-pressed="${x.name === state.cat}" data-c="${esc(x.name)}">${esc(x.name)} · ${x.n}</button>`).join('')
      : '';
    $('#stamp').textContent = total + ' ürün';
    $('#list').innerHTML = d.items.length ? d.items.map(card).join('')
      : `<div class="empty">${mine && !total ? 'Takip listen boş. Yukarıdan bir ürün arayıp “Listeme ekle”ye bas; fiyatı düzenli takip edilir.' : 'Bu filtrede ürün yok.'}</div>`;
  };
  $('#tabs').onclick = (e) => { const b = e.target.closest('.tab'); if (b) { state.tab = b.dataset.k; load(); } };
  $('#cats').onclick = (e) => { const b = e.target.closest('.chip'); if (b) { state.cat = b.dataset.c; load(); } };
  let qt;
  $('#q').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 250); };
  $('#sort').onchange = (e) => { state.sort = e.target.value; load(); };
  await load();
}

// ---------- Ürün detayı ----------
function chart(d) {
  const a = d.analysis;
  const byDay = new Map();
  for (const s of d.history) {
    if (s.inStock === 0) continue;
    const k = Math.floor(s.capturedAt / DAY);
    const cur = byDay.get(k);
    if (cur === undefined || s.price < cur) byDay.set(k, s.price);
  }
  const h = [...byDay.entries()].sort((p, q) => p[0] - q[0]);
  if (h.length < 2) return '<p class="muted small">Grafik için henüz yeterli fiyat kaydı yok.</p>';
  const W = 760, H = 260, L = 64, R = 12, T = 12, B = 28;
  const xs = h.map((p) => p[0] * DAY), ys = h.map((p) => p[1]).concat(a.referencePrice ? [a.referencePrice] : []);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = (y1 - y0) * 0.08 || y1 * 0.05; y0 -= pad; y1 += pad;
  const X = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R), Y = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  let path = '';
  h.forEach((p, i) => { path += (i ? ` H${X(p[0] * DAY).toFixed(1)} V` : `M${X(p[0] * DAY).toFixed(1)} `) + Y(p[1]).toFixed(1); });
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = y0 + ((y1 - y0) * i) / 4;
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v).toLocaleString('tr-TR')}</text>`;
    const x = x0 + ((x1 - x0) * i) / 4;
    g += `<text x="${X(x)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${new Date(x).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</text>`;
  }
  let ref = '';
  if (a.referencePrice && a.discountStartedAt) {
    const ws = Math.max(x0, a.discountStartedAt - 30 * DAY), we = Math.min(x1, a.discountStartedAt);
    ref = `<rect x="${X(ws)}" y="${T}" width="${Math.max(0, X(we) - X(ws))}" height="${H - T - B}" fill="var(--accent)" opacity=".07"/>
      <line x1="${X(ws)}" x2="${W - R}" y1="${Y(a.referencePrice)}" y2="${Y(a.referencePrice)}" stroke="var(--good)" stroke-width="1.5" stroke-dasharray="3 3"/>`;
  }
  const last = h[h.length - 1];
  return `<div class="chartbox"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fiyat geçmişi grafiği">${g}${ref}
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.2"/><circle cx="${X(last[0] * DAY)}" cy="${Y(last[1])}" r="4" fill="var(--accent)"/></svg></div>
    <div class="legend"><span><i style="background:var(--accent)"></i>En ucuz fiyat</span><span><i style="background:var(--good)"></i>İndirim öncesi 30 gün en düşük</span><span>Gölgeli alan: referans penceresi</span></div>`;
}

async function renderProduct(id) {
  shell('<p class="muted">Yükleniyor…</p>');
  let d;
  try {
    d = await api('/products/' + id);
  } catch (err) {
    shell(`<div class="empty">${esc(err.message)}</div><a class="btn" href="#/">Fırsatlara dön</a>`);
    return;
  }
  const a = d.analysis;
  let alts = [];
  try { const s = JSON.parse(sessionStorage.getItem('alts') || 'null'); if (s && s.id === d.id) alts = s.list; } catch { /* yok say */ }
  const priceAlert = d.alerts.find((x) => x.type === 'fiyat');
  const realAlert = d.alerts.find((x) => x.type === 'gercek');
  shell(`<a class="small" href="#/">← Fırsatlar</a>
    <div class="panel">
      <div class="head"><div><div class="site">${esc(d.category || d.marketplaceName)}</div><h1>${esc(d.title || d.url)}</h1></div>
        <span class="badge ${a.status}">${esc(a.statusLabel)}</span></div>
      <div class="prices"><span class="now">${tl(a.price)}</span>${a.listPrice ? `<span class="strike">${tl(a.listPrice)}</span>` : ''}</div>
      ${chart(d)}
      <div class="stats">${[['30 gün en düşük', tl(a.min30)], ['30 gün en yüksek', tl(a.max30)], ['30 gün ortalama', tl(a.avg30)], ['Kayıtlı en düşük', tl(a.allTimeLow)],
        ['Gerçek indirim', pc(a.realDiscountPct)], ['Gösterilen indirim', pc(a.claimedDiscountPct)], ['Gerçek tasarruf', tl(a.savings)], ['Güven', esc(a.confidence || '–')]]
        .map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <div class="flags">${flagsHtml(a)}</div>
      <ul class="reasons">${(a.reasons || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <div class="row">
        <button class="btn ${d.fav ? '' : 'primary'}" id="favBtn">${d.fav ? '★ Listemde — çıkar' : '☆ Listeme ekle'}</button>
        <a class="btn" href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener noreferrer">Kaynakta aç ↗</a>
        <button class="btn" id="refBtn">Fiyatı şimdi yenile</button>
      </div>
      <p class="muted small" style="margin:0">Son kontrol: ${when(d.lastChecked)} · ${a.snapshotCount} fiyat kaydı${d.lastError ? ' · ⚠ ' + esc(d.lastError) : ''}</p>
    </div>
    <div class="panel"><h2>Alarm kur</h2>
      <form class="row" id="alertForm">
        <label for="target" class="small">Fiyat şunun altına inince haber ver:</label>
        <input type="number" id="target" min="1" step="any" inputmode="decimal" style="width:140px" placeholder="TL" value="${priceAlert ? priceAlert.targetPrice : ''}" required>
        <button class="btn primary">${priceAlert ? 'Hedefi güncelle' : 'Alarm kur'}</button>
        ${priceAlert ? `<button type="button" class="btn danger" data-del="${priceAlert.id}">Kaldır</button>` : ''}
      </form>
      <div class="row"><span class="small">Gerçek indirime girince haber ver:</span>
        ${realAlert ? `<span class="pill ok">Açık</span><button class="btn sm danger" data-del="${realAlert.id}">Kapat</button>` : '<button class="btn sm" id="realBtn">Aç</button>'}</div>
      <p class="muted small" style="margin:0">Alarmlar <a href="#/bildirimler">Bildirimler</a> sayfasına düşer; telefon bildirimi için orada “Bildirimleri aç”a bas.</p>
    </div>
    ${d.offers && d.offers.length ? `<div class="panel"><h2>Satıcılar (en ucuzdan)</h2><div class="list">${d.offers.map((o) =>
      `<div class="item"><a class="t" href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener noreferrer">${esc(o.seller || o.store)}</a><b>${tl(o.price)}</b></div>`).join('')}</div></div>` : ''}
    ${alts.length ? `<div class="panel"><h2>Bunu mu aramıştın?</h2><div class="list">${alts.map((x) =>
      `<div class="item"><span class="t">${esc(x.title)}</span><button class="btn sm" data-alt="${esc(x.url)}">Bunu analiz et</button></div>`).join('')}</div></div>` : ''}`);

  const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); renderProduct(id); } catch (err) { toast(err.message); } };
  $('#favBtn').onclick = () => act(() => api(`/products/${id}/follow`, { method: d.fav ? 'DELETE' : 'POST' }), d.fav ? 'Listenden çıkarıldı' : 'Listene eklendi');
  $('#refBtn').onclick = (e) => { e.target.disabled = true; e.target.textContent = 'Çekiliyor…'; act(() => api(`/products/${id}/refresh`, { method: 'POST' }), 'Fiyat güncellendi'); };
  $('#alertForm').onsubmit = (e) => { e.preventDefault(); act(() => api('/alerts', { method: 'POST', body: { productId: d.id, type: 'fiyat', targetPrice: Number($('#target').value) } }), 'Alarm kuruldu'); };
  const rb = $('#realBtn');
  if (rb) rb.onclick = () => act(() => api('/alerts', { method: 'POST', body: { productId: d.id, type: 'gercek' } }), 'Alarm açıldı');
  $('main').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) act(() => api('/alerts/' + del.dataset.del, { method: 'DELETE' }), 'Alarm kaldırıldı');
    const alt = e.target.closest('[data-alt]');
    if (alt) {
      alt.disabled = true; alt.textContent = 'Çekiliyor…';
      api('/search?q=' + encodeURIComponent(alt.dataset.alt)).then((r) => { location.hash = '#/urun/' + r.product.id; }).catch((err) => { toast(err.message); alt.disabled = false; });
    }
  });
}

// ---------- Alarmlar ----------
async function renderAlerts() {
  shell('<h1>Alarmlarım</h1><div class="panel"><div class="list" id="al"><p class="muted">Yükleniyor…</p></div></div>');
  const load = async () => {
    const list = await api('/alerts');
    $('#al').innerHTML = list.length ? list.map((x) => `<div class="item">
        <div class="t"><a href="#/urun/${x.productId}">${esc(x.title || 'Ürün')}</a>
          <div class="muted small">${x.type === 'fiyat' ? `Fiyat ${tl(x.targetPrice)} veya altına inince` : 'Gerçek indirime girince'}${x.lastFiredAt ? ' · son bildirim ' + when(x.lastFiredAt) : ''}</div></div>
        <span class="row">${x.triggered ? '<span class="pill ok">Koşul sağlanıyor</span>' : '<span class="pill">Bekliyor</span>'}
          <button class="btn sm danger" data-del="${x.id}">Kaldır</button></span></div>`).join('')
      : '<p class="muted" style="margin:0">Henüz alarm yok. Bir ürünün sayfasından hedef fiyat belirleyerek alarm kurabilirsin.</p>';
  };
  $('#al').onclick = async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    try { await api('/alerts/' + b.dataset.del, { method: 'DELETE' }); await load(); } catch (err) { toast(err.message); }
  };
  await load().catch((err) => { $('#al').innerHTML = `<p class="err">${esc(err.message)}</p>`; });
}

// ---------- Bildirimler + telefon bildirimi ----------
const b64ToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function pushStatus() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? 'on' : 'off';
}

async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Bildirim izni verilmedi');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(state.vapidKey) });
  await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
}

async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}

async function renderNotifications() {
  shell(`<h1>Bildirimler</h1>
    <div class="panel"><h2>Telefon / tarayıcı bildirimi</h2><p class="muted small" id="pushMsg" style="margin:0">Kontrol ediliyor…</p><div class="row" id="pushBtns"></div></div>
    <div class="panel"><div class="list" id="nl"><p class="muted">Yükleniyor…</p></div></div>
    <div class="row"><button class="btn" id="logout">Çıkış yap (${esc(state.user.name)})</button></div>`);
  $('#logout').onclick = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); state.user = null; renderAuth(); };

  const paintPush = async () => {
    const s = await pushStatus();
    const msg = {
      unsupported: 'Bu tarayıcı anlık bildirimi desteklemiyor. iPhone\'da önce Paylaş → “Ana Ekrana Ekle” ile siteyi uygulama olarak kur, sonra uygulamadan aç.',
      denied: 'Bildirim izni bu cihazda kapatılmış. Tarayıcının site ayarlarından izin verdikten sonra sayfayı yenile.',
      on: 'Bu cihazda bildirimler açık. Alarmların tetiklendiğinde bildirim alırsın.',
      off: 'Alarmların tetiklendiğinde bu cihaza bildirim gelmesi için aç.',
    }[s];
    $('#pushMsg').textContent = msg;
    $('#pushBtns').innerHTML = s === 'off' ? '<button class="btn primary" id="pOn">Bildirimleri aç</button>'
      : s === 'on' ? '<button class="btn" id="pTest">Deneme bildirimi gönder</button><button class="btn danger" id="pOff">Bu cihazda kapat</button>' : '';
    const on = $('#pOn'), off = $('#pOff'), test = $('#pTest');
    if (on) on.onclick = async () => { on.disabled = true; try { await enablePush(); toast('Bildirimler açıldı'); } catch (err) { toast(err.message); } paintPush(); };
    if (off) off.onclick = async () => { try { await disablePush(); } catch (err) { toast(err.message); } paintPush(); };
    if (test) test.onclick = async () => {
      test.disabled = true;
      try { const r = await api('/push/test', { method: 'POST', body: {} }); toast(r.sent ? 'Deneme bildirimi gönderildi' : 'Bildirim gönderilemedi; kapatıp yeniden açmayı dene'); }
      catch (err) { toast(err.message); }
      test.disabled = false;
    };
  };
  paintPush().catch(() => { $('#pushMsg').textContent = 'Bildirim durumu okunamadı.'; });

  try {
    const d = await api('/notifications');
    $('#nl').innerHTML = d.items.length ? d.items.map((n) => `<div class="item ${n.readAt ? '' : 'unread'}"><div class="t">
        ${n.productId ? `<a href="#/urun/${n.productId}">${esc(n.title)}</a>` : `<b>${esc(n.title)}</b>`}
        <div class="small">${esc(n.body)}</div></div><span class="muted small">${when(n.createdAt)}</span></div>`).join('')
      : '<p class="muted" style="margin:0">Henüz bildirim yok. Alarm kurduğun ürünlerde koşul sağlanınca burada görünür.</p>';
    if (d.unread) { await api('/notifications/read', { method: 'POST', body: {} }); state.unread = 0; }
  } catch (err) {
    $('#nl').innerHTML = `<p class="err">${esc(err.message)}</p>`;
  }
}

// ---------- Yönetim ----------
async function renderAdmin() {
  shell('<h1>Yönetim</h1><div id="adm"><p class="muted">Yükleniyor…</p></div>');
  const load = async () => {
    const d = await api('/admin');
    $('#adm').innerHTML = `<div class="panel"><h2>Davet kodu</h2>
        <p class="small" style="margin:0">Siteye yalnızca bu kodu bilenler kayıt olabilir: <code class="invite">${esc(d.inviteCode)}</code></p></div>
      <div class="panel"><h2>Durum</h2><p class="small" style="margin:0">${d.products} ürün takipte · ${d.failing} üründe son kontrol hatalı · fiyatlar ${d.refreshHours} saatte bir yenilenir</p>
        <div class="row"><button class="btn" id="refAll">Tümünü şimdi yenile</button></div></div>
      <div class="panel"><h2>Otomatik taranan sayfalar</h2>
        <div class="list">${d.watchlists.map((w) => `<div class="item"><div class="t"><a href="${esc(safeUrl(w.url))}" target="_blank" rel="noopener noreferrer">${esc(w.label || w.url)}</a>
          <div class="muted small">Son tarama: ${when(w.last_run)}${w.last_error ? ' · ⚠ ' + esc(w.last_error) : ''}</div></div>
          <button class="btn sm danger" data-del="${w.id}">Kaldır</button></div>`).join('') || '<p class="muted" style="margin:0">Liste boş.</p>'}</div>
        <form class="row" id="wlForm"><input class="grow" type="url" id="wlUrl" required placeholder="Akakçe kategori / kampanya / arama sayfası linki">
          <input type="text" id="wlLabel" placeholder="Etiket" maxlength="60" style="width:160px"><button class="btn primary">Ekle</button></form>
        <p class="muted small" style="margin:0">Bu sayfalardaki ürünler günde bir kez otomatik bulunur ve takibe alınır.</p></div>`;
    $('#refAll').onclick = async (e) => { e.target.disabled = true; try { await api('/admin/refresh', { method: 'POST', body: {} }); toast('Güncelleme arka planda başladı'); } catch (err) { toast(err.message); } };
    $('#wlForm').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/admin/watchlists', { method: 'POST', body: { url: $('#wlUrl').value, label: $('#wlLabel').value } }); toast('Eklendi; ilk tarama bir sonraki güncellemede'); load(); }
      catch (err) { toast(err.message); }
    };
  };
  $('#adm').onclick = async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    try { await api('/admin/watchlists/' + b.dataset.del, { method: 'DELETE' }); load(); } catch (err) { toast(err.message); }
  };
  await load().catch((err) => { $('#adm').innerHTML = `<p class="err">${esc(err.message)}</p>`; });
}

// ---------- Yönlendirme ----------
function route() {
  if (!state.user) return renderAuth();
  const h = location.hash || '#/';
  const m = h.match(/^#\/urun\/(\d+)/);
  window.scrollTo(0, 0);
  if (m) return renderProduct(Number(m[1]));
  if (h === '#/listem') return renderDeals(true);
  if (h === '#/alarmlar') return renderAlerts();
  if (h === '#/bildirimler') return renderNotifications();
  if (h === '#/yonetim' && state.user.isAdmin) return renderAdmin();
  return renderDeals(false);
}

async function boot() {
  try {
    const me = await api('/me');
    Object.assign(state, { user: me.user, unread: me.unread, vapidKey: me.vapidKey });
  } catch {
    state.user = null;
  }
  route();
}

window.addEventListener('hashchange', route);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
