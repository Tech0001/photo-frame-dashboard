'use strict';
// Read-only integrations. Only selected aggregate/activity fields leave the hub.
const text = (v, max = 160) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '';
const number = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const stamp = v => Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const unavailable = detail => ({ state: 'unknown', detail });
const unlinked = () => ({ state: 'off', detail: 'Add an API token in server Connections → Homelab' });

async function json(request, url, headers = {}) {
  const r = await request(url, { method: 'GET', headers: { Accept: 'application/json', ...headers }, redirect: 'error', signal: AbortSignal.timeout(4000) });
  if (!r.ok) { if (r.body) await r.body.cancel(); throw Error(r.status === 401 || r.status === 403 ? 'Sign-in rejected; check the saved token and its permissions' : 'API request failed'); }
  if (!r.body) throw Error('Empty API response');
  const reader = r.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) throw Error('API response too large'); chunks.push(Buffer.from(value)); }
  } finally { await reader.cancel().catch(() => {}); }
  return { data: JSON.parse(Buffer.concat(chunks).toString('utf8')), headers: r.headers };
}
function total(r) {
  if (!Array.isArray(r.data)) throw Error('Invalid collection');
  const n = r.headers.get('x-total-count');
  if (n !== null && /^\d+$/.test(n) && Number.isSafeInteger(Number(n))) return Number(n);
  return r.data.length === 0 ? 0 : null;
}
function contributions(raw, now, timezone) {
  if (!Array.isArray(raw)) throw Error('Invalid contribution history');
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  function day(date) { const p = format.formatToParts(date), get = k => p.find(v => v.type === k).value; return get('year') + '-' + get('month') + '-' + get('day'); }
  const today = day(new Date(now)), byDay = {};
  for (const r of raw) {
    if (number(r?.timestamp) === null || number(r?.contributions) === null || !Number.isFinite(new Date(r.timestamp * 1000).getTime())) continue;
    const key = day(new Date(r.timestamp * 1000)); byDay[key] = (byDay[key] || 0) + r.contributions;
  }
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 41 + i); const date = d.toISOString().slice(0, 10); return { date, count: byDay[date] || 0 }; });
  return { days, today: days[41].count, week: days.slice(-7).reduce((n, d) => n + d.count, 0) };
}
function pushes(raw) {
  if (!Array.isArray(raw)) throw Error('Invalid activity feed');
  const unique = new Map();
  for (const e of raw) {
    if (e?.op_type !== 'commit_repo') continue;
    const repository = text(e.repo?.full_name, 120), at = stamp(e.created), actor = text(e.act_user?.login, 60), branch = text(e.ref_name, 80).replace(/^refs\/heads\//, '');
    if (!repository || !at) continue;
    let content = {}; try { content = JSON.parse(e.content || '{}') || {}; } catch (_) { /* missing detail is not a zero-commit push */ }
    const head = content.HeadCommit || content.Commits?.[0], count = number(content.Len);
    const key = JSON.stringify([repository, at, actor, branch]), old = unique.get(key);
    // Gitea may emit a second, empty companion event for the same push.
    if (old && (old.commits !== null || !head)) continue;
    unique.set(key, { repository, at, actor, branch, commits: count, title: text(typeof head?.Message === 'string' ? head.Message.split(/\r?\n/)[0] : '', 180) || 'Push details unavailable', sha: /^[a-f0-9]{7,64}$/i.test(head?.Sha1 || '') ? head.Sha1.slice(0, 7) : '' });
  }
  return [...unique.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 6);
}
async function gitea(settings, token, timezone, request = fetch, now = Date.now()) {
  if (!settings.gitea || !token) return unlinked();
  const base = settings.gitea.replace(/\/$/, '') + '/api/v1', headers = { Authorization: 'token ' + token };
  const get = suffix => json(request, base + suffix, headers);
  let login;
  try { login = (await get('/user')).data.login; if (typeof login !== 'string' || !login) throw Error(); }
  catch (_) { return unavailable('Cannot sign in to Gitea; check its address, token and permissions'); }
  const org = settings.giteaOrganization, owner = org ? '/orgs/' + encodeURIComponent(org) : '/users/' + encodeURIComponent(login);
  const results = await Promise.allSettled([
    get('/version'), get('/user/repos?limit=1'), get('/repos/issues/search?state=open&type=pulls&limit=1'),
    get('/repos/issues/search?state=open&type=issues&limit=1'), get('/users/' + encodeURIComponent(login) + '/heatmap'), get(owner + '/activities/feeds?limit=100')
  ]);
  const out = { state: 'ok', detail: 'Activity loaded', login: text(login, 60), organization: text(org, 60), version: null, repositories: null, openPulls: null, openIssues: null, contributions: null, pushes: null, missing: [] };
  const keys = ['version', 'repositories', 'openPulls', 'openIssues', 'contributions', 'pushes'];
  results.forEach((r, i) => {
    try {
      if (r.status !== 'fulfilled') throw Error();
      const v = r.value;
      out[keys[i]] = i === 0 ? text(v.data.version, 40) || null : i <= 3 ? total(v) : i === 4 ? contributions(v.data, now, timezone) : pushes(v.data);
      if (out[keys[i]] === null) throw Error();
    } catch (_) { out.missing.push(keys[i]); }
  });
  if (out.missing.length) { out.state = 'warning'; out.detail = 'Some activity is unavailable; check API access in server settings'; }
  return out;
}
function versions(raw) {
  const version = v => typeof v === 'string' && /^v?\d+(?:\.\d+)+(?:[.-][\w.-]+)?$/.test(v) ? v.slice(0, 40) : null;
  return ['core', 'web', 'FTL'].map(key => {
    const current = version(raw?.[key + '_current']), latest = version(raw?.[key + '_latest']);
    return { name: key === 'core' ? 'Pi-hole' : key === 'web' ? 'Web interface' : 'FTL', current, latest, update: current && latest && typeof raw[key + '_update'] === 'boolean' ? raw[key + '_update'] : null };
  });
}
async function pihole(settings, token, request = fetch) {
  if (!settings.pihole || !token) return unlinked();
  const base = new URL(settings.pihole);
  base.pathname = base.pathname.replace(/(?:\/admin(?:\/.*)?)?\/?$/, '/admin/api.php');
  const get = query => { const u = new URL(base); u.search = query; u.searchParams.set('auth', token); return json(request, u.href); };
  const [stats, version] = await Promise.allSettled([get('summaryRaw'), get('versions')]);
  const out = { state: 'ok', detail: 'Statistics loaded', queries: null, blocked: null, blockedPercent: null, clients: null, domains: null, blocking: null, gravityUpdated: null, versions: versions(version.status === 'fulfilled' ? version.value.data : null) };
  const s = stats.status === 'fulfilled' ? stats.value.data : null;
  if (!s || number(s.dns_queries_today) === null || s.FTLnotrunning) return { ...out, state: 'unknown', detail: s?.FTLnotrunning ? 'Pi-hole reports that FTL is not running' : 'Statistics unavailable; check the Pi-hole v5 API token in server settings' };
  Object.assign(out, { queries: number(s.dns_queries_today), blocked: number(s.ads_blocked_today), blockedPercent: number(s.ads_percentage_today), clients: number(s.unique_clients), domains: number(s.domains_being_blocked), blocking: s.status === 'enabled' ? true : s.status === 'disabled' ? false : null });
  const when = s.gravity_last_updated?.file_exists && number(s.gravity_last_updated.absolute);
  out.gravityUpdated = when > 0 && Number.isFinite(new Date(when * 1000).getTime()) ? new Date(when * 1000).toISOString() : null;
  return out;
}
module.exports = { gitea, pihole, _internal: { json, total, pushes, contributions, versions } };
