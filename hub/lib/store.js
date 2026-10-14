'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { readJson, writeJsonAtomic, problem, ymd, uid } = require('./util');
const PALETTE = { blue:'#1F6FEB', pink:'#E91E8C', green:'#009B72', amber:'#FFB000', black:'#111111' };
function colorFields(value = 'blue') {
  const color = PALETTE[value] || (/^#[0-9a-f]{6}$/i.test(value) ? value : PALETTE.blue);
  const channels = [1,3,5].map(i => parseInt(color.slice(i, i + 2), 16));
  return { color, rgb: channels.join(' '), ink: channels.reduce((s, v, i) => s + v * [.2126,.7152,.0722][i], 0) > 150 ? '#111111' : '#FFFFFF' };
}
function initial() { return { rev:0, people:[], chores:[], groceries:[], events:[], stars:{}, stores:[{ id:'grocer', name:'Groceries' }], categories:['Produce','Pantry','Household','Other'], commonItems:[], completions:{}, settings:{ display:{ homeSec:60, ambientSec:120 }, tune:{} } }; }
class Store {
  constructor(dir) {
    this.file = path.join(dir, 'state.json'); this.backupDir = path.join(dir, 'backups');
    this.state = { ...initial(), ...readJson(this.file, initial()) };
    for (const key of ['people','chores','groceries','events','stores','categories','commonItems']) if (!Array.isArray(this.state[key])) throw problem('Invalid stored ' + key, 500);
    this.state.settings = { display:{homeSec:60,ambientSec:120}, tune:{}, ...this.state.settings };
  }
  update(change) {
    const next = structuredClone(this.state); change(next); next.rev = (this.state.rev || 0) + 1;
    if (fs.existsSync(this.file)) {
      fs.mkdirSync(this.backupDir, { recursive:true, mode:0o700 });
      fs.copyFileSync(this.file, path.join(this.backupDir, Date.now() + '-' + uid('state-') + '.json'));
      const files = fs.readdirSync(this.backupDir).sort(); for (const name of files.slice(0, Math.max(0, files.length - 20))) fs.unlinkSync(path.join(this.backupDir, name));
    }
    writeJsonAtomic(this.file, next); this.state = next; return next;
  }
  peopleOut() { return this.state.people.map(p => ({ ...p, ...colorFields(p.color), home:p.home !== false, status:p.status || '' })); }
  choresToday(date = new Date()) {
    const dow = date.getDay(), done = (this.state.completions || {})[ymd(date)] || {};
    return this.state.chores.filter(c => !Array.isArray(c.days) || c.days.includes(dow)).map(c => ({ ...c, r:c.r || c.routine || 'anytime', who:c.who || 'any', title:c.title || c.name, done:Object.hasOwn(done,c.id) ? !!done[c.id] : c.doneOn === ymd(date), emoji:c.emoji || '', stars:c.stars || 0 }));
  }
  toggleChore(id, done) {
    if (!this.state.chores.some(c => c.id === id)) return false;
    this.update(s => { const day = ymd(); s.completions ||= {}; s.completions[day] ||= {}; s.completions[day][id] = done; }); return true;
  }
  restore(name) {
    if (!/^[A-Za-z0-9.-]+\.json$/.test(name)) throw problem('Invalid backup name');
    const restored = readJson(path.join(this.backupDir, name), null); if (!restored || !Array.isArray(restored.people) || !Array.isArray(restored.chores)) throw problem('Invalid backup');
    this.update(s => Object.assign(s, restored));
  }
}
function list(value, key) { if (!Array.isArray(value) || value.length > 500) throw problem(key + ' must be a list of up to 500 items'); return value; }
function cleanRecords(value, key) {
  return list(value, key).map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw problem('Invalid ' + key + ' entry');
    const out = { ...record, id:String(record.id || uid(key[0])) };
    if (['__proto__','constructor','prototype'].includes(out.id) || !/^[a-zA-Z0-9_-]{1,80}$/.test(out.id)) throw problem('Invalid identifier');
    if (key === 'people' || key === 'stores') { out.name = String(record.name || '').trim().slice(0,80); if (!out.name) throw problem('Name is required'); }
    else if (key === 'events') { out.title = String(record.title || '').trim().slice(0,200); if (!out.title || !/^\d{4}-\d{2}-\d{2}$/.test(record.date || '')) throw problem('Event needs a title and date'); }
    else { out.name = String(record.name || record.title || '').trim().slice(0,160); if (!out.name) throw problem('Name is required'); }
    return out;
  });
}
module.exports = { Store, PALETTE, colorFields, cleanRecords };
