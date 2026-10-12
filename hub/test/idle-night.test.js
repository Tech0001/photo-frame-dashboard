'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function frame() {
  let tick, blocked = false, now = new Date(2026, 9, 12, 21, 59, 59);
  const stage = { dataset: {}, style: {} };
  const noop = () => {};
  const document = {
    addEventListener: noop,
    querySelector: selector => selector === '#stage' ? stage : selector === '#takeover'
      ? { classList: { contains: () => blocked } }
      : { addEventListener: noop, innerHTML: '' }
  };
  const window = { DATA: {}, innerWidth: 1280, innerHeight: 800, addEventListener: noop,
    liveBoot: async () => true };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../dashboard/js/app.js'), 'utf8'), {
    window, document, location: { hash: '#home' }, Date,
    setInterval: fn => { tick = fn; }, setTimeout: noop, clearTimeout: noop
  });
  const app = window.App;
  app.now = () => now;
  app.go = name => { app.current = name; };
  app.closeSheet = noop;
  app.on('mode', app.resetIdle);
  app.start();
  await new Promise(resolve => setImmediate(resolve));
  return { app, stage, tick: () => tick(), time: (h, m = 0, s = 0) => {
    now = new Date(2026, 9, 12, h, m, s);
  }, block: value => { blocked = value; } };
}

test('running slideshow switches at 10 PM and night clock returns to photos at 6 AM', async () => {
  const f = await frame();
  const changes = [];
  f.app.on('mode', mode => changes.push(mode));
  f.app.setMode('ambient');
  f.tick(); assert.equal(f.app.mode, 'ambient');
  f.time(22); f.tick(); assert.equal(f.stage.dataset.mode, 'night');
  f.tick(); assert.equal(changes.length, 2, 'unchanged mode does not restart overlays');
  f.time(0); f.tick(); assert.equal(f.app.mode, 'night');
  f.time(5, 59, 59); f.tick(); assert.equal(f.app.mode, 'night');
  f.time(6); f.tick(); assert.equal(f.stage.dataset.mode, 'ambient');
});

test('schedule catches up after sleep, respects takeovers, and does not interrupt dashboard use', async () => {
  const f = await frame();
  f.app.setMode('ambient');
  f.time(23, 30); f.block(true); f.tick(); assert.equal(f.app.mode, 'ambient');
  f.block(false); f.tick(); assert.equal(f.app.mode, 'night');
  f.app.setMode('day'); f.app.current = 'shopping';
  f.tick(); assert.equal(f.app.mode, 'day'); assert.equal(f.app.current, 'shopping');
  for (let i = 1; i < 120; i++) f.tick();
  assert.equal(f.app.mode, 'night');
});

test('dimmed dashboard returns to the scheduled idle display after 20 seconds', async () => {
  const f = await frame();
  f.time(5, 59, 59); f.app.setMode('nightdash');
  for (let i = 0; i < 19; i++) f.tick();
  assert.equal(f.app.mode, 'nightdash');
  f.time(6); f.tick(); assert.equal(f.app.mode, 'ambient');
  f.time(23); f.app.setMode('nightdash');
  for (let i = 0; i < 20; i++) f.tick();
  assert.equal(f.app.mode, 'night');
});
