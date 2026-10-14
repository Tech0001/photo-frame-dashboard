'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const net = require('node:net');
const path = require('node:path');
const run = promisify(execFile);
const bad = message => Object.assign(new Error(message), { userError: true });
const ACTIONS = ['gravity', 'restart', 'reboot', 'update'];
const defaults = () => ({ host: '', user: 'pi', port: 22, identityFile: '' });
function clean(value) {
  const v = Object.assign(defaults(), value || {});
  for (const k of ['host', 'user', 'identityFile']) v[k] = String(v[k] || '').trim();
  if (v.host && !(net.isIP(v.host) || /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(v.host))) throw bad('Pi-hole SSH: enter a hostname or IP address');
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(v.user)) throw bad('Pi-hole SSH: enter a valid username');
  v.port = Number(v.port); if (!Number.isInteger(v.port) || v.port < 1 || v.port > 65535) throw bad('Pi-hole SSH: port must be 1–65535');
  if (v.identityFile && (!path.isAbsolute(v.identityFile) || /[\x00-\x1f]/.test(v.identityFile))) throw bad('Pi-hole SSH: enter the absolute key file path on the hub');
  return { host: v.host, user: v.user, port: v.port, identityFile: v.identityFile };
}
const safeText = v => typeof v === 'string' ? v.slice(0, 160) : '';
const iso = v => Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
function summarize(raw) {
  if (raw?.protocol !== 1 || raw.kind !== 'frame-pihole') throw Error('Invalid helper response');
  const job = raw.job && ACTIONS.includes(raw.job.action) && ['queued', 'running', 'reboot_requested', 'succeeded', 'failed', 'interrupted'].includes(raw.job.state) ? { action: raw.job.action, state: raw.job.state, started: iso(raw.job.started), finished: iso(raw.job.finished) } : null;
  return { configured: true, state: 'ok', detail: 'Management connected', os: safeText(raw.os), uptimeSeconds: typeof raw.uptimeSeconds === 'number' && raw.uptimeSeconds >= 0 ? raw.uptimeSeconds : null, bootedAt: iso(raw.bootedAt), softwareUpdatedAt: iso(raw.softwareUpdatedAt),
    versions: Array.isArray(raw.versions) ? raw.versions.slice(0, 3).map(v => ({ name: safeText(v.name), current: safeText(v.current) || null, latest: safeText(v.latest) || null, update: typeof v.update === 'boolean' ? v.update : null })) : [],
    actions: Array.isArray(raw.actions) ? raw.actions.filter(a => ACTIONS.includes(a)) : [], updateReason: safeText(raw.updateReason), job };
}
function create(execute = run) {
  async function call(settings, action) {
    const s = clean(settings);
    if (!s.host || !s.identityFile) throw bad('Set the Pi-hole SSH host and restricted key file first');
    if (action !== 'status' && !ACTIONS.includes(action)) throw bad('Unknown Pi-hole action');
    try {
      const { stdout } = await execute('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=4', '-o', 'ConnectionAttempts=1', '-i', s.identityFile, '-p', String(s.port), s.user + '@' + s.host, action], { timeout: 8000, maxBuffer: 65536, windowsHide: true });
      return JSON.parse(stdout);
    } catch (_) { throw bad('Pi-hole management unavailable; check the restricted SSH key, known host and installed helper on the server'); }
  }
  async function status(settings) {
    const s = clean(settings);
    if (!s.host || !s.identityFile) return { configured: false, state: 'off', detail: 'Management is not connected', actions: [], job: null };
    try { return summarize(await call(s, 'status')); }
    catch (_) { return { configured: true, state: 'unknown', detail: 'Pi-hole management unavailable', actions: [], job: null }; }
  }
  async function action(settings, name, confirmation) {
    if (!ACTIONS.includes(name) || confirmation !== name) throw bad('Confirm the specific Pi-hole action first');
    const s = await status(settings);
    if (!s.actions.includes(name)) throw bad(name === 'update' && s.updateReason ? s.updateReason : 'This Pi-hole action is currently unavailable');
    const r = await call(settings, name);
    if (r?.accepted !== true) throw bad(safeText(r?.error) || 'Pi-hole did not accept the action');
    return { accepted: true, action: name, detail: 'Action accepted. Check management status for its result.' };
  }
  return { status, action };
}
module.exports = { defaults, clean, ...create(), _internal: { create, summarize } };
