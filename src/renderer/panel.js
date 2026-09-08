'use strict';

const STATUS = [
  { max: 60, key: 'good', label: 'Healthy', varName: '--good' },
  { max: 80, key: 'warning', label: 'Watch', varName: '--warning' },
  { max: 93, key: 'serious', label: 'Low', varName: '--serious' },
  { max: Infinity, key: 'critical', label: 'Critical', varName: '--critical' },
];

// Distinct shapes, so status never rides on colour alone.
const STATUS_ICON = {
  good: '<path d="M2.5 6.4 5 8.9l4.6-4.6" /><circle cx="6" cy="6" r="5" />',
  warning: '<circle cx="6" cy="6" r="5" /><path d="M6 3.4v3.1" /><path d="M6 8.6v.1" />',
  serious: '<path d="M6 1.3 11.2 10.6H0.8Z" /><path d="M6 4.9v2.4" /><path d="M6 9v.1" />',
  critical: '<path d="M4 1h4l3 3v4l-3 3H4L1 8V4Z" fill="currentColor" stroke="none" /><path d="M6 3.6v2.6" stroke="var(--surface-1)" /><path d="M6 8.2v.1" stroke="var(--surface-1)" />',
  idle: '<circle cx="6" cy="6" r="5" /><path d="M6 3.6v2.8" /><path d="M6 8.4v.1" />',
};

const MONOGRAM = { claude: 'C', opencodeZen: 'G', opencodeFree: 'F', codex: 'X', openrouter: 'R' };

const el = (id) => document.getElementById(id);
const RING_CIRCUMFERENCE = 2 * Math.PI * 27;

let lastSnapshot = null;
let view = 'main'; // 'main' | 'goPlan'
let goTab = 'pricing'; // 'pricing' | 'requests'
let goPlan = null;
let goPlanError = false;
let goPlanBusy = false;

function statusFor(used) {
  if (used === null || used === undefined || Number.isNaN(used)) {
    return { key: 'idle', label: 'Unknown', varName: '--idle' };
  }
  return STATUS.find((s) => used < s.max);
}

function statusIcon(key) {
  return `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STATUS_ICON[key] || STATUS_ICON.idle}</svg>`;
}

function pill(used) {
  const s = statusFor(used);
  return `<span class="pill" style="--status: var(${s.varName})">${statusIcon(s.key)}${s.label}</span>`;
}

