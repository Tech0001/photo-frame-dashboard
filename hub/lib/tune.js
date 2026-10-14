'use strict';
const { problem } = require('./util');
const SCHEMA = [
  { key:'homeSec', label:'Back to Today after', type:'num', min:5, max:86400, def:60, store:'display' },
  { key:'ambientSec', label:'Start slideshow after', type:'num', min:10, max:86400, def:120, store:'display' },
  { key:'pollSec', label:'Frame checks the hub every', type:'num', min:5, max:300, def:20 },
  { key:'weatherMin', label:'Weather cache (minutes)', type:'num', min:5, max:240, def:15 },
  { key:'calendarMin', label:'Calendar cache (minutes)', type:'num', min:1, max:120, def:5 }
];
let live = {};
function fromState(settings = {}) { return { ...settings.tune, ...settings.display }; }
function resolve(input = {}) { return Object.fromEntries(SCHEMA.map(r => [r.key, input[r.key] ?? r.def])); }
function clean(input, previous = resolve()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw problem('Settings must be an object');
  const out = { ...previous };
  for (const [key,value] of Object.entries(input)) {
    const r = SCHEMA.find(row => row.key === key); if (!r) throw problem('Unknown setting: ' + key);
    if (r.type === 'select') { if (!r.options.some(option => option[0] === value)) throw problem('Invalid ' + r.label); out[key] = value; }
    else { if (value === '' || value === null || !Number.isFinite(Number(value)) || Number(value) < r.min || Number(value) > r.max) throw problem('Invalid ' + r.label); out[key] = Math.round(Number(value)); }
  }
  if (out.homeSec >= out.ambientSec) throw problem('Slideshow must start after the return to Today');
  return out;
}
function split(values) { const result = { display:{}, tune:{} }; for (const r of SCHEMA) result[r.store === 'display' ? 'display' : 'tune'][r.key] = values[r.key]; return result; }
function setLive(values) { live = values; }
function get(key) { return live[key] ?? resolve()[key]; }
module.exports = { SCHEMA, fromState, resolve, clean, split, setLive, get };
