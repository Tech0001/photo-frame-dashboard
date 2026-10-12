'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const pi = require('../lib/pihole-v6'), lab = require('../lib/homelab'), connections = require('../lib/connections');
const settings = { pihole: 'http://pi.example/sub/admin/', piholeVersion: '6' }, password = 'PRIVATE+app/password=', sid = 'PRIVATE+session/id=';
const versions = { version: Object.fromEntries(['core', 'web', 'ftl'].map(key => [key, { local: { version: 'v6.1' }, remote: { version: 'v6.2' } }])) };
function mock(calls, broken) {
  return async (url, options) => {
    calls.push([url, options.method]); assert(url.startsWith('http://pi.example/sub/api/')); assert(!url.includes(password) && !url.includes(sid)); assert.equal(options.redirect, 'error');
    if (options.method === 'POST') { assert.deepEqual(JSON.parse(options.body), { password }); return broken === 'auth' ? new Response('PRIVATE', { status: 401 }) : Response.json({ session: { valid: true, sid, validity: 300 } }); }
    assert.equal(options.headers['X-FTL-SID'], sid);
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.endsWith('/stats/summary')) return broken === 'stats' ? new Response('PRIVATE', { status: 401 }) : Response.json({ queries: { total: 0, blocked: 0, percent_blocked: 0 }, clients: { active: 2, total: 5 }, gravity: { domains_being_blocked: 123, last_update: 1725194639 }, PRIVATE: password });
    if (url.endsWith('/dns/blocking')) return broken === 'blocking' ? Response.json({ blocking: 'unknown' }) : Response.json({ blocking: 'disabled' });
    if (url.endsWith('/info/version')) return Response.json(versions);
    throw Error('Unexpected endpoint');
  };
}
test('Pi-hole v6 authenticates without URL credentials, reads only totals, and always closes its session', async () => {
  const calls = [], r = await pi.get(settings, password, mock(calls));
  assert.equal(r.state, 'ok'); assert.equal(r.queries, 0); assert.equal(r.blockedPercent, 0); assert.equal(r.clients, 2); assert.equal(r.blocking, false); assert.equal(r.period, 'Last 24 hours');
  assert.equal(r.gravityUpdated, '2024-09-01T12:43:59.000Z'); assert(r.versions.every(v => v.update));
  assert.equal(calls.length, 5); assert.equal(calls.at(-1)[1], 'DELETE'); assert(!JSON.stringify(r).includes('PRIVATE'));
  for (const ending of ['', '/', '/admin/', '/api', '/admin/settings.php']) assert.equal(pi._internal.baseUrl('http://pi.example/sub' + ending), 'http://pi.example/sub/api');
});
test('auth rejection never falls back to a legacy URL; failures and partial data do not show healthy zeros', async () => {
  for (const broken of ['auth', 'stats', 'blocking']) {
    const calls = [], r = await pi.get(settings, password, mock(calls, broken));
    assert.equal(r.state, broken === 'blocking' ? 'warning' : 'unknown'); assert(!JSON.stringify(r).includes('PRIVATE'));
    assert.equal(calls.at(-1)[1], broken === 'auth' ? 'POST' : 'DELETE');
    if (broken !== 'blocking') assert.equal(r.queries, null);
  }
  assert.equal((await pi.get(settings, '', () => { throw Error('No fetch'); })).state, 'off');
});
test('v6 passwords are write-only, separate from v5 tokens, and cleared when moving or unlinking hosts', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-v6-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cfgFile = path.join(dir, 'config.json'), secFile = path.join(dir, 'secrets.json');
  const cfg = { timezone: 'UTC', calendars: [], proxmenux: {}, homelab: lab.cleanSettings(settings) }, sec = { admin_password: 'keep', homelab_pihole_token: 'legacy-token' };
  fs.writeFileSync(cfgFile, '{}'); fs.writeFileSync(secFile, '{}');
  const c = connections({ cfg, secrets: sec, cfgFile, secFile, getPeopleIds: () => [] });
  c.apply({ homelab: { ...cfg.homelab, piholePassword: password } });
  assert(c.view().homelab.piholePasswordSet); assert(!JSON.stringify(c.view()).includes(password)); assert(!fs.readFileSync(cfgFile, 'utf8').includes(password));
  c.apply({ homelab: { ...cfg.homelab, piholePassword: '' } }); assert.equal(sec.homelab_pihole_password, password);
  assert.throws(() => c.apply({ homelab: { ...cfg.homelab, pihole: 'http://other.example' } }), /again/);
  c.apply({ homelab: { ...cfg.homelab, pihole: 'http://other.example', piholePassword: password } }); assert.equal(sec.homelab_pihole_token, undefined);
  c.restore({ ...cfg, homelab: { ...cfg.homelab, pihole: 'http://third.example' } }); assert.equal(sec.homelab_pihole_password, undefined);
  c.apply({ homelab: { ...cfg.homelab, piholePassword: password } }); c.apply({ homelab: { ...cfg.homelab, piholeUnlink: true } }); assert.equal(sec.homelab_pihole_password, undefined);
});
