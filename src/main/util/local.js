'use strict';
// Readers for credentials the user's CLI tools already keep on disk, so the
// widget can light up without the user re-entering anything.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
const p = (...parts) => path.join(HOME, ...parts);

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Claude Code's OAuth credentials (`claude` login). */
function claudeCredentials() {
  const data = readJSON(p('.claude', '.credentials.json'));
  const oauth = data?.claudeAiOauth;
  if (!oauth?.accessToken) return null;
  return {
    accessToken: oauth.accessToken,
    expiresAt: oauth.expiresAt || null,
    subscriptionType: oauth.subscriptionType || null,
    rateLimitTier: oauth.rateLimitTier || null,
    source: '~/.claude/.credentials.json',
  };
}

/** OpenCode's auth store — the `opencode-go` entry is the Zen Go key. */
function opencodeZenKey() {
  const auth = readJSON(p('.local', 'share', 'opencode', 'auth.json'));
  const entry = auth?.['opencode-go'] || auth?.['opencode'] || null;
  if (entry?.key) return { key: entry.key, source: '~/.local/share/opencode/auth.json' };

  // Codex can also be pointed at the Zen gateway; borrow that token if so.
  const toml = safeRead(p('.codex', 'config.toml'));
  if (toml && /opencode\.ai\/zen/.test(toml)) {
    const m = toml.match(/experimental_bearer_token\s*=\s*"([^"]+)"/);
    if (m) return { key: m[1], source: '~/.codex/config.toml' };
  }
  return null;
}

/** Codex CLI's ChatGPT tokens, when the user signed in with ChatGPT. */
function codexAuth() {
  const data = readJSON(p('.codex', 'auth.json'));
  const tokens = data?.tokens;
  if (!tokens?.access_token) return null;
  return {
    accessToken: tokens.access_token,
    accountId: tokens.account_id || data.account_id || null,
    source: '~/.codex/auth.json',
  };
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Read only the tail of a file — rollout logs can be tens of megabytes. */
async function readTail(file, bytes = 512 * 1024) {
  const handle = await fsp.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(Math.min(bytes, size));
    await handle.read(buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Newest-first list of Codex rollout transcripts. */
async function codexRollouts(limit = 12) {
  const root = p('.codex', 'sessions');
  const found = [];
  async function walk(dir, depth) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) await walk(full, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try {
          found.push({ file: full, mtime: (await fsp.stat(full)).mtimeMs });
        } catch {
          /* file vanished mid-scan */
        }
      }
    }
  }
  await walk(root, 0);
  found.sort((a, b) => b.mtime - a.mtime);
  return found.slice(0, limit);
}

module.exports = { HOME, claudeCredentials, opencodeZenKey, codexAuth, codexRollouts, readTail, readJSON };
