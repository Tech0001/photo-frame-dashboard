'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function load(data, live = false) {
  let html;
  const App = { live, now: () => new Date(2026, 9, 13, 23), resetIdle() {}, icon: () => '', esc: s => String(s), weatherNow: () => ({ hour: 23, temp: 12, cond: 'cloud' }), sheet: s => { html = s; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/weather-details.js'), 'utf8'), { App, window: { DATA: data } });
  return { App, html: () => html };
}
test('hourly selection uses the requested forecast day and stops at midnight', () => {
  const { App } = load({});
  const hh = { t: Array.from({ length: 168 }, (_, i) => i), c: Array(168).fill('sun'), p: Array(168).fill(0) };
  const today = App.forecastHours({ hh }, 0, 23, 24);
  assert.equal(today.length, 1);
  assert.equal(today[0].t, 23);
  const tomorrow = App.forecastHours({ hh }, 1, 0, 24);
  assert.equal(tomorrow.length, 24);
  assert.equal(tomorrow[0].t, 24);
  assert.equal(tomorrow[23].t, 47);
  assert.equal(App.forecastHours({ t: hh.t.slice(0, 24) }, 1, 0, 24).length, 0);
});
test('missing measurements remain unknown while zero rain and UV remain visible', () => {
  const loaded = load({ weather: { t: Array(24).fill(12), units: 'F', feels: null, today: { hi: 20, lo: 10, p: 0, uv: 0, rise: 6.5, set: 18.75 } } });
  loaded.App.weatherSheet();
  assert.match(loaded.html(), /Feels like<\/dt><dd>—/);
  assert.match(loaded.html(), /Rain chance<\/dt><dd>0%/);
  assert.match(loaded.html(), /UV index<\/dt><dd>0/);
  assert.match(loaded.html(), /6:30 AM/);
  assert.match(loaded.html(), /6:45 PM/);
});
test('an unavailable live forecast does not show demo weather', () => {
  const loaded = load({ weatherConfigured: true, weatherLive: false, weather: { feels: 99 } }, true);
  loaded.App.weatherSheet();
  assert.match(loaded.html(), /forecast is unavailable/);
  assert.doesNotMatch(loaded.html(), /99/);
});
