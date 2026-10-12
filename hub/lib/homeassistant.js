'use strict';
// Only GET requests. Keep credentials and unselected entities on the hub.
const crypto = require('node:crypto');
const bad = (message) => Object.assign(new Error(message), { userError: true });
const idPattern = /^(climate|camera|sensor|binary_sensor|event)\.[a-z0-9_]+$/;
const str = (v, n = 100) => String(v == null ? '' : v).slice(0, n);
const num = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
const date = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const defaults = () => ({ url: '', climate: '', entities: [] });

function cleanSettings(input) {
  const h = Object.assign(defaults(), input);
  if (typeof h.url !== 'string' || typeof h.climate !== 'string') throw bad('Home Assistant address and thermostat must be text.');
  if (h.url) {
    let u;
    try { u = new URL(String(h.url).trim()); } catch { throw bad('Enter the full Home Assistant address.'); }
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw bad('Use an http:// or https:// Home Assistant address without login details or query parameters.');
    h.url = u.origin; // Accept a pasted dashboard URL, use the API at its origin.
  }
  if (h.climate && (!idPattern.test(h.climate) || !h.climate.startsWith('climate.'))) throw bad('Choose a thermostat entity.');
  if (!Array.isArray(h.entities) || h.entities.length > 16 || h.entities.some((id) => typeof id !== 'string' || !idPattern.test(id) || id.startsWith('climate.'))) throw bad('Choose up to 16 camera, sensor or event entities.');
  return { url: h.url, climate: h.climate, entities: [...new Set(h.entities)] };
}
function cleanToken(value) {
  const t = String(value).trim();
  if (!/^[A-Za-z0-9._~-]{30,8192}$/.test(t)) throw bad('Paste the complete Home Assistant long-lived access token.');
  return t;
}
function connection(cfg, secrets) {
  const h = cleanSettings(cfg.homeassistant), token = secrets.homeassistant_token;
  if (!h.url || !token) throw bad('Connect Home Assistant in Frame admin → Connections → Home Assistant.');
  return { h, token };
}
async function request(c, endpoint, fetcher = fetch, image = false) {
  let r;
  try { r = await fetcher(c.h.url + endpoint, { headers: { Authorization: 'Bearer ' + c.token, Accept: image ? 'image/jpeg,image/png,image/webp' : 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) }); }
  catch { throw Error('The hub could not reach Home Assistant. Check its address and connection.'); }
  if (r.status === 401 || r.status === 403) throw Error('Home Assistant rejected the token. Update it in Connections → Home Assistant.');
  if (!r.ok) throw Error('Home Assistant answered HTTP ' + r.status + '.');
  return r;
}
async function json(c, endpoint, fetcher) {
  const r = await request(c, endpoint, fetcher);
  try { return await r.json(); } catch { throw Error('Home Assistant returned an unreadable response.'); }
}
function reading(s, unit) {
  const a = s.attributes || {}, domain = s.entity_id.split('.')[0];
  const out = { id: s.entity_id, name: str(a.friendly_name || s.entity_id, 80), domain, state: str(s.state),
    available: !['unavailable', 'unknown'].includes(s.state), changedAt: date(s.last_changed),
    unit: str(a.unit_of_measurement, 12), deviceClass: str(a.device_class, 40) };
  if (domain === 'climate') Object.assign(out, { current: num(a.current_temperature), humidity: num(a.current_humidity),
    target: num(a.temperature), low: num(a.target_temp_low), high: num(a.target_temp_high),
    action: str(a.hvac_action, 30), preset: str(a.preset_mode, 40), unit: ['°F', '°C'].includes(unit) ? unit : '' });
  if (domain === 'event') Object.assign(out, { eventAt: date(s.state), eventType: str(a.event_type, 40) });
  return out;
}
async function discover(cfg, secrets, fetcher) {
  const c = connection(cfg, secrets), states = await json(c, '/api/states', fetcher);
  if (!Array.isArray(states)) throw Error('Home Assistant returned an unrecognized entity list.');
  return states.filter((s) => s && idPattern.test(s.entity_id)).slice(0, 1500).map((s) => ({
    id: s.entity_id, name: str((s.attributes || {}).friendly_name || s.entity_id, 80), domain: s.entity_id.split('.')[0]
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function createReader(fetcher = fetch, clock = Date.now) {
  let cache = null;
  function clear() { cache = null; }
  function identity(cfg, secrets) { return JSON.stringify(cleanSettings(cfg.homeassistant)) + ':' + crypto.createHash('sha256').update(secrets.homeassistant_token || '').digest('hex'); }
  function result(entry) {
    return Object.assign({ configured: true, ok: !entry.error, error: entry.error || '', updated: null, climate: null, entities: [] }, entry.data,
      { ok: !entry.error, error: entry.error || '', stale: !!entry.error || !entry.data || clock() - Date.parse(entry.data.updated) > 90000 });
  }
  async function get(cfg, secrets) {
    if (!cfg.homeassistant?.url || !secrets.homeassistant_token) { clear(); return { configured: false, ok: false, stale: false, updated: null, climate: null, entities: [] }; }
    const key = identity(cfg, secrets);
    if (!cache || cache.key !== key) cache = { key, at: -Infinity, data: null, pending: null, error: '' };
    const entry = cache;
    if (!entry.pending && clock() - entry.at >= 20000) {
      const c = connection(cfg, secrets);
      entry.pending = (async () => {
        try {
          const [states, config] = await Promise.all([json(c, '/api/states', fetcher), json(c, '/api/config', fetcher)]);
          if (!Array.isArray(states) || !config || typeof config !== 'object') throw Error('Home Assistant returned an unrecognized response.');
          const selected = [c.h.climate, ...c.h.entities].filter(Boolean);
          const unit = config.unit_system?.temperature;
          const byId = new Map(states.filter((s) => s && selected.includes(s.entity_id)).map((s) => [s.entity_id, reading(s, unit)]));
          const pick = (id) => byId.get(id) || { id, name: id, domain: id.split('.')[0], available: false, state: 'unavailable', missing: true };
          entry.data = { updated: new Date(clock()).toISOString(), climate: c.h.climate ? pick(c.h.climate) : null, entities: c.h.entities.map(pick) };
          entry.error = '';
        } catch (e) { entry.error = e.message; }
        finally { entry.at = clock(); entry.pending = null; }
      })();
    }
    if (entry.pending) await entry.pending;
    // A save/unlink while the request was running must not disclose the old selection.
    if (cache !== entry || identity(cfg, secrets) !== key) return get(cfg, secrets);
    return result(entry);
  }
  return { get, clear };
}

async function camera(cfg, secrets, id, fetcher) {
  const c = connection(cfg, secrets);
  if (!idPattern.test(id) || !id.startsWith('camera.') || !c.h.entities.includes(id)) throw bad('That camera is not selected for the frame.');
  const r = await request(c, '/api/camera_proxy/' + encodeURIComponent(id), fetcher, true);
  const type = (r.headers.get('content-type') || '').split(';')[0];
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw Error('No supported image is available from this camera.');
  const chunks = []; let size = 0;
  for await (const chunk of r.body) { size += chunk.length; if (size > 8 * 1024 * 1024) throw Error('The camera image is too large.'); chunks.push(chunk); }
  if (cfg.homeassistant?.url !== c.h.url || secrets.homeassistant_token !== c.token || !cfg.homeassistant.entities.includes(id)) throw bad('The camera connection changed.');
  return { type, body: Buffer.concat(chunks) };
}
const reader = createReader();
module.exports = { defaults, cleanSettings, cleanToken, discover, camera, get: reader.get, clear: reader.clear, _internal: { reading, createReader } };
