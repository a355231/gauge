'use strict';
const path = require('node:path');
const { getJSON } = require('../util/http');
const { codexAuth, codexRollouts, readTail } = require('../util/local');

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

const PLAN_LABEL = { free: 'Free', plus: 'Plus', pro: 'Pro', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu' };

async function fetchCodex(settings) {
  const manual = settings?.token?.trim();
  const local = manual ? null : codexAuth();
  const token = manual || local?.accessToken;

  if (token) {
    const viaApi = await fromApi(token, local?.accountId, manual ? 'Settings' : local?.source);
    if (viaApi) return viaApi;
  }

  // No usable token (or the API refused) — fall back to what the CLI logged locally.
  const viaLog = await fromRollouts();
  if (viaLog) return viaLog;

  return {
    state: 'setup',
    message: token ? 'Login expired' : 'Not signed in',
    hint: token
      ? 'Run `codex` in a terminal to refresh your ChatGPT login.'
      : 'Sign in with `codex` (ChatGPT auth) so limits can be read.',
  };
}

async function fromApi(token, accountId, source) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'codex_cli_rs/0.153.4',
    Accept: 'application/json',
  };
  if (accountId) headers['chatgpt-account-id'] = accountId;

  const res = await getJSON(USAGE_URL, { headers });
  if (res.status === 401 || res.status === 403) return null; // let the caller fall back
  if (!res.ok || !res.json) {
    return { state: 'error', message: res.networkError || `Codex usage API returned ${res.status}`, source };
  }

  const rl = res.json.rate_limit || {};
  const meters = [];
  pushWindow(meters, 'primary', rl.primary_window);
  pushWindow(meters, 'secondary', rl.secondary_window);
  for (const [i, extra] of (res.json.additional_rate_limits || []).entries()) {
    pushWindow(meters, `extra_${i}`, extra?.window || extra, extra?.name);
  }

  const credits = res.json.credits || {};
  const primary = meters.length
    ? bindingMeter(meters)
    : creditsPrimary(credits);

  if (!primary) {
    return { state: 'error', message: 'Codex reported no limits for this account', source };
  }

  return {
    state: 'ok',
    plan: PLAN_LABEL[res.json.plan_type] || res.json.plan_type || null,
    account: res.json.email || null,
    source,
    meters,
    primary,
    notes: buildNotes(res.json, credits),
  };
}

function buildNotes(body, credits) {
  const notes = [];
  if (body.rate_limit?.limit_reached) notes.push('Rate limit reached');
  if (credits.unlimited) notes.push('Unlimited credits');
  else if (typeof credits.balance === 'number') notes.push(`${credits.balance} credits left`);
  if (body.spend_control?.reached) notes.push('Spend cap reached');
  return notes;
}

function creditsPrimary(credits) {
  if (typeof credits.balance !== 'number') return null;
  return { kind: 'count', amount: credits.balance, label: 'Credits', resetsAt: null };
}

function pushWindow(meters, key, w, nameOverride) {
  if (!w) return;
  const used = firstNumber(w.used_percent, w.usedPercent);
  if (used === null) return;
  const seconds = firstNumber(w.limit_window_seconds, w.window_minutes ? w.window_minutes * 60 : null);
  const resetsAt = resolveReset(w);
  meters.push({
    key,
    label: nameOverride || windowLabel(seconds),
    note: seconds ? `${humanWindow(seconds)} window` : null,
    used: Math.max(0, Math.min(100, used)),
    resetsAt,
  });
}

function resolveReset(w) {
  if (typeof w.reset_at === 'number') return new Date(w.reset_at * 1000).toISOString();
  if (typeof w.resets_at === 'number') return new Date(w.resets_at * 1000).toISOString();
  if (typeof w.resets_at === 'string') return w.resets_at;
  const after = firstNumber(w.reset_after_seconds, w.resets_in_seconds);
  if (after !== null) return new Date(Date.now() + after * 1000).toISOString();
  return null;
}

function firstNumber(...vals) {
  for (const v of vals) if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function windowLabel(seconds) {
  if (!seconds) return 'Usage';
  const h = seconds / 3600;
  if (h <= 1.5) return 'Hourly';
  if (h <= 12) return 'Session';
  if (h <= 36) return 'Daily';
  if (h <= 24 * 10) return 'Weekly';
  return 'Monthly';
}

function humanWindow(seconds) {
  const h = seconds / 3600;
  if (h < 24) return `${round(h)}-hour`;
  return `${round(h / 24)}-day`;
}
const round = (n) => (Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : n.toFixed(1));

/**
 * Codex writes a `token_count` event containing `rate_limits` into every
 * rollout transcript. When the API is unreachable, the newest non-null
 * snapshot is still a usable (if slightly stale) reading.
 */
async function fromRollouts() {
  let files;
  try {
    files = await codexRollouts(10);
  } catch {
    return null;
  }
  for (const { file, mtime } of files) {
    let text;
    try {
      text = await readTail(file, 512 * 1024);
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('"rate_limits"')) continue;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        continue; // first line of a tail read is usually truncated
      }
      const rl = evt?.payload?.rate_limits;
      if (!rl) continue;
      const meters = [];
      pushWindow(meters, 'primary', rl.primary);
      pushWindow(meters, 'secondary', rl.secondary);
      if (!meters.length) continue;
      return {
        state: 'ok',
        plan: PLAN_LABEL[rl.plan_type] || rl.plan_type || null,
        account: null,
        source: `local session log · ${path.basename(file).slice(0, 24)}…`,
        stale: evt.timestamp || new Date(mtime).toISOString(),
        meters,
        primary: bindingMeter(meters),
      };
    }
  }
  return null;
}

function bindingMeter(meters) {
  const worst = meters.reduce((a, b) => (b.used > a.used ? b : a));
  return { kind: 'percent', used: worst.used, remaining: 100 - worst.used, label: worst.label, resetsAt: worst.resetsAt };
}

module.exports = { fetchCodex };
