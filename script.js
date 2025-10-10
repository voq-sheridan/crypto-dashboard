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
  swap: document.querySelector('#swap'),
  rateCards: document.querySelector('#rateCards'),
  statbar: document.querySelector('#statbar'),
  chart: document.querySelector('#chart'),
  conversion: document.querySelector('#conversion'),
    historicalEl: document.querySelector('#historical'),
  reset: document.querySelector('#resetApp'),
  app: document.querySelector('#app'),
};

const state = {
  currencies: {},
  base: 'USD',
  quote: 'CAD',
  rangeDays: 30,
  date: '',
  amount: 100,
  feePct: 0,
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

  // Load persisted fee percentage if present
  const savedFee = localStorage.getItem('feePct');
  if (savedFee !== null){ state.feePct = Number(savedFee) || 0; els.fee.value = String(state.feePct); }

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
  els.reset.addEventListener('click', async ()=>{
    Object.assign(state, { base:'USD', quote:'CAD', rangeDays:30, date:'', amount:100, feePct:2.5 });
    syncControlsFromState(); await refreshAll();
  });

  // Persist fee on change
  els.fee.addEventListener('change', (e) => { localStorage.setItem('feePct', String(state.feePct)); });

  // Initial load
  await refreshAll();
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
}

function renderRateCards(){
  // Clear the left column rate cards (we render rates in the right column now)
  els.rateCards.innerHTML = '';

  const latestRate = state.latest?.rate ?? 1;
  const latestDate = state.latest?.date ?? new Date().toISOString().slice(0,10);
  const hist = state.historical;

  // Render both Live and Historical inside the right-column placeholder
  if (els.historicalEl){
    if (hist){
      // When a historical date is selected, show only the historical rate (hide today's rate and the date)
      els.historicalEl.innerHTML = `
        <div class="row">
          <div class="stat">
            <p>1 ${state.base} = <strong>${Number(hist.rate).toFixed(4)}</strong> ${state.quote}</p>
          </div>
        </div>
      `;
    } else {
      // No historical date selected — show live mid-market only
      els.historicalEl.innerHTML = `
        <div class="row">
          <div class="stat">
            <p>1 ${state.base} = <strong>${Number(latestRate).toFixed(4)}</strong> ${state.quote}</p>
          </div>
        </div>
      `;
    }
  }
}

