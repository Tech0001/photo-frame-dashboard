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
  function attention(rows, title, empty, cls) {
    return '<section class="eg-card ' + cls + '"><h3>' + title + '</h3>' + (rows.length ? rows.map(function (row) {
      return '<article class="eg-row"><h4>' + esc(row.title) + '</h4>' + note(row) + (row.next ? '<p class="eg-next">Next: ' + esc(row.next) + '</p>' : '') + '</article>';
    }).join('') : '<p class="eg-empty">' + empty + '</p>') + '</section>';
  }
  function render() {
    if (!data || !data.report) return '<div class="ag-progress"><section class="eg-card eg-setup"><h2 class="serif">Evergreen</h2><p>' + (error ? 'The hub could not be reached. Try Refresh.' : busy ? 'Checking for Evergreen progress…' : 'Waiting for the first Evergreen report.') + '</p><p class="eg-empty">The configured progress feed will bring the objective, recent progress, blockers and decisions here automatically.</p></section></div>';
    var r = data.report, warn = warnings();
    return '<div class="ag-progress">' + (warn.length ? '<div class="eg-warning" role="status">' + esc(warn.join(' ')) + '</div>' : '') +
      '<section class="eg-objective"><div><h2 class="serif">Evergreen</h2><div class="eg-source">' + esc(r.source) + ' · reported ' + esc(when(r.updatedAt)) + '</div></div><p>' + esc(r.objective) + '</p>' + (r.next ? '<div class="eg-next"><b>Next</b> ' + esc(r.next) + '</div>' : '') + '</section>' +
      '<div class="eg-attention">' + attention(r.decisions, 'Needs you', 'No decisions requested in this report.', 'eg-decisions' + (r.decisions.length ? ' has-items' : '')) +
      attention(r.blockers, 'Blockers & follow-up', 'No blockers reported.', 'eg-blockers' + (r.blockers.length ? ' has-items' : '')) + '</div>' +
      '<div class="eg-columns"><section class="eg-card"><h3>What works today</h3><p class="eg-key">✓ reported · ○ pending · ? unreported</p>' + (r.work.length ? r.work.map(function (row) {
        return '<article class="eg-row"><h4>' + esc(row.title) + '</h4>' + note(row) + '<div class="eg-stages">' + stages.map(function (s) {
          var v = row.stages[s[0]]; return '<span class="eg-stage' + (v === true ? ' is-reported' : '') + '">' + (v === true ? '✓ ' : v === false ? '○ ' : '? ') + s[1] + '</span>';
        }).join('') + '</div></article>';
      }).join('') : '<p class="eg-empty">No delivery stages reported yet.</p>') + '</section>' +
      '<section class="eg-card"><h3>Recent progress</h3>' + (r.recent.length ? r.recent.map(function (row) {
        var stage = stages.filter(function (s) { return s[0] === row.stage; })[0][1];
        return '<article class="eg-row"><div class="eg-recent-meta">' + esc(stage) + ' · ' + esc(when(row.at)) + '</div><h4>' + esc(row.title) + '</h4>' + note(row) + '</article>';
      }).join('') : '<p class="eg-empty">No recent completions reported.</p>') + '</section></div></div>';
  }
  App.evergreen = { active: false, refresh: refresh, render: render, stamp: function () {
    return data && data.report ? (warnings().length ? 'Report needs attention' : 'Reported ' + when(data.report.updatedAt)) : 'Awaiting progress feed';
  } };
  setInterval(function () { refresh(false); }, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(false); });
})();
