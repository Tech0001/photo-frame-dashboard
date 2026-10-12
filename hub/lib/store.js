'use strict';
// Everything you edit lives in one JSON file (data/state.json): people, chores, groceries, events.
const path = require('path');
const { categoriesFor } = require('./groceries');
const { readJson, writeJsonAtomic, ymd, uid } = require('./util');

const PALETTE = {
  black: { color: '#111111', rgb: '17 17 17', ink: '#FFFFFF' },
  purple: { color: '#8957E5', rgb: '137 87 229', ink: '#FFFFFF' },
  red: { color: '#E5252A', rgb: '229 37 42', ink: '#FFFFFF' },
  blue: { color: '#2D5BFF', rgb: '45 91 255', ink: '#FFFFFF' },
  green: { color: '#00A36C', rgb: '0 163 108', ink: '#FFFFFF' },
  yellow: { color: '#FFB000', rgb: '255 176 0', ink: '#111111' },
  pink: { color: '#E4007C', rgb: '228 0 124', ink: '#FFFFFF' },
  orange: { color: '#FF6A13', rgb: '255 106 19', ink: '#FFFFFF' }
};

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function inkFor(hex) {
  const c = hexToRgb(hex);
  if (!c) return '#FFFFFF';
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 150 ? '#111111' : '#FFFFFF';
}
function colorFields(color) {
  if (PALETTE[color]) return PALETTE[color];
  const c = hexToRgb(color);
  if (!c) return PALETTE.blue;
  return { color: color[0] === '#' ? color : '#' + color, rgb: c.join(' '), ink: inkFor(color) };
}

