'use strict';
// Read-only view of ProxMenux Monitor. The API token lives only here on the NAS; the frame is only
// ever given the summary numbers. ProxMenux tokens cannot be limited to read-only, so we only ever
// issue GET requests and never forward arbitrary paths.
const https = require('https');

const tune = require('./tune');
const ttlMs = () => tune.get('nasSec') * 1000;   // /admin > Settings > Refresh rates
const ENDPOINTS = {
  system: '/api/system',
  storage: '/api/storage/summary',
  vms: '/api/vms',
  network: '/api/network/summary',
  disks: '/api/storage',
  health: '/api/health/status'
};

const cache = new Map();

function getJson(base, pth, token, insecure) {
  const url = new URL(pth, base.endsWith('/') ? base : base + '/');
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      timeout: 8000,
      rejectUnauthorized: !insecure
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(pth + ' -> HTTP ' + res.statusCode + ' ' + text.slice(0, 120)));
        try { resolve(JSON.parse(text)); } catch (e) { reject(new Error(pth + ' -> not JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(pth + ' -> timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function fetchRaw(cfg, secrets, name) {
  const p = cfg.proxmenux, token = secrets[p.tokenSecret];
  if (!p.url) throw new Error('proxmenux.url is not set in config.json');
  if (!token) throw new Error('no "' + p.tokenSecret + '" in secrets.json');
  if (!ENDPOINTS[name]) throw new Error('unknown endpoint ' + name);
  const key = name;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs()) return hit.data;
  const data = await getJson(p.url, ENDPOINTS[name], token, p.insecureTLS);
  cache.set(key, { at: Date.now(), data });
  return data;
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null));
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return null; };
const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10);
const pct = (v) => { const n = num(v); return n === null ? null : round1(n); };

/** "2 days, 1:20:14" or "1:20:14" -> seconds. */
function uptimeSeconds(v) {
  if (typeof v === 'number') return v;
  const m = /^(?:(\d+)\s*days?,\s*)?(\d+):(\d+):(\d+)/.exec(String(v || ''));
  return m ? (+m[1] || 0) * 86400 + +m[2] * 3600 + +m[3] * 60 + +m[4] : null;
}
/** "58.2T" / "14.6T" / "512G" -> bytes. */
function sizeBytes(v) {
  const m = /^([\d.]+)\s*([KMGTP])/i.exec(String(v || ''));
  if (!m) return null;
  return parseFloat(m[1]) * Math.pow(1024, 'KMGTP'.indexOf(m[2].toUpperCase()) + 1);
}
const asArray = (v, ...keys) => Array.isArray(v) ? v : (v && keys.map((k) => v[k]).find(Array.isArray)) || [];

