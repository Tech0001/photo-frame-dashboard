'use strict';
// Keep credentials and unselected entities on the hub. Writes are separately enabled
// and restricted to the selected thermostat and its reported capabilities.
const crypto = require('node:crypto');
const bad = (message) => Object.assign(new Error(message), { userError: true });
const idPattern = /^(climate|camera|sensor|binary_sensor|event)\.[a-z0-9_]+$/;
const str = (v, n = 100) => String(v == null ? '' : v).slice(0, n);
const num = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
const date = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const defaults = () => ({ url: '', climate: '', entities: [], controls: false, ecobeeResume: false });

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
  for (const key of ['controls', 'ecobeeResume']) if (typeof h[key] !== 'boolean') throw bad('Thermostat control settings must be on or off.');
  return { url: h.url, climate: h.climate, entities: [...new Set(h.entities)], controls: h.controls, ecobeeResume: h.ecobeeResume };
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
async function request(c, endpoint, fetcher = fetch, image = false, payload) {
  let r;
  try { r = await fetcher(c.h.url + endpoint, { method: payload === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + c.token, Accept: image ? 'image/jpeg,image/png,image/webp' : 'application/json', ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), redirect: 'error', signal: AbortSignal.timeout(10000) }); }
  catch { throw Error(payload === undefined ? 'The hub could not reach Home Assistant. Check its address and connection.' : 'Could not confirm delivery to Home Assistant. Refresh the thermostat before trying again.'); }
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
    action: str(a.hvac_action, 30), preset: str(a.preset_mode, 40), unit: ['°F', '°C'].includes(unit) ? unit : '', capabilities: capabilities(s) });
  if (domain === 'event') Object.assign(out, { eventAt: date(s.state), eventType: str(a.event_type, 40) });
  return out;
}
function capabilities(s) {
  const a = s.attributes || {}, features = Number.isInteger(a.supported_features) ? a.supported_features : 0;
  const choices = value => Array.isArray(value) ? [...new Set(value.filter(x => typeof x === 'string' && x.length > 0 && x.length <= 60))].slice(0, 20) : [];
  const min = num(a.min_temp), max = num(a.max_temp), bounded = min !== null && max !== null && min < max;
  return { temperature: bounded && !!(features & 1), range: bounded && !!(features & 2), min, max,
    step: num(a.target_temp_step) > 0 ? num(a.target_temp_step) : (s.attributes?.temperature_unit === '°F' ? 1 : 0.5),
    modes: choices(a.hvac_modes), presets: features & 16 ? choices(a.preset_modes) : [] };
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
          entry.data = { updated: new Date(clock()).toISOString(), climate: c.h.climate ? pick(c.h.climate) : null, entities: c.h.entities.map(pick), controls: c.h.controls, ecobeeResume: c.h.controls && c.h.ecobeeResume };
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
const actionKey = crypto.randomBytes(32);
function controlToken(cfg, secrets) {
  return crypto.createHmac('sha256', actionKey).update(JSON.stringify(cleanSettings(cfg.homeassistant))).update(secrets.homeassistant_token || '').digest('hex');
}
function authorizeControl(req, cfg, secrets) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '') || req.headers['sec-fetch-site'] === 'cross-site') throw bad('Open thermostat controls on this dashboard.');
  if (req.headers.origin) {
    let origin; try { origin = new URL(req.headers.origin); } catch { throw bad('Invalid dashboard origin.'); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) throw bad('Cross-origin thermostat actions are not allowed.');
  }
  const given = Buffer.from(req.headers['x-frame-action'] || ''), expected = Buffer.from(controlToken(cfg, secrets));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw bad('Refresh the dashboard before changing the thermostat.');
}
function createController(fetcher = fetch, invalidate = reader.clear) {
  let running = false;
  async function act(cfg, secrets, input) {
    const c = connection(cfg, secrets), identity = controlToken(cfg, secrets);
    if (!c.h.controls || !c.h.climate) throw bad('Thermostat controls are disabled in server settings.');
    if (!input || input.entity !== c.h.climate) throw bad('That thermostat is not selected for the frame.');
    if (running) throw bad('A thermostat request is already running. Wait for it to finish.');
    running = true;
    try {
      const state = await json(c, '/api/states/' + encodeURIComponent(c.h.climate), fetcher);
      if (state.entity_id !== c.h.climate || !state.state || ['unknown', 'unavailable'].includes(state.state)) throw bad('The thermostat is unavailable. No change was sent.');
      const cap = capabilities(state), data = { entity_id: c.h.climate };
      let domain = 'climate', service;
      if (input.action === 'temperature') {
        const mode = input.mode;
        if (!cap.modes.includes(mode) || !['heat', 'cool', 'heat_cool', 'auto'].includes(mode)) throw bad('Choose a supported heating or cooling mode.');
        const range = mode === 'heat_cool';
        if (!(range ? cap.range : cap.temperature)) throw bad('This thermostat does not support that temperature control.');
        function temperature(key) {
          const v = input[key];
          if (typeof v !== 'number' || !Number.isFinite(v) || v < cap.min || v > cap.max) throw bad('Choose a temperature within the thermostat’s limits.');
          return v;
        }
        if (range) {
          data.target_temp_low = temperature('low'); data.target_temp_high = temperature('high');
          if (data.target_temp_low >= data.target_temp_high) throw bad('The cooling target must be above the heating target.');
        } else data.temperature = temperature('temperature');
        data.hvac_mode = mode; service = 'set_temperature';
      } else if (input.action === 'mode') {
        if (!cap.modes.includes(input.mode)) throw bad('That thermostat mode is unavailable.');
        data.hvac_mode = input.mode; service = 'set_hvac_mode';
      } else if (input.action === 'preset') {
        if (!cap.presets.includes(input.preset)) throw bad('That comfort mode is unavailable.');
        data.preset_mode = input.preset; service = 'set_preset_mode';
      } else if (input.action === 'resume') {
        if (!c.h.ecobeeResume) throw bad('Ecobee schedule controls are not enabled.');
        domain = 'ecobee'; service = 'resume_program'; data.resume_all = false;
      } else throw bad('Unknown thermostat action.');
      const services = await json(c, '/api/services', fetcher);
      if (!Array.isArray(services) || !services.some(x => x.domain === domain && Object.hasOwn(x.services || {}, service))) throw bad('Home Assistant does not provide that thermostat action.');
      if (identity !== controlToken(cfg, secrets)) throw bad('The thermostat connection changed. Refresh the dashboard.');
      const r = await request(c, '/api/services/' + domain + '/' + service, fetcher, false, data);
      if (r.body) await r.body.cancel();
      invalidate();
      return { accepted: true }; // HA accepting an action is not confirmation from the device.
    } finally { running = false; }
  }
  return { act };
}
const controller = createController();
module.exports = { defaults, cleanSettings, cleanToken, discover, camera, get: reader.get, clear: reader.clear, act: controller.act, controlToken, authorizeControl, _internal: { reading, capabilities, createReader, createController } };
