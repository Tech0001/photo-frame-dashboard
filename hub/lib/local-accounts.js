'use strict';
const crypto = require('node:crypto');
const IDS = ['codex', 'claude'];
const bad = message => Object.assign(new Error(message), { userError: true });
function enabled(secrets) { return IDS.filter(id => secrets.accounts?.[id]?.source === 'local'); }
function authorize(req, secrets) {
  const want = Buffer.from(String(secrets.local_accounts_token || '')), given = Buffer.from(String(req.headers['x-local-accounts-token'] || ''));
  if (!want.length || given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw bad('Missing or invalid local account sync token.');
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '') || req.headers['sec-fetch-site'] === 'cross-site') throw bad('Send local account usage as JSON.');
}
function publish(input, secrets, agents) {
  if (!input || !Array.isArray(input.services) || input.services.length > 2 || !input.services.length) throw bad('Send the selected local account services.');
  const allowed = enabled(secrets), seen = new Set();
  const rows = input.services.map(s => {
    if (!s || !allowed.includes(s.id) || seen.has(s.id)) throw bad('This account is not configured for local login sync.');
    seen.add(s.id);
    const error = s.error ? String(s.error).slice(0, 180) : '';
    if (!error && (!Array.isArray(s.meters) || !s.meters.length || s.meters.length > 4 || s.meters.some(m => !m || typeof m.used !== 'number' || !Number.isFinite(m.used) || m.used < 0 || m.used > 100 || typeof m.win !== 'number' || !Number.isFinite(m.win) || m.win <= 0))) throw bad('Send valid reported usage windows.');
    return { id: s.id, name: s.id === 'codex' ? 'Codex' : 'Claude', plan: String(s.plan || '').slice(0,40), color: s.id === 'codex' ? '#10A37F' : '#D97757', kind: 'limits', unofficial: true, meters: error ? [] : s.meters.map(m => ({ label: String(m.label || '').slice(0,40), used: m.used, win: m.win, leftMin: m.leftMin, resetAt: m.resetAt })), error };
  });
  rows.forEach(s => agents.setService(s, s.error, 'pc-login'));
  return { ok: true };
}
module.exports = { enabled, authorize, publish };
