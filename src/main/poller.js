'use strict';
const { EventEmitter } = require('node:events');
const { fetchProvider, order } = require('./providers');
const store = require('./store');

class Poller extends EventEmitter {
  constructor() {
    super();
    this.results = new Map();
    this.refreshing = false;
    this.lastRefresh = null;
    this.timer = null;
    this.alerted = new Map(); // "provider:meter" -> reset timestamp already alerted on
  }

  snapshot() {
    const enabled = new Set(store.enabledProviders());
    return {
      providers: order.filter((id) => enabled.has(id)).map((id) => this.results.get(id) || pending(id)),
      refreshing: this.refreshing,
      lastRefresh: this.lastRefresh,
      general: store.load().general,
      worst: this.worst(),
    };
  }

  /** Highest utilisation across everything currently enabled and healthy. */
  worst() {
    const enabled = new Set(store.enabledProviders());
    let worst = null;
    let anyOk = false;
    let anyProblem = false;
    for (const [id, r] of this.results) {
      if (!enabled.has(id)) continue;
      if (r.state !== 'ok') {
        if (r.state === 'error' || r.state === 'auth') anyProblem = true;
        continue;
      }
      anyOk = true;
      const used = usedOf(r);
      if (used !== null && (worst === null || used > worst.used)) worst = { used, id, name: r.name, label: r.primary?.label };
    }
    if (!anyOk) return { used: null, id: null, name: null, problem: anyProblem };
    return { ...worst, problem: anyProblem };
  }

  async refresh({ reason = 'manual' } = {}) {
    if (this.refreshing) return this.snapshot();
    this.refreshing = true;
    this.emit('update', this.snapshot());

    const ids = store.enabledProviders();
    // Drop results for providers that have since been switched off.
    for (const id of [...this.results.keys()]) if (!ids.includes(id)) this.results.delete(id);

    await Promise.all(
      ids.map(async (id) => {
        const result = await fetchProvider(id, store.providerConfig(id));
        this.results.set(id, result);
        // Stream each provider in as it lands so the panel fills progressively.
        this.emit('update', { ...this.snapshot(), refreshing: true });
      })
    );

    this.refreshing = false;
    this.lastRefresh = new Date().toISOString();
    const snap = this.snapshot();
    this.emit('update', snap);
    if (reason !== 'silent') this.checkAlerts(snap);
    return snap;
  }

  checkAlerts(snap) {
    const { alerts, alertThreshold } = store.load().general;
    if (!alerts) return;
    for (const p of snap.providers) {
      if (p.state !== 'ok') continue;
      for (const m of p.meters || []) {
        if (typeof m.used !== 'number' || m.used < alertThreshold) continue;
        const key = `${p.id}:${m.key}`;
        const stamp = m.resetsAt || 'static';
        if (this.alerted.get(key) === stamp) continue;
        this.alerted.set(key, stamp);
        this.emit('alert', {
          provider: p,
          meter: m,
          title: `${p.name}: ${Math.round(100 - m.used)}% left`,
          body: `${m.label} usage has reached ${Math.round(m.used)}%.`,
        });
      }
    }
  }

  start() {
    this.stop();
    const minutes = Math.max(1, Number(store.load().general.refreshMinutes) || 5);
    this.timer = setInterval(() => this.refresh({ reason: 'timer' }), minutes * 60 * 1000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Re-arm the interval after the user changes the cadence. */
  reschedule() {
    this.start();
  }
}

function usedOf(result) {
  if (result.primary?.kind === 'percent' && typeof result.primary.used === 'number') return result.primary.used;
  // Currency-style providers only contribute if they expose a bounded meter.
  const bounded = (result.meters || []).filter((m) => typeof m.used === 'number');
  if (!bounded.length) return null;
  return Math.max(...bounded.map((m) => m.used));
}

function pending(id) {
  return { id, state: 'loading' };
}

module.exports = { Poller };
