'use strict';
const { getJSON } = require('../util/http');
const { opencodeZenKey } = require('../util/local');

const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';

const WINDOWS = [
  ['rolling', 'Rolling', 'Short rolling window'],
  ['weekly', 'Weekly', 'Resets weekly'],
  ['monthly', 'Monthly', 'Resets on your billing date'],
];

async function fetchOpencodeZen(settings) {
  const manual = settings?.apiKey?.trim();
  const local = manual ? null : opencodeZenKey();
  const key = manual || local?.key;

  if (!key) {
    return {
      state: 'setup',
      message: 'No API key',
      hint: 'Run `opencode auth login` and pick OpenCode Zen, or paste a key in Settings.',
    };
  }

  const res = await getJSON(USAGE_URL, { headers: { Authorization: `Bearer ${key}` } });

  if (res.status === 401 || res.status === 403) {
    return { state: 'auth', message: 'Key rejected', hint: 'That OpenCode Zen key is invalid or expired.' };
  }
  if (!res.ok || !res.json?.usage) {
    return {
      state: 'error',
      message: res.networkError || `OpenCode Zen returned ${res.status}`,
      source: manual ? 'Settings' : local?.source,
    };
  }

  const usage = res.json.usage;
  const meters = [];
  for (const [key_, label, note] of WINDOWS) {
    const w = usage[key_];
    if (!w || typeof w.percent !== 'number') continue;
    meters.push({
      key: key_,
      label,
      note,
      used: Math.max(0, Math.min(100, w.percent)),
      resetsAt: w.resetsAt || null,
      locked: w.status && w.status !== 'ok' ? w.status : null,
    });
  }

  if (!meters.length) return { state: 'error', message: 'No usage windows reported' };

  return {
    state: 'ok',
    plan: 'Zen Go',
    account: null,
    source: manual ? 'Settings' : local?.source,
    meters,
    primary: bindingMeter(meters),
  };
}

function bindingMeter(meters) {
  const worst = meters.reduce((a, b) => (b.used > a.used ? b : a));
  return { kind: 'percent', used: worst.used, remaining: 100 - worst.used, label: worst.label, resetsAt: worst.resetsAt };
}

module.exports = { fetchOpencodeZen };