function formatCountdown(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rem = mins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${rem}m`;
  return `${Math.max(1, rem)}m`;
}

function formatAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60000) return 'just now';
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return `${mins}m ago`;
}

function formatMoney(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '--';
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(2)}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** The resource closest to running out, across every healthy provider. */
function worstOf(providers) {
  let best = null;
  for (const p of providers) {
    if (p.state !== 'ok') continue;
    for (const m of p.meters || []) {
      if (typeof m.used !== 'number') continue;
      if (!best || m.used > best.meter.used) best = { provider: p, meter: m };
    }
  }
  return best;
}

// ---- rendering ------------------------------------------------------------

function renderHero(providers) {
  const hero = el('hero');
  const worst = worstOf(providers);
  if (!worst) {
    hero.hidden = true;
    return;
  }
  hero.hidden = false;

  const { provider, meter } = worst;
  const s = statusFor(meter.used);
  hero.style.setProperty('--status', `var(${s.varName})`);

  const remaining = Math.max(0, Math.round(100 - meter.used));
  el('hero-number').textContent = String(remaining);
  el('hero-unit').textContent = '% left';
  el('hero-sub').textContent = `${provider.name} · ${meter.label}`;

  const countdown = formatCountdown(meter.resetsAt);
  el('hero-reset').textContent = countdown ? `Resets in ${countdown}` : 'No scheduled reset';
  el('hero-status').innerHTML = pill(meter.used);

  const fill = el('ring-fill');
  const frac = Math.max(0, Math.min(1, meter.used / 100));
  fill.style.strokeDasharray = String(RING_CIRCUMFERENCE);
  fill.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - frac));
}

function meterRow(m) {
  const s = statusFor(m.used);
  const countdown = formatCountdown(m.resetsAt);
  const tip = `${m.label}: ${m.used.toFixed(1)}% used, ${(100 - m.used).toFixed(1)}% left${
    countdown ? ` - resets in ${countdown}` : ''
  }${m.detail ? ` - ${m.detail}` : ''}${m.note ? ` - ${m.note}` : ''}`;
  const trailing = countdown ? `in ${countdown}` : m.detail || '';
  return `
    <div class="meter" style="--status: var(${s.varName})" title="${esc(tip)}">
      <div class="meter-name">${esc(m.label)}</div>
      <div class="track"><div class="fill" style="width: ${Math.max(0, Math.min(100, m.used)).toFixed(1)}%"></div></div>
      <div class="meter-value">${Math.round(m.used)}%</div>
      <div class="meter-reset">${esc(trailing)}</div>
    </div>`;
}

function cardValue(p) {
  const pr = p.primary || {};
  if (pr.kind === 'currency') {
    return `<span class="card-number">${formatMoney(pr.amount)}</span><span class="card-unit">remaining</span>`;
  }
  if (pr.kind === 'tally') {
    return `<span class="card-number">${Number(pr.amount).toLocaleString()}</span><span class="card-unit">${esc(pr.unit)} · ${esc(pr.label)}</span>`;
  }
  if (pr.kind === 'count') {
    return `<span class="card-number">${esc(pr.amount)}</span><span class="card-unit">credits left</span>`;
  }
  if (typeof pr.used === 'number') {
    return `<span class="card-number">${Math.round(100 - pr.used)}%</span><span class="card-unit">left · ${esc(pr.label || '')}</span>`;
  }
  return `<span class="card-number">--</span>`;
}

const CHEVRON =
  '<span class="chev" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5" /></svg></span>';

function renderCard(p) {
  const name = esc(p.name || p.id);
  const mono = MONOGRAM[p.id] || name.slice(0, 1).toUpperCase();
  // Only the Go plan has a published per-model breakdown to drill into.
  const drill = p.id === 'opencodeZen' && p.state === 'ok';
  const open = drill
    ? `<div class="card clickable" data-drill role="button" tabindex="0" title="See every Go model: pricing and requests per month">`
    : '<div class="card">';
  const head = `
    <div class="card-head">
      <span class="mono" aria-hidden="true">${esc(mono)}</span>
      <span class="card-name">${name}</span>
      ${p.plan ? `<span class="badge">${esc(p.plan)}</span>` : ''}
      ${drill ? CHEVRON : ''}
    </div>`;

  if (p.state === 'loading') {
    return `${open}${head}
      <div style="margin-top:10px; display:flex; flex-direction:column; gap:7px">
        <div class="skeleton" style="width:45%; height:14px"></div>
        <div class="skeleton"></div><div class="skeleton" style="width:70%"></div>
      </div></div>`;
  }

  if (p.state !== 'ok') {
    const needsKey = p.state === 'setup' || p.state === 'auth';
    return `${open}${head}
      <div class="card-msg">${esc(p.message || 'Unavailable')}</div>
      ${p.hint ? `<div class="card-hint">${esc(p.hint)}</div>` : ''}
      ${needsKey ? `<div style="margin-top:8px"><button class="btn ghost" data-open-settings>Open settings</button></div>` : ''}
    </div>`;
  }

  const meters = (p.meters || []).map(meterRow).join('');
  const stats = (p.stats || [])
    .map((st) => `<div class="stat-row"><span class="k">${esc(st.label)}</span><span class="v">${esc(st.value)}</span></div>`)
    .join('');
  const notes = (p.notes || []).length ? `<div class="card-note">${esc(p.notes.join(' · '))}</div>` : '';
  const stale = p.stale ? `<div class="card-note">From local session log · ${esc(formatAgo(p.stale))}</div>` : '';
  return `${open}${head}
    <div class="card-value">${cardValue(p)}</div>
    ${meters}${stats}${notes}${stale}
  </div>`;
}


// ---- Go plan drill-down ---------------------------------------------------

const fmtPrice = (v) => {
  if (v == null) return '--';
  const n = Number(v.toPrecision(3));
  const str = String(n);
  const decimals = (str.split('.')[1] || '').length;
  // Show at least cents so the column reads as money, but keep sub-cent rates exact.
  return decimals < 2 ? n.toFixed(2) : str;
};

async function openGoPlan() {
  view = 'goPlan';
  render(lastSnapshot);
  if (!goPlan && !goPlanError) {
    try {
      goPlan = await window.gauge.getGoPlan();
    } catch {
      goPlan = null;
    }
    if (!goPlan) goPlanError = true;
    render(lastSnapshot);
  }
}

function goRow(m) {
  const req = m.requests || {};
  const tiered = (m.tiers || []).length > 1;
  const tip = [
    m.name + (m.id ? ` (${m.id})` : ''),
    `Input $${fmtPrice(m.input)} / Output $${fmtPrice(m.output)} per 1M tokens`,
    m.cacheRead != null ? `Cached read $${fmtPrice(m.cacheRead)}` : null,
    m.cacheWrite != null ? `Cached write $${fmtPrice(m.cacheWrite)}` : null,
    `Monthly pool $${m.pool} (5h $${(m.pool * 0.2).toFixed(2)}, weekly $${(m.pool * 0.5).toFixed(2)})`,
    req.monthly
      ? `About ${req.monthly.toLocaleString()} requests/month, ${req.weekly.toLocaleString()}/week, ${req.fiveHour.toLocaleString()} per 5h`
      : 'Request estimate not published for this model',
    tiered ? 'Tiered: ' + m.tiers.map((t) => `${t.label} $${fmtPrice(t.input)}/$${fmtPrice(t.output)}`).join('; ') : null,
  ]
    .filter(Boolean)
    .join('\n');

  if (goTab === 'pricing') {
    return `<div class="drow pricing" title="${esc(tip)}">
      <span class="m">${esc(m.name)}${tiered ? ' *' : ''}</span>
      <span class="num">$${fmtPrice(m.input)} / $${fmtPrice(m.output)}</span>
      <span class="pool">$${esc(m.pool)}</span>
    </div>`;
  }
  return `<div class="drow requests" title="${esc(tip)}">
    <span class="m">${esc(m.name)}</span>
    <span class="num">${req.monthly ? req.monthly.toLocaleString() : 'not published'}</span>
  </div>`;
}

function renderDetail() {
  const d = el('detail');
  const lim = (goPlan && goPlan.limits) || {};
  const sub = goPlan
    ? `$${goPlan.planPrice}/mo · pools $${lim.fiveHour} per 5h · $${lim.weekly} week · $${lim.monthly} month`
    : 'OpenCode Go plan';

  const checked = goPlan && goPlan.fetchedAt ? ` · checked ${formatAgo(goPlan.fetchedAt)}` : '';
  const head = `
    <div class="detail-head">
      <button class="icon-btn" data-back title="Back" aria-label="Back">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8 10 12.5" /></svg>
      </button>
      <div style="min-width:0; flex:1">
        <div class="detail-title">OpenCode Go models</div>
        <div class="detail-sub">${esc(sub)}${esc(checked)}</div>
      </div>
      <button class="icon-btn ${goPlanBusy ? 'spin' : ''}" data-goplan-refresh title="Check for model changes" aria-label="Check for model changes">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8a6 6 0 1 1-1.8-4.3" /><path d="M14 2v3.6h-3.6" /></svg>
      </button>
    </div>
    <div class="detail-tabs">
      <div class="seg" data-gotab>
        <button data-value="pricing" aria-pressed="${goTab === 'pricing'}">Pricing</button>
        <button data-value="requests" aria-pressed="${goTab === 'requests'}">Requests</button>
      </div>
    </div>`;

  if (!goPlan) {
    d.innerHTML =
      head +
      `<div class="empty">${goPlanError ? 'Could not load the Go model list.' : 'Loading model list...'}</div>`;
    return;
  }

  // Same order in both views, so toggling re-expresses the list rather than reshuffling it.
  const models = [...goPlan.models].sort((a, b) => (b.requests?.monthly || 0) - (a.requests?.monthly || 0));

  const chg = goPlan.lastChange;
  const banner = chg
    ? `<div class="detail-change">Changed ${esc(formatAgo(chg.at))}: ${esc(
        [
          chg.added.length ? `added ${chg.added.join(', ')}` : null,
          chg.removed.length ? `removed ${chg.removed.join(', ')}` : null,
          chg.repriced.length ? `repriced ${chg.repriced.map((r) => r.name).join(', ')}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      )}</div>`
    : '';

  const cols =
    goTab === 'pricing'
      ? `<div class="detail-cols cols-pricing"><span>Model</span><span style="text-align:right">In / Out per 1M</span><span style="text-align:right">Pool</span></div>`
      : `<div class="detail-cols cols-requests"><span>Model</span><span style="text-align:right">Requests / mo</span></div>`;

  const foot =
    goTab === 'pricing'
      ? 'USD per 1M tokens. Pool is that model&rsquo;s monthly allowance; the 5-hour and weekly pools are 20% and 50% of it. * tiered by context size.'
      : 'OpenCode&rsquo;s estimate for typical usage &mdash; your real count depends on prompt size and caching.';

  d.innerHTML = `${head}${banner}${cols}
    <div class="detail-list">${models.map(goRow).join('')}</div>
    <div class="detail-foot">${foot} <a class="link" data-ext="https://opencode.ai/docs/go/">Source</a></div>`;
}

function render(snap) {
  lastSnapshot = snap;
  const providers = snap.providers || [];
  const detailMode = view === 'goPlan';

  el('detail').hidden = !detailMode;
  el('list').hidden = detailMode;

  if (detailMode) {
    el('hero').hidden = true;
    renderDetail();
  } else {
    renderHero(providers);
    const list = el('list');
    list.innerHTML = providers.length
      ? providers.map(renderCard).join('')
      : `<div class="empty">No trackers enabled.<br /><button class="btn ghost" style="margin-top:10px" data-open-settings>Choose what to track</button></div>`;
  }

  const ok = providers.filter((p) => p.state === 'ok').length;
  el('head-count').textContent = providers.length ? `· ${ok}/${providers.length}` : '';

  el('btn-refresh').classList.toggle('spin', Boolean(snap.refreshing));
  el('updated').textContent = snap.refreshing
    ? 'Refreshing...'
    : snap.lastRefresh
      ? `Updated ${new Date(snap.lastRefresh).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Not refreshed yet';

  reportHeight();
}

function reportHeight() {
  const app = el('app');
  if (app) window.gauge.setPanelHeight(app.offsetHeight + 16);
}

// ---- wiring ---------------------------------------------------------------

el('btn-refresh').addEventListener('click', () => window.gauge.refresh());
el('btn-settings').addEventListener('click', () => window.gauge.openSettings());
el('btn-quit').addEventListener('click', () => window.gauge.quit());

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-goplan-refresh]')) {
    goPlanBusy = true;
    render(lastSnapshot);
    goPlan = await window.gauge.getGoPlan(true);
    goPlanBusy = false;
    render(lastSnapshot);
    return;
  }
  if (e.target.closest('[data-open-settings]')) {
    window.gauge.openSettings();
    return;
  }
  if (e.target.closest('[data-back]')) {
    view = 'main';
    render(lastSnapshot);
    return;
  }
  const tab = e.target.closest('[data-gotab] button');
  if (tab) {
    goTab = tab.dataset.value;
    render(lastSnapshot);
    return;
  }
  const ext = e.target.closest('[data-ext]');
  if (ext) {
    window.gauge.openExternal(ext.dataset.ext);
    return;
  }
  if (e.target.closest('[data-drill]')) openGoPlan();
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-drill]')) {
    e.preventDefault();
    openGoPlan();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (view === 'goPlan') {
      view = 'main';
      render(lastSnapshot);
    } else {
      window.gauge.hidePanel();
    }
  }
  if (e.key === 'r' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    window.gauge.refresh();
  }
});

window.gauge.onGoPlan((payload) => {
  if (!payload || !payload.plan) return;
  goPlan = { ...payload.plan, lastChange: payload.lastChange };
  goPlanError = false;
  if (view === 'goPlan') render(lastSnapshot);
});

window.gauge.onSnapshot(render);
window.gauge.getSnapshot().then(render);

// Countdowns drift out of date while the panel sits open.
setInterval(() => {
  if (lastSnapshot && !document.hidden) render(lastSnapshot);
}, 30000);

new ResizeObserver(reportHeight).observe(el('app'));
