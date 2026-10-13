'use strict';
// Aggregate statistics only. Each poll owns and closes its API session; no DNS
// query list, session ID, password, or raw provider response reaches the frame.
const number = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const version = v => typeof v === 'string' && /^v?\d+(?:\.\d+)+(?:[.-][\w.-]+)?$/.test(v) ? v.slice(0, 40) : null;
function versions(raw) {
  return ['core', 'web', 'ftl'].map((key, i) => {
    const current = version(raw?.version?.[key]?.local?.version), latest = version(raw?.version?.[key]?.remote?.version);
    const parts = v => v.replace(/^v/, '').split('.').map(Number);
    let update = null;
    if (current && latest && /^v?\d+(\.\d+)+$/.test(current) && /^v?\d+(\.\d+)+$/.test(latest)) {
      const a = parts(current), b = parts(latest); update = false;
      for (let n = 0; n < Math.max(a.length, b.length); n++) { if ((a[n] || 0) !== (b[n] || 0)) { update = (b[n] || 0) > (a[n] || 0); break; } }
    }
    return { name: ['Pi-hole', 'Web interface', 'FTL'][i], current, latest, update };
  });
}
function baseUrl(address) {
  const u = new URL(address);
  u.pathname = u.pathname.replace(/\/(?:admin|api)(?:\/.*)?$/, '').replace(/\/$/, '') + '/api';
  u.search = ''; u.hash = ''; return u.href;
}
async function request(fetcher, base, endpoint, { method = 'GET', sid, password } = {}) {
  let r;
  try {
    r = await fetcher(base + endpoint, { method, redirect: 'error', signal: AbortSignal.timeout(4000), headers: {
      Accept: 'application/json', ...(sid ? { 'X-FTL-SID': sid } : {}), ...(password === undefined ? {} : { 'Content-Type': 'application/json' })
    }, ...(password === undefined ? {} : { body: JSON.stringify({ password }) }) });
  } catch { throw Error('Pi-hole v6 could not be reached'); }
  if (!r.ok) {
    if (r.body) await r.body.cancel();
    throw Error(r.status === 401 || r.status === 403 ? 'Pi-hole v6 sign-in rejected; save an application password in Connections → Homelab' : r.status === 429 ? 'Pi-hole sign-in is rate limited; wait before refreshing' : 'Pi-hole v6 API request failed (HTTP ' + r.status + ')');
  }
  if (method === 'DELETE') { if (r.body) await r.body.cancel(); return null; }
  if (!r.body) throw Error('Pi-hole v6 returned an empty response');
  const chunks = []; let size = 0;
  try {
    for await (const chunk of r.body) { size += chunk.length; if (size > 256 * 1024) throw Error(); chunks.push(Buffer.from(chunk)); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw Error('Pi-hole v6 returned an unreadable response'); }
}
async function get(settings, password, fetcher = fetch) {
  const out = { state: 'off', detail: 'Add a Pi-hole v6 application password in server Connections → Homelab', apiVersion: 6, period: 'Last 24 hours', queries: null, blocked: null, blockedPercent: null, clients: null, domains: null, blocking: null, gravityUpdated: null, versions: versions(null) };
  if (!settings.pihole || !password) return out;
  const base = baseUrl(settings.pihole); let sid;
  try {
    const auth = await request(fetcher, base, '/auth', { method: 'POST', password });
    if (auth?.session?.valid !== true || typeof auth.session.sid !== 'string' || !auth.session.sid || auth.session.sid.length > 256 || /[\r\n]/.test(auth.session.sid)) throw Error('Pi-hole v6 sign-in failed; use an application password if two-factor authentication is enabled');
    sid = auth.session.sid;
    const results = await Promise.allSettled(['/stats/summary', '/dns/blocking', '/info/version'].map(endpoint => request(fetcher, base, endpoint, { sid })));
    const stats = results[0].status === 'fulfilled' ? results[0].value : null;
    if (!stats || number(stats.queries?.total) === null) throw Error(results[0].reason?.message || 'Pi-hole v6 statistics are unavailable');
    Object.assign(out, { state: 'ok', detail: 'Statistics loaded', queries: number(stats.queries.total), blocked: number(stats.queries.blocked), blockedPercent: number(stats.queries.percent_blocked), clients: number(stats.clients?.active), domains: number(stats.gravity?.domains_being_blocked) });
    const when = number(stats.gravity?.last_update);
    out.gravityUpdated = when > 0 && Number.isFinite(new Date(when * 1000).getTime()) ? new Date(when * 1000).toISOString() : null;
    const blocking = results[1].status === 'fulfilled' ? results[1].value?.blocking : null;
    out.blocking = blocking === 'enabled' || blocking === true ? true : blocking === 'disabled' || blocking === false ? false : null;
    if (results[2].status === 'fulfilled') out.versions = versions(results[2].value);
    if (out.blocking === null || out.versions.some(v => !v.current)) { out.state = 'warning'; out.detail = 'Statistics loaded; some blocking or version details are unavailable'; }
  } catch (e) { out.state = 'unknown'; out.detail = e.message; }
  finally {
    if (sid) {
      try { await request(fetcher, base, '/auth', { method: 'DELETE', sid }); }
      catch { if (out.state === 'ok') { out.state = 'warning'; out.detail = 'Statistics loaded; the API session could not be closed and will expire'; } }
    }
  }
  return out;
}
module.exports = { get, _internal: { baseUrl, versions } };
