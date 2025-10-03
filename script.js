/*  RateSense — Foreign Exchange Explorer (Frankfurter API)
    Author: You (with AI collaboration)
    Docs: https://www.frankfurter.app/docs  (no key; CORS enabled)
    What this file demonstrates for your rubric:
    - Fetch, transform, and display API data (Steps 5, 6, 7)
    - Structured dynamic HTML using template strings
    - Interfaces that give users control of the API (filters, range, date, swap)
    - Narrative framing supported by visual design (chart + stats + copy)
    - LocalStorage favorites; accessible UI; mobile-friendly

    NOTE for submission docs: Attribute any snippets or prompts you used. (See project brief about documenting AI usage.) 
*/

const API = 'https://api.frankfurter.app';
const els = {
  base: document.querySelector('#base'),
  quote: document.querySelector('#quote'),
  date: document.querySelector('#date'),
  range: document.querySelector('#range'),
  amount: document.querySelector('#amount'),
  fee: document.querySelector('#fee'),
  refresh: document.querySelector('#refresh'),
  swap: document.querySelector('#swap'),
  favToggle: document.querySelector('#favToggle'),
  rateCards: document.querySelector('#rateCards'),
  statbar: document.querySelector('#statbar'),
  chart: document.querySelector('#chart'),
  conversion: document.querySelector('#conversion'),
  favorites: document.querySelector('#favorites'),
  reset: document.querySelector('#resetApp'),
  app: document.querySelector('#app'),
};

const state = {
  currencies: {},
  base: 'USD',
  quote: 'EUR',
  rangeDays: 30,
  date: '', // yyyy-mm-dd
  amount: 100,
  feePct: 2.5,
  favorites: loadFavorites(), // array of "BASE/QUOTE"
  series: [], // [{d:'2025-09-01', v:1.234}]
  latest: null, // {date:'', rate: number}
  historical: null,
};

init().catch(console.error);

async function init(){
  // Accessibility nicety: '/' focuses base currency search
  window.addEventListener('keydown', (e)=>{
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT'){
      e.preventDefault(); els.base.focus();
    }
  });

  // Populate currencies
  state.currencies = await fetchJSON(`${API}/currencies`);
  populateCurrencySelects(state.currencies);

  // Defaults (persist across refresh if you wish)
  syncControlsFromState();

  // Wire events
  els.base.addEventListener('change', onPairChange);
  els.quote.addEventListener('change', onPairChange);
  els.range.addEventListener('change', async e => {
    state.rangeDays = +e.target.value; await refreshAll();
  });
  els.date.addEventListener('change', async e => {
    state.date = e.target.value; await fetchHistorical();
  });
  els.amount.addEventListener('input', e => { state.amount = +e.target.value || 0; renderConversion(); });
  els.fee.addEventListener('input', e => { state.feePct = +e.target.value || 0; renderConversion(); });
  els.swap.addEventListener('click', async ()=>{
    [state.base, state.quote] = [state.quote, state.base];
    syncControlsFromState(); await refreshAll(); 
  });
  els.refresh.addEventListener('click', refreshAll);
  els.favToggle.addEventListener('click', toggleFavorite);
  els.reset.addEventListener('click', async ()=>{
    Object.assign(state, { base:'USD', quote:'EUR', rangeDays:30, date:'', amount:100, feePct:2.5 });
    syncControlsFromState(); await refreshAll(); 
  });

  // Initial fetches
  await refreshAll();

  // Render favorites list
  renderFavorites();
}

