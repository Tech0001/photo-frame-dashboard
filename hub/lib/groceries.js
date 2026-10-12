'use strict';
const { uid } = require('./util');
const DEFAULT_COMMON = require('./grocery-catalog.json');
const DEFAULT_CATEGORIES = ['Produce', 'Bakery', 'Meat & Fish', 'Dairy & Eggs', 'Pantry', 'Frozen', 'Snacks', 'Household', 'Other'];
const bad = (message) => Object.assign(new Error(message), { userError: true });
const text = (value, limit) => String(value == null ? '' : value).trim().slice(0, limit);

function categoriesFor(state) {
  return [...new Set([...(state.categories || DEFAULT_CATEGORIES), ...(state.groceries || []).map(g => g.cat).filter(Boolean)])];
}
function cleanStores(stores) {
  if (!Array.isArray(stores) || !stores.length || stores.length > 8) throw bad('Keep between 1 and 8 stores.');
  const result = stores.map(s => ({ id: text(s.id, 40), name: text(s.name, 30) }));
  if (result.some(s => !/^[a-z0-9]+$/.test(s.id) || s.id === 'all' || !s.name)) throw bad('Every store needs a name and a valid identifier.');
  if (new Set(result.map(s => s.id)).size !== result.length || new Set(result.map(s => s.name.toLowerCase())).size !== result.length) throw bad('Store names must be unique.');
  return result;
}
function cleanCategories(categories) {
  if (!Array.isArray(categories) || !categories.length || categories.length > 32) throw bad('Keep between 1 and 32 categories.');
  const result = categories.map(c => text(c, 40));
  if (result.some(c => !c) || new Set(result.map(c => c.toLowerCase())).size !== result.length) throw bad('Category names must be nonempty and unique.');
  return result;
}
function cleanItems(items) {
  if (!Array.isArray(items) || items.length > 500) throw bad('Use a list of up to 500 grocery items.');
  return items.filter(g => g && text(g.name, 80)).map(g => ({
    id: /^[a-zA-Z0-9_-]{1,40}$/.test(g.id || '') ? g.id : uid('g'), name: text(g.name, 80),
    cat: text(g.cat, 40), qty: Math.max(1, Math.min(99, +g.qty || 1)), store: text(g.store, 40),
    done: !!g.done, note: text(g.note, 120)
  }));
}
function commonFor(state) {
  if (Array.isArray(state.commonItems)) return state.commonItems;
  const categories = categoriesFor(state), fallback = categories.includes('Other') ? 'Other' : categories[0];
  return DEFAULT_COMMON.map(item => ({ ...item, cat: categories.includes(item.cat) ? item.cat : fallback }));
}
function cleanCommon(items, categories) {
  if (!Array.isArray(items) || items.length > 500) throw bad('Use up to 500 common items.');
  const result = items.filter(item => item && text(item.name, 80)).map(item => ({
    id: /^[a-zA-Z0-9_-]{1,40}$/.test(item.id || '') ? item.id : uid('c'), name: text(item.name, 80), cat: text(item.cat, 40), usual: !!item.usual
  }));
  if (new Set(result.map(item => item.name.toLowerCase())).size !== result.length || new Set(result.map(item => item.id)).size !== result.length) throw bad('Common item names and identifiers must be unique.');
  if (result.some(item => !categories.includes(item.cat))) throw bad('A category still has common items. Move those items first.');
  return result;
}
function mergeItems(state, items, base) {
  if (!Array.isArray(base)) return items; // Older clients replace the list.
  const known = new Set(base), included = new Set(items.map(g => g.id));
  return items.concat(state.groceries.filter(g => !known.has(g.id) && !included.has(g.id)));
}
function frameItems(state, body) {
  const categories = categoriesFor(state), stores = state.stores, previous = new Map(state.groceries.map(g => [g.id, g]));
  const items = cleanItems(body.items).map(g => {
    const old = previous.get(g.id);
    if (!categories.includes(g.cat)) g.cat = old && categories.includes(old.cat) ? old.cat : categories.includes('Other') ? 'Other' : categories[0];
    if (!stores.some(s => s.id === g.store)) g.store = old && stores.some(s => s.id === old.store) ? old.store : stores[0].id;
    return g;
  });
  return mergeItems(state, items, body.base);
}
function adminUpdate(state, body) {
  const stores = cleanStores(body.stores), categories = cleanCategories(body.categories);
  const groceries = mergeItems(state, cleanItems(body.items), body.base);
  if (groceries.some(g => !stores.some(s => s.id === g.store))) throw bad('A store still has items. Move those items to another store first.');
  if (groceries.some(g => !categories.includes(g.cat))) throw bad('A category still has items. Move them first, or reload if another device added items while you were editing.');
  const commonItems = body.commonItems === undefined ? commonFor(state).map(item => ({ ...item, cat: categories.includes(item.cat) ? item.cat : categories[0] })) : cleanCommon(body.commonItems, categories);
  return { stores, categories, groceries, commonItems };
}
module.exports = { DEFAULT_CATEGORIES, categoriesFor, commonFor, cleanStores, frameItems, adminUpdate };
