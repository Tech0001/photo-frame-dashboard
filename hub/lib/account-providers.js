'use strict';
// Read-only provider calls. Claude follows ai-usagebar's OAuth usage reader;
// OpenRouter uses its documented current-key API. No inference or token refresh.
const bad = (message) => Object.assign(new Error(message), { userError: true });
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const token = (v) => typeof v === 'string' && /^[A-Za-z0-9._~-]{20,8192}$/.test(v);

function parseClaude(text) {
  let j;
  try { j = JSON.parse(text); } catch { throw bad('Paste the Claude credentials JSON, including claudeAiOauth.'); }
  const c = j && j.claudeAiOauth;
  if (!c || !token(c.accessToken)) throw bad('No Claude access token found in claudeAiOauth.accessToken.');
  if (c.expiresAt != null && (!finite(c.expiresAt) || c.expiresAt <= 0)) throw bad('Claude expiresAt must be a timestamp in milliseconds.');
  const subscription = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise' }[c.subscriptionType] || 'Claude';
  const tier = String(c.rateLimitTier || '');
  const plan = subscription + (tier.includes('20x') ? ' 20×' : tier.includes('5x') ? ' 5×' : '');
  // Deliberately discard refreshToken: the original CLI/Usagebar owns its rotation.
  return { access_token: c.accessToken, expires_at: c.expiresAt || null, plan, saved_at: new Date().toISOString() };
}
function parseOpenRouter(text) {
  const key = String(text).trim();
  if (!token(key) || !key.startsWith('sk-or-')) throw bad('Paste an OpenRouter API key beginning with sk-or-.');
  return { api_key: key, saved_at: new Date().toISOString() };
}
async function read(url, headers, name, fetcher) {
  let r;
  try { r = await fetcher(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('Could not reach ' + name + '. The hub will retry.'); }
  if (r.status === 401 || r.status === 403) throw new Error(name + ' rejected the saved credential. Update it in Connections → Accounts.');
  if (r.status === 429) throw new Error(name + ' is rate limiting usage checks. The hub will retry.');
  if (!r.ok) throw new Error(name + ' answered HTTP ' + r.status + '.');
  try { return await r.json(); } catch { throw new Error(name + ' returned an unreadable usage response.'); }
}
function claudeUsage(j, creds, now = Date.now()) {
  if (!j || typeof j !== 'object') throw new Error('Claude returned an unrecognized usage response.');
  const meters = [];
  function add(w, label, win) {
    if (w == null) return;
    if (!finite(w.utilization) || w.utilization < 0 || w.utilization > 101) throw new Error('Claude returned an invalid usage percentage.');
    const at = w.resets_at == null ? NaN : Date.parse(w.resets_at);
    meters.push({ label, used: Math.min(100, Math.round(w.utilization)), win,
      leftMin: Number.isFinite(at) ? Math.max(0, (at - now) / 60000) : null,
      resetAt: Number.isFinite(at) ? at : null });
  }
  add(j.five_hour, 'Session · 5 h', 300);
  add(j.seven_day, 'Weekly · all models', 10080);
  add(j.seven_day_sonnet, 'Weekly · Sonnet', 10080);
  (Array.isArray(j.limits) ? j.limits : []).forEach((w) => {
    const model = w.scope && w.scope.model && w.scope.model.display_name;
    if (w.kind === 'weekly_scoped' && typeof model === 'string' && meters.length < 4) {
      const label = 'Weekly · ' + model.slice(0, 24);
      if (!meters.some((m) => m.label === label)) add({ utilization: w.percent, resets_at: w.resets_at }, label, 10080);
    }
  });
  if (!meters.length) throw new Error('Claude returned no recognized usage windows.');
  return { kind: 'limits', plan: creds.plan, meters };
}
async function fetchClaude(creds, fetcher = fetch) {
  if (creds.expires_at && creds.expires_at <= Date.now()) throw new Error('The Claude login token has expired. Update the credentials JSON in Connections → Accounts.');
  const j = await read('https://api.anthropic.com/api/oauth/usage', {
    Authorization: 'Bearer ' + creds.access_token, 'anthropic-beta': 'oauth-2025-04-20',
    'User-Agent': 'claude-code/2.1.183', 'Content-Type': 'application/json'
  }, 'Claude', fetcher);
  return claudeUsage(j, creds);
}
function openRouterUsage(j) {
  const d = j && j.data;
  if (!d || typeof d !== 'object') throw new Error('OpenRouter returned an unrecognized usage response.');
  function money(key, optional = false, negative = false) {
    if (optional && d[key] == null) return null;
    if (!finite(d[key]) || (!negative && d[key] < 0)) throw new Error('OpenRouter returned an invalid ' + key + ' value.');
    return d[key];
  }
  return { kind: 'credits', plan: 'API key', meters: [], credits: {
    daily: money('usage_daily'), weekly: money('usage_weekly'), monthly: money('usage_monthly'),
    total: money('usage'), limit: money('limit', true), remaining: money('limit_remaining', true, true)
  } };
}
async function fetchOpenRouter(creds, fetcher = fetch) {
  const headers = { Authorization: 'Bearer ' + creds.api_key, Accept: 'application/json' };
  const result = openRouterUsage(await read('https://openrouter.ai/api/v1/key', headers, 'OpenRouter', fetcher));
  result.credits.accountRemaining = null;
  result.credits.accountError = '';
  try {
    const j = await read('https://openrouter.ai/api/v1/credits', headers, 'OpenRouter balance', fetcher);
    const d = j && j.data;
    if (!d || !finite(d.total_credits) || !finite(d.total_usage) || d.total_credits < 0 || d.total_usage < 0) throw new Error('OpenRouter returned an invalid account balance.');
    result.credits.accountRemaining = d.total_credits - d.total_usage;
  } catch {
    // A unavailable account balance must not discard independently read key usage
    // or display an old balance as fresh. Keep missing separate from a real zero.
    result.credits.accountError = 'Account balance unavailable. Key usage is still shown.';
  }
  return result;
}
module.exports = {
  claude: { id: 'claude', name: 'Claude', label: 'Claude', defaultPlan: 'Claude', color: '#D97757', unofficial: true,
    parse: parseClaude, fetch: fetchClaude, expiry: (c) => c.expires_at || null },
  openrouter: { id: 'openrouter', name: 'OpenRouter', label: 'OpenRouter', defaultPlan: 'API key', color: '#6467F2', unofficial: false,
    parse: parseOpenRouter, fetch: fetchOpenRouter, expiry: () => null },
  _internal: { parseClaude, parseOpenRouter, claudeUsage, openRouterUsage }
};
