'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { load } = require('./lib/config');
const { Store, cleanRecords } = require('./lib/store');
const tune = require('./lib/tune');
const { Photos } = require('./lib/photos');
const { getWeather } = require('./lib/weather');
const { getEvents } = require('./lib/calendar');
const { ROOT, problem, send, readBody, readBytes, writeJsonAtomic, sameOrigin, equalSecret } = require('./lib/util');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2' };
function createHub(options = {}) {
  const loaded = options.loaded || load(), { cfg,secrets,cfgFile,secFile } = loaded;
  process.env.TZ = cfg.timezone;
  const store = new Store(cfg.dataDir), photos = new Photos(cfg), started = Date.now();
  const routes = new Map(), extensions = [], settings = new Map(), tasks = [];
  const displayToken = crypto.randomBytes(32).toString('hex');
  tune.setLive(tune.resolve(tune.fromState(store.state.settings)));
  const route = (method,url,handler,opts = {}) => routes.set(method + ' ' + url,{handler,...opts});
  const saveFiles = () => { writeJsonAtomic(cfgFile,cfg); writeJsonAtomic(secFile,secrets); };
  function configView() { return { timezone:cfg.timezone,weather:cfg.weather,photosDir:cfg.photosDir,calendars:(cfg.calendars || []).map(c => ({name:c.name,secret:c.secret,people:c.people || [],configured:!!secrets.ical?.[c.secret]})),adminPasswordSet:!!secrets.admin_password,_integrationForms:Object.fromEntries([...settings].map(([key,plugin]) => [key,{fields:plugin.fields || [],actions:plugin.actions || []}])),...Object.fromEntries([...settings].map(([key,plugin]) => [key,plugin.view()])) }; }
  const ctx = { cfg,secrets,cfgFile,secFile,store,photos,route,send,readBody,problem,saveFiles,tune,addState:fn => extensions.push(fn),settings:(key,value) => settings.set(key,value),onClose:fn => tasks.push(fn) };
  const plugins = options.plugins || (fs.existsSync(path.join(ROOT,'integrations')) ? fs.readdirSync(path.join(ROOT,'integrations')) : []).filter(name => name.endsWith('.js')).map(name => require(path.join(ROOT,'integrations',name)));
  for (const plugin of plugins) plugin.install(ctx);
  // Optional theme contribution uses its palette IDs as validated display settings.
  const palettesFile = path.resolve(ROOT,'../dashboard/js/theme-palettes.json');
  if (fs.existsSync(palettesFile) && !tune.SCHEMA.some(r => r.key === 'theme')) { const palettes = JSON.parse(fs.readFileSync(palettesFile)); tune.SCHEMA.push({key:'theme',label:'Dashboard theme',type:'select',options:palettes.map(p => [p.id,p.label]),def:'paper'}); }
  function range(query) { const from = query.get('from') ? new Date(query.get('from')) : new Date(Date.now() - 35 * 86400000); const to = query.get('to') ? new Date(query.get('to')) : new Date(Date.now() + 70 * 86400000); if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to - from > 366 * 86400000) throw problem('Invalid calendar range'); return {from,to}; }
  const currentTune = () => tune.resolve(tune.fromState(store.state.settings));
  const display = () => Object.fromEntries(['homeSec','ambientSec','theme'].filter(key => currentTune()[key] !== undefined).map(key => [key,currentTune()[key]]));
  function persistTune(input) { const values = tune.clean(input,currentTune()), parts = tune.split(values); store.update(s => { s.settings.display = {...s.settings.display,...parts.display}; s.settings.tune = {...s.settings.tune,...parts.tune}; }); tune.setLive(values); return values; }
  async function state() {
    const [calendar,images,weather] = await Promise.all([getEvents({cfg,secrets,state:store.state,...range(new URLSearchParams())}),photos.scan(),getWeather(cfg)]);
    const extra = Object.assign({},...await Promise.all(extensions.map(fn => fn())));
    return {rev:store.state.rev,now:new Date().toISOString(),people:store.peopleOut(),chores:store.choresToday(),groceries:store.state.groceries,stores:store.state.stores,categories:store.state.categories,commonItems:store.state.commonItems,events:calendar.events,feeds:calendar.feeds,photos:images,weather,weatherConfigured:!!cfg.weather,stars:store.state.stars || {},week:{},display:store.state.settings.display,tune:currentTune(),...extra};
  }
  route('GET','/api/state',state);
  route('GET','/api/events',({url}) => getEvents({cfg,secrets,state:store.state,...range(url.searchParams)}));
  route('GET','/api/photos',() => photos.scan(true).then(images => ({photos:images,skippedHeic:photos.skipped})));
  for (const endpoint of ['/api/health','/api/status']) route('GET',endpoint,() => ({ok:true,rev:store.state.rev,uptimeSec:Math.floor((Date.now() - started)/1000),tz:cfg.timezone,calendars:cfg.calendars.length}));
  route('GET','/api/display-settings',({req}) => { sameOrigin(req); return {token:displayToken,values:display()}; });
  route('PUT','/api/display-settings',({req,body}) => {
    if (!equalSecret(req.headers['x-display-token'],displayToken)) throw problem('Reopen display settings',403);
    const allowed = Object.keys(display()); if (!body.values || Object.keys(body.values).some(key => !allowed.includes(key))) throw problem('Only display settings can be changed here');
    persistTune(body.values); return {ok:true,values:display()};
  });
  route('POST','/api/chores/toggle',({body}) => { if (!store.toggleChore(body.id,!!body.done)) throw problem('Unknown chore',404); return {ok:true,rev:store.state.rev}; });
  route('PUT','/api/groceries',({body}) => {
    const items = cleanRecords(body.items,'groceries');
    if (new Set(items.map(item => item.id)).size !== items.length) throw problem('Duplicate item IDs');
    store.update(s => { const base = new Set(body.base || s.groceries.map(g => g.id)), ids = new Set(items.map(g => g.id)); s.groceries = items.concat(s.groceries.filter(g => !base.has(g.id) && !ids.has(g.id))); });
    return {ok:true,rev:store.state.rev};
  });
  route('GET','/api/admin/data',() => ({...store.state,tune:currentTune(),tuneSchema:tune.SCHEMA,config:configView()}),{admin:true});
  route('GET','/api/admin/connections',configView,{admin:true});
  route('PUT','/api/admin/connections',({body}) => {
    const previousCfg = structuredClone(cfg), previousSecrets = structuredClone(secrets);
    try {
    const allowed = new Set(['timezone','weather','calendars','photosDir',...settings.keys()]);
    if (Object.keys(body).some(key => !allowed.has(key))) throw problem('Unknown connection setting');
    if (body.timezone !== undefined && body.timezone !== cfg.timezone) throw problem('Change timezone in config.json and restart the hub');
    if (body.weather !== undefined) {
      const w = body.weather;
      if (w !== null && (typeof w.lat !== 'number' || typeof w.lon !== 'number' || w.lat < -90 || w.lat > 90 || w.lon < -180 || w.lon > 180 || !Number.isFinite(w.lat) || !Number.isFinite(w.lon))) throw problem('Invalid weather coordinates');
      cfg.weather = w === null ? null : {lat:w.lat,lon:w.lon,units:w.units === 'f' ? 'f':'c'};
    }
    if (body.photosDir !== undefined) { if (typeof body.photosDir !== 'string' || !path.isAbsolute(body.photosDir)) throw problem('Photo directory must be an absolute path'); cfg.photosDir = body.photosDir; photos.scanned = 0; }
    if (body.calendars !== undefined) {
      if (!Array.isArray(body.calendars) || body.calendars.length > 20) throw problem('Invalid calendar list');
      const calendars = [], links = {...secrets.ical};
      for (const [index,c] of body.calendars.entries()) { const key = 'calendar-' + crypto.randomUUID(); if (c.url) { let url; try { url = new URL(c.url); } catch { throw problem('Invalid calendar URL'); } if (!['http:','https:'].includes(url.protocol)) throw problem('Invalid calendar URL'); links[key] = url.toString(); } calendars.push({name:String(c.name || 'Calendar').slice(0,80),secret:c.url ? key : c.secret,people:Array.isArray(c.people) ? c.people : []}); }
      cfg.calendars = calendars; secrets.ical = links;
    }
    for (const [key,plugin] of settings) if (body[key] !== undefined) plugin.save(body[key]);
    saveFiles(); return configView();
    } catch (error) { for (const key of Object.keys(cfg)) delete cfg[key]; Object.assign(cfg,previousCfg); for (const key of Object.keys(secrets)) delete secrets[key]; Object.assign(secrets,previousSecrets); throw error; }
  },{admin:true});
  for (const key of ['people','chores','events','stores','commonItems']) route('PUT','/api/admin/' + key,({body}) => { const records = cleanRecords(body[key],key); if (new Set(records.map(r => r.id)).size !== records.length) throw problem('Duplicate identifiers'); if (key === 'stores' && !records.length) throw problem('At least one store is required'); store.update(s => { s[key] = records; }); return {ok:true,rev:store.state.rev}; },{admin:true});
  route('PUT','/api/admin/categories',({body}) => { if (!Array.isArray(body.categories) || !body.categories.length || body.categories.length > 32 || body.categories.some(c => typeof c !== 'string' || !c.trim() || c.length > 40)) throw problem('Invalid categories'); store.update(s => { s.categories = [...new Set(body.categories)]; }); return {ok:true}; },{admin:true});
  route('PUT','/api/admin/tune',({body}) => ({ok:true,values:persistTune(body.values || body)}),{admin:true});
  route('POST','/api/admin/photo-upload',async ({req,url}) => photos.upload(await readBytes(req,40 * 1024 * 1024),url.searchParams.get('name') || ''),{admin:true,raw:true});
  route('GET','/api/admin/backups',async () => { let names = []; try { names = await fsp.readdir(store.backupDir); } catch {} return {state:names.sort().reverse(),keep:20}; },{admin:true});
  route('POST','/api/admin/restore',({body}) => { store.restore(body.name); return {ok:true}; },{admin:true});
  async function file(res,filename,cache = 'no-cache') {
    const stat = await fsp.stat(filename).catch(() => null); if (!stat?.isFile()) throw problem('Not found',404);
    res.writeHead(200,{'Content-Type':MIME[path.extname(filename)] || 'application/octet-stream','Content-Length':stat.size,'Cache-Control':cache,'X-Content-Type-Options':'nosniff'});
    const stream = fs.createReadStream(filename); stream.on('error',() => res.destroy()); stream.pipe(res);
  }
  const server = http.createServer(async (req,res) => {
    try {
      const url = new URL(req.url,'http://hub'), pathname = decodeURIComponent(url.pathname), record = routes.get(req.method + ' ' + pathname);
      if (pathname === '/admin' || record?.admin) {
        const authorization = /^Basic (.+)$/i.exec(req.headers.authorization || ''), encoded = authorization ? Buffer.from(authorization[1],'base64').toString() : '';
        if (!encoded.includes(':') || !equalSecret(encoded.slice(encoded.indexOf(':') + 1),secrets.admin_password)) return send(res,401,{error:'Admin sign-in required. Set HUB_ADMIN_PASSWORD or secrets.json first.'},{'WWW-Authenticate':'Basic realm="Hub"'});
      }
      if (record) {
        let body = {};
        if (!['GET','HEAD'].includes(req.method)) { sameOrigin(req); if (!record.raw) { if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw problem('Send JSON',415); body = await readBody(req,record.limit); } }
        const result = await record.handler({req,res,url,body}); if (!res.headersSent) send(res,200,result ?? {ok:true}); return;
      }
      if (req.method !== 'GET') throw problem('Not found',404);
      if (pathname.startsWith('/photo/')) { const image = await photos.sized(pathname.slice(7),url.searchParams.get('w')); if (!image) throw problem('Not found',404); return file(res,image.file,'private, max-age=86400'); }
      if (pathname === '/admin') return file(res,path.join(ROOT,'public/admin.html'));
      const root = path.resolve(cfg.dashboardDir), target = path.resolve(root,'.' + (pathname === '/' ? '/index.html':pathname));
      if (!target.startsWith(root + path.sep)) throw problem('Forbidden',403);
      const real = await fsp.realpath(target).catch(() => null); if (!real) throw problem('Not found',404); if (!real.startsWith(root + path.sep)) throw problem('Forbidden',403);
      return file(res,real,pathname.startsWith('/assets/') ? 'public, max-age=86400':'no-cache');
    } catch (error) { if (!res.headersSent) send(res,error.status || (error.userError ? 400:500),{error:error.status || error.userError ? error.message:'Hub request failed'}); else res.destroy(); }
  });
  server.on('close',() => tasks.forEach(fn => fn()));
  return {server,ctx,state};
}
if (require.main === module) {
  const hub = createHub(); hub.server.listen(hub.ctx.cfg.port,hub.ctx.cfg.host,() => console.log('Hub listening on ' + hub.ctx.cfg.host + ':' + hub.ctx.cfg.port));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => hub.server.close(() => process.exit()));
}
module.exports = { createHub };