function seed() {
  const g = (name, cat, qty, store, note) => ({ id: uid('g'), name, cat, qty: qty || 1, store: store || 'grocer', done: false, note: note || '' });
  const ch = (r, who, title, emoji, stars, days) => ({ id: uid('c'), r, who, title, emoji, stars: stars || 0, days: days || null, doneOn: null });
  return {
    rev: 1,
    people: [
      { id: 'alex', name: 'Alex', color: 'black', kid: false },
      { id: 'jordan', name: 'Jordan', color: 'purple', kid: false },
      { id: 'maya', name: 'Maya', color: 'red', kid: false }
    ],
    // Starter chores. Edit them at /admin. days = weekdays (0 = Sunday) or null for every day.
    chores: [
      ch('morning', 'alex', 'Make coffee', '☕', 0),
      ch('morning', 'jordan', 'Pack lunches', '🥪', 0),
      ch('morning', 'maya', 'Make bed', '🛏️', 1),
      ch('morning', 'any', 'Feed the pets', '🐾', 1),
      ch('after', 'alex', 'Take out recycling', '♻️', 0, [2, 5]),
      ch('after', 'jordan', 'Fold laundry', '👕', 0),
      ch('after', 'maya', 'Homework', '📚', 2),
      ch('after', 'any', 'Water the plants', '🌱', 1),
      ch('evening', 'alex', 'Lock up', '🔐', 0),
      ch('evening', 'jordan', 'Run dishwasher', '🍽️', 0),
      ch('evening', 'maya', 'Tidy room', '🏠', 1),
      ch('evening', 'any', 'Wipe counters', '✨', 1)
    ],
    groceries: [
      g('Milk', 'Dairy & Eggs', 1), g('Eggs', 'Dairy & Eggs', 1), g('Bananas', 'Produce', 1),
      g('Bread', 'Bakery', 1), g('Coffee beans', 'Pantry', 1)
    ],
    stores: [{ id: 'grocer', name: 'Grocery store' }, { id: 'costco', name: 'Costco' }],
    events: [],         // manual events, see /admin
    stars: {},          // { personId: total } for people marked kid
    history: {},        // { 'YYYY-MM-DD': { personId: { done, total } } }
    settings: { display: { homeSec: 60, ambientSec: 120 } }   // display = idle timers in seconds
  };
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'state.json');
    this.state = readJson(this.file, null);
    if (!this.state) { this.state = seed(); this.flush(); }
    this.normalize();
  }
  /** Forward-compatible defaults: older files get any section added since they were written. */
  normalize() {
    const s = this.state;
    s.events = s.events || []; s.history = s.history || {}; s.stars = s.stars || {};
    s.stores = s.stores && s.stores.length ? s.stores : [{ id: 'grocer', name: 'Grocery store' }];
    s.categories = categoriesFor(s);
    s.settings = s.settings || {};
    s.settings.display = Object.assign({ homeSec: 60, ambientSec: 120 }, s.settings.display || {});
    // tunable values (lib/tune.js)
    s.settings.tune = s.settings.tune || {};
  }
  /** Replace everything with a backed-up copy. What is here now is kept first, so the restore can itself be undone. */
  restore(obj) {
    if (!obj || !Array.isArray(obj.people) || !Array.isArray(obj.chores) || !Array.isArray(obj.groceries) || typeof obj.settings !== 'object') throw Object.assign(new Error('That backup is not a Frame state file'), { userError: true });
    require('./backup').snapshot(this.file, true);
    const rev = (this.state.rev || 0) + 1;
    this.state = obj; this.state.rev = rev;
    this.normalize(); this.recordToday(); this.flush();
  }
  flush() { writeJsonAtomic(this.file, this.state); }
  /** Apply a mutation, bump the revision and save. */
  update(fn) { fn(this.state); this.state.rev++; this.recordToday(); this.flush(); return this.state.rev; }

  today() { return ymd(new Date()); }

  /** Chores that apply today, with `done` resolved from doneOn. */
  choresToday() {
    const t = this.today(), dow = new Date().getDay();
    return this.state.chores
      .filter((c) => !c.days || c.days.length === 0 || c.days.indexOf(dow) > -1)
      .map((c) => ({ id: c.id, r: c.r, who: c.who, title: c.title, emoji: c.emoji, stars: c.stars || 0, done: c.doneOn === t }));
  }

  recordToday() {
    const t = this.today(), per = {};
    this.choresToday().forEach((c) => {
      if (c.who === 'any') return;
      const p = per[c.who] || (per[c.who] = { done: 0, total: 0 });
      p.total++; if (c.done) p.done++;
    });
    this.state.history[t] = per;
    // keep ~60 days
    const keys = Object.keys(this.state.history).sort();
    while (keys.length > 60) delete this.state.history[keys.shift()];
  }

  /** Mon..Sun for the current week: 1 all done, 0 missed, null future/none. */
  weekFor(pid) {
    const now = new Date(), dow = (now.getDay() + 6) % 7; // Mon = 0
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now); d.setDate(now.getDate() - dow + i);
      const key = ymd(d), h = this.state.history[key] && this.state.history[key][pid];
      if (i > dow || !h || !h.total) out.push(null);   // future day, or nothing was scheduled
      else out.push(h.done >= h.total ? 1 : 0);
    }
    return out;
  }

  toggleChore(id, done) {
    const c = this.state.chores.find((x) => x.id === id);
    if (!c) return false;
    const t = this.today(), was = c.doneOn === t;
    if (!!done === was) return true;
    this.update((s) => {
      c.doneOn = done ? t : null;
      if (c.who !== 'any' && (c.stars || 0) > 0) {
        const p = s.people.find((x) => x.id === c.who);
        if (p && p.kid) s.stars[c.who] = Math.max(0, (s.stars[c.who] || 0) + (done ? c.stars : -c.stars));
      }
    });
    return true;
  }

  /** People with colour fields resolved the way the dashboard wants them. */
  peopleOut() {
    return this.state.people.map((p) => Object.assign({
      id: p.id, name: p.name, age: p.age || undefined, kid: !!p.kid,
      home: false, status: p.status || ''
    }, colorFields(p.color)));
  }
}

module.exports = { Store, PALETTE, colorFields };
