'use strict';
const path = require('node:path');
const { problem, readJson, writeJsonAtomic } = require('./util');
const ids = new Set(['codex','claude','openrouter']);
function cleanService(row) {
  if (!row || !ids.has(row.id)) throw problem('Unknown account provider');
  const text = (v,n = 80) => String(v || '').slice(0,n);
  const meters = (row.meters || []).slice(0,4).map(m => {
    if (!Number.isFinite(m.used) || m.used < 0 || m.used > 100 || !Number.isFinite(m.win) || m.win <= 0) throw problem('Invalid usage window');
    return {label:text(m.label),used:m.used,win:m.win,leftMin:Number.isFinite(m.leftMin) ? Math.max(0,m.leftMin):null,resetAt:Number.isFinite(m.resetAt) ? m.resetAt:null};
  });
  const credits = row.kind === 'credits' && row.credits ? Object.fromEntries(['daily','weekly','monthly','total','limit','remaining','accountRemaining'].map(key=>[key,Number.isFinite(row.credits[key]) ? row.credits[key]:null])):null;
  if (credits) credits.accountError = text(row.credits.accountError,180);
  return {id:row.id,name:text(row.name),plan:text(row.plan),color:/^#[0-9a-f]{6}$/i.test(row.color || '') ? row.color:'#888888',kind:row.kind === 'credits' ? 'credits':'limits',unofficial:!!row.unofficial,meters,credits,error:text(row.error,180)};
}
class AgentsStore {
  constructor(dir) { this.file = path.join(dir,'agents.json'); this.data = readJson(this.file,{services:{},requestedAt:null}); }
  commit(next) { writeJsonAtomic(this.file,next); this.data = next; }
  get() { return {services:Object.values(this.data.services),requestedAt:this.data.requestedAt}; }
  request() { if (Date.now() - Date.parse(this.data.requestedAt || '') > 5000 || !this.data.requestedAt) this.commit({...this.data,requestedAt:new Date().toISOString()}); return this.data.requestedAt; }
  setService(service,error,source = 'hub') {
    const row = cleanService({...service,error}), previous = this.data.services[row.id];
    if (error && previous) Object.assign(row,{meters:previous.meters,credits:previous.credits,updated:previous.updated,errorAt:new Date().toISOString()}); else Object.assign(row,{updated:error ? null:new Date().toISOString(),errorAt:error ? new Date().toISOString():null});
    this.commit({...this.data,services:{...this.data.services,[row.id]:{...row,source}}});
  }
  update(payload) {
    if (!Array.isArray(payload?.services) || !payload.services.length || payload.services.length > 3) throw problem('Send up to three account services');
    const rows = payload.services.map(cleanService); if (new Set(rows.map(r=>r.id)).size !== rows.length) throw problem('Duplicate providers');
    const next = structuredClone(this.data);for (const row of rows) next.services[row.id] = {...row,updated:new Date().toISOString(),source:'collector'};this.commit(next);
  }
  removeLinkedService(id) { const next = structuredClone(this.data);delete next.services[id];this.commit(next); }
}
module.exports = { AgentsStore, cleanService };
