'use strict';
// frame-hub: serves the dashboard and the data behind it. Plain Node, no framework.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { load } = require('./lib/config');
const { ROOT, send, readBody, ymd } = require('./lib/util');
const loaded = load();
const { cfg, secrets, cfgFile, secFile } = loaded;
process.env.TZ = cfg.timezone;            // makes "today" and all-day events follow your timezone

const { Store, colorFields, PALETTE } = require('./lib/store');
const { getEvents } = require('./lib/calendar');
const { Photos } = require('./lib/photos');
const homelab = require('./lib/homelab');
const piManagement = require('./lib/pihole-management');
const { getNas, fetchRaw, ENDPOINTS } = require('./lib/nas');
const { getWeather } = require('./lib/weather');
const { searchLocations } = require('./lib/locations');
const { AgentsStore } = require('./lib/agents');
const makeConnections = require('./lib/connections');
const accounts = require('./lib/accounts');
const homeassistant = require('./lib/homeassistant');
const groceries = require('./lib/groceries');
const tune = require('./lib/tune');
const backup = require('./lib/backup');

const store = new Store(cfg.dataDir);
tune.setLive(tune.resolve(tune.fromState(store.state.settings)));
const photos = new Photos(cfg);
const agents = new AgentsStore(cfg.dataDir);
const connections = makeConnections({ cfg, secrets, cfgFile, secFile, getPeopleIds: () => store.state.people.map((p) => p.id) });
const startedAt = new Date();
const uploadMax = () => tune.get('uploadMaxMb') * 1024 * 1024;   // /admin > Photos > Uploads

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json'
};

function adminOk(req) {
  const pw = secrets.admin_password;
  if (!pw) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const given = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':');
  const a = Buffer.from(given), b = Buffer.from(pw);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function needAuth(res) {
  send(res, 401, 'Admin password required', { 'WWW-Authenticate': 'Basic realm="frame-hub admin"' });
}

function serveFile(res, file, cacheable) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cacheable ? 'public, max-age=86400' : 'no-cache'
    });
    fs.createReadStream(file).pipe(res);
  });
}

function windowFrom(q) {
  const day = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
  const from = q.get('from') ? new Date(q.get('from')) : day(-35);
  const to = q.get('to') ? new Date(q.get('to')) : day(70);
  return { from, to };
}

