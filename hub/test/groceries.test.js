'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const groceries = require('../lib/groceries');
const { Store } = require('../lib/store');
const item = (id, cat = 'Pantry', store = 'grocer') => ({ id, name: 'Feed', cat, store, qty: 1 });
const state = () => ({ stores: [{ id: 'grocer', name: 'Grocery store' }], categories: ['Pantry', 'Other'], groceries: [item('g1')] });

test('custom categories, stores and assigned items persist across a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-groceries-'));
  try {
    const store = new Store(dir), body = { stores: [...store.state.stores, { id: 'farm', name: 'Farm supply' }], categories: [...store.state.categories, 'Ducks & chickens'], items: [item('feed', 'Ducks & chickens', 'farm')] };
    store.update(s => Object.assign(s, groceries.adminUpdate(s, body)));
    const loaded = new Store(dir);
    assert(loaded.state.categories.includes('Ducks & chickens'));
    assert.equal(loaded.state.stores.at(-1).name, 'Farm supply');
    assert.equal(loaded.state.groceries[0].store, 'farm');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('invalid category or store edits cannot partially replace the list', () => {
  const s = state(), original = JSON.stringify(s), body = { stores: s.stores, categories: ['Other'], items: s.groceries };
  assert.throws(() => groceries.adminUpdate(s, body), /category still has items/);
  assert.throws(() => groceries.adminUpdate(s, { ...body, categories: ['Pantry', 'pantry'] }), /unique/);
  assert.throws(() => groceries.adminUpdate(s, { ...body, stores: [] }), /between 1 and 8/);
  assert.throws(() => groceries.cleanStores([{ id: 'one', name: 'Shop' }, { id: 'two', name: 'shop' }]), /unique/);
  assert.equal(JSON.stringify(s), original);
});
test('admin saves retain items added elsewhere since the list was opened', () => {
  const s = state(); s.groceries.push(item('concurrent'));
  const saved = groceries.adminUpdate(s, { stores: s.stores, categories: s.categories, items: [], base: ['g1'] });
  assert.deepEqual(saved.groceries.map(g => g.id), ['concurrent']);
});
test('old tablet categories and removed stores resolve to the current assignment', () => {
  const s = state(); s.categories = ['Feed & supplies']; s.stores = [{ id: 'farm', name: 'Farm supply' }]; s.groceries = [item('g1', 'Feed & supplies', 'farm')];
  const saved = groceries.frameItems(s, { items: [item('g1'), item('g2')], base: ['g1'] });
  assert(saved.every(g => g.cat === 'Feed & supplies' && g.store === 'farm'));
});
test('legacy grocery categories remain visible when defaults are introduced', () => {
  assert(groceries.categoriesFor({ groceries: [item('old', 'Garden')] }).includes('Garden'));
});
test('common items persist independently from shopping entries and an empty list stays empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-common-'));
  try {
    const store = new Store(dir), original = JSON.stringify(store.state.groceries);
    const body = { stores: store.state.stores, categories: store.state.categories, items: store.state.groceries, commonItems: [{ id: 'feed', name: 'Chicken feed', cat: 'Other', usual: true }] };
    store.update(s => Object.assign(s, groceries.adminUpdate(s, body)));
    assert.equal(JSON.stringify(store.state.groceries), original);
    assert.deepEqual(new Store(dir).state.commonItems, body.commonItems);
    store.update(s => Object.assign(s, groceries.adminUpdate(s, { ...body, commonItems: [] })));
    assert.deepEqual(new Store(dir).state.commonItems, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('common item validation blocks duplicate names and removed category assignments', () => {
  const s = state(), body = { stores: s.stores, categories: s.categories, items: s.groceries, commonItems: [{ id: 'one', name: 'Coffee', cat: 'Pantry', usual: true }] };
  assert.throws(() => groceries.adminUpdate(s, { ...body, commonItems: [...body.commonItems, { id: 'two', name: 'coffee', cat: 'Pantry' }] }), /unique/);
  assert.throws(() => groceries.adminUpdate(s, { ...body, commonItems: [{ id: 'one', name: 'Coffee', cat: 'Removed' }] }), /common items/);
  const saved = groceries.adminUpdate(s, body);
  s.commonItems = saved.commonItems;
  groceries.frameItems(s, { items: [], base: ['g1'] });
  assert.deepEqual(s.commonItems, body.commonItems);
});
