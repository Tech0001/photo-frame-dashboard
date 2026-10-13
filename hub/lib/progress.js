'use strict';
// Explicit project reports, independent of account usage and lane activity.
const path = require('node:path');
const crypto = require('node:crypto');
const { readJson, writeJsonAtomic } = require('./util');
const STAGES = ['built', 'reviewed', 'integrated', 'live'];
const STATUSES = ['completed', 'underway', 'blocked', 'pending', 'unknown'];
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
  if (!input || ![1, 2].includes(input.schemaVersion) || input.project !== 'evergreen') throw bad('Use Evergreen progress schema version 1 or 2.');
  if (input.publishable === false || input.proposalVersion != null) throw bad('A progress proposal cannot be published as live status.');
  if (input.schemaVersion === 2 && input.publishable !== true) throw bad('Version 2 requires publishable: true after source reconciliation.');
  if (input.schemaVersion === 1 && input.sections != null) throw bad('Use version 2 for checklist sections.');
  const updatedAt = date(input.updatedAt, now);
  const out = { schemaVersion: input.schemaVersion, project: 'evergreen', source: text(input.source, 80, true), updatedAt,
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
  if (input.schemaVersion === 2) {
    out.publishable = true;
    out.sections = cleanSections(input.sections, updatedAt, now);
  }
  return out;
}
function cleanProgress(value, updatedAt, now) {
  if (value == null) return undefined;
  function numbers(row) {
    if (!row || !Number.isInteger(row.completed) || !Number.isInteger(row.total) || row.total < 1 || row.total > 100000 || row.completed < 0 || row.completed > row.total) throw bad('Progress counts need checked and total integer checklist entries.');
    return { completed: row.completed, total: row.total, basis: text(row.basis, 60, true) };
  }
  const out = numbers(value);
  if (!Array.isArray(value.history) || value.history.length > 32) throw bad('Progress history must contain at most 32 dated count snapshots.');
  const seen = new Set();
  out.history = value.history.map(row => {
    const point = numbers(row); point.at = date(row.at, now);
    if (Date.parse(point.at) > Date.parse(updatedAt) || seen.has(point.at)) throw bad('Progress history dates must be unique and no newer than reconciliation.');
    seen.add(point.at); return point;
  }).sort((a,b) => Date.parse(a.at) - Date.parse(b.at));
  return out;
}
function cleanSections(sections, updatedAt, now) {
  if (!Array.isArray(sections) || !sections.length || sections.length > 16) throw bad('Send 1–16 reported checklist sections.');
  const sectionsSeen = new Set(), itemsSeen = new Set();
  let itemCount = 0, milestoneCount = 0;
  function id(value, seen) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,60}$/.test(value) || seen.has(value)) throw bad('Checklist IDs must be unique and stable.');
    seen.add(value); return value;
  }
  function scope(row) {
    if (!row || !STATUSES.includes(row.status)) throw bad('Checklist status must be completed, underway, blocked, pending or unknown.');
    const out = { title: text(row.title, 180, true), status: row.status, owner: text(row.owner, 120), detail: text(row.detail, 500), next: text(row.next, 400), stages: {}, stageEvidence: {} };
    for (const stage of STAGES) {
      const value = row.stages?.[stage];
      if (value != null && typeof value !== 'boolean') throw bad('Progress stages must be true, false or null.');
      out.stages[stage] = value == null ? null : value;
      out.stageEvidence[stage] = text(row.stageEvidence?.[stage], 400);
    }
    const progress = cleanProgress(row.progress, updatedAt, now);
    if (progress) out.progress = progress;
    return out;
  }
  return sections.map(section => {
    if (!section || !['partial', 'complete'].includes(section.coverage)) throw bad('Declare section coverage as partial or complete.');
    if (!Array.isArray(section.items) || !section.items.length || section.items.length > 128) throw bad('Send 1–128 reported items per section.');
    const out = { id: id(section.id, sectionsSeen), title: text(section.title, 180, true), coverage: section.coverage, items: [] };
    const progress = cleanProgress(section.progress, updatedAt, now);
    if (progress) out.progress = progress;
    if (section.totalItems != null) {
      if (!Number.isInteger(section.totalItems) || section.totalItems < section.items.length || section.totalItems > 128 || (section.coverage === 'complete' && section.totalItems !== section.items.length)) throw bad('Section totalItems must match the checklist size and reported coverage.');
      out.totalItems = section.totalItems;
    }
    out.items = section.items.map(item => {
      if (++itemCount > 256) throw bad('Send at most 256 reported checklist items.');
      const row = scope(item); row.id = id(item.id, itemsSeen);
      if (typeof item.checklistChecked !== 'boolean' || item.checklistChecked !== (item.status === 'completed')) throw bad('Completed checklist items must be checked; open items must not be completed.');
      row.checklistChecked = item.checklistChecked;
      if (row.progress && (row.progress.completed === row.progress.total) !== row.checklistChecked) throw bad('A fully checked subtask checklist must agree with its completed acceptance status.');
      if (row.progress && row.progress.total === 1 && row.progress.completed !== Number(row.checklistChecked)) throw bad('Leaf progress must match its checkbox.');
      row.acceptance = text(item.acceptance, 600);
      if (!Array.isArray(item.milestones) || item.milestones.length > 24) throw bad('Send at most 24 milestones per item.');
      const seen = new Set();
      row.milestones = item.milestones.map(m => {
        if (++milestoneCount > 512) throw bad('Send at most 512 reported milestones.');
        const milestone = scope(m); milestone.id = id(m.id, seen);
        milestone.at = m.at == null ? null : date(m.at, now);
        if (milestone.at && Date.parse(milestone.at) > Date.parse(updatedAt)) throw bad('Milestone achievement cannot be newer than reconciliation.');
        if (milestone.at && m.status !== 'completed') throw bad('Only completed milestones may have achievement dates.');
        return milestone;
      });
      return row;
    });
    if (out.progress) {
      const checked = out.items.filter(item => item.checklistChecked).length;
      const total = out.coverage === 'complete' ? out.items.length : out.totalItems || out.progress.total;
      if (out.progress.total !== total || out.progress.completed < checked || out.progress.completed > checked + total - out.items.length) throw bad('Section progress must count checked subtasks, not their partial progress.');
    }
    return out;
  });
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
module.exports = { ProgressStore, cleanReport, authorize, STAGES, STATUSES };
