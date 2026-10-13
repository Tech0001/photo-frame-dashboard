'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const management = require('../lib/pihole-management');
const settings = { host: 'pi.example', user: 'pi', port: 22, identityFile: '/private/key' };
const raw = () => ({ protocol: 1, kind: 'frame-pihole', os: 'Linux', uptimeSeconds: 1000, bootedAt: '2026-10-12T12:00:00Z', actions: ['gravity', 'restart', 'reboot'], updateReason: 'Major migration required', PRIVATE: 'secret' });
test('management validates SSH inputs and uses a fixed noninteractive command without a local shell', async () => {
  for (const value of [{ host: '-oProxyCommand=bad' }, { host: 'host;bad' }, { user: 'pi root' }, { identityFile: '/tmp/key\nother' }, { identityFile: 'relative' }, { port: -1 }]) assert.throws(() => management.clean({ ...settings, ...value }));
  const client = management._internal.create(async (exe, args, opts) => {
    assert.equal(exe, 'ssh'); assert(args.includes('StrictHostKeyChecking=yes')); assert(args.includes('BatchMode=yes')); assert(args.includes('IdentitiesOnly=yes')); assert.equal(args.at(-1), 'status'); assert.equal(args.at(-2), 'pi@pi.example'); assert.equal(opts.shell, undefined); assert(opts.timeout <= 8000); return { stdout: JSON.stringify(raw()) };
  });
  const result = await client.status(settings); assert.equal(result.state, 'ok'); assert.equal(result.uptimeSeconds, 1000); assert(!JSON.stringify(result).includes('PRIVATE')); assert(!JSON.stringify(result).includes('/private'));
});
test('actions require exact confirmation and a fresh capability check; update migration is blocked', async () => {
  const calls = [];
  const client = management._internal.create(async (_, args) => { const action = args.at(-1); calls.push(action); return { stdout: JSON.stringify(action === 'status' ? raw() : { accepted: true }) }; });
  await assert.rejects(client.action(settings, 'reboot', 'yes'), /Confirm/);
  await assert.rejects(client.action(settings, 'reboot; bad', 'reboot; bad'), /Confirm/);
  assert.equal(calls.length, 0);
  await assert.rejects(client.action(settings, 'update', 'update'), /Major migration/); assert.deepEqual(calls, ['status']);
  const r = await client.action(settings, 'gravity', 'gravity'); assert.equal(r.accepted, true); assert.deepEqual(calls, ['status', 'status', 'gravity']);
});
test('unreachable or busy management has no enabled actions and never exposes raw SSH errors', async () => {
  const client = management._internal.create(async () => { throw Error('PRIVATE ssh command /private/key'); });
  assert.deepEqual((await client.status(settings)).actions, []); await assert.rejects(client.action(settings, 'reboot', 'reboot'), /unavailable/);
  const broken = await client.status(settings); assert(!JSON.stringify(broken).includes('PRIVATE'));
  const busy = management._internal.create(async () => ({ stdout: JSON.stringify({ ...raw(), actions: [], job: { action: 'gravity', state: 'running', log: 'PRIVATE' } }) }));
  await assert.rejects(busy.action(settings, 'restart', 'restart'), /unavailable/);
  assert(!JSON.stringify(await busy.status(settings)).includes('PRIVATE'));
});
