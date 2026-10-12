// Live data from the frame hub (hub/server.js). When the page is served by the hub, /api/state returns
// your people, chores, groceries, calendar, photos, weather and AI usage, and this file swaps them in place of the
// demo data in window.DATA. If the hub cannot be reached the demo data stays (demo mode).
(function () {
  'use strict';
  var D = window.DATA;
  var WATCH_MS = 1500, QUIET_MS = 6000, BOOT_TIMEOUT_MS = 5000;
  var lastKey = '', lastTouch = 0, live = false;
  var synced = { chores: {}, groceries: '' };
  var pushing = false;

  function getJson(url, ms) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms || 8000) : null;
    return fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function send(method, url, body) {
    return fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function replace(target, items) { target.length = 0; Array.prototype.push.apply(target, items); }

  function groceryKey() {
    return JSON.stringify(D.groceries.map(function (g) { return [g.id, g.name, g.cat, g.qty, g.store, !!g.done, g.note || '']; }));
  }
  function snapshot() {
    synced.chores = {};
    D.chores.forEach(function (c) { synced.chores[c.id] = !!c.done; });
    synced.groceries = groceryKey();
    synced.base = D.groceries.map(function (g) { return g.id; });   // what the hub last showed us: only these can be deleted by our next edit
  }

  // ---- AI usage: real services come from collector scripts via the hub; the rest are shown as "not connected"
  var OFF = [
    { id: 'codex', name: 'Codex', plan: 'OpenAI', color: '#10A37F', rgb: '16 163 127', note: 'Not linked yet. Link it in /admin, under Connections and then Accounts. This reads your plan limits through an unofficial endpoint.' },
    { id: 'claude', name: 'Claude', plan: 'Anthropic', color: '#D97757', rgb: '217 119 87', note: 'Link Claude in Frame admin → Connections → Accounts to show session and weekly limits.' },
    { id: 'openrouter', name: 'OpenRouter', plan: 'API key', color: '#6467F2', rgb: '100 103 242', note: 'Optional: add an OpenRouter API key in Frame admin → Connections → Accounts to show its usage and remaining key budget.' }
  ];
  function hexRgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(' '); }
  function ymdLocal(d) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function fmtTok(n) { return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(Math.round(n)); }
  function buildAgents(data) {
    var out = [], latest = 0, today = new Date(), keys = [];
    for (var i = 6; i >= 0; i--) { var d = new Date(today); d.setDate(today.getDate() - i); keys.push(ymdLocal(d)); }
    ((data && data.services) || []).forEach(function (sv) {
      if (sv.id === 'gemini' || sv.id === 'copilot') return;
      if (sv.kind === 'limits' || sv.kind === 'credits') {   // plan limits the hub read itself (e.g. ChatGPT / Codex)
        var u2 = Date.parse(sv.updated) || 0; if (u2 > latest) latest = u2;
        var dollars = function (v) { return typeof v === 'number' ? '$' + v.toFixed(2) : '—'; };
        var creditStats = sv.kind === 'credits' ? (sv.credits ? [
          { label: 'Key today', value: dollars(sv.credits.daily), sub: 'USD · current UTC day' },
          { label: 'Key this week', value: dollars(sv.credits.weekly), sub: 'USD · current UTC week' },
          { label: 'Key this month', value: dollars(sv.credits.monthly), sub: 'USD · current UTC month' },
          { label: 'Key budget left', value: sv.credits.limit == null ? 'No cap' : dollars(sv.credits.remaining), sub: 'Key cap, not account balance' }
        ] : []) : null;
        out.push({
          id: sv.id, name: sv.name, plan: sv.plan || '', color: sv.color, rgb: hexRgb(sv.color),
          status: sv.error ? 'degraded' : 'ok', incident: sv.error ? ('Could not refresh: ' + sv.error) : '',
          meters: (sv.meters || []).map(function (m) { return { label: m.label, win: m.win || 300, used: m.used, left: m.leftMin, resetAt: m.resetAt || (m.leftMin == null ? null : u2 + m.leftMin * 60000), unknownReset: m.leftMin == null && !m.resetAt }; }),
          tokens: 0, cost: 0, week: [0, 0, 0, 0, 0, 0, 0], live: true, limits: sv.kind === 'limits', credits: sv.kind === 'credits',
          updated: u2, stats: creditStats, note: sv.kind === 'credits' ? 'Spending for this API key only.' : ''
        });
        return;
      }
      var by = {}; (sv.days || []).forEach(function (d) { by[d.date] = d; });
      var t = by[keys[6]] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
      var week = keys.map(function (k) { var d = by[k]; return d ? (d.input + d.output + d.cacheWrite) / 1e6 : 0; });
      var wkCost = keys.reduce(function (s, k) { return s + (by[k] ? by[k].cost : 0); }, 0);
      var upd = Date.parse(sv.updated) || 0; if (upd > latest) latest = upd;
      out.push({
        id: sv.id, name: sv.name, plan: sv.plan, color: sv.color, rgb: hexRgb(sv.color), status: 'ok', meters: [],
        tokens: (t.input + t.output + t.cacheWrite) / 1e6, cost: t.cost, week: week, live: true, updated: upd,
        stats: [
          { label: 'Today', value: '$' + t.cost.toFixed(2), sub: 'estimated cost' },
          { label: 'Last 7 days', value: '$' + wkCost.toFixed(2), sub: 'estimated cost' },
          { label: 'Output today', value: fmtTok(t.output), sub: 'tokens written' },
          { label: 'Cache reads today', value: fmtTok(t.cacheRead), sub: 'tokens re-used' }
        ],
        note: sv.costNote || ''
      });
    });
    OFF.forEach(function (o) {
      if (!out.some(function (a) { return a.id === o.id; })) out.push({ id: o.id, name: o.name, plan: o.plan, color: o.color, rgb: o.rgb, status: 'off', meters: [], tokens: 0, cost: 0, week: [0, 0, 0, 0, 0, 0, 0], note: o.note });
    });
    out.sort(function (a, b) { var ids = ['codex', 'claude', 'openrouter']; var ai = ids.indexOf(a.id), bi = ids.indexOf(b.id); return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi); });
    D.agentsUpdated = latest;
    D.agentsRequestedAt = Date.parse((data && data.requestedAt) || '') || 0;
    return out;
  }

  // Tunable settings from /admin (hub/lib/tune.js); read through App.tune().
  function applyTune(t) {
    if (!t) return;
    window.TUNE = t;
    if (window.App) App.emit('tune', t);
  }

  // Idle timers (seconds) from /admin > Settings.
  function applyDisplay(d) {
    if (!d || !window.App) return;
    if (d.homeSec) App.idle.home = d.homeSec;
    if (d.ambientSec) App.idle.ambient = d.ambientSec;
  }

  function apply(s) {
    var ids = s.people.map(function (p) { return p.id; });
    replace(D.people, s.people);
    applyTune(s.tune);
    applyDisplay(s.display);
    replace(D.ALL, ids);
    // "Family" / "Anyone" need a colour that is not one of the people (one of them is black).
    D.family.color = '#6B665C'; D.family.rgb = '107 102 92'; D.family.ink = '#FFFFFF';

    replace(D.events, s.events.map(function (e) {
      var who = (e.people || []).filter(function (id) { return ids.indexOf(id) > -1; });
      var o = { id: e.id, title: e.title, start: new Date(e.start), end: new Date(e.end), allDay: !!e.allDay, people: who.length ? who : ids.slice() };
      if (e.loc) o.loc = e.loc;
      if (e.notes) o.notes = e.notes;
      return o;
    }));

    replace(D.chores, s.chores);
    Object.keys(D.stars).forEach(function (k) { delete D.stars[k]; });
    Object.keys(s.stars || {}).forEach(function (k) { D.stars[k] = s.stars[k]; });
    Object.keys(D.week).forEach(function (k) { delete D.week[k]; });
    Object.keys(s.week || {}).forEach(function (k) { D.week[k] = s.week[k]; });

    replace(D.stores, s.stores);
    var order = s.categories || D.catOrder.all;
    Object.keys(D.catOrder).forEach(function (k) { delete D.catOrder[k]; });
    D.catOrder.all = order.slice();
    s.stores.forEach(function (st) { D.catOrder[st.id] = order.slice(); });
    replace(D.groceries, s.groceries);
    if (Array.isArray(s.commonItems)) {
      replace(D.catalog, s.commonItems.map(function (item) { return [item.name, item.cat]; }));
      replace(D.usuals, s.commonItems.filter(function (item) { return item.usual; }).map(function (item) { return item.name; }));
    }

    replace(D.photos, s.photos.map(function (p) {
      return { url: p.url, o: p.o, date: p.date, dated: p.dated !== false, place: p.place || '', from: p.from || 'family', tag: p.tag || 'frame' };
    }));
    replace(D.agents, buildAgents(s.agents));
    D.weatherLive = !!s.weather;
    D.weatherConfigured = !!s.weatherConfigured;
    if (s.weather) Object.keys(s.weather).forEach(function (k) { D.weather[k] = s.weather[k]; });
    snapshot();
  }

  // Only the fields that matter for display, so a changing "now" does not look like new data.
  function keyOf(s) {
    return JSON.stringify([s.rev, s.people, s.chores, s.stars, s.week, s.groceries, s.stores, s.categories, s.commonItems, s.events, s.weather, s.weatherConfigured, s.photos.length, s.display, s.tune, s.agents && s.agents.services && s.agents.services.map(function (x) { return [x.id, x.updated, x.error, x.errorAt, x.meters, x.credits]; }), s.agents && s.agents.requestedAt]);
  }

  // Is the hub answering? Shown on the Today screen. A failed read marks it reconnecting, a second one in a row offline.
  var HUB = window.HUB = { live: false, ok: true, fails: 0, at: 0, status: null };
  function hubSeen(ok) {
    var before = HUB.ok + '|' + (HUB.fails > 1);
    if (ok) { HUB.ok = true; HUB.fails = 0; HUB.at = Date.now(); } else { HUB.ok = false; HUB.fails++; }
    if (window.App && before !== HUB.ok + '|' + (HUB.fails > 1)) App.emit('hub');
  }
  function hubStatus() {
    getJson('/api/status', 6000).then(function (s) { HUB.status = s; hubSeen(true); if (window.App) App.emit('hub'); }).catch(function (e) { if (!/HTTP 404/.test(e && e.message)) hubSeen(false); /* an older hub has no status page: the state poll still tells us it is up */ });
  }

  function pull() {
    return getJson('/api/state').then(function (s) {
      hubSeen(true);
      var k = keyOf(s);
      if (k === lastKey) return;
      // Do not redraw under someone's finger or mid-typing.
      if (Date.now() - lastTouch < QUIET_MS && lastKey) return;
      lastKey = k;
      apply(s);
      if (window.App) { App.emit('data'); App.rerender && App.rerender(); }
    }).catch(function () { hubSeen(false); /* hub unreachable: keep showing what we have */ });
  }

  // Send the frame's own edits (ticking a chore, editing the grocery list) back to the hub.
  function watch() {
    if (pushing) return;
    var jobs = [];
    D.chores.forEach(function (c) {
      var was = synced.chores[c.id];
      if (was !== undefined && was !== !!c.done) {
        synced.chores[c.id] = !!c.done;
        jobs.push(send('POST', '/api/chores/toggle', { id: c.id, done: !!c.done }));
      }
    });
    var gk = groceryKey();
    if (gk !== synced.groceries) {
      synced.groceries = gk;
      jobs.push(send('PUT', '/api/groceries', { items: D.groceries, base: synced.base || [] }));
    }
    if (jobs.length) {
      pushing = true;
      Promise.all(jobs).catch(function () { synced.groceries = ''; /* retry next tick */ }).then(function () { pushing = false; lastKey = ''; });
    }
  }

  // The Agents screen asks for fresh numbers. A watcher on the computer that holds the logs sees the request and sends them.
  var lastAgentsRequest = 0;
  window.liveRefreshAgents = function (silent) {
    if (silent && Date.now() - lastAgentsRequest < 60000) return;   // automatic requests at most once a minute
    lastAgentsRequest = Date.now();
    D.agentsRequestedAt = Date.now();
    if (window.App && App.current === 'agents' && App.rerender) App.rerender();   // shows "Refreshing…" right away
    send('POST', '/api/agents/refresh', {}).catch(function () { /* hub unreachable: nothing to do */ });
    var tries = 0;
    (function again() {
      setTimeout(function () {
        pull().then(function () { if ((D.agentsUpdated || 0) < (D.agentsRequestedAt || 0) && ++tries < 24) again(); });
      }, 3000);
    })();
  };

  window.liveBoot = function () {
    return getJson('/api/state', BOOT_TIMEOUT_MS).then(function (s) {
      lastKey = keyOf(s);
      apply(s);
      live = true;
      window.DATA_LIVE = true;
      HUB.live = true; HUB.at = Date.now(); hubStatus();
      setInterval(hubStatus, 30000);
      document.addEventListener('pointerdown', function () { lastTouch = Date.now(); }, true);
      (function poll() { setTimeout(function () { pull(); poll(); }, (window.TUNE ? window.TUNE.pollSec : 20) * 1000); })();
      setInterval(watch, WATCH_MS);
      return true;
    }).catch(function () { return false; });
  };
})();
