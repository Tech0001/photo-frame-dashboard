'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHub } = require('../server');
const { Store } = require('../lib/store');
const { manualEvents } = require('../lib/calendar');
const { transform, createWeather } = require('../lib/weather');
const { Photos } = require('../lib/photos');
const { ymd } = require('../lib/util');
const sharp = require('sharp');
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'frame-hub-test-'));
  const cfg = {timezone:'UTC',host:'127.0.0.1',port:0,dataDir:path.join(dir,'data'),cacheDir:path.join(dir,'cache'),photosDir:path.join(dir,'photos'),dashboardDir:path.join(dir,'dashboard'),calendars:[],weather:null};
  await fs.mkdir(cfg.dashboardDir); await fs.writeFile(path.join(cfg.dashboardDir,'index.html'),'test dashboard');
  const hub = createHub({loaded:{cfg,secrets:{admin_password:'test-password'},cfgFile:path.join(dir,'config.json'),secFile:path.join(dir,'secrets.json')},plugins:[]});
  await new Promise(resolve => hub.server.listen(0,'127.0.0.1',resolve));
  t.after(async () => { await new Promise(resolve => hub.server.close(resolve)); await fs.rm(dir,{recursive:true,force:true}); });
  const url = 'http://127.0.0.1:' + hub.server.address().port;
  const admin = {authorization:'Basic ' + Buffer.from('admin:test-password').toString('base64')};
  const request = async (endpoint,method = 'GET',body,headers = {}) => { const response = await fetch(url + endpoint,{method,headers:{...(body ? {'Content-Type':'application/json'}:{}),...headers},body:body ? JSON.stringify(body):undefined});return {status:response.status,data:await response.json()}; };
  return {hub,cfg,dir,url,admin,request};
}
test('empty setup serves dashboard, protects administration, and never returns credentials',async t => {
  const {url,request,admin} = await setup(t);
  assert.equal(await (await fetch(url)).text(),'test dashboard');
  assert.equal((await request('/api/admin/data')).status,401);
  const state = await request('/api/state'); assert.deepEqual(state.data.people,[]); assert.equal(state.data.weather,null);
  const connections = await request('/api/admin/connections','GET',undefined,admin);
  assert.equal(connections.status,200); assert(!JSON.stringify(connections.data).includes('test-password'));
});
test('household edits persist, chore completion is dated, and invalid edits do not replace state',async t => {
  const {request,admin,hub,cfg} = await setup(t);
  assert.equal((await request('/api/admin/people','PUT',{people:[{id:'adult',name:'Adult',color:'green'}]},admin)).status,200);
  assert.equal((await request('/api/admin/chores','PUT',{chores:[{id:'dishes',name:'Dishes',who:'adult',r:'anytime'}]},admin)).status,200);
  assert.equal((await request('/api/chores/toggle','POST',{id:'dishes',done:true})).status,200);
  assert.equal((await request('/api/state')).data.chores[0].done,true);
  assert.equal(new Store(cfg.dataDir).choresToday()[0].done,true);
  const before = hub.ctx.store.state.rev;
  assert.equal((await request('/api/admin/people','PUT',{people:[{id:'a',name:''}]},admin)).status,400);
  assert.equal(hub.ctx.store.state.rev,before);
  assert.equal((await request('/api/chores/toggle','POST',{id:'missing',done:true})).status,404);
});
test('cross-origin writes and out-of-scope display settings are rejected',async t => {
  const {request,url} = await setup(t);
  assert.equal((await request('/api/groceries','PUT',{items:[]},{origin:'https://foreign.example'})).status,403);
  const display = await request('/api/display-settings');
  assert.equal((await request('/api/display-settings','PUT',{values:{homeSec:60,ambientSec:180}},{'x-display-token':display.data.token,origin:url})).status,200);
  assert.equal((await request('/api/display-settings','PUT',{values:{pollSec:10}},{'x-display-token':display.data.token})).status,400);
  assert.equal((await request('/api/display-settings','PUT',{values:{homeSec:300,ambientSec:60}},{'x-display-token':display.data.token})).status,400);
  assert.equal((await request('/api/display-settings','PUT',{values:{homeSec:30}})).status,403);
});
test('concurrent grocery additions survive a client editing an older list',async t => {
  const {request} = await setup(t);
  await request('/api/groceries','PUT',{items:[{id:'a',name:'Apples'}],base:[]});
  await request('/api/groceries','PUT',{items:[{id:'b',name:'Bread'}],base:[]});
  const groceries = (await request('/api/state')).data.groceries;
  assert.deepEqual(new Set(groceries.map(g=>g.id)),new Set(['a','b']));
});
test('backup restores previous state and preserves a backup of the current state',async t => {
  const {request,admin} = await setup(t);
  await request('/api/admin/people','PUT',{people:[{id:'a',name:'First'}]},admin);
  await request('/api/admin/people','PUT',{people:[{id:'a',name:'Second'}]},admin);
  const backup = (await request('/api/admin/backups','GET',undefined,admin)).data.state[0];
  assert.equal((await request('/api/admin/restore','POST',{name:backup},admin)).status,200);
  assert.equal((await request('/api/state')).data.people[0].name,'First');
});
test('corrupt saved state fails closed instead of overwriting household data',async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'hub-corrupt-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.writeFile(path.join(dir,'state.json'),'{broken');
  assert.throws(()=>new Store(dir),/Cannot read JSON/);
  assert.equal(await fs.readFile(path.join(dir,'state.json'),'utf8'),'{broken');
});
test('calendar repeats are bounded, exclusions apply, and all-day entries retain their dates',() => {
  const events = manualEvents([{id:'weekly',title:'Weekly',date:'2026-10-01',start:'09:00',end:'10:00',repeat:'weekly',until:'2026-10-10'},{id:'all',title:'All day',date:'2026-10-03',allDay:true}],new Date('2026-10-01'),new Date('2026-10-20'));
  assert.equal(events.filter(e=>e.title==='Weekly').length,2);
  const all = events.find(e=>e.allDay);assert.equal(all.start,'2026-10-03T00:00:00.000Z');assert.equal(all.end,'2026-10-04T00:00:00.000Z');
});
function forecast() {
  const date = ymd(); return {current:{apparent_temperature:0,relative_humidity_2m:50,wind_speed_10m:3,wind_gusts_10m:7},daily:{time:[date],temperature_2m_max:[15],temperature_2m_min:[0],weather_code:[3],precipitation_probability_max:[0],uv_index_max:[0],sunrise:[date+'T07:30'],sunset:[date+'T18:15']},hourly:{time:Array.from({length:24},(_,i)=>date+'T'+String(i).padStart(2,'0')+':00'),temperature_2m:Array(24).fill(10),weather_code:Array(24).fill(0),is_day:Array(24).fill(1),precipitation_probability:Array(24).fill(0)}};
}
test('forecast keeps zero readings and solar minutes, caches requests and visibly marks stale fallback',async () => {
  const j = forecast(), mapped = transform(j,{weather:{units:'c'}});assert.equal(mapped.feels,0);assert.equal(mapped.today.uv,0);assert.equal(mapped.today.rise,7.5);assert.equal(mapped.today.set,18.25);
  let calls = 0;const get = createWeather(async()=>{calls++;if(calls>1)throw Error('offline');return {ok:true,json:async()=>j};});const cfg={timezone:'UTC',weather:{lat:1,lon:2,units:'c'}};
  await get(cfg);await get(cfg);assert.equal(calls,1);const stale = await get(cfg,true);assert.equal(stale.stale,true);assert.equal(stale.t[0],10);
});
test('photo serving ignores symlinks, resizes valid photos, and rejects forged IDs',async t => {
  const {cfg,dir} = await setup(t);await fs.mkdir(cfg.photosDir);
  const bytes = await sharp({create:{width:800,height:400,channels:3,background:'#eeccbb'}}).png().toBuffer();
  await fs.writeFile(path.join(cfg.photosDir,'photo.png'),bytes);await fs.writeFile(path.join(dir,'outside.png'),bytes);await fs.symlink(path.join(dir,'outside.png'),path.join(cfg.photosDir,'escape.png'));
  const library = new Photos(cfg), images = await library.scan();assert.equal(images.length,1);assert.equal(images[0].o,'l');assert.equal(await library.sized('../outside'),null);
  const resized = await library.sized(images[0].id,320), meta = await sharp(resized.file).metadata();assert.equal(meta.width,320);
  await assert.rejects(()=>library.upload(Buffer.from('not-image'),'invalid.png'),/Unsupported image/);
});
test('iCal feeds expand recurring events, respect exclusions and reuse the cached document',async()=>{
 const {createCalendar}=require('../lib/calendar');let reads=0;
 const ics='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:weekly-test\r\nDTSTART:20261015T090000Z\r\nDTEND:20261015T100000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEXDATE:20261022T090000Z\r\nSUMMARY:Weekly appointment\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
 const reader=createCalendar(async()=>{reads++;return new Response(ics,{status:200});});
 const input={cfg:{calendars:[{name:'Calendar',secret:'feed',people:['adult']}]},secrets:{ical:{feed:'https://calendar.example/private-feed'}},state:{events:[]},from:new Date('2026-10-01'),to:new Date('2026-11-01')};
 const data=await reader(input);assert.equal(data.events.length,2);assert.equal(data.events[0].start,'2026-10-15T09:00:00.000Z');assert.deepEqual(data.events[0].people,['adult']);assert(!JSON.stringify(data).includes('private-feed'));await reader(input);assert.equal(reads,1);
});
