'use strict';
const { getJSON } = require('../util/http');
const { claudeCredentials } = require('../util/local');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';

const HEADERS = (token) => ({
  Authorization: `Bearer ${token}`,
  'anthropic-beta': 'oauth-2025-04-20',
  'User-Agent': 'claude-cli/2.0.0 (external, cli)',
  'Content-Type': 'application/json',
});

// The API returns a wide set of limit buckets; these are the ones worth showing.
const WINDOWS = [
  ['five_hour', 'Session', '5-hour window'],
  ['seven_day', 'Weekly', '7-day window'],
  ['seven_day_opus', 'Weekly · Opus', 'Opus 7-day window'],
  ['seven_day_sonnet', 'Weekly · Sonnet', 'Sonnet 7-day window'],
];

const PLAN_LABEL = { pro: 'Pro', max: 'Max', max_5x: 'Max 5x', max_20x: 'Max 20x', team: 'Team', enterprise: 'Enterprise' };

let profileCache = { at: 0, value: null };

async function fetchClaude(settings) {
  const manual = settings?.token?.trim();
  const local = claudeCredentials();
  const token = manual || local?.accessToken;

  if (!token) {
    return {
      state: 'setup',
      message: 'Not signed in',
      hint: 'Run `claude` once to sign in, or paste an OAuth token in Settings.',
    };
  }

  const res = await getJSON(USAGE_URL, { headers: HEADERS(token) });

  if (res.status === 401 || res.status === 403) {
    return {
      state: 'auth',
      message: 'Login expired',
      hint: manual
        ? 'That token is no longer valid — paste a fresh one in Settings.'
        : 'Run `claude` in a terminal to refresh your login.',
      source: manual ? 'Settings' : local?.source,
    };
  }
  if (!res.ok || !res.json) {
    return {
      state: 'error',
      message: res.networkError || `Anthropic API returned ${res.status}`,
      source: manual ? 'Settings' : local?.source,
    };
  }

  const meters = [];
  for (const [key, label, note] of WINDOWS) {
    const w = res.json[key];
    if (!w || typeof w.utilization !== 'number') continue;
    meters.push({
      key,
      label,
      note,
      used: clampPct(w.utilization),
      resetsAt: w.resetsAt || w.resets_at || null,
      locked: w.locked_reason || null,
      usedDollars: w.used_dollars ?? null,
      limitDollars: w.limit_dollars ?? null,
    });
  }

  if (!meters.length) {
    return { state: 'error', message: 'No usage windows reported for this account' };
  }

  const profile = await fetchProfile(token);

  return {
    state: 'ok',
    plan: planLabel(profile, local),
    account: profile?.account?.email || null,
    source: manual ? 'Settings' : local?.source,
    meters,
    primary: bindingMeter(meters),
  };
}

async function fetchProfile(token) {
  // Plan/e-mail barely change; refresh at most hourly.
  if (profileCache.value && Date.now() - profileCache.at < 60 * 60 * 1000) return profileCache.value;
  const res = await getJSON(PROFILE_URL, { headers: HEADERS(token) });
  if (res.ok && res.json) profileCache = { at: Date.now(), value: res.json };
  return profileCache.value;
}

function planLabel(profile, local) {
  const org = profile?.organization;
  if (org?.organization_type) {
    const t = org.organization_type.replace(/^claude_/, '');
    const label = PLAN_LABEL[t] || t.replace(/_/g, ' ');
    return org.subscription_status === 'trialing' ? `${label} · trial` : label;
  }
  const sub = local?.subscriptionType;
  return sub ? PLAN_LABEL[sub] || sub : null;
}

function clampPct(n) {
  return Math.max(0, Math.min(100, n));
}

/** Whichever window will stop you first is the one to headline. */
function bindingMeter(meters) {
  const worst = meters.reduce((a, b) => (b.used > a.used ? b : a));
  return { kind: 'percent', used: worst.used, remaining: 100 - worst.used, label: worst.label, resetsAt: worst.resetsAt };
}

module.exports = { fetchClaude };