// A time shown in the hub's own time zone (the one in /admin > Connections), not UTC.
function localStamp(iso) { try { return new Date(iso).toLocaleString('en-US', { timeZone: cfg.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return String(iso).slice(0, 16).replace('T', ' ') + ' UTC'; } }

async function buildState() {
  const { from, to } = windowFrom(new URLSearchParams());
  const cal = await getEvents({ cfg, secrets, state: store.state, from, to });
  const list = await photos.scan(false);
  const weather = await getWeather(cfg);
  const people = store.peopleOut();
  const kids = people.filter((p) => p.kid);
  return {
    rev: store.state.rev,
    now: new Date().toISOString(),
    people,
    chores: store.choresToday(),
    stars: Object.assign({}, store.state.stars),
    week: kids.reduce((o, p) => { o[p.id] = store.weekFor(p.id); return o; }, {}),
    groceries: store.state.groceries,
    stores: store.state.stores, categories: store.state.categories,
    events: cal.events,
    feeds: cal.feeds,
    photos: list.map((p) => ({ id: p.id, url: '/photo/' + p.id, o: p.o, date: p.date, dated: p.dated !== false, place: p.place, from: p.from, tag: p.tag })),
    weather,
    weatherConfigured: !!cfg.weather,
    display: store.state.settings.display,
    tune: tune.resolve(tune.fromState(store.state.settings)),
    agents: agents.get()
  };
}

function userError(msg) { const e = new Error(msg); e.userError = true; return e; }

function validPeople(list) {
  if (!Array.isArray(list) || !list.length) throw userError('people must be a non-empty list');
  const seen = new Set();
  return list.map((p) => {
    const id = String(p.id || p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!id || seen.has(id)) throw userError('each person needs a unique name');
    seen.add(id);
    // a named palette colour, or any #RRGGBB the colour picker produced; anything else falls back to blue
    const raw = String(p.color || 'blue').trim();
    const color = PALETTE[raw] ? raw : (/^#?[0-9a-fA-F]{6}$/.test(raw) ? '#' + raw.replace('#', '').toUpperCase() : 'blue');
    const out = { id, name: String(p.name || id), color, kid: !!p.kid };
    if (p.age) out.age = +p.age;
    return out;
  });
}
const str = (v, n) => String(v == null ? '' : v).slice(0, n || 200);

const routes = {
  'GET /api/state': async (req, res) => send(res, 200, await buildState()),

  'GET /api/events': async (req, res, q) => {
    const { from, to } = windowFrom(q);
    send(res, 200, await getEvents({ cfg, secrets, state: store.state, from, to }));
  },

  'GET /api/photos': async (req, res) => send(res, 200, { photos: await photos.scan(true), skippedHeic: photos.skipped }),

  'GET /api/homelab': async (req, res, q) => {
    const result = await homelab.get(cfg, { secrets, refresh: q.get('refresh') === '1' });
    send(res, 200, !result.configured && cfg.proxmenux.url ? { kind: 'proxmenux', legacy: await getNas(cfg, secrets) } : result);
  },
  'GET /api/nas': async (req, res) => send(res, 200, await getNas(cfg, secrets)),
  'GET /api/home': async (req, res) => {
    const data = await homeassistant.get(cfg, secrets);
    send(res, 200, { ...data, controlToken: data.controls ? homeassistant.controlToken(cfg, secrets) : null }, { 'Cache-Control': 'no-store' });
  },
  'POST /api/home/climate': async (req, res) => {
    try {
      homeassistant.authorizeControl(req, cfg, secrets);
      send(res, 202, await homeassistant.act(cfg, secrets, await readBody(req)));
    } catch (e) { send(res, e.userError ? 400 : 502, { error: e.message }); }
  },
  'GET /api/home/camera': async (req, res, q) => {
    try {
      const r = await homeassistant.camera(cfg, secrets, String(q.get('entity') || ''));
      send(res, 200, r.body, { 'Content-Type': r.type, 'Cache-Control': 'no-store' });
    } catch (e) { send(res, e.userError ? 400 : 502, { error: e.message }); }
  },

  // Raw ProxMenux JSON for one fixed endpoint, for checking field names. Admin only.
  'GET /api/admin/nas-raw': async (req, res, q) => {
    const name = q.get('name') || 'system';
    if (!ENDPOINTS[name]) return send(res, 400, { error: 'name must be one of ' + Object.keys(ENDPOINTS).join(', ') });
    try { send(res, 200, await fetchRaw(cfg, secrets, name)); } catch (e) { send(res, 502, { error: String(e.message || e) }); }
  },

  'GET /api/agents': async (req, res) => send(res, 200, agents.get()),
  'POST /api/agents/refresh': async (req, res) => {
    const requestedAt = agents.request();
    accounts.refreshAll(secrets, agents).catch((e) => console.error('account refresh failed:', e.message));   // linked accounts are read by the hub itself
    send(res, 200, { ok: true, requestedAt });
  },

  // Collector scripts (tools/agent-usage/) push usage numbers here. Needs the X-Agent-Token header when secrets.json has agents_token.
  'PUT /api/agents': async (req, res) => {
    const want = secrets.agents_token;
    if (want) {
      const got = Buffer.from(String(req.headers['x-agent-token'] || '')), exp = Buffer.from(String(want));
      if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) return send(res, 401, { error: 'bad or missing X-Agent-Token' });
    }
    agents.update(await readBody(req, 1024 * 1024));
    send(res, 200, { ok: true });
  },

  'GET /api/health': async (req, res) => send(res, 200, { ok: true, rev: store.state.rev, uptimeSec: Math.round((Date.now() - startedAt) / 1000), tz: cfg.timezone }),

  // What the frame's status panel shows: the hub itself and the things it depends on.
  'GET /api/status': async (req, res) => send(res, 200, {
    ok: true, rev: store.state.rev, uptimeSec: Math.round((Date.now() - startedAt) / 1000), tz: cfg.timezone,
    calendars: (cfg.calendars || []).length
  }),

  // --- changes made on the frame
  'POST /api/chores/toggle': async (req, res) => {
    const b = await readBody(req);
    if (!store.toggleChore(String(b.id), !!b.done)) return send(res, 404, { error: 'unknown chore' });
    send(res, 200, { ok: true, rev: store.state.rev });
  },
  'PUT /api/groceries': async (req, res) => {
    const b = await readBody(req);
    const items = groceries.frameItems(store.state, b);
    store.update((s) => { s.groceries = items; });
    send(res, 200, { ok: true, rev: store.state.rev });
  },

  // --- admin: everything you can edit from a phone or computer
  'GET /api/admin/data': async (req, res) => send(res, 200, {
    people: store.state.people, chores: store.state.chores, groceries: store.state.groceries, stores: store.state.stores, categories: store.state.categories,
    events: store.state.events, rev: store.state.rev, settings: store.state.settings,
    tune: tune.resolve(tune.fromState(store.state.settings)), tuneSchema: tune.SCHEMA,
    config: { timezone: cfg.timezone, calendars: cfg.calendars.map((c) => ({ name: c.name, people: c.people, configured: !!(secrets.ical && secrets.ical[c.secret]) })),
      proxmenux: { url: cfg.proxmenux.url, configured: !!secrets[cfg.proxmenux.tokenSecret] }, weather: cfg.weather, photosDir: cfg.photosDir }
  }),
  // --- admin: backend settings (calendars, ProxMenux, weather, timezone, passwords). Secret values are write-only.
  'GET /api/admin/connections': async (req, res) => send(res, 200, connections.view()),
  'GET /api/admin/locations': async (req, res, q) => send(res, 200, { results: await searchLocations(q.get('q')) }),
  'PUT /api/admin/connections': async (req, res) => {
    const b = await readBody(req);
    // With no admin password yet, the only thing anyone may do is set one.
    if (!secrets.admin_password && Object.keys(b).some((k) => k !== 'adminPassword')) throw userError('Set an admin password first');
    send(res, 200, connections.apply(b));
    if (b.accounts) accounts.refreshAll(secrets, agents, true).catch((e) => console.error('account refresh failed:', e.message));
  },
  'POST /api/admin/test': async (req, res) => send(res, 200, await connections.test(await readBody(req))),
  'GET /api/admin/pihole': async (req, res) => send(res, 200, await piManagement.status(cfg.homelab?.piholeSsh)),
  'POST /api/admin/pihole': async (req, res) => {
    if (!secrets.admin_password) throw userError('Set an admin password before using Pi-hole controls');
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '') || req.headers['sec-fetch-site'] === 'cross-site') throw userError('Use Pi-hole controls from this server’s settings page');
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw userError('Cross-origin Pi-hole actions are not allowed');
    const b = await readBody(req);
    send(res, 202, await piManagement.action(cfg.homelab?.piholeSsh, b.action, b.confirm));
    homelab.clear();
  },

  // --- admin: which photo folders feed the frame
  'GET /api/admin/photo-folders': async (req, res, q) => {
    const t = photos.tree();
    const dirs = photos.dirs().map((d) => path.relative(photos.root, d).split(path.sep).join('/') || '.');
    const list = await photos.scan(q.get('rescan') === '1');
    const gone = (Array.isArray(cfg.photoFolders) ? cfg.photoFolders : []).filter((r) => !fs.existsSync(path.resolve(photos.root, r)));
    send(res, 200, { missing: gone, root: t.root, rootDirect: t.rootDirect, rootTotal: t.rootTotal, nodes: t.nodes, enabled: dirs, showing: list.length, skippedHeic: photos.skipped.length });
  },
  'PUT /api/admin/photo-folders': async (req, res) => {
    const b = await readBody(req);
    const r = connections.setPhotoFolders(b.folders, photos.root);
    photos.reset();
    const list = await photos.scan(true);
    send(res, 200, { ok: true, showing: list.length, skipped: r.skipped });
  },

  // --- admin: add photos from the browser (one file per request, raw bytes in the body)
  'GET /api/admin/uploads': async (req, res) => {
    const list = (await photos.scan(true)).filter((x) => x.tag === 'uploads');
    // the id is '@uploads/<folder>/<name>' or '@uploads/<name>' (top level)
    const out = list.map((x) => { const parts = Buffer.from(x.id, 'base64url').toString('utf8').split('/'); return { id: x.id, name: x.name, folder: parts.length > 2 ? parts[1] : '', o: x.o, date: x.date, dated: x.dated }; });
    send(res, 200, { photos: out, folders: photos.uploadFolders(), max: uploadMax() });
  },
  'POST /api/admin/upload-folder': async (req, res) => send(res, 200, { ok: true, name: photos.createFolder((await readBody(req)).name) }),
  'POST /api/admin/upload-folder-delete': async (req, res) => { photos.deleteFolder((await readBody(req)).name); send(res, 200, { ok: true }); },
  'POST /api/admin/photo-move': async (req, res) => {
    const b = await readBody(req);
    send(res, 200, { ok: true, name: photos.moveUpload(b.name, b.from, b.to) });
  },
  'POST /api/admin/photo-upload': async (req, res, q) => {
    const name = q.get('name') || 'photo.jpg';
    if (!/\.(jpe?g|png|webp)$/i.test(name)) throw userError(/\.(heic|heif)$/i.test(name) ? 'HEIC photos are not supported yet; export or convert to JPEG first' : 'only JPEG, PNG and WebP photos can be added');
    if (+req.headers['content-length'] > uploadMax()) throw userError('that photo is over ' + (uploadMax() >> 20) + ' MB');
    const folder = photos.cleanFolder(q.get('folder'));
    if (folder && !fs.existsSync(photos.folderPath(folder))) throw userError('no such folder: ' + folder);
    fs.mkdirSync(photos.uploadsDir, { recursive: true });
    const tmp = path.join(photos.uploadsDir, '.upload-' + crypto.randomBytes(6).toString('hex') + '.tmp');
    try {
      await new Promise((resolve, reject) => {
        let size = 0, head = null;
        const out = fs.createWriteStream(tmp);
        req.on('data', (c) => {
          if (!head) head = c.subarray(0, 12);
          size += c.length;
          if (size > uploadMax()) { reject(userError('that photo is over ' + (uploadMax() >> 20) + ' MB')); req.destroy(); out.destroy(); }
        });
        req.on('error', reject);
        out.on('error', reject);
        out.on('finish', () => {
          if (!size) return reject(userError('the file was empty'));
          const jpg = head[0] === 0xFF && head[1] === 0xD8, png = head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]));
          const webp = head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
          if (!jpg && !png && !webp) return reject(userError('that file is not a JPEG, PNG or WebP image'));
          resolve();
        });
        req.pipe(out);
      });
      const saved = await photos.saveUpload(name, tmp, +q.get('mtime') || 0, q.get('folder'));
      send(res, 200, { ok: true, name: saved });
    } catch (e) {
      fs.rm(tmp, { force: true }, () => {});
      throw e;
    }
  },
  'POST /api/admin/photo-delete': async (req, res) => {
    const b = await readBody(req);
    if (!photos.deleteUpload(b.name, b.folder)) throw userError('no such uploaded photo');
    send(res, 200, { ok: true });
  },

  'PUT /api/admin/people': async (req, res) => {
    const b = await readBody(req);
    const people = validPeople(b.people);
    store.update((s) => { s.people = people; });
    send(res, 200, { ok: true, rev: store.state.rev });
  },
  'PUT /api/admin/chores': async (req, res) => {
    const b = await readBody(req);
    if (!Array.isArray(b.chores)) return send(res, 400, { error: 'chores must be a list' });
    const prev = new Map(store.state.chores.map((c) => [c.id, c]));
    const chores = b.chores.slice(0, 300).map((c) => ({
      id: str(c.id, 40) || ('c' + Math.random().toString(36).slice(2, 8)),
      r: ['morning', 'after', 'evening'].includes(c.r) ? c.r : 'after', who: str(c.who, 40) || 'any', title: str(c.title, 80),
      emoji: str(c.emoji, 8) || '✅', stars: Math.max(0, Math.min(9, +c.stars || 0)),
      days: Array.isArray(c.days) && c.days.length && c.days.length < 7 ? c.days.map(Number).filter((n) => n >= 0 && n <= 6) : null,
      doneOn: prev.get(c.id) ? prev.get(c.id).doneOn : null
    })).filter((c) => c.title);
    store.update((s) => { s.chores = chores; });
    send(res, 200, { ok: true, rev: store.state.rev });
  },
  'PUT /api/admin/events': async (req, res) => {
    const b = await readBody(req);
    if (!Array.isArray(b.events)) return send(res, 400, { error: 'events must be a list' });
    const events = b.events.slice(0, 500).map((e) => ({
      id: str(e.id, 40) || ('m' + Math.random().toString(36).slice(2, 8)), title: str(e.title, 120), date: str(e.date, 10),
      start: str(e.start, 5), end: str(e.end, 5), allDay: !!e.allDay, days: Math.max(1, Math.min(60, +e.days || 1)),
      people: Array.isArray(e.people) ? e.people.map(String) : [], loc: str(e.loc, 120), notes: str(e.notes, 280),
      repeat: ['none', 'daily', 'weekly', 'monthly'].includes(e.repeat) ? e.repeat : 'none', until: str(e.until, 10)
    })).filter((e) => e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
    store.update((s) => { s.events = events; });
    send(res, 200, { ok: true, rev: store.state.rev });
  },
  // Tunable settings (lib/tune.js): partial update, validated per setting, live on the frame within one poll.
  'PUT /api/admin/tune': async (req, res) => {
    const b = await readBody(req);
    let values;
    try { values = tune.clean(b.values, tune.resolve(tune.fromState(store.state.settings))); } catch (e) { throw userError(e.message); }
    const parts = tune.split(values);   // each value goes to the place the frame already reads it from
    store.update((s) => {
      s.settings.tune = Object.assign({}, s.settings.tune, parts.tune);
      if (Object.keys(parts.display).length) s.settings.display = Object.assign({}, s.settings.display, parts.display);
    });
    const now = tune.resolve(tune.fromState(store.state.settings));
    tune.setLive(now);
    send(res, 200, { ok: true, rev: store.state.rev, tune: now });
  },
  // What is working, in one list. Each check says what it found and which tab fixes it. Calendars and photos are read live; the rest is what the hub already knows.
  'GET /api/admin/health': async (req, res) => {
    const checks = [], add = (id, label, state, detail, fix) => checks.push({ id, label, state, detail, fix: fix || null });
    const up = Math.round((Date.now() - startedAt) / 1000);
    add('hub', 'Frame hub', 'ok', 'Running for ' + (up < 90 ? 'less than a minute' : up < 3600 ? Math.round(up / 60) + ' min' : up < 172800 ? Math.round(up / 3600) + ' hours' : Math.round(up / 86400) + ' days') + ' · time zone ' + cfg.timezone);
    add('password', 'Admin password', secrets.admin_password ? 'ok' : 'warn', secrets.admin_password ? 'Set' : 'Not set: anyone on your network can open this page', 'connections#security');
    try {
      const w = windowFrom(new URLSearchParams()), cal = await getEvents({ cfg, secrets, state: store.state, from: w.from, to: w.to });
      if (!cfg.calendars.length) add('cal', 'Calendars', 'off', 'None added', 'connections#calendars');
      cfg.calendars.forEach((c) => {
        const f = (cal.feeds || []).filter((x) => x.name === c.name)[0];
        const has = !!(secrets.ical && secrets.ical[c.secret]);
        add('cal:' + c.name, 'Calendar: ' + c.name, !has ? 'bad' : f && f.ok ? 'ok' : 'bad', !has ? 'No link saved' : f ? (f.ok ? f.count + ' events in view' : f.error) : 'Not read yet', 'connections#calendars');
      });
    } catch (e) { add('cal', 'Calendars', 'bad', e.message, 'connections#calendars'); }
    try { const n = (await photos.scan(false)).length; add('photos', 'Photos', n ? 'ok' : 'warn', n ? n + ' photos on the frame' : 'No photos found in ' + cfg.photosDir, 'photos'); } catch (e) { add('photos', 'Photos', 'bad', e.message, 'photos'); }
    add('weather', 'Weather', cfg.weather ? 'ok' : 'off', cfg.weather ? cfg.weather.lat + ', ' + cfg.weather.lon : 'No location set: the frame shows sample weather', 'connections#weather');
    const px = connections.view().proxmenux;
    const lab = await homelab.get(cfg, { secrets });
    if (lab.configured) {
      lab.services.filter(s => s.configured).forEach(s => add('homelab:' + s.id, s.name, s.state === 'ok' ? 'ok' : 'warn', s.detail, 'connections#homelab'));
      if (lab.backup.configured) add('time-machine', 'Time Machine', lab.backup.state === 'ok' ? 'ok' : 'warn', lab.backup.detail, 'connections#homelab');
    }
    if (!lab.configured || px.url) add('proxmenux', 'ProxMenux (optional)', px.url && px.tokenSet ? 'ok' : 'off', px.url ? (px.tokenSet ? px.url : 'No token saved') : 'Not set up', 'connections#proxmenux');
    const bs = backup.list(path.join(cfg.dataDir, 'state.json'))[0], bc = backup.list(cfgFile)[0];
    add('backups', 'Automatic backups', bs || bc ? 'ok' : 'off', (bs ? 'Settings and data: ' + localStamp(bs.at) : 'None yet') + (bc ? ' · connections: ' + localStamp(bc.at) : ''), 'status');
    send(res, 200, { checks, at: new Date().toISOString() });
  },
  'GET /api/admin/backups': async (req, res) => send(res, 200, { state: backup.list(path.join(cfg.dataDir, 'state.json')), config: backup.list(cfgFile), windowMin: backup.WINDOW_MS / 60000, keep: backup.KEEP }),
  'POST /api/admin/restore': async (req, res) => {
    const b = await readBody(req);
    if (b.which === 'state') {
      const data = backup.read(path.join(cfg.dataDir, 'state.json'), String(b.name || ''));
      if (!data) throw userError('That backup was not found');
      try { store.restore(data); } catch (e) { throw userError(e.message); }
      tune.setLive(tune.resolve(tune.fromState(store.state.settings)));
    } else if (b.which === 'config') {
      const data = backup.read(cfgFile, String(b.name || ''));
      if (!data) throw userError('That backup was not found');
      connections.restore(data);
    } else throw userError('which must be state or config');
    send(res, 200, { ok: true });
  },
  'PUT /api/admin/groceries': async (req, res) => {
    const next = groceries.adminUpdate(store.state, await readBody(req));
    store.update(s => Object.assign(s, next));
    send(res, 200, { ok: true, rev: store.state.rev });
  },
  'PUT /api/admin/stores': async (req, res) => {
    const b = await readBody(req), stores = groceries.cleanStores(b.stores);
    if (store.state.groceries.some(g => !stores.some(s => s.id === g.store))) throw userError('Move items to another store before removing their store.');
    store.update(s => { s.stores = stores; });
    send(res, 200, { ok: true, rev: store.state.rev });
  }
};

