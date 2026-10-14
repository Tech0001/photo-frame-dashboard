'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Homelab only polls while visible, every five minutes, and manual refresh bypasses cache', async () => {
  const requests = [], intervals = new Map(), events = {}, handlers = {};
  let view, click, seq = 0;
  const el = { innerHTML: '', querySelector: () => ({ scrollTop: 0 }), addEventListener: (_, fn) => { click = fn; } };
  const document = { hidden: false, addEventListener: (name, fn) => { handlers[name] = fn; } };
  const App = { live: true, current: 'home', mode: 'day', icon: () => '', esc: String, fmt: { time: () => '12:00' }, on: (name, fn) => { events[name] = fn; }, register: (_, v) => { view = v; } };
  const context = { App, document, AbortController, Date, setTimeout: () => ++seq, clearTimeout: () => {},
    setInterval: (fn, delay) => { const id = ++seq; intervals.set(id, { fn, delay }); return id; }, clearInterval: id => intervals.delete(id),
    fetch: async url => { requests.push(url); return { ok: true, json: async () => ({ configured: true, updated: new Date().toISOString(), services: [], backup: {} }) }; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../dashboard/js/views/nas.js'), 'utf8'), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  view.show(el); await settle(); assert.equal(requests.length, 0, 'prebuilding a hidden view must not check services');
  App.current = 'nas'; view.resume(); await settle(); assert.equal(requests.length, 1); assert.equal([...intervals.values()][0].delay, 300000);
  click({ target: { closest: () => ({}) } }); await settle(); assert.equal(requests.at(-1), '/api/homelab?refresh=1');
  App.mode = 'ambient'; events.mode(); await settle(); assert.equal(intervals.size, 0); assert.equal(requests.length, 2);
  App.mode = 'day'; events.mode(); await settle(); assert.equal(intervals.size, 1);
  document.hidden = true; handlers.visibilitychange(); assert.equal(intervals.size, 0);
  const before = requests.length; view.show(el); await settle(); assert.equal(requests.length, before);
  document.hidden = false; handlers.visibilitychange(); await settle(); assert.equal(intervals.size, 1);
  view.hide(); App.current = 'home'; assert.equal(intervals.size, 0);
});
