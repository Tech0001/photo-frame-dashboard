'use strict';
// Read-only, bounded checks made by the hub. Never return addresses, paths or provider bodies to the frame.
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const details = require('./homelab-details');
const management = require('./pihole-management');
const bad = message => Object.assign(new Error(message), { userError: true });
const defaults = () => ({ pihole: '', piholeSsh: management.defaults(), gitea: '', giteaOrganization: '', plane: '', rustdesk: { host: '', idPort: 21116, relayPort: 21117 }, backup: { path: '', destination: '', label: 'VM backup', maxAgeHours: 36 } });
function cleanSettings(value) {
  const h = Object.assign(defaults(), value || {});
  for (const key of ['pihole', 'gitea', 'plane']) {
    const text = String(h[key] || '').trim();
    if (!text) { h[key] = ''; continue; }
    let u; try { u = new URL(text); } catch (_) { throw bad(key + ': enter a full http:// or https:// address'); }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.search || u.hash) throw bad(key + ': use a web address without credentials, query parameters or a fragment');
    h[key] = u.href;
  }
  const r = Object.assign(defaults().rustdesk, h.rustdesk || {});
  h.giteaOrganization = String(h.giteaOrganization || '').trim();
  if (h.giteaOrganization && !/^[a-z0-9_.-]{1,60}$/i.test(h.giteaOrganization)) throw bad('Gitea: enter the organization name, not its URL');
  r.host = String(r.host || '').trim();
  if (r.host && !(net.isIP(r.host) || /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(r.host))) throw bad('RustDesk: enter only a hostname or IP address');
  for (const key of ['idPort', 'relayPort']) { r[key] = Number(r[key]); if (!Number.isInteger(r[key]) || r[key] < 1 || r[key] > 65535) throw bad('RustDesk ports must be from 1 to 65535'); }
  const b = Object.assign(defaults().backup, h.backup || {});
  b.path = String(b.path || '').trim();
  if (b.path && (!path.isAbsolute(b.path) || !b.path.endsWith('.json') || b.path.includes('\0'))) throw bad('Time Machine: enter the absolute path to its status.json file on the hub server');
  b.destination = String(b.destination || '').trim().slice(0, 100);
  b.label = String(b.label || 'VM backup').trim().slice(0, 60) || 'VM backup';
  b.maxAgeHours = Number(b.maxAgeHours);
  if (!Number.isFinite(b.maxAgeHours) || b.maxAgeHours < 1 || b.maxAgeHours > 8760) throw bad('Backup overdue threshold must be 1–8760 hours');
  return { pihole: h.pihole, piholeSsh: management.clean(h.piholeSsh), gitea: h.gitea, giteaOrganization: h.giteaOrganization, plane: h.plane, rustdesk: { host: r.host, idPort: r.idPort, relayPort: r.relayPort }, backup: { path: b.path, destination: b.destination, label: b.label, maxAgeHours: b.maxAgeHours } };
}
function cleanToken(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{20,512}$/.test(value.trim())) throw bad('Enter a valid API token, without a URL or token label');
  return value.trim();
}
const iso = value => { const n = Date.parse(value); return Number.isFinite(n) ? new Date(n).toISOString() : null; };
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
function backupSummary(raw, settings, now = Date.now()) {
  const base = { configured: true, label: settings.label, state: 'unknown', detail: 'No backup result yet', lastSuccess: null };
  if (!raw || raw.version !== 1 || !raw.destinations || typeof raw.destinations !== 'object' || Array.isArray(raw.destinations)) return Object.assign(base, { detail: 'Unrecognized Time Machine status file' });
  const keys = Object.keys(raw.destinations);
  const key = settings.destination || (keys.length === 1 ? keys[0] : '');
  if (!key || !Object.hasOwn(raw.destinations, key)) return Object.assign(base, { detail: key ? 'Backup destination was not found' : 'Choose a backup destination in server settings' });
  const dest = raw.destinations[key], run = dest?.last_run || {}, success = iso(dest?.last_success_at), finished = iso(run.finished_at);
  const overdue = success ? now - Date.parse(success) > settings.maxAgeHours * 3600000 : false;
  const invalidTime = success && Date.parse(success) > now + 300000;
  const failed = run.result === 'error' || run.result === 'failed' || (typeof run.exit_code === 'number' && run.exit_code !== 0);
  const state = failed ? 'error' : invalidTime ? 'unknown' : overdue ? 'overdue' : success ? 'ok' : 'unknown';
  return Object.assign(base, {
    state, detail: failed ? 'Latest backup failed' : invalidTime ? 'Backup clock is ahead of the hub' : overdue ? 'No successful backup within ' + settings.maxAgeHours + ' hours' : success ? 'Last backup successful' : 'No successful backup recorded',
    lastSuccess: success, finished, durationSeconds: number(run.duration_seconds), snapshots: number(dest?.snapshot_count),
    repoBytes: number(dest?.repo_size_bytes), addedBytes: number(run.data_added_bytes), maxAgeHours: settings.maxAgeHours
  });
}
async function readBackup(settings, now) {
  if (!settings.path) return { configured: false, label: settings.label, state: 'off', detail: 'Not connected', lastSuccess: null };
  let file;
  try {
    file = await fs.open(settings.path, 'r');
    const stat = await file.stat(); if (!stat.isFile() || stat.size > 1024 * 1024) throw Error('invalid file');
    return backupSummary(JSON.parse(await file.readFile('utf8')), settings, now);
  } catch (_) { return { configured: true, label: settings.label, state: 'unknown', detail: 'Cannot read Time Machine status', lastSuccess: null }; }
  finally { if (file) await file.close(); }
}
function checkPort(host, port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => finish(false), 4000);
    function finish(ok) { clearTimeout(timer); socket.destroy(); resolve(ok); }
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
  });
}
async function smallJson(response) {
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 65536) throw Error('too large'); chunks.push(Buffer.from(value)); } }
  finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function createReader({ request = fetch, port = checkPort, backup = readBackup, clock = Date.now, manage = management.status } = {}) {
  let cached = null, pending = null, generation = 0;
  async function http(id, name, url) {
    const result = { id, name, configured: !!url, state: 'off', detail: 'Not connected' };
    if (!url) return result;
    try {
      const target = id === 'gitea' ? url.replace(/\/$/, '') + '/api/healthz' : url;
      const r = await request(target, { method: 'GET', signal: AbortSignal.timeout(4000), redirect: 'follow', headers: { Accept: id === 'gitea' ? 'application/json' : 'text/html' } });
      if (id === 'gitea' && r.ok) {
        const health = await smallJson(r);
        return Object.assign(result, { state: health.status === 'pass' ? 'ok' : 'error', detail: health.status === 'pass' ? 'Health check passed' : 'Health check did not pass' });
      }
      if (r.body) await r.body.cancel();
      return Object.assign(result, { state: r.ok ? 'ok' : r.status === 401 || r.status === 403 ? 'warning' : 'error', detail: r.ok ? 'Web interface responding' : r.status === 401 || r.status === 403 ? 'Responding · sign-in required' : 'HTTP ' + r.status });
    } catch (_) { return Object.assign(result, { state: 'error', detail: id === 'gitea' ? 'Health check unavailable' : 'Web interface unreachable' }); }
  }
  async function read(h, secrets, timezone) {
    const [pihole, gitea, plane, rustdesk, b, piDetails, gitDetails, piManagement] = await Promise.all([
      http('pihole', 'Pi-hole', h.pihole), http('gitea', 'Gitea', h.gitea), http('plane', 'Plane', h.plane),
      (async () => {
        if (!h.rustdesk.host) return { id: 'rustdesk', name: 'RustDesk', configured: false, state: 'off', detail: 'Not connected' };
        const [id, relay] = await Promise.all([port(h.rustdesk.host, h.rustdesk.idPort), port(h.rustdesk.host, h.rustdesk.relayPort)]);
        return { id: 'rustdesk', name: 'RustDesk', configured: true, state: id && relay ? 'ok' : 'error', detail: id && relay ? 'ID and relay ports responding' : (!id && !relay ? 'ID and relay ports unreachable' : !id ? 'ID port unreachable' : 'Relay port unreachable') };
      })(), backup(h.backup, clock()), details.pihole(h, secrets.homelab_pihole_token, request), details.gitea(h, secrets.homelab_gitea_token, timezone, request, clock()), manage(h.piholeSsh)
    ]);
    const services = [pihole, gitea, plane, rustdesk];
    piDetails.management = piManagement;
    if (piManagement.state === 'ok') {
      piDetails.versions = piManagement.versions;
      if (piDetails.state === 'off') { piDetails.state = 'warning'; piDetails.detail = 'Management connected; add an API token for DNS statistics'; }
    }
    return { kind: 'services', configured: services.some(s => s.configured) || b.configured || piManagement.configured, updated: new Date(clock()).toISOString(), services, backup: b, pihole: piDetails, gitea: gitDetails };
  }
  async function get(cfg, { refresh = false, secrets = {} } = {}) {
    const settings = cleanSettings(cfg.homelab), key = crypto.createHash('sha256').update(JSON.stringify([settings, cfg.timezone, secrets.homelab_pihole_token, secrets.homelab_gitea_token])).digest('hex'), now = clock();
    if (!refresh && cached?.key === key && now - cached.at < 5 * 60 * 1000) return cached.data;
    if (pending?.key === key) return pending.promise;
    const gen = generation, promise = read(settings, secrets, cfg.timezone).then(data => {
      if (generation === gen) cached = { key, data, at: clock() };
      return data;
    });
    pending = { key, promise };
    try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
  }
  return { get, clear: () => { generation++; cached = null; pending = null; } };
}
const reader = createReader();
module.exports = { defaults, cleanSettings, cleanToken, get: reader.get, clear: reader.clear, _internal: { createReader, backupSummary, readBackup, checkPort } };
