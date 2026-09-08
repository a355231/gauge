'use strict';
const { getJSON } = require('../util/http');

const CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
const KEY_URL = 'https://openrouter.ai/api/v1/key';

async function fetchOpenRouter(settings) {
  const key = (settings?.apiKey || process.env.OPENROUTER_API_KEY || '').trim();
  if (!key) {
    return {
      state: 'setup',
      message: 'No API key',
      hint: 'Add an OpenRouter key in Settings — create one at openrouter.ai/keys.',
    };
  }

  const headers = { Authorization: `Bearer ${key}` };
  const [credits, keyInfo] = await Promise.all([
    getJSON(CREDITS_URL, { headers }),
    getJSON(KEY_URL, { headers }),
  ]);

  if (credits.status === 401 || keyInfo.status === 401) {
    return { state: 'auth', message: 'Key rejected', hint: 'That OpenRouter key is invalid or was revoked.' };
  }
  if (!credits.ok && !keyInfo.ok) {
    return {
      state: 'error',
      message: credits.networkError || `OpenRouter returned ${credits.status || keyInfo.status}`,
    };
  }

  const c = credits.json?.data || {};
  const k = keyInfo.json?.data || {};
  const granted = num(c.total_credits);
  const spent = num(c.total_usage);
  const balance = granted !== null && spent !== null ? granted - spent : null;

  const meters = [];
  // A per-key spend cap is optional on OpenRouter; only show it when set.
  const keyLimit = num(k.limit);
  const keyUsage = num(k.usage);
  if (keyLimit !== null && keyLimit > 0 && keyUsage !== null) {
    meters.push({
      key: 'key_limit',
      label: 'Key cap',
      note: 'Spend cap on this key',
      used: Math.max(0, Math.min(100, (keyUsage / keyLimit) * 100)),
      detail: `${money(keyUsage)}/${money(keyLimit)}`,
      resetsAt: null,
    });
  }
  if (granted !== null && granted > 0 && spent !== null) {
    meters.push({
      key: 'credits',
      label: 'Credits',
      note: 'Lifetime credits purchased vs spent',
      used: Math.max(0, Math.min(100, (spent / granted) * 100)),
      detail: `${money(spent)}/${money(granted)}`,
      resetsAt: null,
    });
  }

  return {
    state: 'ok',
    plan: k.is_free_tier ? 'Free tier' : 'Pay as you go',
    account: k.label || null,
    source: settings?.apiKey ? 'Settings' : 'OPENROUTER_API_KEY',
    meters,
    primary: {
      kind: 'currency',
      amount: balance ?? keyRemaining(k),
      spent,
      total: granted,
      label: 'Balance',
      resetsAt: null,
    },
  };
}

function keyRemaining(k) {
  const r = num(k.limit_remaining);
  return r === null ? null : r;
}
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function money(v) {
  return `$${v.toFixed(2)}`;
}

module.exports = { fetchOpenRouter };
