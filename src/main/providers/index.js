'use strict';
const { fetchClaude } = require('./claude');
const { fetchOpenRouter } = require('./openrouter');
const { fetchOpencodeZen } = require('./opencodeZen');
const { fetchCodex } = require('./codex');
const { fetchOpencodeFree } = require('./opencodeFree');
const { claudeCredentials, opencodeZenKey, codexAuth } = require('../util/local');

const PROVIDERS = [
  {
    id: 'claude',
    name: 'Claude Code',
    subtitle: 'Anthropic subscription limits',
    fetch: fetchClaude,
    credential: {
      field: 'token',
      label: 'OAuth access token',
      placeholder: 'sk-ant-oat01-...',
      help: 'Optional. Leave empty to use the login from the Claude Code CLI.',
      link: 'https://claude.ai/settings/usage',
    },
    detect: () => (claudeCredentials() ? 'Signed in via Claude Code CLI' : null),
  },
  {
    id: 'opencodeZen',
    name: 'OpenCode Go',
    subtitle: 'OpenCode Zen quota',
    fetch: fetchOpencodeZen,
    credential: {
      field: 'apiKey',
      label: 'Zen API key',
      placeholder: 'sk-...',
      help: 'Optional. Leave empty to use the key stored by the OpenCode CLI.',
      link: 'https://opencode.ai/docs/zen/',
    },
    detect: () => {
      const k = opencodeZenKey();
      return k ? 'Key found in ' + k.source : null;
    },
  },
  {
    id: 'opencodeFree',
    name: 'OpenCode Free',
    subtitle: 'Free Zen models (local tally)',
    fetch: fetchOpencodeFree,
    credential: null,
    detect: () => {
      const { existsSync } = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      const f = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode-v1.db');
      return existsSync(f) ? 'Reading OpenCode history (no key needed)' : null;
    },
  },
  {
    id: 'codex',
    name: 'Codex',
    subtitle: 'OpenAI / ChatGPT limits',
    fetch: fetchCodex,
    credential: {
      field: 'token',
      label: 'ChatGPT access token',
      placeholder: 'eyJ...',
      help: 'Optional. Leave empty to use the login from the Codex CLI.',
      link: 'https://chatgpt.com/codex/settings/usage',
    },
    detect: () => (codexAuth() ? 'Signed in via Codex CLI' : null),
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    subtitle: 'Prepaid credit balance',
    fetch: fetchOpenRouter,
    credential: {
      field: 'apiKey',
      label: 'API key',
      placeholder: 'sk-or-v1-...',
      help: 'Required. Create one at openrouter.ai/keys.',
      link: 'https://openrouter.ai/settings/keys',
    },
    detect: () => (process.env.OPENROUTER_API_KEY ? 'Found OPENROUTER_API_KEY in your environment' : null),
  },
];

const byId = new Map(PROVIDERS.map((p) => [p.id, p]));

/** Static descriptors for the settings UI. Never includes secrets. */
function catalog() {
  return PROVIDERS.map(({ id, name, subtitle, credential, detect }) => {
    let detected = null;
    try {
      detected = detect();
    } catch {
      /* detection is best-effort */
    }
    return { id, name, subtitle, credential, detected };
  });
}

async function fetchProvider(id, config) {
  const provider = byId.get(id);
  if (!provider) throw new Error('Unknown provider: ' + id);
  const base = { id, name: provider.name, subtitle: provider.subtitle };
  try {
    const result = await provider.fetch(config);
    return { ...base, ...result, updatedAt: new Date().toISOString() };
  } catch (err) {
    return {
      ...base,
      state: 'error',
      message: (err && err.message) || 'Unexpected error',
      updatedAt: new Date().toISOString(),
    };
  }
}

module.exports = { PROVIDERS, catalog, fetchProvider, order: PROVIDERS.map((p) => p.id) };
