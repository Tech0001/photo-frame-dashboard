'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const palettes = require('../../dashboard/js/theme-palettes.json');
const tune = require('../lib/tune');

function luminance(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4));
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
test('theme choices default to original Paper and reject unknown or arbitrary CSS', () => {
  assert.equal(tune.resolve({}).theme, 'paper');
  assert.equal(tune.resolve({ theme: 'missing' }).theme, 'paper');
  const row = tune.SCHEMA.find(r => r.key === 'theme');
  assert.deepEqual(row.options.map(o => o[0]), palettes.map(p => p.id));
  for (const p of palettes) {
    const values = tune.clean({ theme: p.id }, tune.resolve({}));
    assert.equal(tune.resolve(tune.fromState({ tune: tune.split(values).tune })).theme, p.id);
  }
  assert.throws(() => tune.clean({ theme: 'url(private)' }, tune.resolve({})), /must be one of/);
});
test('new palettes keep body text, secondary text, labels and navigation readable', () => {
  for (const p of palettes.filter(p => p.id !== 'paper')) {
    for (const foreground of ['ink', 'ink-2', 'mute']) {
      for (const background of ['paper', 'card']) {
        assert(contrast(p.colors[foreground], p.colors[background]) >= 4.5,
          p.id + ': ' + foreground + ' on ' + background);
      }
    }
    assert(contrast(p.colors.accent, p.colors['accent-ink']) >= 4.5, p.id + ': navigation');
  }
});
test('live theme updates are scoped to the stage and Paper removes every palette override', () => {
  const properties = new Map(), handlers = {};
  const stage = { dataset: {}, style: { setProperty: (k, v) => properties.set(k, v), removeProperty: k => properties.delete(k) } };
  const App = { $: selector => { assert.equal(selector, '#stage'); return stage; }, on: (name, fn) => { handlers[name] = fn; } };
  const src = fs.readFileSync(path.join(__dirname, '../../dashboard/js/themes.js'), 'utf8').replace(/^import .*;\n/, '');
  vm.runInNewContext(src, { palettes, App, window: { App } });
  handlers.tune({ theme: 'sakura-mochi' });
  assert.equal(properties.get('--accent'), '#F23888');
  assert.equal(stage.dataset.themeDark, 'true');
  assert.equal(properties.get('--r'), '26px');
  assert(properties.has('--panel-surface'));
  handlers.tune({ theme: 'autumn' });
  assert.equal(stage.dataset.themeDark, 'false');
  assert.equal(properties.has('--r'), false);
  assert.equal(properties.has('--panel-surface'), false);
  handlers.tune({ theme: 'paper' });
  assert.equal(properties.size, 0);
  handlers.tune({ theme: 'unknown' });
  assert.equal(properties.size, 0);
  assert.equal(stage.dataset.theme, 'paper');
});
