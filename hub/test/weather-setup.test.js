'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { searchLocations } = require('../lib/locations');
const connections = require('../lib/connections');

test('location search encodes the query and returns selectable places', async () => {
  const places = await searchLocations('Paris, France', async (url, options) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://geocoding-api.open-meteo.com');
    assert.equal(u.searchParams.get('name'), 'Paris, France');
    assert(options.signal);
    return { ok: true, json: async () => ({ results: [
      { name: 'Paris', admin1: 'Île-de-France', country: 'France', latitude: 48.8534, longitude: 2.3488, timezone: 'Europe/Paris' },
      { name: 'Invalid location without coordinates' }
    ] }) };
  });
  assert.deepEqual(places, [{ name: 'Paris, Île-de-France, France', lat: 48.8534, lon: 2.3488, timezone: 'Europe/Paris' }]);
});

test('empty and failed searches give actionable results', async () => {
  await assert.rejects(searchLocations('x'), /city or postal code/);
  await assert.rejects(searchLocations('a'.repeat(101)), /city or postal code/);
  await assert.rejects(searchLocations('Paris', async () => ({ ok: false })), /try again or enter coordinates/);
  assert.deepEqual(await searchLocations('Unknown city', async () => ({ ok: true, json: async () => ({}) })), []);
});

test('weather setup persists location and units, rejects partial coordinates, and can be cleared', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-weather-'));
  const cfgFile = path.join(dir, 'config.json'), secFile = path.join(dir, 'secrets.json');
  const cfg = { timezone: 'UTC', weather: null, calendars: [], proxmenux: { url: '', tokenSecret: 'proxmenux_token' } };
  const secrets = { admin_password: 'test-only-password', ical: {} };
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  fs.writeFileSync(secFile, JSON.stringify(secrets));
  const originalTZ = process.env.TZ;
  try {
    const service = connections({ cfg, secrets, cfgFile, secFile, getPeopleIds: () => [] });
    service.apply({ weather: { lat: 48.85341, lon: 2.34881, units: 'c', name: 'Paris' }, timezone: 'Europe/Paris' });
    assert.deepEqual(JSON.parse(fs.readFileSync(cfgFile)).weather, { lat: 48.8534, lon: 2.3488, units: 'c', name: 'Paris' });
    assert.equal(service.view().timezone, 'Europe/Paris');
    const before = fs.readFileSync(cfgFile, 'utf8');
    for (const w of [{lat: null, lon: 10}, {lat: '', lon: 10}, {lat: 10}, {lat: 91, lon: 0}]) {
      assert.throws(() => service.apply({ weather: w }));
      assert.equal(fs.readFileSync(cfgFile, 'utf8'), before);
    }
    service.apply({ weather: { lat: 0, lon: 0, units: 'f' } });
    assert.equal(service.view().weather.units, 'f');
    service.apply({ weather: null });
    assert.equal(service.view().weather, null);
    assert.equal(JSON.parse(fs.readFileSync(cfgFile)).weather, null);
    assert.equal(JSON.parse(fs.readFileSync(secFile)).admin_password, 'test-only-password');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ;
  }
});
