'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

const DEFAULTS = {
  version: 1,
  general: {
    refreshMinutes: 5,
    launchAtLogin: true,
    theme: 'system', // system | dark | light
    trayStyle: 'ring', // ring | ringPercent
    alerts: true,
    alertThreshold: 85,
  },
  providers: {
    claude: { enabled: true },
    opencodeZen: { enabled: true },
    opencodeFree: { enabled: true },
    codex: { enabled: true },
    openrouter: { enabled: true },
  },
};

const SECRET_FIELDS = { claude: 'token', openrouter: 'apiKey', opencodeZen: 'apiKey', codex: 'token' };

let cache = null;
let secretsCache = null;
let encryptionAvailable = null;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const secretsPath = () => path.join(app.getPath('userData'), 'secrets.dat');

function canEncrypt() {
  if (encryptionAvailable === null) {
    try {
      encryptionAvailable = safeStorage.isEncryptionAvailable();
    } catch {
      encryptionAvailable = false;
    }
  }
  return encryptionAvailable;
}

function load() {
  if (cache) return cache;
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    /* first run */
  }
  cache = {
    version: DEFAULTS.version,
    general: { ...DEFAULTS.general, ...(saved.general || {}) },
    providers: Object.fromEntries(
      Object.keys(DEFAULTS.providers).map((id) => [
        id,
        { ...DEFAULTS.providers[id], ...((saved.providers || {})[id] || {}) },
      ])
    ),
  };
  return cache;
}

function persist() {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
}

// ---- secrets -------------------------------------------------------------

function loadSecrets() {
  if (secretsCache) return secretsCache;
  secretsCache = {};
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(secretsPath(), 'utf8'));
  } catch {
    return secretsCache;
  }
  for (const [id, entry] of Object.entries(raw)) {
    if (!entry || typeof entry.value !== 'string') continue;
    if (entry.enc) {
      if (!canEncrypt()) continue; // encrypted under a profile we can't read
      try {
        secretsCache[id] = safeStorage.decryptString(Buffer.from(entry.value, 'base64'));
      } catch {
        /* key rotated or profile moved - treat as absent */
      }
    } else {
      secretsCache[id] = entry.value;
    }
  }
  return secretsCache;
}

function persistSecrets() {
  const out = {};
  for (const [id, value] of Object.entries(secretsCache)) {
    if (!value) continue;
    out[id] = canEncrypt()
      ? { enc: true, value: safeStorage.encryptString(value).toString('base64') }
      : { enc: false, value };
  }
  const file = secretsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function getSecret(id) {
  return loadSecrets()[id] || '';
}

function setSecret(id, value) {
  loadSecrets();
  const trimmed = (value || '').trim();
  if (trimmed) secretsCache[id] = trimmed;
  else delete secretsCache[id];
  persistSecrets();
}

// ---- public API ----------------------------------------------------------

/** Settings merged with the decrypted secret for each provider. */
function providerConfig(id) {
  const cfg = { ...load().providers[id] };
  const field = SECRET_FIELDS[id];
  if (field) cfg[field] = getSecret(id);
  return cfg;
}

function getState() {
  const s = load();
  return {
    general: { ...s.general },
    providers: Object.fromEntries(
      Object.entries(s.providers).map(([id, cfg]) => [
        id,
        { ...cfg, hasSecret: Boolean(getSecret(id)), secretField: SECRET_FIELDS[id] },
      ])
    ),
    encrypted: canEncrypt(),
  };
}

function updateGeneral(patch) {
  const s = load();
  s.general = { ...s.general, ...patch };
  persist();
  return s.general;
}

function updateProvider(id, patch) {
  const s = load();
  if (!s.providers[id]) return null;
  const { secret, ...rest } = patch;
  s.providers[id] = { ...s.providers[id], ...rest };
  persist();
  if (secret !== undefined) setSecret(id, secret);
  return s.providers[id];
}

function enabledProviders() {
  const s = load();
  return Object.entries(s.providers)
    .filter(([, cfg]) => cfg.enabled)
    .map(([id]) => id);
}

module.exports = {
  DEFAULTS,
  getState,
  load,
  providerConfig,
  updateGeneral,
  updateProvider,
  enabledProviders,
  getSecret,
  setSecret,
  canEncrypt,
};