function renderStatsAndChart(){
  if (!state.series?.length){ els.statbar.innerHTML = ''; els.chart.innerHTML=''; return; }

  const vals = state.series.map(p => p.v);
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const avg = vals.reduce((a,b)=>a+b,0) / vals.length;

  els.statbar.innerHTML = `
    ${stat('High', fmt(hi))}
    ${stat('Low', fmt(lo))}
    ${stat('Avg', fmt(avg))}
  `;
  function stat(label, val){ return `<div class="stat"><h3>${label}</h3><p>${val}</p></div>`; }

  // SVG sparkline
  const W = 1000, H = 300;
  // margins: give extra left space for y-axis labels and bottom for x labels
  const M = { left: 80, right: 36, top: 20, bottom: 60 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const xs = (i) => M.left + (i * (plotW) / (state.series.length - 1 || 1));
  const ys = (v) => hi === lo ? (M.top + plotH/2) : (M.top + plotH - ((v - lo) * plotH / (hi - lo)));
  const dPath = state.series.map((p,i) => `${i?'L':'M'}${xs(i)},${ys(p.v)}`).join(' ');
  const gridY = [lo, avg, hi].map(v => ({ y: ys(v), label: fmt(v) }));
  // Build x-axis ticks (dates) and y-axis ticks (numeric rates)
  // Local formatter for chart axis values (2 decimal places)
  const fmt2 = n => (Number(n) || 0).toFixed(2);
  const xTickCount = Math.min(8, state.series.length);
  const step = Math.max(1, Math.floor((state.series.length - 1) / (xTickCount - 1)));
  const tickIdx = [];
  for (let i = 0; i < state.series.length; i += step) tickIdx.push(i);
  if (tickIdx[tickIdx.length - 1] !== state.series.length - 1) tickIdx.push(state.series.length - 1);

  const fmtDate = d => { const dt = new Date(d); return `${dt.getMonth()+1}/${dt.getDate()}`; };

  const xTicks = tickIdx.map(i => {
    const x = xs(i);
    const label = fmtDate(state.series[i].d);
    const y = M.top + plotH;
  // Date label vertical padding (distance from axis line)
  // Read from CSS variable --chart-date-label-offset (fallback to 26)
  const style = getComputedStyle(document.querySelector('.chart-wrap'));
  const cssOffset = parseInt(style.getPropertyValue('--chart-date-label-offset')) || 26;
  const dateLabelOffset = cssOffset;
    return `<g transform="translate(${x},0)">` +
             `<line y1="${y-6}" y2="${y}" stroke="var(--muted)" stroke-width="1" />` +
             `<text y="${y + dateLabelOffset}" text-anchor="middle">${label}</text>` +
           `</g>`;
  }).join('');

  const yTicksVals = [hi, (hi+lo)/2, lo];
  const yTicks = yTicksVals.map(v => {
    const y = ys(v);
    return `<g transform="translate(0,${y})">` +
             `<line x1="${M.left}" x2="${W-M.right}" stroke="rgba(255,255,255,0.06)" />` +
             `<text x="${M.left-12}" y="12" text-anchor="end">${fmt2(v)}</text>` +
           `</g>`;
  }).join('');

  els.chart.innerHTML = `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="currentColor" stop-opacity=".28"/>
        <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <!-- faint horizontal grid lines and y labels -->
    <g font-size="12" fill="var(--muted)">
      ${yTicks}
    </g>
    <g fill="currentColor" style="color: var(--accent)">
      <path d="${dPath}" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="${dPath} L ${M.left+plotW},${M.top+plotH} L ${M.left},${M.top+plotH} Z" fill="url(#g)" />
      ${dotAtValue(hi)} ${dotAtValue(lo)}
    </g>
    <!-- x axis and ticks -->
    <g stroke="var(--muted)" fill="var(--muted)" font-size="12">
      <line x1="${M.left}" y1="${M.top+plotH}" x2="${M.left+plotW}" y2="${M.top+plotH}" />
      ${xTicks}
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
  const today = state.latest?.date || new Date().toISOString().slice(0,10);
  const rate4 = (Number(r) || 0).toFixed(4);
  const pair = `${state.base}/${state.quote}`;

  els.conversion.innerHTML = `
    <div class="row">
      <div class="stat">
        <h3>Rate as of: ${today}</h3>
        <p>1 ${state.base} = <strong>${rate4}</strong> ${state.quote}</p>
      </div>
      <div class="stat converted">
        <h3>Converted amount</h3>
            <p><strong>${fmt2(out)}</strong> ${state.quote} <span class="muted"></span></p>
      </div>
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

function fmt2(n){
  const val = Number(n);
  if (Number.isNaN(val)) return '—';
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
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
// THEME TOGGLE (no text, just knob + labels)
const themeToggle = document.getElementById('theme-toggle');
const htmlElement = document.documentElement;

const savedTheme = localStorage.getItem('theme') || 'light';
htmlElement.setAttribute('data-theme', savedTheme);
themeToggle.setAttribute('aria-label', savedTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');

themeToggle.addEventListener('click', () => {
  const current = htmlElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  htmlElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  themeToggle.setAttribute('aria-label', next === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
});


/* ---------------- Extras ---------------- */
// Keyboard shortcut: Shift+S swaps pair
window.addEventListener('keydown', async e=>{
  if (e.shiftKey && (e.key.toLowerCase() === 's')){
    [state.base, state.quote] = [state.quote, state.base];
    syncControlsFromState(); await refreshAll();
  }
});
