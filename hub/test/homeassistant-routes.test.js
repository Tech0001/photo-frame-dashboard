'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
test('real hub routes protect action tokens including encoded paths and send only explicitly applied thermostat changes', { timeout: 20000 }, async t => {
  const writes = [], mock = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const state = { entity_id: 'climate.main', state: 'heat', attributes: { supported_features: 1, temperature: 68, min_temp: 45, max_temp: 90, hvac_modes: ['heat', 'off'] } };
    if (req.method === 'POST') { let body = ''; for await (const c of req) body += c; writes.push({ path: req.url, body: JSON.parse(body) }); res.end('[]'); }
    else res.end(JSON.stringify(req.url === '/api/config' ? { unit_system: { temperature: '°F' } } : req.url === '/api/states' ? [state] : req.url === '/api/services' ? [{ domain: 'climate', services: { set_temperature: {} } }] : state));
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening'); t.after(() => { mock.closeAllConnections(); mock.close(); });
  const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-route-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const folder of ['photos', 'data', 'cache']) fs.mkdirSync(path.join(dir, folder));
  const config = { port, photosDir: path.join(dir, 'photos'), dataDir: path.join(dir, 'data'), cacheDir: path.join(dir, 'cache'), calendars: [], weather: null, homeassistant: { url: 'http://127.0.0.1:' + mock.address().port, climate: 'climate.main', controls: true, entities: [] } };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config)); fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ homeassistant_token: 'FAKE_TOKEN_FOR_TEST_ONLY', admin_password: 'test-admin' }));
  const child = spawn(process.execPath, [path.resolve(__dirname, '../server.js')], { env: { ...process.env, HUB_CONFIG: path.join(dir, 'config.json'), HUB_SECRETS: path.join(dir, 'secrets.json'), PORT: String(port), PHOTOS_DIR: config.photosDir, DATA_DIR: config.dataDir, CACHE_DIR: config.cacheDir }, stdio: 'ignore' });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  const base = 'http://127.0.0.1:' + port;
  let response;
  for (let i = 0; i < 60; i++) { try { response = await fetch(base + '/api/home'); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); } }
  assert(response?.ok); assert.equal(response.headers.get('access-control-allow-origin'), null);
  const data = await response.json(); assert(data.controlToken); assert(!JSON.stringify(data).includes('FAKE_TOKEN'));
  const encoded = await fetch(base + '/api/%68ome', { headers: { Origin: 'http://evil.example' } });
  assert.equal(encoded.headers.get('access-control-allow-origin'), null);
  const body = { entity: 'climate.main', action: 'temperature', mode: 'heat', temperature: 69 };
  const headers = { 'Content-Type': 'application/json', 'X-Frame-Action': data.controlToken, Origin: base };
  for (const extra of [{ Origin: 'http://evil.example' }, { 'X-Frame-Action': '' }, { 'Content-Type': 'text/plain' }]) {
    const r = await fetch(base + '/api/home/climate', { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) }); assert.equal(r.status, extra.Origin ? 403 : extra['Content-Type'] ? 415 : 400);
  }
  assert.equal(writes.length, 0);
  const r = await fetch(base + '/api/home/climate', { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal(r.status, 202); assert.deepEqual(await r.json(), { accepted: true });
  assert.deepEqual(writes, [{ path: '/api/services/climate/set_temperature', body: { entity_id: 'climate.main', temperature: 69, hvac_mode: 'heat' } }]);
});
