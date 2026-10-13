'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const accounts = require('../lib/accounts');
const providers = require('../lib/account-providers');
const { AgentsStore } = require('../lib/agents');
const connections = require('../lib/connections');
const internals = providers._internal;
const claudeInput = () => JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat01-test-only-access-token', refreshToken: 'never-copy-this-refresh-token', expiresAt: Date.now() + 3600000, subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x', scopes: ['user:profile'] } });
const creditData = { usage_daily: 1.25, usage_weekly: 5, usage_monthly: 12.5, usage: 50, limit: null, limit_remaining: null };
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-accounts-'));
  const cfgFile = path.join(dir, 'config.json'), secFile = path.join(dir, 'secrets.json');
  const cfg = { timezone: 'UTC', calendars: [], weather: null, proxmenux: { url: '' } };
  const secrets = { admin_password: 'test-password', ical: {} };
  fs.writeFileSync(cfgFile, JSON.stringify(cfg)); fs.writeFileSync(secFile, JSON.stringify(secrets));
  const tz = process.env.TZ;
  try { return fn({ dir, cfgFile, secFile, cfg, secrets }); }
  finally { fs.rmSync(dir, { force: true, recursive: true }); if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
}

test('Claude keeps only the usage credential and plan metadata', () => {
  const c = internals.parseClaude(claudeInput());
  assert.equal(c.plan, 'Max 20×'); assert(c.expires_at > Date.now());
  assert(!JSON.stringify(c).includes('refresh')); assert(!JSON.stringify(c).includes('scopes'));
  assert.throws(() => internals.parseClaude('{secret-token'), /credentials JSON/);
  assert.throws(() => internals.parseClaude('{}'), /No Claude access token/);
});
test('Claude accepts partial window sets without inventing usage or reset dates', () => {
  const now = Date.now();
  const r = internals.claudeUsage({ five_hour: null, seven_day: { utilization: 0, resets_at: null }, limits: [{ kind: 'weekly_scoped', percent: 12, resets_at: new Date(now + 600000).toISOString(), scope: { model: { display_name: 'Sonnet' } } }] }, { plan: 'Pro' }, now);
  assert.equal(r.meters.length, 2); assert.equal(r.meters[0].used, 0); assert.equal(r.meters[0].resetAt, null);
  assert.equal(r.meters[1].leftMin, 10);
  for (const utilization of [undefined, -1, 102, '40']) assert.throws(() => internals.claudeUsage({ five_hour: { utilization } }, {}));
  assert.throws(() => internals.claudeUsage({}, {}), /no recognized/);
});
test('Claude request is read-only, uses Usagebar headers, and rejects expired logins', async () => {
  const c = internals.parseClaude(claudeInput()); let calls = 0;
  const fetcher = async (url, options) => {
    calls++; assert.equal(url, 'https://api.anthropic.com/api/oauth/usage');
    assert.equal(options.headers.Authorization, 'Bearer ' + c.access_token);
    assert.equal(options.headers['anthropic-beta'], 'oauth-2025-04-20');
    assert.match(options.headers['User-Agent'], /^claude-code\//); assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ five_hour: { utilization: 45, resets_at: null } }) };
  };
  assert.equal((await providers.claude.fetch(c, fetcher)).meters[0].used, 45);
  await assert.rejects(providers.claude.fetch({ ...c, expires_at: 1 }, fetcher), /expired/); assert.equal(calls, 1);
});
test('OpenRouter reports key-scoped spending and distinguishes missing fields from zero', async () => {
  const c = internals.parseOpenRouter('sk-or-v1-test-only-key-for-fixtures');
  const r = await providers.openrouter.fetch(c, async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer ' + c.api_key);
    if (url === 'https://openrouter.ai/api/v1/credits') return { ok: true, json: async () => ({ data: { total_credits: 100, total_usage: 74.5 } }) };
    assert.equal(url, 'https://openrouter.ai/api/v1/key');
    return { ok: true, json: async () => ({ data: creditData }) };
  });
  assert.deepEqual(r.credits, { daily: 1.25, weekly: 5, monthly: 12.5, total: 50, limit: null, remaining: null, accountRemaining: 25.5, accountError: '' });
  assert.equal(internals.openRouterUsage({ data: { ...creditData, limit: 5, limit_remaining: -0.25 } }).credits.remaining, -0.25);
  assert.throws(() => internals.openRouterUsage({ data: {} }));
  assert.throws(() => internals.openRouterUsage({ data: { ...creditData, usage_daily: -1 } }));
  assert.throws(() => internals.parseOpenRouter('not-a-key'));
});
test('OpenRouter balance handles zero, negative and unavailable without mislabeling key allowance', async () => {
  const creds = { api_key: 'test-key' };
  const read = async balance => providers.openrouter.fetch(creds, async url => url.endsWith('/key')
    ? { ok: true, json: async () => ({ data: { ...creditData, limit: 5, limit_remaining: 2 } }) }
    : balance);
  const zero = await read({ ok: true, json: async () => ({ data: { total_credits: 10, total_usage: 10 } }) });
  assert.equal(zero.credits.accountRemaining, 0); assert.equal(zero.credits.remaining, 2);
  const negative = await read({ ok: true, json: async () => ({ data: { total_credits: 10, total_usage: 10.5 } }) });
  assert.equal(negative.credits.accountRemaining, -.5);
  for (const response of [{ ok: false, status: 403 }, { ok: true, json: async () => ({ data: {} }) }, { ok: true, json: async () => ({ data: { total_credits: '100', total_usage: 2 } }) }]) {
    const r = await read(response);
    assert.equal(r.credits.accountRemaining, null); assert.match(r.credits.accountError, /unavailable/); assert.equal(r.credits.daily, 1.25);
  }
});
test('provider failures never expose a response body or credential in an error', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(providers.openrouter.fetch({ api_key: 'secret-test-key' }, async () => ({ ok: false, status, json: async () => ({ error: 'secret-test-key' }) })), (e) => !e.message.includes('secret-test-key'));
  }
  await assert.rejects(providers.openrouter.fetch({}, async () => { throw Error('secret-test-key'); }), /Could not reach OpenRouter/);
});
test('stored OpenRouter credits retain the account balance separately from the key allowance', () => fixture(f => {
  const store = new AgentsStore(f.dir);
  store.setService({ id: 'openrouter', kind: 'credits', credits: { remaining: 2, accountRemaining: 25.5, accountError: '', privateField: 'discard' } });
  let credits = new AgentsStore(f.dir).get().services[0].credits;
  assert.equal(credits.accountRemaining, 25.5); assert.equal(credits.remaining, 2); assert(!('privateField' in credits));
  store.setService({ id: 'openrouter', kind: 'credits', credits: { daily: 1.25, accountRemaining: null, accountError: 'Balance unavailable' } });
  credits = new AgentsStore(f.dir).get().services[0].credits;
  assert.equal(credits.accountRemaining, null); assert.equal(credits.daily, 1.25); assert.equal(credits.accountError, 'Balance unavailable');
}));
test('admin save is write-only, strips refresh tokens, preserves blank inputs and validates before writing', () => fixture((f) => {
  const service = connections({ ...f, getPeopleIds: () => [] });
  service.apply({ accounts: { claude: { authJson: claudeInput() }, openrouter: { authJson: 'sk-or-v1-test-only-key-for-fixtures' } } });
  const saved = fs.readFileSync(f.secFile, 'utf8');
  assert(!saved.includes('refresh')); assert(saved.includes('sk-or-v1-'));
  assert.equal(fs.statSync(f.secFile).mode & 0o777, 0o600);
  assert.throws(() => service.apply({ accounts: { constructor: { authJson: 'invalid' } } }), /unknown account/);
  const publicView = JSON.stringify(service.view()); assert(!publicView.includes('sk-or-')); assert(!publicView.includes('access_token'));
  assert.equal(service.view().accounts.filter((a) => a.linked).length, 2);
  service.apply({ accounts: { claude: { authJson: '' } } }); assert.equal(fs.readFileSync(f.secFile, 'utf8'), saved);
  assert.throws(() => service.apply({ accounts: { claude: { unlink: true }, openrouter: { authJson: 'invalid' } } }));
  assert.equal(fs.readFileSync(f.secFile, 'utf8'), saved);
  service.apply({ accounts: { claude: { unlink: true } } }); assert(!f.secrets.accounts.claude); assert(f.secrets.accounts.openrouter);
}));
test('failed refresh preserves the last successful values and unlink clears only hub-owned data', () => fixture(({ dir }) => {
  const store = new AgentsStore(dir);
  store.setService({ id: 'openrouter', kind: 'credits', plan: 'API key', credits: { daily: 1.25 } });
  const previous = store.get().services[0];
  store.setService({ id: 'openrouter', kind: 'credits' }, 'Please update the key');
  const failed = store.get().services[0]; assert.equal(failed.credits.daily, 1.25); assert.equal(failed.updated, previous.updated); assert(failed.errorAt);
  store.update({ services: [{ id: 'claude', days: [] }] });
  store.removeLinkedService('claude'); assert(store.get().services.some((s) => s.id === 'claude'));
  store.removeLinkedService('openrouter'); assert(!store.get().services.some((s) => s.id === 'openrouter'));
}));
test('unlink while a fetch is in flight cannot bring the account back', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-unlink-'));
  const store = new AgentsStore(dir), secrets = { accounts: { claude: internals.parseClaude(claudeInput()) } };
  const original = accounts.providers.claude.fetch;
  let release;
  accounts.providers.claude.fetch = () => new Promise((r) => { release = r; });
  try {
    const work = accounts.refreshAll(secrets, store, true);
    delete secrets.accounts.claude;
    release({ meters: [], plan: 'Pro' });
    await work; assert.equal(store.get().services.length, 0);
  } finally { accounts.providers.claude.fetch = original; fs.rmSync(dir, { recursive: true, force: true }); }
});