const server = http.createServer(async (req, res) => {
  let url, p;
  try { url = new URL(req.url, 'http://x'); p = decodeURIComponent(url.pathname); }
  catch { return send(res, 400, { error: 'Invalid request path' }); }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // The thermostat's per-connection action token is same-origin only. Other
  // sites must not read it through the general LAN dashboard CORS policy.
  if (p === '/api/home' || p.startsWith('/api/home/')) {
    res.removeHeader('Access-Control-Allow-Origin');
    res.removeHeader('Access-Control-Allow-Methods');
    res.removeHeader('Access-Control-Allow-Headers');
  }
  if (req.method === 'OPTIONS') return send(res, 204, '');
  try {
    const admin = p === '/admin' || p.startsWith('/api/admin/');
    if (admin && !adminOk(req)) return needAuth(res);

    // photos: /photo/<id>?w=1600
    if (req.method === 'GET' && p.startsWith('/photo/')) {
      const r = await photos.sized(p.slice(7), +url.searchParams.get('w') || 1280);
      if (!r) return send(res, 404, { error: 'no such photo' });
      const st = fs.statSync(r.file);
      res.writeHead(200, { 'Content-Type': r.type, 'Content-Length': st.size, 'Cache-Control': 'public, max-age=604800' });
      return fs.createReadStream(r.file).pipe(res);
    }

    const handler = routes[req.method + ' ' + p];
    if (handler) return await handler(req, res, url.searchParams);

    if (req.method === 'GET' && p === '/admin') return serveFile(res, path.join(ROOT, 'public', 'admin.html'), false);

    if (req.method === 'GET') { // the dashboard itself
      const rel = p === '/' ? '/index.html' : p;
      const full = path.resolve(cfg.dashboardDir, '.' + rel);
      if (!full.startsWith(path.resolve(cfg.dashboardDir))) return send(res, 403, { error: 'forbidden' });
      return serveFile(res, full, /\/assets\//.test(rel));
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    const bad = e && e.userError;
    if (!bad) console.error(new Date().toISOString(), req.method, p, e && e.stack || e);
    if (!res.headersSent) send(res, bad ? 400 : 500, { error: String(e.message || e) });
  }
});

server.listen(cfg.port, '0.0.0.0', () => {
  console.log('frame-hub listening on :' + cfg.port + '  tz=' + cfg.timezone);
  console.log('  photos:    ' + cfg.photosDir);
  console.log('  dashboard: ' + cfg.dashboardDir);
  console.log('  data:      ' + cfg.dataDir);
  console.log('  calendars: ' + (cfg.calendars.length || 'none') + ' · proxmenux: ' + (cfg.proxmenux.url ? 'set' : 'not set') + ' · admin password: ' + (secrets.admin_password ? 'yes' : 'NO (open on your LAN)'));
  photos.scan(true).then((l) => console.log('  photos found: ' + l.length + (photos.skipped.length ? ' (+' + photos.skipped.length + ' HEIC skipped)' : ''))).catch(() => {});
  const refreshAccounts = () => accounts.refreshAll(secrets, agents).catch((e) => console.error('account refresh failed:', e.message));
  refreshAccounts();
  setInterval(refreshAccounts, 5 * 60 * 1000).unref();
});
