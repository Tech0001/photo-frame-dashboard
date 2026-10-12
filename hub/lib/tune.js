'use strict';
// Tunable settings: one table drives the stored defaults, validation, the /admin controls and what the frame receives.
// To add a setting: add a row here, read it where it is used (frame: window.TUNE.key, hub: tune.get('key')).
// type 'num' needs min/max (and optional step/unit); type 'select' needs options [[value, label], ...].
//   tab   = which /admin tab shows it (settings rows also have sub = the pill under Settings: display, refresh)
//   group = the card it sits in             adv = true tucks it into the Advanced fold at the bottom of its page
//   where = who reads it: 'frame' (dashboard, live), 'hub' (this server, live), 'kiosk' (the Android app; the frame hands it over)
const THEMES = require('../../dashboard/js/theme-palettes.json');
const SCHEMA = [




  // ---- Photos > Uploads
  { key: 'uploadMaxMb', adv: true, tab: 'photos', group: 'Uploads', label: 'Largest photo you can add from the browser', type: 'num', min: 1, max: 200, step: 1, unit: 'MB', def: 40, where: 'hub' },

  // ---- Settings > Display
  //   store: where a value is kept. Omitted = state.settings.tune. 'display' is an older home that the frame reads from /api/state,
  //   kept so nothing on the frame changes; /admin treats every row the same.
  { key: 'theme', tab: 'settings', sub: 'display', group: 'Dashboard theme', label: 'Color theme', hint: 'Paper is the original. Choose a preview to apply it to the frame. Photos and the dim red night clock keep their own colors.', type: 'select', options: THEMES.map(t => [t.id, t.label]), previews: THEMES.map(t => ({ id: t.id, label: t.label, description: t.description, paper: t.colors.paper, card: t.colors.card, ink: t.colors.ink, accent: t.colors.accent, accentInk: t.colors['accent-ink'] })), def: 'paper', where: 'frame' },
  { key: 'homeSec', store: 'display', tab: 'settings', sub: 'display', group: 'Away-from-screen timers', label: 'Back to Today after', hint: 'Counted from the last touch. Set both short (for example 15 and 30) to see each stage quickly while testing.', type: 'num', min: 5, max: 86400, step: 1, unit: 'seconds', def: 60, slider: false, where: 'frame' },
  { key: 'ambientSec', store: 'display', tab: 'settings', sub: 'display', group: 'Away-from-screen timers', label: 'Start the photo slideshow after', type: 'num', min: 10, max: 86400, step: 1, unit: 'seconds', def: 120, slider: false, where: 'frame' },

  // ---- Settings > Refresh rates
  { key: 'pollSec', tab: 'settings', sub: 'refresh', group: 'Refresh rates', label: 'Frame checks the hub every', hint: 'How quickly an edit in /admin reaches the frame.', type: 'num', min: 5, max: 300, step: 1, unit: 'seconds', def: 20, where: 'frame' },
  { key: 'calendarMin', adv: true, tab: 'settings', sub: 'refresh', group: 'Refresh rates', label: 'Hub re-reads calendars every', type: 'num', min: 1, max: 120, step: 1, unit: 'minutes', def: 5, where: 'hub' },
  { key: 'weatherMin', adv: true, tab: 'settings', sub: 'refresh', group: 'Refresh rates', label: 'Hub re-reads the weather every', type: 'num', min: 5, max: 240, step: 5, unit: 'minutes', def: 15, where: 'hub' },
  { key: 'nasSec', adv: true, tab: 'settings', sub: 'refresh', group: 'Refresh rates', label: 'Hub re-reads server stats every', type: 'num', min: 5, max: 600, step: 5, unit: 'seconds', def: 15, where: 'hub' },


];

const BY_KEY = {}; SCHEMA.forEach((r) => { BY_KEY[r.key] = r; });
const DEFAULTS = {}; SCHEMA.forEach((r) => { DEFAULTS[r.key] = r.def; });

/** One value, checked against its row. Throws a message fit to show in /admin. */
function check(row, v) {
  if (row.type === 'select') {
    if (!row.options.some((o) => o[0] === v)) throw new Error(row.label + ' must be one of: ' + row.options.map((o) => o[1]).join(', '));
    return v;
  }
  const n = +v;
  if (v === '' || v === null || !isFinite(n) || n < row.min || n > row.max) throw new Error(row.label + ' must be between ' + row.min + ' and ' + row.max + (row.unit ? ' ' + row.unit : ''));
  return row.step && row.step < 1 ? Math.round(n * 10) / 10 : Math.round(n);
}

/** Stored (sparse) values -> every setting with defaults filled in and bad stored values ignored. */
function resolve(stored) {
  const out = Object.assign({}, DEFAULTS);
  Object.keys(stored || {}).forEach((k) => { if (BY_KEY[k]) { try { out[k] = check(BY_KEY[k], stored[k]); } catch (e) { /* keep the default */ } } });
  return out;
}

/** Validate a partial update; returns only the cleaned values. Cross-field rules live here. */
function clean(values, current) {
  const out = {};
  Object.keys(values || {}).forEach((k) => {
    if (!BY_KEY[k]) throw new Error('Unknown setting: ' + k);
    out[k] = check(BY_KEY[k], values[k]);
  });
  const merged = Object.assign({}, current, out);
  if (!(merged.homeSec < merged.ambientSec)) throw new Error('The timers must go in order: back to Today, then the slideshow, then the screen turning off');
  return out;
}

// The hub's own code reads the live values through get(); server.js refreshes them on start and after every save.
let live = Object.assign({}, DEFAULTS);
function setLive(values) { live = Object.assign({}, DEFAULTS, values); }
function get(key) { return live[key]; }

/**
 * The stored values for resolve(): the sparse tune map plus the two older homes (theme, display timers), so one call gives every setting.
 */
function fromState(settings) {
  const s = settings || {}, out = Object.assign({}, s.tune || {});
  const d = s.display || {};
  ['homeSec', 'ambientSec'].forEach((k) => { if (d[k] != null) out[k] = d[k]; });
  return out;
}
/** Cleaned values split by where each one is kept: { tune, display }. */
function split(values) {
  const out = { tune: {}, display: {} };
  Object.keys(values || {}).forEach((k) => {
    const st = BY_KEY[k] && BY_KEY[k].store;
    if (st === 'display') out.display[k] = values[k]; else out.tune[k] = values[k];
  });
  return out;
}

module.exports = { SCHEMA, DEFAULTS, resolve, clean, setLive, get, fromState, split };
