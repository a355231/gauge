'use strict';

const DEFAULT_TIMEOUT = 12000;

/** Fetch JSON without throwing on HTTP errors — callers branch on `status`. */
async function getJSON(url, { headers = {}, timeout = DEFAULT_TIMEOUT, method = 'GET' } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(timeout),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body (usually an HTML error page) */
    }
    return { ok: res.ok, status: res.status, json, text, headers: res.headers };
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      json: null,
      text: '',
      networkError: timedOut ? 'Request timed out' : describeNetworkError(err),
    };
  }
}

function describeNetworkError(err) {
  const code = err?.cause?.code || err?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'No network connection';
  if (code === 'ECONNREFUSED') return 'Connection refused';
  if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') return 'TLS certificate problem';
  return err?.message || 'Network error';
}

module.exports = { getJSON };