/* ---------- Fetch helpers ---------- */
async function fetchJSON(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

// Daily latest for pair
async function fetchLatest(){
  if (state.base === state.quote){
    const today = new Date().toISOString().slice(0,10);
    state.latest = { date: today, rate: 1 };
    return;
  }
  const data = await fetchJSON(`${API}/latest?from=${state.base}&to=${state.quote}`);
  state.latest = { date: data.date, rate: data.rates[state.quote] };
}

// Historical for chosen date
async function fetchHistorical(){
  if (!state.date){ state.historical = null; renderRateCards(); return; }
  if (state.base === state.quote){
    state.historical = { date: state.date, rate: 1 };
    renderRateCards(); return;
  }
  const data = await fetchJSON(`${API}/${state.date}?from=${state.base}&to=${state.quote}`);
  state.historical = { date: data.date, rate: data.rates[state.quote] };
  renderRateCards();
}

// Time-series (window from today - N to today)
async function fetchSeries(days){
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  const endStr = end.toISOString().slice(0,10);
  const startStr = start.toISOString().slice(0,10);

  if (state.base === state.quote){
    // flat series at 1
    const arr = daysArray(start, end).map(d => ({ d, v:1 }));
    state.series = arr;
    return;
  }

  const url = `${API}/${startStr}..${endStr}?from=${state.base}&to=${state.quote}`;
  const data = await fetchJSON(url);
  const arr = Object.entries(data.rates).sort(([d1],[d2]) => d1.localeCompare(d2))
              .map(([d, obj]) => ({ d, v: obj[state.quote] }));
  state.series = arr;
}

/* ---------- Renderers ---------- */
function populateCurrencySelects(map){
  const options = Object.entries(map)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([code, name]) => `<option value="${code}">${code} — ${name}</option>`)
    .join('');
  els.base.innerHTML = options;
  els.quote.innerHTML = options;
}

function syncControlsFromState(){
  els.base.value = state.base;
  els.quote.value = state.quote;
  els.range.value = String(state.rangeDays);
  els.date.value = state.date;
  els.amount.value = String(state.amount);
  els.fee.value = String(state.feePct);
  updateFavStar();
}

async function refreshAll(){
  await Promise.all([
    fetchLatest(),
    fetchSeries(state.rangeDays),
    fetchHistorical(), // may be null if no date
  ]);
  renderRateCards();
  renderStatsAndChart();
  renderConversion();
  updateFavStar();
}

function renderRateCards(){
  const pair = `${state.base}/${state.quote}`;
  const latest = state.latest ? card('Today', state.latest.date, state.latest.rate, pair) : '';
  const hist = state.historical ? card('Historical', state.historical.date, state.historical.rate, pair) : '';
  els.rateCards.innerHTML = `
    ${latest}
    ${hist || emptyCard('Pick a date to see a historical rate.')}
    ${pairNote()}
  `;
  function card(label, date, rate, pair){
    return `
      <div class="stat" role="group" aria-label="${label} rate">
        <h3>${label} • <span class="muted">${date}</span></h3>
        <p aria-live="polite"><strong>1 ${state.base}</strong> = <strong>${fmt(rate)}</strong> ${state.quote}</p>
        <p class="notice">Pair: ${pair}</p>
      </div>
    `;
  }
  function emptyCard(text){ return `<div class="stat"><p class="muted">${text}</p></div>`; }
  function pairNote(){ return `<div class="stat"><p class="notice">Data from Frankfurter. If base and quote are the same, rate = 1.0</p></div>`; }
}

function renderStatsAndChart(){
  if (!state.series?.length){ els.statbar.innerHTML = ''; els.chart.innerHTML=''; return; }

  const values = state.series.map(p => p.v);
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const avg = values.reduce((a,b)=>a+b,0) / values.length;

  els.statbar.innerHTML = `
    ${stat('Window', `${state.rangeDays}d`)}
    ${stat('High', fmt(hi))}
    ${stat('Low', fmt(lo))}
    ${stat('Avg', fmt(avg))}
  `;
  function stat(label, val){ return `<div class="stat"><h3>${label}</h3><p>${val}</p></div>`; }

  // Draw a clean sparkline with axes ticks
  const W = 1000, H = 300, P = 36;
  const xs = (i) => P + (i*(W-2*P))/(state.series.length-1 || 1);
  const ys = (v) => {
    if (hi === lo) return H/2;
    return H - P - ((v - lo) * (H - 2*P) / (hi - lo));
  };
  const path = state.series.map((p,i) => `${i?'L':'M'}${xs(i)},${ys(p.v)}`).join(' ');
  const gridY = [lo, avg, hi].map(v => ({
    y: ys(v), label: fmt(v)
  }));

  els.chart.innerHTML = `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="currentColor" stop-opacity=".28"/>
        <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <g stroke="rgba(255,255,255,.15)" stroke-width="1">
      ${gridY.map(g => `<line x1="${P}" y1="${g.y}" x2="${W-P}" y2="${g.y}" />`).join('')}
    </g>
    <g fill="currentColor" style="color: var(--accent)">
      <path d="${path}" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="${path} L ${W-P},${H-P} L ${P},${H-P} Z" fill="url(#g)" />
      <!-- High/Low dots -->
      ${dotAtValue(hi)} ${dotAtValue(lo)}
    </g>
    <g font-size="12" fill="var(--muted)">
      ${gridY.map((g,i)=> `<text x="${W-P+6}" y="${g.y-4}">${['Low','Avg','High'][i]} ${g.label}</text>`).join('')}
    </g>
  `;
  function dotAtValue(val){
    const i = state.series.findIndex(p => p.v === val);
    if (i < 0) return '';
    return `<circle cx="${xs(i)}" cy="${ys(val)}" r="4" fill="var(--accent-2)" />`;
  }
}

