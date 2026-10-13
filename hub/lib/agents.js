'use strict';
// Usage numbers pushed by collector scripts (tools/agent-usage/). Only counts and dollar estimates are stored, never text.
const path = require('path');
const { readJson, writeJsonAtomic } = require('./util');

const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
const str = (v, n) => String(v == null ? '' : v).slice(0, n);

function cleanService(s) {
  const id = str(s.id, 30).toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!id) throw Object.assign(new Error('each service needs an id'), { userError: true });
  const days = (Array.isArray(s.days) ? s.days : []).slice(-31).map((d) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) return null;
    const models = {};
    Object.keys(d.models || {}).slice(0, 12).forEach((m) => {
      const x = d.models[m] || {};
      models[str(m, 60)] = { input: num(x.input), output: num(x.output), cacheRead: num(x.cacheRead), cacheWrite: num(x.cacheWrite), messages: num(x.messages) };
    });
    return { date: d.date, input: num(d.input), output: num(d.output), cacheRead: num(d.cacheRead), cacheWrite: num(d.cacheWrite), cost: Math.round(num(d.cost) * 100) / 100, models };
  }).filter(Boolean);
  const meters = (Array.isArray(s.meters) ? s.meters : []).slice(0, 4).map((m) => ({ label: str(m.label, 40), used: Math.min(100, num(m.used)), win: num(m.win), leftMin: m.leftMin == null ? null : num(m.leftMin), resetAt: num(m.resetAt) || null }));
  const credits = s.kind === 'credits' && s.credits ? Object.fromEntries(
    ['daily', 'weekly', 'monthly', 'total', 'limit', 'remaining', 'accountRemaining'].map((key) => [key,
      typeof s.credits[key] === 'number' && Number.isFinite(s.credits[key]) ? s.credits[key] : null])) : null;
  if (credits) credits.accountError = str(s.credits.accountError, 180);
  return {
    id, kind: ['limits', 'credits'].includes(s.kind) ? s.kind : 'usage', unofficial: !!s.unofficial, meters, credits, error: str(s.error, 300), name: str(s.name, 40) || id, plan: str(s.plan, 40), color: /^#[0-9a-fA-F]{6}$/.test(s.color || '') ? s.color : '#888888',
    costNote: str(s.costNote, 200), days
  };
}

class AgentsStore {
  constructor(dir) {
    this.file = path.join(dir, 'agents.json');
    this.data = readJson(this.file, { services: {} });
    if (!this.data.services) this.data.services = {};
  }
  /** Replace the services named in the payload, keep the others. `updated` is the hub's own clock. */
  update(payload) {
    const list = Array.isArray(payload && payload.services) ? payload.services.slice(0, 10) : null;
    if (!list || !list.length) throw Object.assign(new Error('services must be a non-empty list'), { userError: true });
    const now = new Date().toISOString();
    list.forEach((s) => {
      const c = cleanService(s);
      this.data.services[c.id] = Object.assign(c, { updated: now, source: str(payload.source, 60), timezone: str(payload.timezone, 60) });
    });
    writeJsonAtomic(this.file, this.data);
  }
  /** Store a service the hub fetched itself. On failure the last good meters stay and the error is recorded. */
  setService(svc, error, source = 'hub') {
    const prev = this.data.services[svc.id] || {};
    const c = cleanService(Object.assign({ days: [] }, svc));
    if (error) { c.meters = prev.meters || []; c.credits = prev.credits || null; c.plan = prev.plan || c.plan; c.error = str(error, 300); c.updated = prev.updated || null; c.errorAt = new Date().toISOString(); }
    else c.updated = new Date().toISOString();
    this.data.services[c.id] = Object.assign(prev.days ? { days: prev.days } : {}, c, { source });
    writeJsonAtomic(this.file, this.data);
  }
  removeLinkedService(id) {
    if (this.data.services[id] && ['hub', 'pc-login'].includes(this.data.services[id].source)) {
      delete this.data.services[id];
      writeJsonAtomic(this.file, this.data);
    }
  }
  /** The frame asks for fresh numbers. A watcher on the computer that holds the logs notices and runs its collector. */
  request() {
    const now = Date.now(), last = Date.parse(this.data.requestedAt || '') || 0;
    if (now - last > 5000) { this.data.requestedAt = new Date(now).toISOString(); writeJsonAtomic(this.file, this.data); }
    return this.data.requestedAt;
  }
  get() { return { services: Object.values(this.data.services), requestedAt: this.data.requestedAt || null }; }
}

module.exports = { AgentsStore };
