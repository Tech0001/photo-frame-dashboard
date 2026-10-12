'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ha = require('../lib/homeassistant');
const connections = require('../lib/connections');
const token = 'test-token-home-assistant-not-a-real-credential';
const config = () => ({ homeassistant: { url: 'http://ha.example', climate: 'climate.main_floor', entities: ['event.door_ding', 'sensor.door_battery', 'camera.door'] } });
const states = () => [
  { entity_id: 'climate.main_floor', state: 'heat_cool', attributes: { friendly_name: 'Main Floor', current_temperature: 74.2, current_humidity: 38, target_temp_low: 62, target_temp_high: 74, hvac_action: 'idle', preset_mode: 'Home' } },
  { entity_id: 'event.door_ding', state: '2026-10-12T12:34:00Z', attributes: { friendly_name: 'Doorbell', event_type: 'ding' } },
  { entity_id: 'sensor.door_battery', state: '0', attributes: { friendly_name: 'Battery', unit_of_measurement: '%', private_url: 'SECRET' } },
  { entity_id: 'camera.door', state: 'idle', attributes: { friendly_name: 'Front Door', access_token: 'CAMERA-SECRET', entity_picture: '/api/camera_proxy/camera.door?token=CAMERA-SECRET', video_url: 'PRIVATE-VIDEO' } },
  { entity_id: 'sensor.private', state: 'PRIVATE-STATE', attributes: {} }
];
const mock = async (url, opts) => {
  assert.equal(opts.headers.Authorization, 'Bearer ' + token); assert.equal(opts.redirect, 'error'); assert(!opts.method || opts.method === 'GET');
  if (url.endsWith('/api/states')) return Response.json(states());
  if (url.endsWith('/api/config')) return Response.json({ unit_system: { temperature: '°F' }, latitude: 12.3456 });
  throw Error('Unexpected URL');
};

test('Home Assistant settings accept dashboard URLs and reject unrelated entity domains', () => {
  assert.equal(ha.cleanSettings({ url: 'http://homeassistant.local/home/overview' }).url, 'http://homeassistant.local');
  for (const url of ['file:///etc/passwd', 'https://token@host/', 'http://host/?token=x']) assert.throws(() => ha.cleanSettings({ url }));
  assert.throws(() => ha.cleanSettings({ climate: 'lock.front_door' }));
  assert.throws(() => ha.cleanSettings({ entities: ['camera.door/../../config'] }));
  assert.throws(() => ha.cleanSettings({ entities: [null] }));
});
test('Home readings return only selected fields, preserve Fahrenheit and zero, and use actual HVAC action', async () => {
  const reader = ha._internal.createReader(mock), result = await reader.get(config(), { homeassistant_token: token });
  assert(result.ok); assert.equal(result.climate.unit, '°F'); assert.equal(result.climate.action, 'idle');
  assert.equal(result.climate.low, 62); assert.equal(result.climate.high, 74); assert.equal(result.climate.current, 74.2);
  assert.equal(result.entities[0].eventAt, '2026-10-12T12:34:00.000Z'); assert.equal(result.entities[1].state, '0');
  const encoded = JSON.stringify(result);
  for (const secret of [token, 'SECRET', 'PRIVATE', 'latitude', 'entity_picture', 'access_token']) assert(!encoded.includes(secret));
});
test('missing and unavailable readings stay unavailable, never become zero', async () => {
  const reader = ha._internal.createReader(async (url) => url.endsWith('/config') ? Response.json({}) : Response.json([{ entity_id: 'climate.main_floor', state: 'unavailable', attributes: {} }]));
  const r = await reader.get(config(), { homeassistant_token: token });
  assert.equal(r.climate.available, false); assert.equal(r.climate.current, null);
  assert(r.entities.every((e) => !e.available && e.missing));
});
test('failed refresh keeps last successful readings with a stale warning and a safe error', async () => {
  let now = 100000, calls = 0, fail = false;
  const reader = ha._internal.createReader(async (...args) => { calls++; return fail ? new Response('SECRET PROVIDER BODY', { status: 401 }) : mock(...args); }, () => now);
  const cfg = config(), sec = { homeassistant_token: token }, first = await reader.get(cfg, sec);
  await reader.get(cfg, sec); assert.equal(calls, 2);
  now += 21000; fail = true; const failed = await reader.get(cfg, sec);
  assert(!failed.ok && failed.stale); assert.equal(failed.updated, first.updated); assert.equal(failed.climate.current, 74.2);
  assert(!failed.error.includes('SECRET')); assert.match(failed.error, /rejected the token/);
});
test('unlink during a fetch cannot resurrect home readings', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const reader = ha._internal.createReader(async (...args) => { await gate; return mock(...args); });
  const cfg = config(), sec = { homeassistant_token: token }, pending = reader.get(cfg, sec);
  delete sec.homeassistant_token; release();
  const result = await pending; assert.equal(result.configured, false); assert.equal(result.climate, null); assert.deepEqual(result.entities, []);
});
test('discovery and camera proxy strip private fields and reject unselected cameras', async () => {
  const cfg = config(), sec = { homeassistant_token: token };
  const list = await ha.discover(cfg, sec, mock); assert.equal(list.length, 5); assert.deepEqual(Object.keys(list[0]).sort(), ['domain', 'id', 'name']);
  await assert.rejects(ha.camera(cfg, sec, 'camera.private', () => { throw Error('Must not fetch'); }), /not selected/);
  const result = await ha.camera(cfg, sec, 'camera.door', async (url, opts) => {
    assert.equal(url, 'http://ha.example/api/camera_proxy/camera.door'); assert.equal(opts.headers.Authorization, 'Bearer ' + token);
    return new Response(Buffer.from('test image bytes'), { headers: { 'Content-Type': 'image/jpeg' } });
  });
  assert.equal(result.type, 'image/jpeg');
  await assert.rejects(ha.camera(cfg, sec, 'camera.door', async () => new Response('<script>', { headers: { 'Content-Type': 'text/html' } })), /No supported image/);
});
test('connection saves are write-only, preserve blank tokens, and require reauthentication for a changed server', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-ha-')), cfgFile = path.join(dir, 'config.json'), secFile = path.join(dir, 'secrets.json');
  const cfg = { timezone: 'UTC', weather: null, calendars: [], proxmenux: {} }, secrets = { admin_password: 'test-admin' };
  fs.writeFileSync(cfgFile, '{}'); fs.writeFileSync(secFile, '{}'); const tz = process.env.TZ;
  try {
    const c = connections({ cfg, secrets, cfgFile, secFile, getPeopleIds: () => [] });
    c.apply({ homeassistant: { ...config().homeassistant, token } });
    assert(c.view().homeassistant.tokenSet); assert(!JSON.stringify(c.view()).includes(token));
    assert.equal(fs.statSync(secFile).mode & 0o777, 0o600);
    c.apply({ homeassistant: { token: '' } }); assert.equal(secrets.homeassistant_token, token);
    assert.throws(() => c.apply({ homeassistant: { url: 'http://other.example' } }), /token again/);
    assert.equal(cfg.homeassistant.url, 'http://ha.example');
    c.apply({ homeassistant: { unlink: true } }); assert(!secrets.homeassistant_token); assert.equal(cfg.homeassistant.url, '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
});
