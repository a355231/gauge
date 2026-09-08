'use strict';
// OpenCode publishes the Go plan's per-model pricing, dollar pool and estimated
// request counts on its docs page. We parse that, cache it, and ship a snapshot
// so the panel still works offline or if the page changes shape.
const fs = require('node:fs');
const path = require('node:path');

const DOCS_URL = 'https://opencode.ai/docs/go/';
const BUNDLED = path.join(__dirname, 'data', 'go-plan.json');
const TTL_MS = 6 * 60 * 60 * 1000;

// Every model's 5-hour and weekly pools are these fractions of its monthly pool
// (verified against the published request counts across all models).
const WINDOW_FRACTION = { fiveHour: 12 / 60, weekly: 30 / 60, monthly: 1 };

let memo = null;

// ---- parsing --------------------------------------------------------------

function stripTags(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tableRows(tableHtml) {
  return (tableHtml.match(/<tr[\s\S]*?<\/tr>/g) || [])
    .map((tr) => (tr.match(/<(td|th)[\s\S]*?<\/\1>/g) || []).map(stripTags))
    .filter((cells) => cells.length);
}

/** "Grok 4.6 (> 200K tokens)" -> { base: "Grok 4.6", variant: "> 200K tokens" } */
function splitName(raw) {
  const m = raw.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  return m ? { base: m[1].trim(), variant: m[2].trim() } : { base: raw.trim(), variant: null };
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const money = (s) => {
  const m = String(s).match(/-?\d+(\.\d+)?/);
  return s && s !== '-' && m ? Number(m[0]) : null;
};
const count = (s) => {
  const n = Number(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function parseGoDocs(html) {
  const tables = (html.match(/<table[\s\S]*?<\/table>/g) || []).map(tableRows);
  const byHeader = (...needles) =>
    tables.find((t) => {
      const head = (t[0] || []).join(' ').toLowerCase();
      return needles.every((n) => head.includes(n));
    });

  const priceT = byHeader('input', 'output', 'usage');
  const reqT = byHeader('requests per');
  const idT = byHeader('model id');
  if (!priceT || !reqT) throw new Error('Go docs tables not found');

  const ids = new Map();
  for (const row of (idT || []).slice(1)) {
    if (row.length >= 2) ids.set(norm(splitName(row[0]).base), row[1]);
  }

  const requests = new Map();
  for (const row of reqT.slice(1)) {
    if (row.length < 4) continue;
    requests.set(norm(splitName(row[0]).base), {
      fiveHour: count(row[1]),
      weekly: count(row[2]),
      monthly: count(row[3]),
    });
  }

  const models = new Map();
  for (const row of priceT.slice(1)) {
    if (row.length < 6) continue;
    const { base, variant } = splitName(row[0]);
    const key = norm(base);
    const tier = {
      label: variant,
      input: money(row[1]),
      output: money(row[2]),
      cacheRead: money(row[3]),
      cacheWrite: money(row[4]),
    };
    const pool = money(row[5]);

    if (!models.has(key)) {
      const req = requests.get(key) || {};
      models.set(key, {
        id: ids.get(key) || null,
        name: base,
        input: tier.input,
        output: tier.output,
        cacheRead: tier.cacheRead,
        cacheWrite: tier.cacheWrite,
        pool,
        requests: { fiveHour: req.fiveHour ?? null, weekly: req.weekly ?? null, monthly: req.monthly ?? null },
        tiers: variant ? [tier] : [],
      });
    } else if (variant) {
      models.get(key).tiers.push(tier);
    }
  }

  const text = stripTags(html.replace(/<\/(td|th|tr|p|li)>/g, ' | '));
  const limitOf = (label) => {
    const m = text.match(new RegExp(label + '[^$]{0,40}\\$(\\d+(?:\\.\\d+)?)', 'i'));
    return m ? Number(m[1]) : null;
  };
  const priceMatch = text.match(/\$(\d+(?:\.\d+)?)\s*\/\s*month/i);

  return {
    planPrice: priceMatch ? Number(priceMatch[1]) : null,
    limits: {
      fiveHour: limitOf('5 hour limit'),
      weekly: limitOf('Weekly limit'),
      monthly: limitOf('Monthly limit'),
    },
    models: [...models.values()].filter((m) => m.pool),
    source: 'opencode.ai/docs/go',
    fetchedAt: Date.now(),
  };
}

// ---- caching --------------------------------------------------------------

function cachePath() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'go-plan.cache.json');
  } catch {
    return null;
  }
}

function readJSONFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readBundled() {
  const b = readJSONFile(BUNDLED);
  return b ? { ...b, stale: true } : null;
}

async function fetchText(url, timeout = 15000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

/**
 * Live Go plan data, preferring a fresh scrape, then the on-disk cache, then
 * the bundled snapshot. Never throws.
 */
async function getGoPlan({ force = false } = {}) {
  const fresh = (p) => p && Date.now() - (p.fetchedAt || 0) < TTL_MS;
  if (!force && fresh(memo)) return memo;

  const file = cachePath();
  const cached = file ? readJSONFile(file) : null;
  if (!force && fresh(cached)) {
    memo = cached;
    return memo;
  }

  try {
    const plan = parseGoDocs(await fetchText(DOCS_URL));
    if (plan.models.length >= 10) {
      memo = plan;
      if (file) {
        try {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, JSON.stringify(plan), 'utf8');
        } catch {
          /* cache is best-effort */
        }
      }
      return memo;
    }
  } catch {
    /* fall through to cached/bundled */
  }

  memo = cached || readBundled();
  return memo;
}


/** Compare two scrapes so model additions, removals and repricings surface. */
function diffGoPlan(prev, next) {
  const empty = { added: [], removed: [], repriced: [], hasChanges: false };
  if (!prev || !next || !prev.models || !next.models) return empty;

  const key = (m) => m.id || m.name;
  const before = new Map(prev.models.map((m) => [key(m), m]));
  const after = new Map(next.models.map((m) => [key(m), m]));

  const added = [...after.keys()].filter((k) => !before.has(k)).map((k) => after.get(k).name);
  const removed = [...before.keys()].filter((k) => !after.has(k)).map((k) => before.get(k).name);

  const repriced = [];
  for (const [k, m] of after) {
    const o = before.get(k);
    if (!o) continue;
    if (o.input !== m.input || o.output !== m.output || o.pool !== m.pool) {
      repriced.push({
        name: m.name,
        from: { input: o.input, output: o.output, pool: o.pool },
        to: { input: m.input, output: m.output, pool: m.pool },
      });
    }
  }

  return { added, removed, repriced, hasChanges: Boolean(added.length || removed.length || repriced.length) };
}

module.exports = { getGoPlan, parseGoDocs, diffGoPlan, WINDOW_FRACTION, DOCS_URL };