function renderConversion(){
  const r = state.latest?.rate ?? 1;
  const feeFactor = Math.max(0, 1 - (state.feePct/100)); // 2% fee => 0.98
  const effectiveRate = r * feeFactor;
  const out = state.amount * effectiveRate;

  els.conversion.innerHTML = `
    <div class="stat">
      <h3>Live mid-market</h3>
      <p>1 ${state.base} = <strong>${fmt(r)}</strong> ${state.quote}</p>
    </div>
    <div class="stat">
      <h3>Real effective rate <span class="muted">(-${fmt(state.feePct)}%)</span></h3>
      <p>1 ${state.base} ≈ <strong>${fmt(effectiveRate)}</strong> ${state.quote}</p>
    </div>
    <div class="stat">
      <h3>Converted amount</h3>
      <p><strong>${fmt(out)}</strong> ${state.quote} <span class="muted">for ${fmt(state.amount)} ${state.base}</span></p>
    </div>
  `;
}

/* ---------- Events & helpers ---------- */
async function onPairChange(){
  state.base = els.base.value;
  state.quote = els.quote.value;
  await refreshAll();
}

function fmt(n){
  // Friendly formatting for rates & amounts
  const val = Number(n);
  if (Number.isNaN(val)) return '—';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(val);
}

function daysArray(startDate, endDate){
  const out = [];
  const d = new Date(startDate);
  while (d <= endDate){
    out.push(d.toISOString().slice(0,10));
    d.setDate(d.getDate()+1);
  }
  return out;
}

/* ---------- Favorites ---------- */
function loadFavorites(){
  try{ return JSON.parse(localStorage.getItem('fx-favorites') || '[]'); }catch{ return []; }
}
function saveFavorites(){
  localStorage.setItem('fx-favorites', JSON.stringify(state.favorites));
}
function pairKey(){ return `${state.base}/${state.quote}`; }

function updateFavStar(){
  const key = pairKey();
  const on = state.favorites.includes(key);
  els.favToggle.setAttribute('aria-pressed', String(on));
  els.favToggle.textContent = on ? '★' : '☆';
}

function toggleFavorite(){
  const key = pairKey();
  const i = state.favorites.indexOf(key);
  if (i >= 0) state.favorites.splice(i,1);
  else state.favorites.push(key);
  saveFavorites(); updateFavStar(); renderFavorites();
}

function renderFavorites(){
  if (!state.favorites.length){
    els.favorites.innerHTML = `<span class="muted">No favorites yet. Click the ★ to save a pair.</span>`;
    return;
  }
  els.favorites.innerHTML = state.favorites.map(k => {
    const [b,q] = k.split('/');
    return `<button class="pill" data-b="${b}" data-q="${q}" aria-label="Load favorite ${k}">${k}</button>`;
  }).join('');
  els.favorites.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      state.base = btn.dataset.b;
      state.quote = btn.dataset.q;
      syncControlsFromState(); await refreshAll();
      els.app.scrollIntoView({behavior:'smooth', block:'start'});
    });
  });
}

/* ---------- Progressive enhancements ---------- */
// Keyboard shortcut: swap with Shift+S
window.addEventListener('keydown', async e=>{
  if (e.shiftKey && (e.key.toLowerCase() === 's')){
    [state.base, state.quote] = [state.quote, state.base];
    syncControlsFromState(); await refreshAll();
  }
});

// Respect reduced motion (chart anim could be added if needed)
