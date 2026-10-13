'use strict';
const crypto = require('node:crypto');
const { json } = require('./homelab-details')._internal;
const cleanText = (v, n = 160) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, n) : '';
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
function pushes(events) {
  if (!Array.isArray(events)) throw Error('Invalid events');
  return events.filter(e => e?.type === 'PushEvent' && e.public === true && /^[\w.-]+\/[\w.-]+$/.test(e.repo?.name || '') && Number.isFinite(Date.parse(e.created_at)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
function createReader({ request = fetch, clock = Date.now } = {}) {
  let cached, pending;
  let pollMs = 15 * 60 * 1000;
  async function read(login, token) {
    const headers = { 'User-Agent': 'Home-HQ-frame-hub', 'X-GitHub-Api-Version': '2026-03-10', ...(token ? { Authorization: 'Bearer ' + token } : {}) };
    const budget = AbortSignal.timeout(8000);
    const get = suffix => json((url, options) => request(url, { ...options, signal: AbortSignal.any([budget, options.signal]) }), 'https://api.github.com' + suffix, headers);
    let user;
    try { user = (await get('/users/' + encodeURIComponent(login))).data; if (!user.login || count(user.public_repos) === null) throw Error(); }
    catch (_) { return { state: 'unknown', detail: 'GitHub unavailable; check the account, optional token or API limit', updated: new Date(clock()).toISOString() }; }
    const results = await Promise.allSettled([
      get('/users/' + encodeURIComponent(user.login) + '/events/public?per_page=100'),
      get('/search/issues?q=' + encodeURIComponent('user:' + user.login + ' is:open is:pr') + '&per_page=1'),
      get('/search/issues?q=' + encodeURIComponent('user:' + user.login + ' is:open is:issue') + '&per_page=1')
    ]);
    const out = { state: 'ok', detail: 'Public activity loaded', login: cleanText(user.login, 39), repositories: count(user.public_repos), openPulls: null, openIssues: null, pushes: null, recentPushes: null, updated: new Date(clock()).toISOString(), missing: [] };
    for (const [index, key] of [[1, 'openPulls'], [2, 'openIssues']]) {
      const r = results[index];
      if (r.status === 'fulfilled' && r.value.data.incomplete_results === false) out[key] = count(r.value.data.total_count);
      if (out[key] === null) out.missing.push(key);
    }
    try {
      if (results[0].status !== 'fulfilled') throw Error();
      const interval = Number(results[0].value.headers.get('x-poll-interval'));
      pollMs = Number.isFinite(interval) && interval > 0 ? Math.max(15 * 60 * 1000, interval * 1000) : 15 * 60 * 1000;
      const events = pushes(results[0].value.data);
      out.recentPushes = events.length;
      out.pushes = await Promise.all(events.slice(0, 6).map(async e => {
        const branch = cleanText(e.payload?.ref, 80).replace(/^refs\/heads\//, '');
        const head = /^[a-f0-9]{40}$/i.test(e.payload?.head || '') ? e.payload.head : '';
        let title = 'Push' + (branch ? ' to ' + branch : '');
        if (head) {
          try { const r = await get('/repos/' + e.repo.name + '/commits/' + head); title = cleanText(r.data.commit?.message?.split(/\r?\n/)[0], 180) || title; } catch (_) { /* A push remains valid without its commit detail. */ }
        }
        return { repository: cleanText(e.repo.name, 120), actor: cleanText(e.actor?.login, 39), branch, at: new Date(e.created_at).toISOString(), title, sha: head.slice(0, 7), commits: count(e.payload?.size) };
      }));
    } catch (_) { out.missing.push('pushes'); }
    if (out.missing.length) { out.state = 'warning'; out.detail = 'Some GitHub activity is unavailable; check the API limit or token'; }
    return out;
  }
  return { async get(login, token) {
    if (!login) return { state: 'off', detail: 'Add a GitHub account in server Connections → Homelab' };
    const key = crypto.createHash('sha256').update(JSON.stringify([login, token])).digest('hex');
    if (cached?.key === key && clock() - cached.at < pollMs) return cached.data;
    if (pending?.key === key) return pending.promise;
    const promise = read(login, token).then(data => { cached = { key, at: clock(), data }; return data; });
    pending = { key, promise };
    try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
  } };
}
module.exports = { createReader, _internal: { pushes } };
