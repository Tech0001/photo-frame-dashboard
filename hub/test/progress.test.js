'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ProgressStore, cleanReport, authorize } = require('../lib/progress');
const now = Date.parse('2026-10-12T20:00:00Z');
const report = () => ({ schemaVersion: 1, project: 'evergreen', source: 'Ledger', updatedAt: new Date(now).toISOString(), objective: 'Review the release', next: 'Finish the independent review', work: [{ id: 'C1', title: 'Release candidate', owner: 'Vega', stages: { built: true, reviewed: false, integrated: true, live: null }, privatePath: '/PRIVATE/path' }], recent: [{ id: 'change1', title: 'Candidate built', stage: 'built', at: new Date(now - 60000).toISOString() }], blockers: [], decisions: [], memory: 'PRIVATE MEMORY' });
test('reports preserve separate delivery stages and exclude unselected data', () => {
  const out = cleanReport(report(), now);
  assert.deepEqual(out.work[0].stages, { built: true, reviewed: false, integrated: true, live: null });
  assert(!JSON.stringify(out).includes('PRIVATE'));
  assert.equal(out.recent[0].stage, 'built');
});
test('malformed progress, future dates and duplicate IDs are rejected', () => {
  assert.throws(() => cleanReport({ ...report(), updatedAt: '2026-02-31T12:00:00Z' }, now));
  for (const change of [r => r.schemaVersion = 2, r => r.project = 'other', r => r.updatedAt = new Date(now + 400000).toISOString(), r => r.work[0].stages.live = 'done', r => r.recent[0].stage = 'complete', r => r.blockers = Array(25).fill({}), r => r.work.push(r.work[0]), r => r.objective = 'x'.repeat(301), r => r.recent[0].at = new Date(now + 1000).toISOString()]) {
    const r = report(); change(r); assert.throws(() => cleanReport(r, now), { userError: true });
  }
});
test('persistence is atomic; invalid or older updates preserve the previous report', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-progress-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new ProgressStore(dir, () => now);
  store.update(report()); const saved = fs.readFileSync(store.file, 'utf8');
  const old = report(); old.updatedAt = new Date(now - 1).toISOString(); old.recent = [];
  assert.throws(() => store.update(old), /older/); assert.throws(() => store.update({}), /schema/);
  assert.equal(fs.readFileSync(store.file, 'utf8'), saved);
  assert.deepEqual(new ProgressStore(dir, () => now).get(), store.get());
  assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
});
test('republishing an old snapshot refreshes the feed without disguising stale progress', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-progress-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = now; const store = new ProgressStore(dir, () => clock);
  store.update(report()); clock += 25 * 3600000;
  assert(store.get().feedStale && store.get().reportStale);
  store.update(report()); assert.equal(store.get().feedStale, false); assert.equal(store.get().reportStale, true);
  fs.writeFileSync(store.file, '{broken'); assert.equal(new ProgressStore(dir, () => clock).get().report, null);
});
test('a dedicated credential is required even before a publisher is configured', () => {
  const headers = { 'content-type': 'application/json', 'x-progress-token': 'report-publisher-only' };
  authorize({ headers }, 'report-publisher-only');
  assert.throws(() => authorize({ headers }, ''), { httpStatus: 503 });
  assert.throws(() => authorize({ headers }, 'usage-token-different'), { httpStatus: 401 });
  for (const extra of [{ 'x-progress-token': '' }, { 'content-type': 'text/plain' }, { 'sec-fetch-site': 'cross-site' }]) assert.throws(() => authorize({ headers: { ...headers, ...extra } }, 'report-publisher-only'));
});
