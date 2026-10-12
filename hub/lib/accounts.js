'use strict';
// Reads linked AI accounts: subscription limits and OpenRouter's current-key usage.
//
// Claude and Codex call undocumented endpoints with the login token of your own account. Such endpoints can
// change or disappear without notice, and the token gives broad access to the account, so it is stored only in secrets.json,
// is write-only in /admin, and is never sent to the frame. Nothing here refreshes or rewrites your login: when a token
// expires, the Agents card says so and you paste a fresh one.
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null));
const bad = (m) => Object.assign(new Error(m), { userError: true });

function jwtPayload(t) {
  try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); } catch (e) { return null; }
}
const jwtExpMs = (t) => { const p = jwtPayload(t); return p && num(p.exp) ? p.exp * 1000 : null; };

/** Key paths and value TYPES of a JSON answer (never the values), so a changed format can be diagnosed without exposing anything. */
function shapeOf(o, path, out, depth) {
  path = path || ''; out = out || []; depth = depth || 0;
  if (out.length > 80) return out;
  if (Array.isArray(o)) { out.push(path + '[] (' + o.length + ')'); if (o.length && depth < 4) shapeOf(o[0], path + '[0]', out, depth + 1); }
  else if (o && typeof o === 'object') { Object.keys(o).slice(0, 30).forEach((k) => { const v = o[k]; if (v && typeof v === 'object') { out.push(path + '/' + k + ' {}'); if (depth < 4) shapeOf(v, path + '/' + k, out, depth + 1); } else out.push(path + '/' + k + ': ' + (v === null ? 'null' : typeof v)); }); }
  return out;
}

// ---------------------------------------------------------------- ChatGPT / Codex plan limits
function parseCodexAuth(text) {
  let j;
  try { j = JSON.parse(String(text).trim()); } catch (e) { throw bad('That is not valid JSON. Paste the whole contents of the auth.json file.'); }
  const t = (j && j.tokens) || j || {};
  const access = typeof t.access_token === 'string' ? t.access_token : '';
  if (access.split('.').length !== 3) throw bad('No login token found. Paste the whole contents of the auth.json file that "codex login" created.');
  let account = typeof t.account_id === 'string' ? t.account_id : '';
  if (!account) { const p = jwtPayload(access), a = p && p['https://api.openai.com/auth']; account = (a && a.chatgpt_account_id) || ''; }
  return { access_token: access, account_id: account, saved_at: new Date().toISOString() };
}

/** Find every object that carries a used-percent plus a window length / reset time, wherever it sits in the answer. */
function findWindows(o, path, out) {
  if (Array.isArray(o)) { o.forEach((x, i) => findWindows(x, path + '[' + i + ']', out)); return out; }
  if (!o || typeof o !== 'object') return out;
  const used = num(o.used_percent != null ? o.used_percent : o.usedPercent);
  if (used !== null) {
    let winSec = num(o.limit_window_seconds != null ? o.limit_window_seconds : (o.window_seconds != null ? o.window_seconds : o.windowSeconds));
    const winMin = num(o.window_minutes != null ? o.window_minutes : o.windowMinutes);
    if (winSec === null && winMin !== null) winSec = winMin * 60;
    let leftSec = num([o.reset_after_seconds, o.resets_in_seconds, o.resetAfterSeconds, o.resetsInSeconds].find((x) => x != null));
    const at = num([o.reset_at, o.resets_at, o.resetAt, o.resetsAt].find((x) => x != null));
    if (leftSec === null && at !== null) leftSec = Math.max(0, (at > 1e12 ? at : at * 1000) / 1000 - Date.now() / 1000);
    out.push({ path, used, winSec, leftSec });
  }
  Object.keys(o).forEach((k) => findWindows(o[k], path + '/' + k, out));
  return out;
}
function windowLabel(w) {
  const s = w.winSec;
  if (s !== null) { if (s <= 6 * 3600) return 'Session · ' + Math.round(s / 3600) + ' h'; if (s >= 6 * 86400 && s <= 8 * 86400) return 'Weekly'; if (s >= 25 * 86400 && s <= 35 * 86400) return 'Monthly'; return Math.round(s / 3600) + ' h window'; }
  if (/primary/i.test(w.path)) return 'Session'; if (/secondary/i.test(w.path)) return 'Weekly';
  return 'Limit';
}

