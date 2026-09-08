'use strict';
// OpenCode Zen's free models have no server-side usage endpoint and return no
// rate-limit headers, so there is nothing remote to read. OpenCode does record
// every assistant message locally, though, so we can tally what you've spent
// even though there is no published allowance to measure it against.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WINDOW_DAYS = 7;
const DAY_MS = 86400 * 1000;

// Free Zen models are suffixed `-free`; these two are the exceptions.
const FREE_EXCEPTIONS = new Set(['grok-code', 'big-pickle']);

function isFreeZenModel(providerID, modelID) {
  if (!providerID || !modelID) return false;
  if (!String(providerID).startsWith('opencode')) return false;
  return modelID.endsWith('-free') || FREE_EXCEPTIONS.has(modelID);
}

function findDatabase() {
  const bases = [
    process.env.XDG_DATA_HOME && path.join(process.env.XDG_DATA_HOME, 'opencode'),
    path.join(os.homedir(), '.local', 'share', 'opencode'),
  ].filter(Boolean);
  for (const base of bases) {
    for (const name of ['opencode-v1.db', 'opencode.db']) {
      const file = path.join(base, name);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

async function fetchOpencodeFree() {
  const dbPath = findDatabase();
  if (!dbPath) {
    return {
      state: 'setup',
      message: 'OpenCode database not found',
      hint: 'Install and run OpenCode once - usage is read from its local history.',
    };
  }

  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    return { state: 'error', message: 'SQLite is unavailable in this runtime' };
  }

  const since = Date.now() - WINDOW_DAYS * DAY_MS;
  let rows;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      rows = db.prepare('SELECT data, time_created FROM message WHERE time_created > ?').all(since);
    } finally {
      db.close();
    }
  } catch (err) {
    return {
      state: 'error',
      message: 'Could not read the OpenCode database',
      hint: err?.code === 'SQLITE_BUSY' ? 'OpenCode is mid-write; it will retry.' : err?.code || err?.message,
      source: shortPath(dbPath),
    };
  }

  const dayAgo = Date.now() - DAY_MS;
  const perModel = new Map();
  let requests = 0;
  let requests24h = 0;
  let tokens = 0;
  let lastUsed = 0;

  for (const row of rows) {
    let d;
    try {
      d = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (d.role !== 'assistant') continue;
    if (!isFreeZenModel(d.providerID, d.modelID)) continue;

    const t = d.tokens || {};
    const used =
      (t.input || 0) + (t.output || 0) + (t.reasoning || 0) + (t.cache?.read || 0) + (t.cache?.write || 0);

    requests++;
    tokens += used;
    if (row.time_created > dayAgo) requests24h++;
    if (row.time_created > lastUsed) lastUsed = row.time_created;

    const entry = perModel.get(d.modelID) || { n: 0, tokens: 0 };
    entry.n++;
    entry.tokens += used;
    perModel.set(d.modelID, entry);
  }

  const top = [...perModel.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 3);

  const notes = [];
  if (requests) {
    notes.push(`${compact(tokens)} tokens`);
    notes.push(`${requests24h} in last 24h`);
  }

  return {
    state: 'ok',
    plan: 'Local tally',
    source: shortPath(dbPath),
    // No published free-model allowance exists, so this is a count, not a meter.
    primary: { kind: 'tally', amount: requests, unit: requests === 1 ? 'request' : 'requests', label: `Last ${WINDOW_DAYS} days` },
    meters: [],
    notes,
    stats: requests
      ? top.map(([id, v]) => ({ label: id, value: `${v.n.toLocaleString()} · ${compact(v.tokens)}` }))
      : [{ label: 'No free-model requests in this window', value: '' }],
    lastUsed: lastUsed || null,
  };
}

function compact(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function shortPath(p) {
  const home = os.homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length).replace(/\\/g, '/') : p;
}

module.exports = { fetchOpencodeFree, isFreeZenModel };
