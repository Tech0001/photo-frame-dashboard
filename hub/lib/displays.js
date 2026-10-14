'use strict';
const crypto = require('node:crypto');
const {problem} = require('./util');
const TABS = ['home','calendar','tasks','shopping','photos','control','nas','agents','spotify','voice'];
const DISPLAY_KEYS = ['homeSec','ambientSec','theme'];
const id = value => { if(typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value) || ['__proto__','constructor','prototype'].includes(value))throw problem('Invalid display or profile ID');return value; };
class Displays {
  constructor(store,tune,defaults) { this.store=store;this.tune=tune;this.defaults=defaults;this.seen=new Map(); }
  profiles() { return this.store.state.settings.profiles || {}; }
  devices() { return this.store.state.settings.displays || {}; }
  settings(displayId) { const device=this.devices()[displayId], profile=device&&this.profiles()[device.profile];return {...this.defaults(),...profile?.values}; }
  profile(displayId) { const device=this.devices()[displayId], p=device&&this.profiles()[device.profile];return p ? {id:device.profile,name:p.name,tabs:p.tabs.slice()} : null; }
  register(input,ip) {
    const key=id(input.id), existing=this.devices()[key];
    const kind=['frame','echo','browser'].includes(input.kind)?input.kind:'browser';
    const capabilities={microphone:input.capabilities?.microphone===true,spotify:input.capabilities?.spotify===true};
    if(!existing) {
      if(Object.keys(this.devices()).length>=50)throw problem('Too many displays');
      this.store.update(s=>{
        s.settings.profiles ||= {};
        for(const [key,name,tabs] of [['household','Household',TABS.filter(t=>!['nas','agents','spotify','voice'].includes(t))],['personal','Personal',TABS]]) {
          if(!s.settings.profiles[key])s.settings.profiles[key]={name,tabs,values:Object.fromEntries(DISPLAY_KEYS.filter(k=>this.defaults()[k]!=null).map(k=>[k,this.defaults()[k]]))};
        }
        s.settings.displays ||= {};s.settings.displays[key]={name:String(input.name|| (kind==='echo'?'Echo Show':kind==='frame'?'Picture frame':'Browser')).slice(0,80),kind,capabilities,profile:kind==='frame'?'household':'personal'};
      });
    } else if(JSON.stringify(existing.capabilities)!==JSON.stringify(capabilities)||existing.kind!==kind) {
      this.store.update(s=>{s.settings.displays[key].capabilities=capabilities;s.settings.displays[key].kind=kind;});
    }
    this.touch(key,ip);return {id:key,profile:this.profile(key)};
  }
  touch(key,ip) { if(key&&this.devices()[key])this.seen.set(key,{at:new Date().toISOString(),ip:String(ip||'').replace(/^::ffff:/,'')}); }
  view() { return {tabs:TABS,profiles:this.profiles(),displays:Object.entries(this.devices()).map(([key,d])=>({id:key,...d,lastSeen:this.seen.get(key)?.at||null,address:this.seen.get(key)?.ip||'',online:!!this.seen.get(key)&&Date.now()-Date.parse(this.seen.get(key).at)<90000}))}; }
  saveProfile(key,input) {
    id(key);if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>80)throw problem('Profile name is required');
    if(!Array.isArray(input.tabs)||!input.tabs.includes('home')||input.tabs.some(t=>!TABS.includes(t))||new Set(input.tabs).size!==input.tabs.length)throw problem('Choose valid tabs including Today');
    const current=this.profiles()[key]?.values||this.defaults();
    if(!input.values||Object.keys(input.values).some(k=>!DISPLAY_KEYS.includes(k)))throw problem('Only display settings belong in a profile');
    const clean=this.tune.clean(input.values,{...this.defaults(),...current});
    const values=Object.fromEntries(DISPLAY_KEYS.filter(k=>clean[k]!=null).map(k=>[k,clean[k]]));
    if(!this.profiles()[key]&&Object.keys(this.profiles()).length>=20)throw problem('Too many profiles');
    this.store.update(s=>{s.settings.profiles ||= {};s.settings.profiles[key]={name:input.name.trim(),tabs:input.tabs.slice(),values};});return this.view();
  }
  assign(key,input) { id(key);if(!this.devices()[key]||!this.profiles()[input.profile])throw problem('Choose an existing display and profile');if(input.name!=null&&(typeof input.name!=='string'||!input.name.trim()||input.name.length>80))throw problem('Display name is required');this.store.update(s=>{s.settings.displays[key].profile=input.profile;if(input.name)s.settings.displays[key].name=input.name.trim();});return this.view(); }
  swap(a,b) {id(a);id(b);if(a===b||!this.devices()[a]||!this.devices()[b])throw problem('Choose two different displays');this.store.update(s=>{const p=s.settings.displays[a].profile;s.settings.displays[a].profile=s.settings.displays[b].profile;s.settings.displays[b].profile=p;});return this.view();}
  token(key,secret) { return crypto.createHmac('sha256',secret).update(key||'global').digest('hex'); }
}
module.exports={Displays,TABS,DISPLAY_KEYS};