async function fetchCodex(creds) {
  const exp = jwtExpMs(creds.access_token);
  if (exp && exp < Date.now()) throw new Error('The saved login token has expired. Paste a fresh auth.json (run "codex login" again).');
  const headers = { Authorization: 'Bearer ' + creds.access_token, Accept: 'application/json', 'User-Agent': 'codex-cli' };
  if (creds.account_id) headers['ChatGPT-Account-Id'] = creds.account_id;
  const res = await fetch('https://chatgpt.com/backend-api/wham/usage', { headers, signal: AbortSignal.timeout(15000) });
  if (res.status === 401 || res.status === 403) throw new Error('ChatGPT rejected the login token (expired or revoked). Paste a fresh auth.json.');
  if (!res.ok) throw new Error('ChatGPT answered HTTP ' + res.status);
  const j = await res.json();
  const wins = findWindows(j, '', []);
  const meters = wins.filter((w) => w.used >= 0).slice(0, 4).map((w) => ({
    label: windowLabel(w), used: Math.max(0, Math.min(100, Math.round(w.used))),
    win: w.winSec !== null ? Math.round(w.winSec / 60) : (/secondary/i.test(w.path) ? 10080 : 300),
    leftMin: w.leftSec !== null ? Math.max(0, Math.round(w.leftSec / 60)) : 0
  }));
  const plan = typeof j.plan_type === 'string' ? j.plan_type : (typeof j.planType === 'string' ? j.planType : '');
  return { plan, meters, shape: shapeOf(j) };
}

const providers = {
  codex: {
    id: 'codex', name: 'Codex', defaultPlan: 'ChatGPT', color: '#10A37F', label: 'ChatGPT / Codex', unofficial: true,
    parse: parseCodexAuth, fetch: fetchCodex, expiry: (c) => jwtExpMs(c.access_token)
  },
  claude: require('./account-providers').claude,
  openrouter: require('./account-providers').openrouter
};

/** What the admin page may show about linked accounts. Never the credentials. */
function status(secrets) {
  const acc = secrets.accounts || {};
  return Object.values(providers).map((p) => {
    const c = acc[p.id], exp = c ? p.expiry(c) : null;
    return { id: p.id, name: p.label, unofficial: p.unofficial, linked: !!c, expiresAt: exp, expired: !!(exp && exp < Date.now()) };
  });
}

let running = null, lastRun = 0, rerun = false;
/** Fetch every linked account and store the answer for the Agents screen. Rate-limited so taps cannot hammer the provider. */
async function refreshAll(secrets, agents, force) {
  // Unlink removes only data read by this hub; independent collectors keep their data.
  for (const p of Object.values(providers)) {
    if (!(secrets.accounts && secrets.accounts[p.id])) agents.removeLinkedService(p.id);
  }
  if (running) { if (force) rerun = true; return running; }
  if (!force && Date.now() - lastRun < 30000) return;
  running = (async () => {
    lastRun = Date.now();
    for (const p of Object.values(providers)) {
      const c = secrets.accounts && secrets.accounts[p.id];
      if (!c) continue;
      try {
        const r = await p.fetch(c);
        if (!secrets.accounts || secrets.accounts[p.id] !== c) continue; // changed/unlinked while fetching
        agents.setService({ id: p.id, name: p.name, plan: r.plan ? r.plan[0].toUpperCase() + r.plan.slice(1) : p.defaultPlan, color: p.color, kind: r.kind || 'limits', unofficial: p.unofficial, meters: r.meters, credits: r.credits, error: '' });
      } catch (e) {
        if (secrets.accounts && secrets.accounts[p.id] === c) agents.setService({ id: p.id, name: p.name, plan: p.defaultPlan, color: p.color, kind: p.id === 'openrouter' ? 'credits' : 'limits', unofficial: p.unofficial }, String(e.message || e));
      }
    }
  })().finally(() => { running = null; if (rerun) { rerun = false; return refreshAll(secrets, agents, true); } });
  return running;
}

/** Diagnostic for the Test button: what came back, as field names and numbers only. */
async function test(secrets, id) {
  const p = providers[id], c = secrets.accounts && secrets.accounts[id];
  if (!Object.hasOwn(providers, id)) throw bad('unknown account');
  if (!c) throw bad('Link the account first (and save), then test');
  try {
    const r = await p.fetch(c);
    return { ok: true, plan: r.plan, meters: r.meters.map((m) => m.label + ' ' + m.used + '%'), credits: r.credits, shape: r.shape };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

module.exports = { providers, status, refreshAll, test, _internal: { findWindows, windowLabel, parseCodexAuth, shapeOf, jwtExpMs } };
