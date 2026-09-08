'use strict';

const MONOGRAM = { claude: 'C', opencodeZen: 'G', codex: 'X', openrouter: 'R' };

const ICON = {
  check: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.3 4.6 8.9 10 3.4" /></svg>',
  dot: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="6" cy="6" r="3.2" /></svg>',
  warn: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="6" cy="6" r="5" /><path d="M6 3.4v3.2" /><path d="M6 8.6v.1" /></svg>',
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = null;

async function load() {
  state = await window.gauge.getSettings();
  renderProviders();
  renderGeneral();
  document.getElementById('version').textContent = `Gauge ${state.version}`;
  document.getElementById('crypto-note').innerHTML = state.encrypted
    ? `${ICON.check} Keys are encrypted with your OS credential store`
    : `${ICON.warn} OS encryption unavailable - keys are stored in plain text`;
}

function renderProviders() {
  const host = document.getElementById('providers');
  host.innerHTML = state.catalog
    .map((c) => {
      const cfg = state.providers[c.id] || {};
      const on = Boolean(cfg.enabled);
      const cred = c.credential;
      return `
      <div class="prov" data-id="${esc(c.id)}">
        <div class="prov-head">
          <span class="mono">${esc(MONOGRAM[c.id] || c.name.slice(0, 1))}</span>
          <div class="prov-title">
            <div class="n">${esc(c.name)}</div>
            <div class="s">${esc(c.subtitle)}</div>
          </div>
          <button class="switch" role="switch" aria-checked="${on}" aria-label="Track ${esc(c.name)}" data-toggle></button>
        </div>
        <div class="prov-body ${on ? '' : 'disabled-body'}">
          <div class="detected ${c.detected ? '' : 'none'}">
            ${c.detected ? ICON.check : ICON.dot}
            <span>${esc(c.detected || 'Nothing detected automatically - add a key below')}</span>
          </div>
          ${cred ? `
          <div class="field">
            <label for="in-${esc(c.id)}">${esc(cred.label || 'API key')}</label>
            <div class="row">
              <input id="in-${esc(c.id)}" type="password" autocomplete="off" spellcheck="false"
                     placeholder="${cfg.hasSecret ? 'Stored - type to replace' : esc(cred.placeholder || '')}" data-input />
              <button class="btn ghost" data-reveal title="Show or hide">Show</button>
              <button class="btn" data-save>Save</button>
            </div>
            <div class="help">
              ${esc(cred.help || '')}
              ${cred.link ? ` <a class="link" data-link="${esc(cred.link)}">Get a key</a>` : ''}
            </div>
          </div>` : ''}
          <div class="row" style="display:flex; gap:6px; align-items:center">
            <button class="btn ghost" data-test>Test connection</button>
            ${cfg.hasSecret ? '<button class="btn ghost" data-clear>Remove stored key</button>' : ''}
            <span class="grow" style="flex:1"></span>
          </div>
          <div data-result></div>
        </div>
      </div>`;
    })
    .join('');
}

function renderGeneral() {
  const g = state.general;
  const host = document.getElementById('general');
  host.innerHTML = `
    <div class="row-setting">
      <div class="t"><div class="n">Refresh every</div><div class="d">How often usage is fetched.</div></div>
      <select data-general="refreshMinutes">
        ${[1, 2, 5, 10, 15, 30, 60].map((m) => `<option value="${m}" ${g.refreshMinutes === m ? 'selected' : ''}>${m} minute${m === 1 ? '' : 's'}</option>`).join('')}
      </select>
    </div>
    <div class="row-setting">
      <div class="t"><div class="n">Appearance</div><div class="d">Follows Windows by default.</div></div>
      <div class="seg" data-seg="theme">
        ${['system', 'light', 'dark'].map((t) => `<button data-value="${t}" aria-pressed="${g.theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
      </div>
    </div>
    <div class="row-setting">
      <div class="t"><div class="n">Tray icon</div><div class="d">Show the used percentage inside the ring.</div></div>
      <div class="seg" data-seg="trayStyle">
        <button data-value="ring" aria-pressed="${g.trayStyle === 'ring'}">Ring</button>
        <button data-value="ringPercent" aria-pressed="${g.trayStyle === 'ringPercent'}">Ring + %</button>
      </div>
    </div>
    <div class="row-setting">
      <div class="t"><div class="n">Start with Windows</div><div class="d">Launch Gauge to the tray at sign-in.</div></div>
      <button class="switch" role="switch" aria-checked="${Boolean(g.launchAtLogin)}" aria-label="Start with Windows" data-general-toggle="launchAtLogin"></button>
    </div>
    <div class="row-setting">
      <div class="t"><div class="n">Notify when running low</div><div class="d">One notification per window, per reset.</div></div>
      <button class="switch" role="switch" aria-checked="${Boolean(g.alerts)}" aria-label="Notify when running low" data-general-toggle="alerts"></button>
    </div>
    <div class="row-setting">
      <div class="t"><div class="n">Alert threshold</div><div class="d">Notify once usage passes this level.</div></div>
      <select data-general="alertThreshold">
        ${[70, 75, 80, 85, 90, 95].map((v) => `<option value="${v}" ${g.alertThreshold === v ? 'selected' : ''}>${v}% used</option>`).join('')}
      </select>
    </div>`;
}

// ---- events ---------------------------------------------------------------

document.addEventListener('click', async (e) => {
  const prov = e.target.closest('.prov');
  const id = prov?.dataset.id;

  if (e.target.closest('[data-toggle]')) {
    const btn = e.target.closest('[data-toggle]');
    const next = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', String(next));
    prov.querySelector('.prov-body').classList.toggle('disabled-body', !next);
    await window.gauge.setProvider(id, { enabled: next });
    await refreshState();
    return;
  }

  if (e.target.closest('[data-reveal]')) {
    const input = prov.querySelector('[data-input]');
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    e.target.closest('[data-reveal]').textContent = showing ? 'Show' : 'Hide';
    return;
  }

  if (e.target.closest('[data-save]')) {
    const input = prov.querySelector('[data-input]');
    const value = input.value.trim();
    if (!value) {
      showResult(prov, false, 'Nothing to save - the field is empty.');
      return;
    }
    setBusy(prov, true);
    await window.gauge.setProvider(id, { secret: value });
    const res = await window.gauge.testProvider(id);
    await refreshState();
    // Re-render so the field clears and the "Remove stored key" button appears.
    renderProviders();
    const fresh = document.querySelector(`.prov[data-id="${CSS.escape(id)}"]`) || prov;
    showResult(fresh, res.state === 'ok', describe(res));
    return;
  }

  if (e.target.closest('[data-clear]')) {
    await window.gauge.setProvider(id, { secret: '' });
    await refreshState();
    renderProviders();
    return;
  }

  if (e.target.closest('[data-test]')) {
    const input = prov.querySelector('[data-input]');
    setBusy(prov, true);
    const res = await window.gauge.testProvider(id, input?.value.trim() || undefined);
    setBusy(prov, false);
    showResult(prov, res.state === 'ok', describe(res));
    return;
  }

  const link = e.target.closest('[data-link]');
  if (link) {
    window.gauge.openExternal(link.dataset.link);
    return;
  }

  const seg = e.target.closest('.seg button');
  if (seg) {
    const key = seg.closest('.seg').dataset.seg;
    const value = seg.dataset.value;
    seg.closest('.seg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === seg)));
    await window.gauge.setGeneral({ [key]: value });
    return;
  }

  const toggle = e.target.closest('[data-general-toggle]');
  if (toggle) {
    const key = toggle.dataset.generalToggle;
    const next = toggle.getAttribute('aria-checked') !== 'true';
    toggle.setAttribute('aria-checked', String(next));
    await window.gauge.setGeneral({ [key]: next });
    return;
  }

  if (e.target.closest('#win-close')) window.gauge.closeWindow();
  if (e.target.closest('#win-min')) window.gauge.minimizeWindow();
});

document.addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-general]');
  if (!sel) return;
  await window.gauge.setGeneral({ [sel.dataset.general]: Number(sel.value) });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-input]')) {
    e.target.closest('.prov').querySelector('[data-save]').click();
  }
  if (e.key === 'Escape') window.gauge.closeWindow();
});

async function refreshState() {
  const fresh = await window.gauge.getSettings();
  state = fresh;
}

function setBusy(prov, busy) {
  prov.querySelectorAll('button').forEach((b) => (b.disabled = busy));
  if (busy) showResult(prov, null, 'Checking...');
}

function describe(res) {
  if (res.state === 'ok') return res.summary || `Connected${res.plan ? ` · ${res.plan}` : ''}`;
  return res.message || 'Could not connect';
}

function showResult(prov, ok, text) {
  const host = prov.querySelector('[data-result]');
  const cls = ok === null ? '' : ok ? 'ok' : 'bad';
  const icon = ok === null ? ICON.dot : ok ? ICON.check : ICON.warn;
  host.innerHTML = `<div class="result ${cls}">${icon}<span>${esc(text)}</span></div>`;
}

window.gauge.onTheme(() => {
  /* tokens follow prefers-color-scheme automatically */
});

load();
