'use strict';
// Edit the hub's own settings from /admin: calendars (iCal links), ProxMenux, weather, timezone, passwords and tokens.
// config.json holds the plain settings; secrets.json holds anything private. Secret values are WRITE-ONLY here:
// the API says whether one is set, and never returns it.
const fs = require('fs');
const crypto = require('crypto');
const { writeJsonAtomic } = require('./util');
const calendar = require('./calendar');
const nas = require('./nas');
const weather = require('./weather');
const accounts = require('./accounts');
const homeassistant = require('./homeassistant');
const homelab = require('./homelab');

const bad = (m) => Object.assign(new Error(m), { userError: true });
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'cal';
const clone = (o) => JSON.parse(JSON.stringify(o));

function cleanUrl(u, what) {
  let x;
  try { x = new URL(String(u).trim()); } catch (e) { throw bad(what + ' must be a full web address (https://...)'); }
  if (!/^https?:$/.test(x.protocol)) throw bad(what + ' must start with http:// or https://');
  return x.toString();
}
function cleanTimezone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: String(tz) }); } catch (e) { throw bad('"' + tz + '" is not a timezone name (example: America/New_York)'); }
  return String(tz);
}
function cleanWeather(w) {
  if (w === null) return null;
  if (!w || w.lat == null || w.lon == null || String(w.lat).trim() === '' || String(w.lon).trim() === '') {
    throw bad('Choose a location or enter both latitude and longitude');
  }
  const lat = Number(w && w.lat), lon = Number(w && w.lon);
  if (!isFinite(lat) || lat < -90 || lat > 90) throw bad('latitude must be between -90 and 90');
  if (!isFinite(lon) || lon < -180 || lon > 180) throw bad('longitude must be between -180 and 180');
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4,
    units: w.units === 'c' ? 'c' : 'f', name: String(w.name || '').trim().slice(0, 160) };
}

