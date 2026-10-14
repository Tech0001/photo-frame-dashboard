'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const api = require('../lib/homelab-details');
const lab = require('../lib/homelab');
const token = 'PRIVATE_TOKEN_1234567890123456789';
const cfg = { gitea: 'http://git.example/sub/', pihole: 'http://pi.example/admin/', giteaOrganization: 'Team' };
const now = Date.parse('2026-10-12T19:00:00Z');
const event = content => ({ op_type: 'commit_repo', created: '2026-10-12T18:00:00Z', repo: { full_name: 'team/project', html_url: 'http://wrong-host/private' }, act_user: { login: 'alice', email: 'PRIVATE_EMAIL' }, ref_name: 'refs/heads/main', content: JSON.stringify(content) });
const commit = { Sha1: 'abc123456789', Message: 'Fix the clock\nPRIVATE_BODY', AuthorEmail: 'PRIVATE_EMAIL' };

test('recent pushes merge companion events, keep distinct branches, and expose no raw content or email', () => {
  const first = event({}), full = event({ Len: 2, HeadCommit: commit }), branch = { ...full, ref_name: 'refs/heads/other' };
  const result = api._internal.pushes([first, full, full, branch]);
  assert.equal(result.length, 2); assert.equal(result[0].commits, 2); assert.equal(result[0].title, 'Fix the clock'); assert.equal(result[0].sha, 'abc1234');
  assert(!JSON.stringify(result).includes('PRIVATE')); assert(!JSON.stringify(result).includes('wrong-host'));
  assert.equal(api._internal.pushes([event({})])[0].commits, null);
});
test('contribution buckets sum in the configured timezone and span calendar days across DST', () => {
  const heat = api._internal.contributions([{ timestamp: Date.parse('2026-10-13T01:00:00Z') / 1000, contributions: 2 }, { timestamp: Date.parse('2026-10-12T19:00:00Z') / 1000, contributions: 3 }], now, 'America/Denver');
  assert.equal(heat.days.length, 42); assert.equal(heat.today, 5); assert.equal(heat.week, 5); assert.equal(heat.days[41].date, '2026-10-12');
  const dst = api._internal.contributions([], Date.parse('2026-11-03T19:00:00Z'), 'America/Denver');
  assert.equal(new Set(dst.days.map(d => d.date)).size, 42);
});
test('Gitea uses configured origin, read-only auth, totals, selected feed, and reports partial failures', async () => {
  const urls = [];
  const result = await api.gitea(cfg, token, 'UTC', async (url, options) => {
    urls.push(url); assert(url.startsWith('http://git.example/sub/api/v1/')); assert.equal(options.redirect, 'error'); assert.equal(options.method, 'GET'); assert.equal(options.headers.Authorization, 'token ' + token);
    if (url.endsWith('/user')) return Response.json({ login: 'alice', email: 'PRIVATE_EMAIL' });
    if (url.endsWith('/version')) return Response.json({ version: '1.25.2' });
    if (url.endsWith('/heatmap')) return new Response('forbidden', { status: 403 });
    if (url.includes('/activities/feeds')) return Response.json([event({ Len: 2, HeadCommit: commit })]);
    return Response.json([{}], { headers: { 'X-Total-Count': '103', Link: '<http://wrong-host/?page=2>; rel="next"' } });
  }, now);
  assert.equal(result.repositories, 103); assert.equal(result.state, 'warning'); assert.deepEqual(result.missing, ['contributions']); assert.equal(result.contributions, null); assert.equal(result.pushes.length, 1);
  assert(urls.some(u => u.endsWith('/orgs/Team/activities/feeds?limit=100'))); assert.equal(urls.length, 7); assert(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(api._internal.total({ data: [{}], headers: new Headers() }), null, 'a one-row page is not a total');
  assert.equal(api._internal.total({ data: [], headers: new Headers() }), 0);
});
test('Gitea sign-in and malformed responses give unknown rather than zero statistics', async () => {
  const result = await api.gitea(cfg, token, 'UTC', async () => new Response('PRIVATE', { status: 401 }));
  assert.equal(result.state, 'unknown'); assert(!JSON.stringify(result).includes('PRIVATE')); assert.equal(result.repositories, undefined);
  await assert.rejects(api._internal.json(async () => new Response('a'.repeat(2 * 1024 * 1024 + 1)), 'http://example'));
});
test('Pi-hole v5 distinguishes blocklist refresh, disabled blocking and unknown software versions', async () => {
  const result = await api.pihole(cfg, token, async (url, options) => {
    const u = new URL(url); assert.equal(u.pathname, '/admin/api.php'); assert.equal(u.searchParams.get('auth'), token); assert.equal(options.redirect, 'error'); assert.equal(options.method, 'GET');
    if (u.searchParams.has('versions')) return Response.json({ core_current: 'N\\/A', core_latest: null, core_update: false, web_current: 'v5.21', web_latest: 'v5.22', web_update: true, FTL_current: 'v5.25', FTL_latest: 'v5.25', FTL_update: false });
    return Response.json({ dns_queries_today: 1234, ads_blocked_today: 120, ads_percentage_today: 9.7, unique_clients: 12, domains_being_blocked: 234567, status: 'disabled', gravity_last_updated: { file_exists: true, absolute: now / 1000 }, PRIVATE: token });
  });
  assert.equal(result.blocking, false); assert.equal(result.queries, 1234); assert.equal(result.gravityUpdated, new Date(now).toISOString());
  assert.equal(result.versions[0].update, null); assert.equal(result.versions[1].update, true); assert.equal(result.versions[2].update, false);
  assert(!JSON.stringify(result).includes('PRIVATE')); assert(!('softwareUpdated' in result));
  const failure = await api.pihole(cfg, token, async () => Response.json([])); assert.equal(failure.state, 'unknown'); assert.equal(failure.queries, null);
});