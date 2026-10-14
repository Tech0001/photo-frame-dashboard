'use strict';
const crypto = require('node:crypto');
const tune = require('./tune');
const KEYS = ['theme', 'homeSec', 'ambientSec', 'ambientStyle'];
const token = crypto.randomBytes(32).toString('hex');
const bad = message => Object.assign(new Error(message), { userError: true });
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') throw bad('Open display settings from this frame hub.');
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch { throw bad('Invalid display settings origin.'); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) throw bad('Open display settings from this frame hub.');
  }
}
function current(store) {
  const values = tune.resolve(tune.fromState(store.state.settings));
  return Object.fromEntries(KEYS.map(key => [key, values[key]]));
}
function read(req, store) { sameOrigin(req); return { token, values: current(store) }; }
function authorize(req) {
  sameOrigin(req);
  const given = Buffer.from(String(req.headers['x-display-token'] || '')), expected = Buffer.from(token);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw bad('Reopen display settings and try again.');
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw bad('Send display settings as JSON.');
}
function save(store, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).some(key => !KEYS.includes(key))) throw bad('Only theme, screensaver style and idle timers can be changed here.');
  let values;
  try { values = tune.clean(input, tune.resolve(tune.fromState(store.state.settings))); } catch (e) { throw bad(e.message); }
  const parts = tune.split(values);
  store.update(s => {
    s.settings.tune = Object.assign({}, s.settings.tune, parts.tune);
    s.settings.display = Object.assign({}, s.settings.display, parts.display);
  });
  tune.setLive(tune.resolve(tune.fromState(store.state.settings)));
  return { ok: true, values: current(store) };
}
module.exports = { read, authorize, save };
