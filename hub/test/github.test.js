'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const github = require('../lib/github');
const lab = require('../lib/homelab');
function calendar(now) {
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(now); d.setUTCDate(d.getUTCDate() - 41 + i);
    return '<td id="day-' + i + '" data-date="' + d.toISOString().slice(0, 10) + '"></td><tool-tip for="day-' + i + '">' + (i % 3 ? i % 3 : 'No') + ' contributions on October 13th.</tool-tip>';
  }).join('');
}
test('GitHub validates account names and reads only public, selected fields', async () => {
  assert.throws(() => lab.cleanSettings({ github: 'https://github.com/me' }));
  const requests = [];
  const reader = github.createReader({ request: async (url, options) => {
    requests.push(url); assert.equal(options.method, 'GET');
    if (url.startsWith('https://github.com/')) {
      assert.equal(options.headers.Authorization, undefined, 'API token is never sent to the profile website');
      return new Response(calendar(Date.now()));
    }
    assert.equal(options.headers.Authorization, 'Bearer SECRET');
    if (url.includes('/events/public')) return Response.json([
      { type: 'PushEvent', public: true, repo: { name: 'me/repo' }, actor: { login: 'me' }, created_at: '2026-10-13T12:00:00Z', payload: { ref: 'refs/heads/main', head: 'a'.repeat(40) } },
      { type: 'PushEvent', public: false, repo: { name: 'PRIVATE/repo' }, created_at: '2026-10-13T12:00:00Z' }
    ]);
    if (url.includes('/commits/')) return Response.json({ commit: { message: 'Useful change\nPRIVATE BODY', author: { email: 'PRIVATE EMAIL' } } });
    if (url.includes('/search/issues')) return Response.json({ total_count: 3, incomplete_results: false, items: [{ body: 'PRIVATE BODY' }] });
    return Response.json({ login: 'me', public_repos: 7, email: 'PRIVATE EMAIL' });
  } });
  const data = await reader.get('me', 'SECRET');
  assert.equal(data.repositories, 7); assert.equal(data.openPulls, 3); assert.equal(data.pushes[0].title, 'Useful change');
  assert.equal(data.pushes[0].commits, null, 'current PushEvent omits commit counts; never invent zero');
  assert.equal(data.recentPushes, 1); assert(!JSON.stringify(data).includes('PRIVATE')); assert(!JSON.stringify(data).includes('SECRET'));
  assert.equal(data.contributions.days.length, 42);
  assert.equal(data.contributions.today, 2); assert.equal(data.contributions.week, 8);
  assert(requests.every(u => u.startsWith('https://api.github.com/') || u === 'https://github.com/users/me/contributions'));
});
test('GitHub caches and coalesces for fifteen minutes including Homelab refreshes; account/token changes invalidate it', async () => {
  let now = 0, calls = 0;
  const reader = github.createReader({ clock: () => now, request: async url => {
    calls++;
    return Response.json(url.includes('/events/') ? [] : url.includes('/search/') ? { total_count: 0, incomplete_results: false } : { login: 'me', public_repos: 0 });
  } });
  await Promise.all([reader.get('me'), reader.get('me')]); assert.equal(calls, 5);
  now = 301000; await reader.get('me'); assert.equal(calls, 5);
  now = 900001; await reader.get('me'); assert.equal(calls, 10);
  await reader.get('other'); assert.equal(calls, 15);
  await reader.get('other', 'token'); assert.equal(calls, 20);
});
test('failed or incomplete GitHub responses are unknown, not zero, and never leak provider errors', async () => {
  const rejected = github.createReader({ request: async () => new Response('PRIVATE', { status: 403 }) });
  const failure = await rejected.get('me'); assert.equal(failure.state, 'unknown'); assert(!JSON.stringify(failure).includes('PRIVATE'));
  const partial = github.createReader({ request: async url => Response.json(url.includes('/users/me/events/') ? {} : url.includes('/search/') ? { total_count: 9, incomplete_results: true } : { login: 'me', public_repos: 2 }) });
  const result = await partial.get('me'); assert.equal(result.state, 'warning'); assert.equal(result.openPulls, null); assert.equal(result.pushes, null); assert.equal(result.contributions, null);
});
test('calendar associates tooltip counts by cell ID, orders dates and rejects gaps instead of inventing zero', () => {
  const now = Date.parse('2026-10-13T18:00:00Z'), html = calendar(now);
  const parsed = github._internal.contributions(html, now);
  assert.equal(parsed.days[0].date, '2026-09-02'); assert.equal(parsed.today, 2); assert.equal(parsed.week, 8);
  assert.deepEqual(github._internal.contributions(html.match(/<td.*?<\/tool-tip>/g).reverse().join(''), now), parsed);
  assert.throws(() => github._internal.contributions(html.replace('for="day-41"', 'for="missing"'), now));
  assert.throws(() => github._internal.contributions(html.replace('No contributions on', 'Unknown contributions on'), now));
  assert.throws(() => github._internal.contributions('<script>PRIVATE</script>', now));
});
