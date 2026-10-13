'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const App = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../dashboard/js/art-palette.js'), 'utf8'), { App });
test('art colors ignore transparent pixels and keep dark backgrounds with readable light text', () => {
  const red = App.artPalette([255,0,0,255]), transparent = App.artPalette([255,0,0,255,0,255,0,0]);
  assert.equal(JSON.stringify(red), JSON.stringify(transparent));
  for (const pixels of [[],[0,0,0,255],[255,255,255,255],[255,0,0,255],[0,0,255,255]]) {
    const colors=App.artPalette(pixels), channels=s=>s.match(/\d+/g).map(Number);
    assert(channels(colors.background).every(c=>c<=53));
    assert(channels(colors.ink).every(c=>c>=232 && c<=255));
    assert(channels(colors.note).every(c=>c>=224 && c<=255));
  }
  assert.notEqual(red.background,App.artPalette([0,0,255,255]).background);
});
