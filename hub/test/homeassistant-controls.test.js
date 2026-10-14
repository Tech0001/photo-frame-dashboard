'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ha = require('../lib/homeassistant');
const config = () => ({ homeassistant: { url: 'http://ha.example', climate: 'climate.main', entities: [], controls: true, ecobeeResume: true } });
const secrets = { homeassistant_token: 'PRIVATE_HA_TOKEN' };
const state = () => ({ entity_id: 'climate.main', state: 'heat_cool', attributes: { supported_features: 411, min_temp: 44.6, max_temp: 95, target_temp_step: 0.5, target_temp_low: 62, target_temp_high: 76, preset_modes: ['home', 'away', 'sleep'], hvac_modes: ['heat_cool', 'heat', 'cool', 'off'] } });
function mock({ changeState, post, changeConfig, fail } = {}) {
  return async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer PRIVATE_HA_TOKEN'); assert.equal(options.redirect, 'error');
    if (url.endsWith('/api/states/climate.main')) return Response.json(changeState ? changeState(state()) : state());
    if (url.endsWith('/api/services')) {
      if (changeConfig) changeConfig();
      return Response.json([{ domain: 'climate', services: { set_temperature: {}, set_hvac_mode: {}, set_preset_mode: {} } }, { domain: 'ecobee', services: { resume_program: {} } }]);
    }
    assert.equal(options.method, 'POST');
    if (post) post(url, JSON.parse(options.body));
    return fail ? new Response('PRIVATE_PROVIDER_BODY', { status: 500 }) : Response.json([{ entity_id: 'sensor.unselected', state: 'PRIVATE_STATE' }]);
  };
}
test('thermostat capabilities preserve heat/cool ranges and filter unsupported controls', () => {
  const r = ha._internal.reading(state(), '°F');
  assert.equal(r.capabilities.range, true); assert.equal(r.capabilities.step, 0.5); assert.deepEqual(r.capabilities.presets, ['home', 'away', 'sleep']);
  const s = state(); s.attributes.supported_features = 0;
  assert.equal(ha._internal.capabilities(s).temperature, false); assert.deepEqual(ha._internal.capabilities(s).presets, []);
});
test('only the selected thermostat receives validated service payloads; acceptance is not confirmation', async () => {
  const writes = []; let cleared = 0;
  const controller = ha._internal.createController(mock({ post: (url, body) => writes.push({ url, body }) }), () => cleared++);
  const cfg = config();
  for (const input of [{ action: 'temperature', mode: 'heat_cool', low: 64, high: 76 }, { action: 'temperature', mode: 'heat', temperature: 65 }, { action: 'preset', preset: 'sleep' }, { action: 'mode', mode: 'off' }, { action: 'resume' }]) {
    assert.deepEqual(await controller.act(cfg, secrets, { ...input, entity: 'climate.main', arbitrary: 'PRIVATE' }), { accepted: true });
  }
  assert.deepEqual(writes[0].body, { entity_id: 'climate.main', target_temp_low: 64, target_temp_high: 76, hvac_mode: 'heat_cool' });
  assert.deepEqual(writes[4].body, { entity_id: 'climate.main', resume_all: false });
  assert(writes[4].url.endsWith('/api/services/ecobee/resume_program'));
  assert.equal(cleared, 5); assert(!JSON.stringify(writes).includes('PRIVATE'));
});
test('invalid values, unsupported actions, unselected entities and unavailable devices never write', async () => {
  let writes = 0; const controller = ha._internal.createController(mock({ post: () => writes++ }), () => {});
  const invalid = [{ action: 'temperature', mode: 'heat_cool', low: 80, high: 70 }, { action: 'temperature', mode: 'heat', temperature: '65' }, { action: 'temperature', mode: 'heat', temperature: null }, { action: 'temperature', mode: 'heat', temperature: 100 }, { action: 'temperature', mode: 'off', temperature: 65 }, { action: 'preset', preset: 'holiday' }, { action: 'mode', mode: 'vent' }, { action: 'unlock' }];
  for (const input of invalid) await assert.rejects(controller.act(config(), secrets, { entity: 'climate.main', ...input }), { userError: true });
  await assert.rejects(controller.act(config(), secrets, { entity: 'climate.private', action: 'mode', mode: 'off' }), /not selected/);
  const cfg = config(); cfg.homeassistant.controls = false;
  await assert.rejects(controller.act(cfg, secrets, { entity: 'climate.main', action: 'mode', mode: 'off' }), /disabled/);
  cfg.homeassistant.controls = true; cfg.homeassistant.ecobeeResume = false;
  await assert.rejects(controller.act(cfg, secrets, { entity: 'climate.main', action: 'resume' }), /not enabled/);
  for (const changeState of [s => ({ ...s, state: 'unavailable' }), s => ({ ...s, attributes: {} })]) {
    const c = ha._internal.createController(mock({ changeState, post: () => writes++ }), () => {});
    await assert.rejects(c.act(config(), secrets, { entity: 'climate.main', action: 'temperature', mode: 'heat', temperature: 65 }));
  }
  assert.equal(writes, 0);
});
test('changed connections and missing services block writes; provider failures are safe and not retried', async () => {
  let writes = 0; const cfg = config();
  const c = ha._internal.createController(mock({ changeConfig: () => { cfg.homeassistant.climate = 'climate.other'; }, post: () => writes++ }), () => {});
  await assert.rejects(c.act(cfg, secrets, { entity: 'climate.main', action: 'resume' }), /connection changed/);
  assert.equal(writes, 0);
  const fail = ha._internal.createController(mock({ fail: true, post: () => writes++ }), () => {});
  await assert.rejects(fail.act(config(), secrets, { entity: 'climate.main', action: 'resume' }), /HTTP 500/); assert.equal(writes, 1);
  const missing = ha._internal.createController(async url => Response.json(url.endsWith('/api/services') ? [] : state()), () => {});
  await assert.rejects(missing.act(config(), secrets, { entity: 'climate.main', action: 'resume' }), /does not provide/);
  const lost = ha._internal.createController(mock({ post: () => { writes++; throw Error('PRIVATE_NETWORK_ERROR'); } }), () => {});
  await assert.rejects(lost.act(config(), secrets, { entity: 'climate.main', action: 'resume' }), /Could not confirm delivery/);
  assert.equal(writes, 2); // The ambiguous delivery was attempted once, never retried.
});
test('thermostat writes require a same-origin connection token that changes when settings change', () => {
  const cfg = config(), headers = { host: 'frame.local:8099', origin: 'http://frame.local:8099', 'content-type': 'application/json', 'x-frame-action': ha.controlToken(cfg, secrets) };
  ha.authorizeControl({ headers }, cfg, secrets);
  for (const extra of [{ origin: 'http://evil.example' }, { origin: 'null' }, { 'content-type': 'text/plain' }, { 'sec-fetch-site': 'cross-site' }, { 'x-frame-action': '' }]) assert.throws(() => ha.authorizeControl({ headers: { ...headers, ...extra } }, cfg, secrets));
  cfg.homeassistant.url = 'http://another.example'; assert.throws(() => ha.authorizeControl({ headers }, cfg, secrets), /Refresh/);
});
