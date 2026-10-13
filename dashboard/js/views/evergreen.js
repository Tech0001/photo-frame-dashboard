// Evergreen receives explicit project reports, never inferred lane progress.
(function () {
  'use strict';
  var data = null, error = '', busy = false, attempted = 0, esc = App.esc;
  var stages = [['built', 'Built'], ['reviewed', 'Reviewed'], ['integrated', 'Integrated'], ['live', 'Live']];
  function when(value) {
    var d = new Date(value);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function warnings() {
    var out = [];
    if (error) out.push('Connection interrupted. Showing the last report.');
    if (data && data.report) {
      if (data.feedStale || Date.now() - Date.parse(data.receivedAt) > 15 * 60000) out.push('Sync has not checked in for over 15 minutes.');
      if (data.reportStale || Date.now() - Date.parse(data.report.updatedAt) > 24 * 3600000) out.push('This progress report is over a day old.');
    }
    return out;
  }
  function refresh(force) {
    if (!App.live || !App.evergreen.active || document.hidden || busy || (!force && Date.now() - attempted < 60000)) return;
    attempted = Date.now(); busy = true;
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 8000);
    fetch('/api/progress/evergreen', { cache: 'no-store', signal: ctl.signal }).then(function (r) { if (!r.ok) throw Error(); return r.json(); })
      .then(function (d) { data = d; error = ''; }).catch(function () { error = 'unreachable'; })
      .then(function () { clearTimeout(timer); busy = false; if (App.evergreen.active) App.rerender(); });
  }
  function note(row) { return (row.owner ? '<span class="eg-owner">' + esc(row.owner) + '</span>' : '') + (row.detail ? '<p>' + esc(row.detail) + '</p>' : ''); }
  function disclosure(key, summary, content, cls) {
    return '<details class="eg-disclosure ' + (cls || '') + '" data-eg-open="' + esc(key) + '"><summary>' + summary + '</summary><div class="eg-detail">' + content + '</div></details>';
  }
  function stageState(v) { return v === true ? 'Reported' : v === false ? 'Pending' : 'Unknown'; }
  function totals(rows) {
    return '<div class="eg-totals" aria-label="Reported delivery stages">' + stages.map(function (s) {
      var yes = 0, pending = 0, unknown = 0;
      rows.forEach(function (row) { var v = row.stages[s[0]]; if (v === true) yes++; else if (v === false) pending++; else unknown++; });
      return '<section class="eg-total"><div><b>' + s[1] + '</b><span class="num">' + yes + '<small> / ' + rows.length + '</small></span></div>' +
        '<div class="eg-total-bar" aria-label="' + s[1] + ': ' + yes + ' reported, ' + pending + ' pending, ' + unknown + ' unknown">' +
        '<i class="is-reported" style="width:' + (rows.length ? yes / rows.length * 100 : 0) + '%"></i><i class="is-pending" style="width:' + (rows.length ? pending / rows.length * 100 : 0) + '%"></i><i class="is-unknown" style="width:' + (rows.length ? unknown / rows.length * 100 : 0) + '%"></i></div></section>';
    }).join('') + '</div>';
  }
  function work(rows) {
    return '<section class="eg-board eg-card"><header><h3>Delivery map</h3><span class="eg-map-key">✓ reported · ○ pending · ? unknown</span></header><p class="eg-map-note">Each tile is a reported scope; scopes can overlap. Tap for evidence.</p><div class="eg-work-scroll" data-eg-scroll="work"><div class="eg-work-grid">' + (rows.length ? rows.map(function (row) {
      var cells = stages.map(function (s) {
        var v = row.stages[s[0]], state = stageState(v);
        return '<span class="eg-cell' + (v === true ? ' is-reported' : v === false ? ' is-pending' : ' is-unknown') + '" title="' + s[1] + ': ' + state + '" aria-label="' + s[1] + ': ' + state + '">' + (v === true ? '✓' : v === false ? '○' : '?') + '<small>' + s[1] + '</small></span>';
      }).join('');
      return disclosure('work-' + row.id, '<b class="eg-tile-title">' + esc(row.title) + '</b><span class="eg-cells">' + cells + '</span>', '<h4>' + esc(row.title) + '</h4>' + note(row), 'eg-work-tile');
    }).join('') : '<p class="eg-empty">No delivery stages reported yet.</p>') + '</div></div></section>';
  }
  function attention(rows, title, empty, cls) {
    return disclosure(cls, '<b>' + title + '</b><span class="eg-count num">' + rows.length + '</span>', rows.length ? rows.map(function (row) {
      return disclosure(cls + '-' + row.id, '<b>' + esc(row.title) + '</b>' + (row.owner ? '<small>' + esc(row.owner) + '</small>' : ''), (row.detail ? '<p>' + esc(row.detail) + '</p>' : '') + (row.next ? '<p class="eg-next"><b>Next</b> ' + esc(row.next) + '</p>' : ''), 'eg-attention-item');
    }).join('') : '<p class="eg-empty">' + empty + '</p>', 'eg-attention-group ' + cls + (rows.length ? ' has-items' : ''));
  }
  function recent(rows) {
    var now = App.now(), yesterday = App.addDays(App.dayStart(now), -1);
    var buckets = [[], [], []];
    rows.slice().sort(function (a, b) { return Date.parse(b.at) - Date.parse(a.at); }).forEach(function (row) {
      var at = new Date(row.at);
      buckets[App.sameDay(at, now) ? 0 : App.sameDay(at, yesterday) ? 1 : 2].push(row);
    });
    function group(index, label) {
      return '<section class="eg-day"><header><h4>' + label + '</h4><span class="eg-day-count">' + buckets[index].length + ' reported</span></header>' +
        (buckets[index].length ? buckets[index].map(function (row) {
          var stage = stages.filter(function (s) { return s[0] === row.stage; })[0][1];
          var clock = index < 2 ? new Date(row.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : when(row.at);
          return disclosure('recent-' + row.id, '<span class="eg-recent-meta"><span class="eg-stage is-reported">' + stage + '</span> ' + esc(clock) + '</span><b>' + esc(row.title) + '</b>', note(row), 'eg-recent-item');
        }).join('') : '<p class="eg-empty">No completions reported.</p>') + '</section>';
    }
    return '<section class="eg-card eg-recent"><h3>Reported progress</h3>' + group(0, 'Today') + group(1, 'Yesterday') + (buckets[2].length ? group(2, 'Earlier') : '') + '</section>';
  }
  function render() {
    if (!data || !data.report) return '<div class="ag-progress"><section class="eg-card eg-setup"><h2 class="serif">Evergreen</h2><p>' + (error ? 'The hub could not be reached. Try Refresh.' : busy ? 'Checking for Evergreen progress…' : 'Waiting for the first Evergreen report.') + '</p><p class="eg-empty">The configured progress feed will bring the objective, recent progress, blockers and decisions here automatically.</p></section></div>';
    var r = data.report, warn = warnings();
    // The first sentence is a compact excerpt, not a generated replacement claim.
    var brief = (r.objective.match(/^.*?[.!?](?:\s|$)/) || [r.objective])[0].trim();
    return '<div class="ag-progress eg-visual">' + (warn.length ? '<div class="eg-warning" role="status">' + esc(warn.join(' ')) + '</div>' : '') +
      disclosure('context', '<span class="eg-objective-label">Evergreen <small>Objective & next step</small></span><b class="eg-objective-brief">' + esc(brief) + '</b>', '<p>' + esc(r.objective) + '</p>' + (r.next ? '<p class="eg-next"><b>Next</b> ' + esc(r.next) + '</p>' : '') + '<p class="eg-source">' + esc(r.source) + ' · reconciled ' + esc(when(r.updatedAt)) + '</p>', 'eg-context') +
      totals(r.work) + '<div class="eg-dashboard">' + work(r.work) + '<aside class="eg-sidebar" data-eg-scroll="sidebar">' + recent(r.recent) +
      attention(r.decisions, 'Needs you', 'No decisions requested in this report.', 'eg-decisions') +
      attention(r.blockers, 'Blockers & follow-up', 'No blockers reported.', 'eg-blockers') + '</aside></div></div>';
  }
  function capture(root) {
    if (!root) return null;
    var open = [], scroll = {};
    root.querySelectorAll('[data-eg-open][open]').forEach(function (e) { open.push(e.dataset.egOpen); });
    root.querySelectorAll('[data-eg-scroll]').forEach(function (e) { scroll[e.dataset.egScroll] = e.scrollTop; });
    return { open: open, scroll: scroll };
  }
  function restore(root, saved) {
    if (!root || !saved) return;
    root.querySelectorAll('[data-eg-open]').forEach(function (e) { e.open = saved.open.indexOf(e.dataset.egOpen) > -1; });
    root.querySelectorAll('[data-eg-scroll]').forEach(function (e) { e.scrollTop = saved.scroll[e.dataset.egScroll] || 0; });
  }
  App.evergreen = { active: false, refresh: refresh, render: render, capture: capture, restore: restore, stamp: function () {
    return data && data.report ? (warnings().length ? 'Report needs attention' : 'Reported ' + when(data.report.updatedAt)) : 'Awaiting progress feed';
  } };
  setInterval(function () { refresh(false); }, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(false); });
})();
