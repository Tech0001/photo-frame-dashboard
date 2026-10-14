'use strict';
const crypto = require('node:crypto');
const { json } = require('./homelab-details')._internal;
const cleanText = (v, n = 160) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, n) : '';
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
function contributions(html, now) {
  // Read selected values from GitHub's public calendar. Never embed remote HTML.
  const attrs = tag => Object.fromEntries(Array.from(tag.matchAll(/([\w-]+)="([^"]*)"/g), m => [m[1], m[2]]));
  const counts = new Map(), dates = new Map();
  for (const m of html.matchAll(/<tool-tip\b([^>]*)>([^<]*)<\/tool-tip>/g)) {
    const a = attrs(m[1]), value = m[2].trim().match(/^(No|[\d,]+) contributions? on /);
    if (!a.for || !value) continue;
    const n = value[1] === 'No' ? 0 : Number(value[1].replace(/,/g, ''));
    if (count(n) !== null && !counts.has(a.for)) counts.set(a.for, n);
  }
  for (const m of html.matchAll(/<td\b([^>]*)>/g)) {
    const a = attrs(m[1]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a['data-date'] || '') || !counts.has(a.id)) continue;
    if (dates.has(a['data-date'])) throw Error('Duplicate calendar date');
    dates.set(a['data-date'], counts.get(a.id));
  }
  const today = new Date(now).toISOString().slice(0, 10);
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 41 + i);
    const date = d.toISOString().slice(0, 10);
    if (!dates.has(date)) throw Error('Incomplete calendar');
    return { date, count: dates.get(date) };
  });
  return { days, today: days[41].count, week: days.slice(-7).reduce((n, d) => n + d.count, 0) };
}
async function publicCalendar(request, login, signal, now) {
  const r = await request('https://github.com/users/' + encodeURIComponent(login) + '/contributions', {
    method: 'GET', headers: { Accept: 'text/html', 'Accept-Language': 'en-US', 'User-Agent': 'Home-HQ-frame-hub' },
    redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(4000)])
  });
  if (!r.ok || !r.body) { if (r.body) await r.body.cancel(); throw Error('Calendar unavailable'); }
  const reader = r.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) throw Error('Calendar too large'); chunks.push(Buffer.from(value)); }
  } finally { await reader.cancel().catch(() => {}); }
  return contributions(Buffer.concat(chunks).toString('utf8'), now);
}
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
      get('/search/issues?q=' + encodeURIComponent('user:' + user.login + ' is:open is:issue') + '&per_page=1'),
      publicCalendar(request, user.login, budget, clock())
    ]);
    const out = { state: 'ok', detail: 'Public activity loaded', login: cleanText(user.login, 39), repositories: count(user.public_repos), openPulls: null, openIssues: null, contributions: null, pushes: null, recentPushes: null, updated: new Date(clock()).toISOString(), missing: [] };
    if (results[3].status === 'fulfilled') out.contributions = results[3].value;
    else out.missing.push('contributions');
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
module.exports = { createReader, _internal: { pushes, contributions } };
