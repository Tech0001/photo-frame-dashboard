'use strict';
// Explicit project reports, independent of account usage and lane activity.
const path = require('node:path');
const crypto = require('node:crypto');
const { readJson, writeJsonAtomic } = require('./util');
const STAGES = ['built', 'reviewed', 'integrated', 'live'];
const bad = message => Object.assign(new Error(message), { userError: true });
function text(value, limit, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > limit || /[\x00-\x08\x0b-\x1f\x7f]/.test(value) || (required && !value.trim())) throw bad('Progress text is missing, too long or invalid.');
  return value.trim();
}
function date(value, now) {
  const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/);
  const day = match && new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  if (!match || day.getUTCFullYear() !== +match[1] || day.getUTCMonth() !== +match[2] - 1 || day.getUTCDate() !== +match[3] || !Number.isFinite(Date.parse(value)) || Date.parse(value) > now + 300000) throw bad('Use a valid progress timestamp, no more than five minutes in the future.');
  return new Date(value).toISOString();
}
function cleanReport(input, now = Date.now()) {
  if (!input || input.schemaVersion !== 1 || input.project !== 'evergreen') throw bad('Use Evergreen progress schema version 1.');
  const updatedAt = date(input.updatedAt, now);
  const out = { schemaVersion: 1, project: 'evergreen', source: text(input.source, 80, true), updatedAt,
    objective: text(input.objective, 300, true), next: text(input.next, 400) };
  for (const key of ['work', 'recent', 'blockers', 'decisions']) {
    if (!Array.isArray(input[key]) || input[key].length > 24) throw bad('Progress lists must contain at most 24 items.');
    const ids = new Set();
    out[key] = input[key].map(item => {
      if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9._-]{1,60}$/.test(item.id) || ids.has(item.id)) throw bad('Progress items need unique, stable IDs.');
      ids.add(item.id);
      const row = { id: item.id, title: text(item.title, 180, true), owner: text(item.owner, 60), detail: text(item.detail, 400) };
      if (key === 'work') {
        row.stages = {};
        for (const stage of STAGES) {
          const value = item.stages?.[stage];
          if (value != null && typeof value !== 'boolean') throw bad('Progress stages must be true, false or null.');
          row.stages[stage] = value == null ? null : value;
        }
      } else if (key === 'recent') {
        if (!STAGES.includes(item.stage)) throw bad('Recent progress must name a reported stage.');
        row.stage = item.stage; row.at = date(item.at, now);
        if (Date.parse(row.at) > Date.parse(updatedAt)) throw bad('Recent progress cannot be newer than the report.');
      } else row.next = text(item.next, 300);
      return row;
    });
  }
  return out;
}
function authorize(req, token) {
  if (!token) throw Object.assign(bad('Set an Evergreen progress token in server settings first.'), { httpStatus: 503 });
  const given = String(req.headers['x-progress-token'] || '');
  const hash = value => crypto.createHash('sha256').update(value).digest();
  if (!given || !crypto.timingSafeEqual(hash(given), hash(token))) throw Object.assign(bad('Bad or missing X-Progress-Token.'), { httpStatus: 401 });
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '') || req.headers['sec-fetch-site'] === 'cross-site') throw bad('Publish progress as JSON from the configured sync tool.');
}
class ProgressStore {
  constructor(dir, clock = Date.now) {
    this.file = path.join(dir, 'evergreen-progress.json'); this.clock = clock;
    const saved = readJson(this.file, null);
    this.data = null;
    try { if (saved) this.data = { report: cleanReport(saved.report, clock()), receivedAt: date(saved.receivedAt, clock()) }; } catch { /* invalid records are never presented as current */ }
  }
  update(input) {
    const report = cleanReport(input, this.clock());
    if (this.data && Date.parse(report.updatedAt) < Date.parse(this.data.report.updatedAt)) throw bad('An older report cannot replace newer Evergreen progress.');
    const next = { report, receivedAt: new Date(this.clock()).toISOString() };
    writeJsonAtomic(this.file, next, 0o600); this.data = next;
    return this.get();
  }
  get() {
    if (!this.data) return { report: null, receivedAt: null, feedStale: false, reportStale: false };
    return { ...this.data, feedStale: this.clock() - Date.parse(this.data.receivedAt) > 15 * 60000,
      reportStale: this.clock() - Date.parse(this.data.report.updatedAt) > 24 * 3600000 };
  }
}
module.exports = { ProgressStore, cleanReport, authorize, STAGES };
