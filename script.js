/*  RateSense — Foreign Exchange Explorer (Frankfurter API)
    - Daily, historical, and time-series rates
    - Conversion tool with fee-adjusted “real effective rate”
    - Trend visualization (7/30/90) with highs/lows/average
    - Favorite currency pairs (localStorage)
    - Accessible & responsive UI; dynamic HTML via template strings
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
  date: '',
  amount: 100,
  feePct: 2.5,
  favorites: loadFavorites(),
  series: [],
  latest: null,
  historical: null,
};

init().catch(console.error);

async function init(){
  // Keyboard: '/' focuses base select
  window.addEventListener('keydown', (e)=>{
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT'){
      e.preventDefault(); els.base.focus();
    }
  });

  // Load currency list and populate
  state.currencies = await fetchJSON(`${API}/currencies`);
  populateCurrencySelects(state.currencies);

  syncControlsFromState();

  // Events
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

  // Initial load
  await refreshAll();
  renderFavorites();
}

/* ---------------- Fetch ---------------- */
async function fetchJSON(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function fetchLatest(){
  if (state.base === state.quote){
    const today = new Date().toISOString().slice(0,10);
    state.latest = { date: today, rate: 1 };
    return;
  }
  const data = await fetchJSON(`${API}/latest?from=${state.base}&to=${state.quote}`);
  state.latest = { date: data.date, rate: data.rates[state.quote] };
}

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

async function fetchSeries(days){
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  const endStr = end.toISOString().slice(0,10);
  const startStr = start.toISOString().slice(0,10);

  if (state.base === state.quote){
    state.series = daysArray(start, end).map(d => ({ d, v:1 }));
    return;
  }
  const url = `${API}/${startStr}..${endStr}?from=${state.base}&to=${state.quote}`;
  const data = await fetchJSON(url);
  state.series = Object.entries(data.rates).sort(([a],[b]) => a.localeCompare(b))
                  .map(([d, o]) => ({ d, v: o[state.quote] }));
}

/* ---------------- Render ---------------- */
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
    fetchHistorical(),
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

  const vals = state.series.map(p => p.v);
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const avg = vals.reduce((a,b)=>a+b,0) / vals.length;

  els.statbar.innerHTML = `
    ${stat('Window', `${state.rangeDays}d`)}
    ${stat('High', fmt(hi))}
    ${stat('Low', fmt(lo))}
    ${stat('Avg', fmt(avg))}
  `;
  function stat(label, val){ return `<div class="stat"><h3>${label}</h3><p>${val}</p></div>`; }

  // SVG sparkline
  const W = 1000, H = 300, P = 36;
  const xs = (i) => P + (i*(W-2*P))/(state.series.length-1 || 1);
  const ys = (v) => hi === lo ? H/2 : H - P - ((v - lo) * (H - 2*P) / (hi - lo));
  const dPath = state.series.map((p,i) => `${i?'L':'M'}${xs(i)},${ys(p.v)}`).join(' ');
  const gridY = [lo, avg, hi].map(v => ({ y: ys(v), label: fmt(v) }));

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
      <path d="${dPath}" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="${dPath} L ${W-P},${H-P} L ${P},${H-P} Z" fill="url(#g)" />
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
  const feeFactor = Math.max(0, 1 - (state.feePct/100));
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

/* ---------------- Helpers & favorites ---------------- */
async function onPairChange(){
  state.base = els.base.value;
  state.quote = els.quote.value;
  await refreshAll();
}

function fmt(n){
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

// Select the toggle button and the root HTML element
const themeToggle = document.getElementById('theme-toggle');
const htmlElement = document.documentElement;

// Apply the saved theme from localStorage on page load
const savedTheme = localStorage.getItem('theme');
if (savedTheme) {
  htmlElement.setAttribute('data-theme', savedTheme);
  themeToggle.setAttribute('aria-label', savedTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
}

// Add event listener to toggle button
themeToggle.addEventListener('click', () => {
  const currentTheme = htmlElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';

  // Apply the new theme
  htmlElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);

  // Update the aria-label for accessibility
  themeToggle.setAttribute('aria-label', newTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
});

/* ---------------- Extras ---------------- */
// Keyboard shortcut: Shift+S swaps pair
window.addEventListener('keydown', async e=>{
  if (e.shiftKey && (e.key.toLowerCase() === 's')){
    [state.base, state.quote] = [state.quote, state.base];
    syncControlsFromState(); await refreshAll();
  }
});