module.exports = function create({ cfg, secrets, cfgFile, secFile, getPeopleIds }) {
  function view() {
    const tokenKey = cfg.proxmenux.tokenSecret || 'proxmenux_token';
    return {
      homelab: Object.assign(homelab.cleanSettings(cfg.homelab), { piholeTokenSet: !!secrets.homelab_pihole_token, piholePasswordSet: !!secrets.homelab_pihole_password, giteaTokenSet: !!secrets.homelab_gitea_token }),
      timezone: cfg.timezone,
      weather: cfg.weather || null,
      proxmenux: { url: cfg.proxmenux.url || '', insecureTLS: !!cfg.proxmenux.insecureTLS, tokenSet: !!secrets[tokenKey] },
      calendars: (cfg.calendars || []).map((c) => ({ key: c.secret, name: c.name, people: c.people || [], urlSet: !!(secrets.ical && secrets.ical[c.secret]) })),
      unusedLinks: Object.keys(secrets.ical || {}).filter((k) => !(cfg.calendars || []).some((c) => c.secret === k)),
      accounts: accounts.status(secrets),
      homeassistant: Object.assign(homeassistant.defaults(), cfg.homeassistant, { tokenSet: !!secrets.homeassistant_token }),
      adminPasswordSet: !!secrets.admin_password,
      agentsTokenSet: !!secrets.agents_token,
      photosDir: cfg.photosDir,
      files: { config: cfgFile, secrets: secFile }
    };
  }

  /** Validate everything first, then write both files, then update the running hub. Nothing changes if any part is invalid. */
  function apply(b) {
    const nsec = clone(secrets);
    nsec.ical = nsec.ical || {};
    const ncfg = { timezone: cfg.timezone, weather: cfg.weather, proxmenux: clone(cfg.proxmenux), calendars: clone(cfg.calendars || []) };
    const out = { ok: true };
    ncfg.homelab = homelab.cleanSettings(b.homelab === undefined ? cfg.homelab : b.homelab);
    for (const id of ['pihole', 'gitea']) {
      const key = 'homelab_' + id + '_token', incoming = b.homelab || {};
      if (id === 'pihole') {
        const passwordKey = 'homelab_pihole_password', changed = ncfg.homelab.pihole !== (cfg.homelab?.pihole || '');
        if (incoming.piholeUnlink || !ncfg.homelab.pihole) { delete nsec[key]; delete nsec[passwordKey]; continue; }
        if (changed && (nsec[key] || nsec[passwordKey])) {
          if (!incoming.piholeToken && !incoming.piholePassword) throw bad('Paste the Pi-hole token or application password again when changing its address.');
          delete nsec[key]; delete nsec[passwordKey];
        }
        if (incoming.piholeToken) nsec[key] = homelab.cleanToken(incoming.piholeToken);
        if (incoming.piholePassword) nsec[passwordKey] = homelab.cleanPassword(incoming.piholePassword);
        continue;
      }
      if (incoming[id + 'Unlink'] || !ncfg.homelab[id]) delete nsec[key];
      else if (incoming[id + 'Token']) nsec[key] = homelab.cleanToken(incoming[id + 'Token']);
      else if (ncfg.homelab[id] !== (cfg.homelab?.[id] || '') && nsec[key]) throw bad('Paste the ' + id + ' API token again when changing its address.');
    }
    ncfg.homeassistant = homeassistant.cleanSettings(cfg.homeassistant);

    if (b.homeassistant) {
      const h = b.homeassistant;
      if (h.unlink) { ncfg.homeassistant = homeassistant.defaults(); delete nsec.homeassistant_token; }
      else {
        ncfg.homeassistant = homeassistant.cleanSettings(Object.assign({}, ncfg.homeassistant, h));
        if (h.token && typeof h.token === 'string') nsec.homeassistant_token = homeassistant.cleanToken(h.token);
        else if (ncfg.homeassistant.url !== (cfg.homeassistant?.url || '') && nsec.homeassistant_token) throw bad('Paste the Home Assistant token again when changing its address.');
      }
    }

    if (b.timezone !== undefined) ncfg.timezone = cleanTimezone(b.timezone);
    if (b.weather !== undefined) ncfg.weather = cleanWeather(b.weather);

    if (b.proxmenux) {
      const p = b.proxmenux, tokenKey = ncfg.proxmenux.tokenSecret || 'proxmenux_token';
      if (p.url !== undefined) ncfg.proxmenux.url = p.url === '' ? '' : cleanUrl(p.url, 'The ProxMenux address').replace(/\/$/, '');
      if (p.insecureTLS !== undefined) ncfg.proxmenux.insecureTLS = !!p.insecureTLS;
      if (typeof p.token === 'string' && p.token.trim()) {
        if (p.token.trim().length < 10) throw bad('That ProxMenux token looks too short');
        nsec[tokenKey] = p.token.trim();
      }
    }

    if (Array.isArray(b.calendars)) {
      if (b.calendars.length > 10) throw bad('At most 10 calendars');
      const inCfg = new Set((cfg.calendars || []).map((c) => c.secret));
      const known = new Set([...inCfg, ...Object.keys(secrets.ical || {})]);   // a saved but unused link can be switched on again
      const people = new Set(getPeopleIds());
      const used = new Set(), list = [];
      for (const c of b.calendars) {
        const name = String(c.name || '').trim().slice(0, 40);
        if (!name) throw bad('Every calendar needs a name');
        let key = c.key && known.has(c.key) ? c.key : null;
        if (!key) { do { key = 'cal-' + slug(name) + '-' + crypto.randomBytes(2).toString('hex'); } while (used.has(key) || known.has(key)); }
        used.add(key);
        if (typeof c.url === 'string' && c.url.trim()) nsec.ical[key] = cleanUrl(c.url, 'The link for "' + name + '"');
        if (!nsec.ical[key]) throw bad('Paste the iCal link for "' + name + '"');
        list.push({ name, secret: key, people: (Array.isArray(c.people) ? c.people : []).filter((id) => people.has(id)) });
      }
      Object.keys(nsec.ical).forEach((k) => { if (!used.has(k) && inCfg.has(k)) delete nsec.ical[k]; });   // a calendar you remove loses its link; an already-unused saved link stays
      ncfg.calendars = list;
    }

    if (b.accounts && typeof b.accounts === 'object') {
      nsec.accounts = nsec.accounts || {};
      Object.keys(b.accounts).forEach((id) => {
        const p = accounts.providers[id], a = b.accounts[id] || {};
        if (!Object.hasOwn(accounts.providers, id)) throw bad('unknown account "' + id + '"');
        if (a.unlink) delete nsec.accounts[id];
        else if (typeof a.authJson === 'string' && a.authJson.trim()) nsec.accounts[id] = p.parse(a.authJson);
      });
      if (!Object.keys(nsec.accounts).length) delete nsec.accounts;
    }

    if (typeof b.adminPassword === 'string' && b.adminPassword !== '') {
      if (b.adminPassword.length < 8) throw bad('The admin password needs at least 8 characters');
      nsec.admin_password = b.adminPassword;
      out.passwordChanged = true;
    }
    if (b.agentsToken !== undefined) {
      if (b.agentsToken === 'regenerate') { nsec.agents_token = crypto.randomBytes(24).toString('hex'); out.generatedAgentsToken = nsec.agents_token; }
      else if (typeof b.agentsToken === 'string' && b.agentsToken.length >= 16) nsec.agents_token = b.agentsToken;
      else throw bad('The collector token needs at least 16 characters');
    }

    // ---- commit: files first (config keeps any keys this page does not manage), then the running process
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8').replace(/^﻿/, '')); } catch (e) { raw = {}; }
    raw.timezone = ncfg.timezone; raw.weather = ncfg.weather; raw.calendars = ncfg.calendars;
    raw.homelab = ncfg.homelab;
    raw.homeassistant = ncfg.homeassistant;
    raw.proxmenux = Object.assign({}, raw.proxmenux || {}, { url: ncfg.proxmenux.url, tokenSecret: ncfg.proxmenux.tokenSecret, insecureTLS: ncfg.proxmenux.insecureTLS });
    writeJsonAtomic(cfgFile, raw, 0o644);
    writeJsonAtomic(secFile, nsec, 0o600);

    cfg.timezone = ncfg.timezone; process.env.TZ = ncfg.timezone;
    cfg.weather = ncfg.weather; cfg.proxmenux = ncfg.proxmenux; cfg.calendars = ncfg.calendars;
    cfg.homelab = ncfg.homelab;
    cfg.homeassistant = ncfg.homeassistant;
    Object.keys(secrets).forEach((k) => delete secrets[k]); Object.assign(secrets, nsec);
    homelab.clear(); nas.clearCache(); weather.reset(); if (b.homeassistant) homeassistant.clear();
    return out;
  }

  /** Which folders feed the frame. Paths are relative to the photos root and must exist inside it. */
  function setPhotoFolders(list, root) {
    if (!Array.isArray(list)) throw bad('folders must be a list');
    if (list.length > 60) throw bad('At most 60 folders');
    const path = require('path');
    const clean = [], skipped = [];
    for (const r of list) {
      const rel = String(r).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || '.';
      const full = path.resolve(root, rel);
      if (full !== root && !full.startsWith(root + path.sep)) throw bad('"' + rel + '" is outside the photos folder');
      // a folder that was deleted or renamed on the NAS is dropped, not an error (the page still holds it from the old setting)
      if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) { if (!skipped.includes(rel)) skipped.push(rel); continue; }
      if (!clean.includes(rel)) clean.push(rel);
    }
    if (!clean.length) throw bad(skipped.length ? 'None of the chosen folders exist any more. Tick at least one folder that is listed.' : 'Choose at least one folder');
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { raw = {}; }
    raw.photoFolders = clean;
    writeJsonAtomic(cfgFile, raw, 0o644);
    cfg.photoFolders = clean;
    return { saved: clean, skipped };
  }

  async function test(b) {
    if (b.what === 'calendar') {
      const url = (typeof b.url === 'string' && b.url.trim()) ? cleanUrl(b.url, 'The link') : (secrets.ical && secrets.ical[b.key]);
      if (!url) throw bad('No link to test yet');
      return calendar.testFeed(url);
    }
    if (b.what === 'homelab') { homelab.clear(); return homelab.get(cfg, { secrets }); }
    if (b.what === 'proxmenux') {
      const r = await nas.getNas(cfg, secrets);
      return { ok: !!r.ok, error: r.ok ? null : (r.errors && r.errors[0]) || 'no answer', host: r.host && r.host.name, guests: r.guests && r.guests.total };
    }
    if (b.what === 'account') return accounts.test(secrets, b.id);
    if (b.what === 'homeassistant') {
      try { const entities = await homeassistant.discover(cfg, secrets); return { ok: true, entities }; }
      catch (e) { return { ok: false, error: e.message }; }
    }
    throw bad('unknown test');
  }

  /** Put back a backed-up config.json (settings only, never secrets). The current file is kept first. */
  function restore(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.calendars)) throw bad('That backup is not a Frame settings file');
    cleanTimezone(raw.timezone);
    if (raw.weather) cleanWeather(raw.weather);
    if (raw.homelab) raw.homelab = homelab.cleanSettings(raw.homelab);
    if (raw.homeassistant) raw.homeassistant = homeassistant.cleanSettings(raw.homeassistant);
    require('./backup').snapshot(cfgFile, true);
    let cur = {};
    try { cur = JSON.parse(fs.readFileSync(cfgFile, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { cur = {}; }
    ['timezone', 'weather', 'calendars', 'proxmenux', 'photoFolders', 'homeassistant', 'homelab'].forEach((k) => { if (raw[k] !== undefined) cur[k] = raw[k]; });
    if (raw.homeassistant && raw.homeassistant.url !== (cfg.homeassistant?.url || '') && secrets.homeassistant_token) {
      delete secrets.homeassistant_token;
      writeJsonAtomic(secFile, secrets, 0o600);
    }
    for (const id of ['pihole', 'gitea']) {
      const key = 'homelab_' + id + '_token';
      if (raw.homelab && raw.homelab[id] !== (cfg.homelab?.[id] || '') && secrets[key]) { delete secrets[key]; writeJsonAtomic(secFile, secrets, 0o600); }
    }
    if (raw.homelab && raw.homelab.pihole !== (cfg.homelab?.pihole || '') && secrets.homelab_pihole_password) {
      delete secrets.homelab_pihole_password; writeJsonAtomic(secFile, secrets, 0o600);
    }
    writeJsonAtomic(cfgFile, cur, 0o644);
    ['timezone', 'weather', 'calendars', 'proxmenux', 'photoFolders', 'homeassistant', 'homelab'].forEach((k) => { if (raw[k] !== undefined) cfg[k] = raw[k]; });
    process.env.TZ = cfg.timezone;
    homelab.clear(); nas.clearCache(); weather.reset(); homeassistant.clear();
  }

  return { view, apply, test, setPhotoFolders, restore };
};