/** Map ProxMenux Monitor's responses (as seen on v1.2+) to the small summary the dashboard draws. Every field is optional. */
function summarize(raw) {
  const sys = raw.system || {}, sto = raw.storage || {}, dsk = raw.disks || {}, net = raw.network || {}, h = raw.health || {};
  const guests = asArray(raw.vms, 'vms', 'items', 'data').map((v) => ({
    id: pick(v, 'vmid', 'id'), name: pick(v, 'name') || ('#' + pick(v, 'vmid', 'id')),
    type: pick(v, 'type') === 'qemu' ? 'vm' : (pick(v, 'type') || 'vm'), status: pick(v, 'status') || 'unknown',
    cpu: pct(pick(v, 'cpu')), mem: num(pick(v, 'mem')), maxmem: num(pick(v, 'maxmem')), uptime: num(pick(v, 'uptime'))
  }));
  const disks = asArray(dsk, 'disks').map((d) => ({
    device: pick(d, 'name', 'device'), model: pick(d, 'model'), size: pick(d, 'size_formatted', 'size'), type: pick(d, 'connection_type', 'type'),
    temp: num(pick(d, 'temperature', 'temp')), health: pick(d, 'smart_status', 'health'), hours: num(pick(d, 'power_on_hours')),
    system: !!d.is_system_disk
  }));
  const pools = asArray(dsk, 'zfs_pools').map((p) => {
    const size = sizeBytes(p.size), used = sizeBytes(p.allocated);
    return { name: p.name, size: p.size, allocated: p.allocated, free: p.free, health: p.health, pct: size && used !== null ? round1(used / size * 100) : null };
  });
  // overall figure: the biggest ZFS pool if there is one, otherwise used/(used+available) from the summary (GB)
  let total = null, used = null, free = null, p = null;
  if (pools.length) {
    const big = pools.slice().sort((a, b) => (sizeBytes(b.size) || 0) - (sizeBytes(a.size) || 0))[0];
    total = sizeBytes(big.size); used = sizeBytes(big.allocated); free = sizeBytes(big.free); p = big.pct;
  } else if (num(sto.used) !== null && num(sto.available) !== null) {
    used = sto.used * 1e9; free = sto.available * 1e9; total = used + free; p = round1(used / total * 100);
  }
  const ifaces = [].concat(asArray(net, 'bridge_interfaces'), asArray(net, 'physical_interfaces'), asArray(net, 'interfaces', 'data')).map((i) => ({
    name: pick(i, 'name', 'interface'), ip: (i.addresses && i.addresses[0] && i.addresses[0].ip) || pick(i, 'ip', 'address'), state: pick(i, 'status', 'state')
  }));
  const load = Array.isArray(sys.load_average) ? num(sys.load_average[0]) : null;
  return {
    host: {
      name: pick(sys, 'hostname', 'proxmox_node', 'node'), pve: pick(sys, 'proxmox_version', 'pve_version', 'version'), kernel: pick(sys, 'kernel_version', 'kernel'),
      cpu: pct(pick(sys, 'cpu_usage', 'cpu')), mem: pct(pick(sys, 'memory_usage', 'mem_usage')),
      memUsed: round1(num(sys.memory_used)), memTotal: round1(num(sys.memory_total)),   // GB
      temp: round1(num(pick(sys, 'temperature', 'cpu_temp', 'temp'))), uptime: uptimeSeconds(sys.uptime),
      threads: num(sys.cpu_threads), load: round1(load), updates: num(sys.available_updates)
    },
    storage: { total, used, free, pct: p, pools, disks, diskCount: num(pick(dsk, 'disk_count') || pick(sto, 'disk_count')) || disks.length,
      warnings: num(dsk.warning_disks), critical: num(dsk.critical_disks) },
    guests: {
      total: guests.length, running: guests.filter((g) => g.status === 'running').length,
      list: guests.sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || (a.id || 0) - (b.id || 0))
    },
    net: ifaces,
    health: { status: pick(h, 'status', 'overall', 'state') || null, issues: num(pick(h, 'active_errors', 'errors', 'warnings')) }
  };
}

async function getNas(cfg, secrets) {
  const raw = {}, errors = [];
  if (!cfg.proxmenux.url || !secrets[cfg.proxmenux.tokenSecret]) {
    const why = !cfg.proxmenux.url ? 'proxmenux.url is not set in config.json' : 'no "' + cfg.proxmenux.tokenSecret + '" in secrets.json';
    return Object.assign({ ok: false, configured: false, errors: [why], updated: new Date().toISOString() }, summarize({}));
  }
  await Promise.all(Object.keys(ENDPOINTS).map(async (name) => {
    try { raw[name] = await fetchRaw(cfg, secrets, name); } catch (e) { errors.push(String(e.message || e)); }
  }));
  const configured = !!(cfg.proxmenux.url && secrets[cfg.proxmenux.tokenSecret]);
  return Object.assign({ ok: Object.keys(raw).length > 0, configured, errors, updated: new Date().toISOString() }, summarize(raw));
}

function clearCache() { cache.clear(); }

module.exports = { getNas, fetchRaw, ENDPOINTS, clearCache };
