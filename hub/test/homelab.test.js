'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lab = require('../lib/homelab');
const { backupSummary, createReader, readBackup } = lab._internal;
const settings = () => lab.cleanSettings({ pihole: 'http://pi.example/admin/', gitea: 'http://git.example/gitea', plane: 'https://plane.example', rustdesk: { host: 'vm.example' } });
const raw = () => ({ version: 1, destinations: { vm: { repository_display: 'PRIVATE-PATH', last_success_at: '2026-10-12T09:04:24Z', snapshot_count: 11, repo_size_bytes: 148043831037, last_run: { result: 'ok', exit_code: 0, finished_at: '2026-10-12T09:04:24Z', duration_seconds: 261, data_added_bytes: 1993316876, error: 'PRIVATE-ERROR', log_file: 'PRIVATE-LOG', snapshot_id: 'PRIVATE-ID' } } } });
const bcfg = () => ({ path: '/private/status.json', destination: 'vm', label: 'Ubuntu VM', maxAgeHours: 36 });

test('settings reject credentials, unsafe protocols and invalid ports without retaining extra input fields', () => {
  for (const pihole of ['file:///etc/passwd', 'http://user:password@host', 'http://host/?token=secret', 'http://host/#secret']) assert.throws(() => lab.cleanSettings({ pihole }), { userError: true });
  for (const rustdesk of [{ host: 'host:21116' }, { host: 'http://host' }, { idPort: 0 }, { relayPort: 65536 }, { idPort: 1.5 }]) assert.throws(() => lab.cleanSettings({ rustdesk }));
  assert.throws(() => lab.cleanSettings({ backup: { path: '../secret.json' } }));
  assert.throws(() => lab.cleanSettings({ backup: { maxAgeHours: 0 } }));
  assert.equal(settings().rustdesk.idPort, 21116);
  assert(!JSON.stringify(lab.cleanSettings({ secret: 'PRIVATE', rustdesk: { password: 'PRIVATE' } })).includes('PRIVATE'));
});
test('backup summary distinguishes recent success, overdue, failure, unknown and wrong clock; omits private fields', () => {
  const good = backupSummary(raw(), bcfg(), Date.parse('2026-10-12T19:00:00Z'));
  assert.equal(good.state, 'ok'); assert.equal(good.snapshots, 11); assert.equal(good.durationSeconds, 261);
  assert(!JSON.stringify(good).includes('PRIVATE'));
  assert.equal(backupSummary(raw(), bcfg(), Date.parse('2026-10-14T19:00:00Z')).state, 'overdue');
  const failed = raw(); failed.destinations.vm.last_run = { result: 'failed', exit_code: 1, error: 'SECRET' };
  const failure = backupSummary(failed, bcfg(), Date.parse('2026-10-12T19:00:00Z'));
  assert.equal(failure.state, 'error'); assert.equal(failure.lastSuccess, good.lastSuccess); assert(!JSON.stringify(failure).includes('SECRET'));
  assert.equal(backupSummary({}, bcfg()).state, 'unknown');
  assert.equal(backupSummary(raw(), { ...bcfg(), destination: 'missing' }).state, 'unknown');
  assert.equal(backupSummary(raw(), bcfg(), Date.parse('2026-10-10T00:00:00Z')).state, 'unknown');
  const multiple = raw(); multiple.destinations.other = {};
  assert.match(backupSummary(multiple, { ...bcfg(), destination: '' }).detail, /Choose/);
});
test('file failures return unknown without leaking paths, and disabled backup does not read', async t => {
  assert.equal((await readBackup({ ...bcfg(), path: '' })).state, 'off');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-backup-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'status.json');
  const missing = await readBackup({ ...bcfg(), path: file }); assert.equal(missing.state, 'unknown'); assert(!JSON.stringify(missing).includes(dir));
  fs.writeFileSync(file, JSON.stringify(raw()));
  assert.equal((await readBackup({ ...bcfg(), path: file }, Date.parse('2026-10-12T19:00:00Z'))).state, 'ok');
  fs.writeFileSync(file, '{invalid'); assert.equal((await readBackup({ ...bcfg(), path: file })).state, 'unknown');
});
test('service checks identify HTTP failures, authentication and a partial RustDesk outage honestly', async () => {
  const reader = createReader({ request: async (url, options) => {
    assert.equal(options.method, 'GET'); assert(options.signal); assert(!options.headers.Authorization);
    if (url.includes('git.example')) { assert.equal(url, 'http://git.example/gitea/api/healthz'); return Response.json({ status: 'fail', secret: 'PRIVATE' }); }
    return new Response('PRIVATE', { status: url.includes('pi.example') ? 403 : 503 });
  }, port: async (_, port) => port === 21116 });
  const r = await reader.get({ homelab: settings() });
  assert.equal(r.services[0].state, 'warning'); assert.equal(r.services[1].state, 'error'); assert.equal(r.services[2].detail, 'HTTP 503'); assert.equal(r.services[3].detail, 'Relay port unreachable');
  for (const privateValue of ['PRIVATE', 'example', '/api/healthz']) assert(!JSON.stringify(r).includes(privateValue));
});
test('bounded body rejects malformed health response; connection failure cannot retain a green status', async () => {
  let now = 0, fail = false;
  const reader = createReader({ clock: () => now, request: async () => { if (fail) throw Error('PRIVATE'); return Response.json({ status: 'pass' }); }, port: async () => !fail });
  const first = await reader.get({ homelab: settings() }); assert(first.services.every(s => s.state === 'ok'));
  fail = true; now += 301000;
  const next = await reader.get({ homelab: settings() }); assert(next.services.every(s => s.state === 'error'));
  assert(!JSON.stringify(next).includes('PRIVATE'));
  const malformed = createReader({ request: async () => new Response('a'.repeat(65537)) });
  assert.equal((await malformed.get({ homelab: { gitea: 'http://git.example' } })).services[1].state, 'error');
});
test('polls coalesce and cache for five minutes; changing settings or clearing invalidates cached readings', async () => {
  let now = 0, calls = 0;
  const reader = createReader({ clock: () => now, request: async () => { calls++; return new Response('ok'); } });
  const cfg = { homelab: { pihole: 'http://pi.example' } };
  await Promise.all([reader.get(cfg), reader.get(cfg)]); assert.equal(calls, 1);
  await reader.get(cfg); assert.equal(calls, 1);
  now = 300001; await reader.get(cfg); assert.equal(calls, 2);
  cfg.homelab.pihole = 'http://other.example'; await reader.get(cfg); assert.equal(calls, 3);
  await reader.get(cfg, { refresh: true }); assert.equal(calls, 4);
  reader.clear(); await reader.get(cfg); assert.equal(calls, 5);
});