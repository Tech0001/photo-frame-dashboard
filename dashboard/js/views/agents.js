// Agents: AI plan usage at a glance (inspired by CodexBar). Display only.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, loaded: Date.now(), synced: Date.now() - 2 * 60000, tab: 'usage' };

  function pstyle(a) { return '--c:' + a.color + ';--c-rgb:' + a.rgb; }
  function minsLeft(m) { if (m.resetAt) return Math.max(0, (m.resetAt - Date.now()) / 60000); return Math.max(0, m.left - (Date.now() - V.loaded) / 60000); }
  function fmtLeft(min) {
    min = Math.round(min);
    if (min < 60) return min + 'm';
    if (min < 1440) return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
    return Math.floor(min / 1440) + 'd ' + Math.floor((min % 1440) / 60) + 'h';
  }
  function fmtTokens(m) { return m >= 10 ? Math.round(m) + 'M' : m.toFixed(1) + 'M'; }

  function meter(m, ai, mi) {
    var left = minsLeft(m);
    if (m.unknownReset) return '<div class="ag-meter"><div class="ag-meter-top"><span class="ag-label">' + App.esc(m.label) + '</span><span class="ag-pct num">' + m.used + '<small>%</small></span></div><div class="ag-bar"><i style="width:' + m.used + '%"></i></div><div class="ag-meter-foot">Reset time unavailable</div></div>';
    var pace = Math.round((1 - left / m.win) * 100); // where even usage would be right now
    var diff = m.used - pace;
    var hot = m.used >= 85;
    var paceText = Math.abs(diff) < 3 ? 'On pace' : diff > 0 ? diff + '% over pace' : -diff + '% under pace';
    return '<div class="ag-meter' + (hot ? ' is-hot' : '') + '">' +
      '<div class="ag-meter-top"><span class="ag-label">' + App.esc(m.label) + '</span>' +
      '<span class="ag-pct num">' + m.used + '<small>%</small></span></div>' +
      '<div class="ag-bar"><i style="width:' + m.used + '%"></i><em data-pace-mark style="left:' + pace + '%" title="Even pace"></em></div>' +
      '<div class="ag-meter-foot" data-meter="' + ai + ',' + mi + '"><span>' + (m.detail ? m.detail + ' · ' : '') + 'Resets in <b data-reset>' + fmtLeft(left) + '</b></span>' +
      '<span class="ag-pace' + (diff >= 3 ? ' is-over' : '') + '" data-pace>' + paceText + '</span></div>' +
      '</div>';
  }

  function spark(vals) {
    var w = 112, h = 34, max = Math.max.apply(null, vals) || 1;
    var pts = vals.map(function (v, i) { return (i / (vals.length - 1) * w).toFixed(1) + ',' + (h - 3 - v / max * (h - 6)).toFixed(1); });
    var last = pts[pts.length - 1].split(',');
    return '<svg class="ag-spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<polyline points="' + pts.join(' ') + '"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="3.5"/></svg>';
  }

  function status(a) {
    var stale = a.updated && Date.now() - a.updated > 15 * 60000;
    var warning = !!a.incident || stale;
    return '<span class="ag-status' + (warning ? ' is-warn' : '') + '"><i></i>' + (a.incident ? 'Check connection' : stale ? 'Stale data' : a.updated ? 'Updated' : App.live ? 'No data yet' : 'Operational') + '</span>';
  }
  function statusSlot(a) { return '<span data-agent-status="' + D.agents.indexOf(a) + '">' + status(a) + '</span>'; }
  function offCard(a) {
    return '<section class="ag-card ag-card--off" style="' + pstyle(a) + '">' +
      '<header class="ag-head"><div class="ag-id"><i class="ag-swatch"></i><b>' + App.esc(a.name) + '</b><span class="ag-plan">' + App.esc(a.plan) + '</span></div>' +
      '<span class="ag-status is-off"><i></i>Not connected</span></header>' +
      '<p class="ag-note">' + App.esc(a.note) + '</p></section>';
  }
  function statsCard(a) {
    var hasWeek = a.week.some(function (v) { return v > 0; });
    return '<section class="ag-card" style="' + pstyle(a) + '">' +
      '<header class="ag-head"><div class="ag-id"><i class="ag-swatch"></i><b>' + App.esc(a.name) + '</b><span class="ag-plan">' + App.esc(a.plan) + '</span></div>' +
      statusSlot(a) + '</header>' +
      (a.incident ? '<div class="ag-incident">' + App.esc(a.incident) + '</div>' : '') +
      '<div class="ag-stats">' + a.stats.map(function (s) {
        return '<div class="ag-stat"><span class="ag-stat-l">' + App.esc(s.label) + '</span><span class="ag-stat-v num">' + App.esc(s.value) + '</span><small>' + App.esc(s.sub) + '</small></div>';
      }).join('') + '</div>' +
      '<footer class="ag-foot ag-foot--solo"><small class="ag-note">' + App.esc(a.note || '') + '</small>' + (a.week.filter(function (v) { return v > 0; }).length > 1 ? spark(a.week) : '') + '</footer></section>';
  }

  function card(a) {
    if (a.status === 'off') return offCard(a);
    if (a.stats) return statsCard(a);
    var hot = a.meters.some(function (m) { return m.used >= 85; });
    return '<section class="ag-card" style="' + pstyle(a) + '">' +
      '<header class="ag-head"><div class="ag-id"><i class="ag-swatch"></i><b>' + App.esc(a.name) + '</b><span class="ag-plan">' + App.esc(a.plan) + '</span></div>' + statusSlot(a) + '</header>' +
      (a.incident ? '<div class="ag-incident">' + App.icon('bolt', 16) + App.esc(a.incident) + '</div>' : hot ? '<div class="ag-incident ag-incident--hot">' + App.icon('clock', 16) + 'Near the session limit</div>' : '') +
      a.meters.map(function (m, mi) { return meter(m, D.agents.indexOf(a), mi); }).join('') +
      '<footer class="ag-foot"><div><span class="num">' + fmtTokens(a.tokens) + '</span><small>tokens today</small></div>' +
      '<div><span class="num">' + (a.cost ? '$' + a.cost.toFixed(2) : 'Incl.') + '</span><small>' + (a.cost ? 'API cost' : 'in plan') + '</small></div>' +
      spark(a.week) + '</footer>' +
      '</section>';
  }

  function summary() {
    var now = App.now();
    var totals = [0, 1, 2, 3, 4, 5, 6].map(function (i) {
      return D.agents.reduce(function (s, a) { return s + a.week[i]; }, 0);
    });
    var max = Math.max.apply(null, totals) || 1;
    var week = totals.reduce(function (s, v) { return s + v; }, 0);
    var cost = D.agents.reduce(function (s, a) { return s + a.cost; }, 0);
    var bars = totals.map(function (t, i) {
      var d = App.addDays(now, i - 6);
      return '<div class="ag-col' + (i === 6 ? ' is-today' : '') + '"><div class="ag-stack" style="height:' + (t / max * 100) + '%">' +
        D.agents.map(function (a) { return '<i style="' + pstyle(a) + ';flex-grow:' + a.week[i] + '"></i>'; }).join('') +
        '</div><span>' + (i === 6 ? 'Today' : App.fmt.dayShort(d)) + '</span></div>';
    }).join('');
    return '<section class="ag-card ag-sum' + (D.agents.length === 4 ? ' ag-sum--wide' : '') + '">' +
      '<header class="ag-head"><div class="ag-id"><b>All agents</b><span class="ag-plan">Last 7 days</span></div></header>' +
      '<div class="ag-sum-stats"><div><span class="num">' + fmtTokens(week) + '</span><small>tokens</small></div>' +
      '<div><span class="num">$' + cost.toFixed(0) + '</span><small>API cost today</small></div></div>' +
      '<div class="ag-chart">' + bars + '</div>' +
      '<div class="ag-legend">' + D.agents.filter(function (a) { return a.status !== 'off'; }).map(function (a) { return '<span style="' + pstyle(a) + '"><i></i>' + App.esc(a.name) + '</span>'; }).join('') + '</div>' +
      '</section>';
  }

  function paceOf(m) {
    var left = minsLeft(m), pace = Math.round((1 - left / m.win) * 100), diff = m.used - pace;
    return { left: left, pace: pace, diff: diff, text: Math.abs(diff) < 3 ? 'On pace' : diff > 0 ? diff + '% over pace' : -diff + '% under pace' };
  }
  // Minute tick: update countdown + pace text in place (no rebuild, so switching here stays instant).
  function tick() {
    if (!V.el || !V.el.firstChild) return;
    if (V.tab === 'evergreen') { render(); return; }
    App.$$('[data-meter]', V.el).forEach(function (foot) {
      var ix = foot.dataset.meter.split(','), m = D.agents[+ix[0]].meters[+ix[1]], p = paceOf(m);
      foot.querySelector('[data-reset]').textContent = fmtLeft(p.left);
      var pe = foot.querySelector('[data-pace]');
      pe.textContent = p.text;
      pe.classList.toggle('is-over', p.diff >= 3);
      foot.parentNode.querySelector('[data-pace-mark]').style.left = p.pace + '%';
    });
    App.$$('[data-agent-status]', V.el).forEach(function (el) { var a = D.agents[+el.dataset.agentStatus]; if (a) el.innerHTML = status(a); });
    var sync = V.el.querySelector('.ag-sync .label');
    if (sync) sync.textContent = synced();
  }

  // With live data: when the collector last ran, and whether a refresh is in flight.
  function liveSynced() {
    var req = D.agentsRequestedAt || 0, upd = D.agentsUpdated || 0, now = Date.now();
    if (req > upd && now - req < 90000) return 'Refreshing…';
    if (!upd) return req ? 'No data yet · check account settings' : 'No data yet';
    var m = Math.round((now - upd) / 60000), d = new Date(upd);
    var when = App.sameDay(d, App.now()) ? App.fmt.time(d) : App.fmt.dayShort(d) + ' ' + App.fmt.time(d);
    return 'Last ran ' + when + (m < 1 ? ' · just now' : m < 60 ? ' · ' + m + ' min ago' : '') + (req > upd ? ' · check account connections' : '');
  }

  function synced() {
    if (App.live) return liveSynced();
    var m = Math.round((Date.now() - (D.agentsUpdated || V.synced)) / 60000);
    return m < 1 ? 'Updated just now' : 'Updated ' + m + ' min ago';
  }

  function render() {
    var progress = V.tab === 'evergreen', scroller = V.el.querySelector('.ag-progress'), scrollTop = scroller ? scroller.scrollTop : 0;
    var progressView = progress ? App.evergreen.capture(V.el) : null;
    App.evergreen.active = progress && App.current === 'agents';
    var showSummary = !App.live || D.agents.some(function (a) { return a.status !== 'off' && !a.limits && !a.credits; });
    V.el.innerHTML = '<div class="agents">' +
      '<header class="ag-top"><div><div class="label">' + (progress ? 'Project progress' : App.live ? 'AI accounts · usage' : 'AI plans · usage limits') + '</div><h1 class="serif">Agents</h1></div>' +
      '<div class="ag-sync"><span class="label">' + App.esc(progress ? App.evergreen.stamp() : synced()) + '</span>' +
      '<button class="icon-btn" data-refresh aria-label="Refresh">' + App.icon('undo', 26) + '</button></div></header>' +
      '<nav class="ag-tabs" aria-label="Agents sections"><button data-ag-tab="usage" aria-pressed="' + !progress + '">Usage</button><button data-ag-tab="evergreen" aria-pressed="' + progress + '">Evergreen</button></nav>' +
      (progress ? App.evergreen.render() : '<div class="ag-grid' + (!showSummary ? ' ag-grid--accounts' : '') + '">' + D.agents.map(function (a) { var h = card(a); return a.limits ? h.replace('class="ag-card"', 'class="ag-card ag-card--limits"') : h; }).join('') + (showSummary ? summary() : '') + '</div>') +
      '</div>';
    scroller = V.el.querySelector('.ag-progress'); if (scroller) scroller.scrollTop = scrollTop;
    if (progress) App.evergreen.restore(V.el, progressView);
  }

  App.register('agents', {
    show: function (el) {
      if (V.tab === 'usage' && App.live && window.liveRefreshAgents && Date.now() - (D.agentsUpdated || 0) > 300000) window.liveRefreshAgents(true);   // opening the tab with stale numbers asks for fresh ones
      if (!V.el) {
        V.el = el;
        el.addEventListener('change', function (e) { if (e.target.matches('[data-eg-section]')) { App.evergreen.selectSection(e.target.value); render(); } });
        el.addEventListener('click', function (e) {
          var tab = e.target.closest('[data-ag-tab]');
          if (tab) { V.tab = tab.dataset.agTab; render(); if (V.tab === 'evergreen') App.evergreen.refresh(false); return; }
          var b = e.target.closest('[data-refresh]');
          if (!b) return;
          if (V.tab === 'evergreen') { App.evergreen.refresh(true); return; }
          V.synced = Date.now();
          if (App.live && window.liveRefreshAgents) window.liveRefreshAgents();
          render();
        });
      }
      render();
      if (V.tab === 'evergreen') App.evergreen.refresh(false);
    },
    resume: function () { render(); if (V.tab === 'evergreen') App.evergreen.refresh(false); },
    hide: function () { App.evergreen.active = false; }
  });
  App.on('minute', tick);
})();
