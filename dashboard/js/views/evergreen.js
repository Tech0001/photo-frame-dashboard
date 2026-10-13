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
    return '<section class="eg-card eg-recent"><h3>What changed</h3>' + group(0, 'Today') + group(1, 'Yesterday') + (buckets[2].length ? group(2, 'Earlier') : '') + '</section>';
  }
  var statusNames = { completed: 'Done', underway: 'Underway', blocked: 'Blocked', pending: 'Pending', unknown: 'Unknown' };
  function counts(rows) {
    var out = { completed: 0, underway: 0, blocked: 0, pending: 0, unknown: 0 };
    rows.forEach(function (r) { out[r.status]++; }); return out;
  }
  function compactStages(row) {
    return '<span class="eg-mini-stages">' + stages.map(function (s) {
      var v = row.stages[s[0]];
      return '<span class="' + (v === true ? 'is-reported' : '') + '">' + (v === true ? '✓ ' : v === false ? '○ ' : '? ') + s[1] + '</span>';
    }).join('') + '</span>';
  }
  function progressNumbers(progress) {
    if (!progress) return { percent:null, today:null, yesterday:null };
    var today = +App.dayStart(App.now()), yesterday = +App.addDays(new Date(today), -1);
    function before(time) { return progress.history.filter(function (p) { return Date.parse(p.at) <= time; }).sort(function (a,b) { return Date.parse(b.at) - Date.parse(a.at); })[0]; }
    function difference(a,b) { return a && b && a.basis === b.basis && a.total === b.total ? Math.round((a.completed - b.completed) / a.total * 1000) / 10 : null; }
    var start = before(today), previous = before(yesterday);
    return { percent:Math.round(progress.completed / progress.total * 100), today:Date.parse(data.report.updatedAt) >= today ? difference(progress,start) : null, yesterday:difference(start,previous) };
  }
  function deltaText(value, label) { return value == null ? '— ' + label : (value > 0 ? '+' : '') + value + ' pp ' + label; }
  function changeLine(numbers) {
    return '<span class="eg-card-change' + (numbers.today > 0 ? ' is-forward' : numbers.today < 0 ? ' is-backward' : '') + '">' + deltaText(numbers.today,'today') + '<small>' + deltaText(numbers.yesterday,'yesterday') + '</small></span>';
  }
  function subtask(item) {
    var m = counts(item.milestones || []), numbers = progressNumbers(item.progress);
    var milestones = (item.milestones || []).length ? '<ul class="eg-submilestones">' + item.milestones.map(function (row) {
      return '<li><span class="eg-dot eg-status-' + row.status + '"></span><span>' + esc(row.title) + '</span><small>' + statusNames[row.status] + '</small></li>';
    }).join('') + '</ul>' : '';
    return disclosure('subtask-' + item.id, '<span class="eg-dot eg-status-' + item.status + '"></span><span class="eg-subtask-title"><b>' + esc(item.id) + ' · ' + esc(item.title) + '</b>' + (item.milestones.length ? '<small>' + m.completed + '/' + item.milestones.length + ' milestones achieved</small>' : '') + '</span>' + (numbers.percent == null ? '' : '<span class="eg-subtask-progress"><b class="num">' + numbers.percent + '%</b>' + changeLine(numbers) + '</span>') + '<span class="eg-state eg-status-' + item.status + '">' + statusNames[item.status] + '</span>',
      compactStages(item) + (item.owner ? '<p class="eg-owner">' + esc(item.owner) + '</p>' : '') + (item.next ? '<p class="eg-next"><b>Next</b> ' + esc(item.next) + '</p>' : '') + milestones, 'eg-subtask');
  }
  function sectionCards(r) {
    var byId = {}, order = [];
    function ensure(id, title) {
      if (!byId[id]) { byId[id] = { id:id, title:title, legacy:[] }; order.push(id); }
      return byId[id];
    }
    r.work.forEach(function (row) {
      var id = row.id.split('.')[0];
      var card = ensure(id, row.title.replace(/^C\d+\s*[-–:]\s*/, ''));
      if (row.id === id) card.title = row.title.replace(/^C\d+\s*[-–:]\s*/, '');
      card.legacy.push(row);
    });
    (r.sections || []).forEach(function (section) { ensure(section.id, section.title.replace(/^C\d+\s*[-–:]\s*/, '')).section = section; });
    order.sort(function (a,b) { return parseInt(a.slice(1),10) - parseInt(b.slice(1),10); });
    return '<section class="eg-board eg-card eg-sections-board"><header><h3>Project progress</h3><span class="eg-map-key">Tap a section for subtasks</span></header><p class="eg-map-note">Verified progress steps · pp = percentage points · tap for subtasks.</p><div class="eg-work-scroll" data-eg-scroll="sections"><div class="eg-section-grid">' + order.map(function (id) {
      var card = byId[id], section = card.section, c = section ? counts(section.items) : null;
      var total = section ? (section.totalItems || (section.coverage === 'complete' ? section.items.length : null)) : null;
      var numbers = progressNumbers(section && section.progress);
      var percent = numbers.percent != null ? numbers.percent : total ? Math.round(c.completed / total * 100) : null;
      var summary = '<span class="eg-section-head"><b>' + esc(id) + '</b><strong class="num">' + (percent == null ? '—' : percent + '<small>%</small>') + '</strong></span><span class="eg-section-title">' + esc(card.title) + '</span>' +
        '<span class="eg-section-bar' + (percent == null ? ' is-unreported' : '') + '">' + (percent == null ? '' : '<i style="width:' + percent + '%"></i>') + '</span>' +
        '<small class="eg-section-status">' + (section ? (section.progress ? section.progress.completed + '/' + section.progress.total + ' steps' : c.completed + '/' + (total || section.items.length) + ' done') + (!total && !section.progress ? ' · reported subset' : '') + (c.underway ? ' · ' + c.underway + ' underway' : '') + (c.blocked ? ' · ' + c.blocked + ' blocked' : '') : 'Progress not reported') + '</small>' + changeLine(numbers);
      var detail = section ? '<div class="eg-section-detail-head"><b>' + esc(id) + ' · Subtasks</b><small>' + (section.coverage === 'partial' ? 'Partial reporting' : 'Full checklist') + '</small></div>' + section.items.map(subtask).join('') : '<p class="eg-empty">Ledger has not supplied this section’s subtask states yet.</p>';
      if (!section) detail += card.legacy.map(function (row) { return '<div class="eg-legacy-scope"><b>' + esc(row.title) + '</b>' + compactStages(row) + '</div>'; }).join('');
      return disclosure('section-' + id, summary, detail, 'eg-section-card');
    }).join('') + '</div></div></section>';
  }
  function render() {
    if (!data || !data.report) return '<div class="ag-progress"><section class="eg-card eg-setup"><h2 class="serif">Evergreen</h2><p>' + (error ? 'The hub could not be reached. Try Refresh.' : busy ? 'Checking for Evergreen progress…' : 'Waiting for the first Evergreen report.') + '</p><p class="eg-empty">Ledger’s sync will bring the objective, recent progress, blockers and decisions here automatically.</p></section></div>';
    var r = data.report, warn = warnings();
    // The first sentence is a compact excerpt, not a generated replacement claim.
    var brief = (r.objective.match(/^.*?[.!?](?:\s|$)/) || [r.objective])[0].trim();
    return '<div class="ag-progress eg-visual">' + (warn.length ? '<div class="eg-warning" role="status">' + esc(warn.join(' ')) + '</div>' : '') +
      disclosure('context', '<span class="eg-objective-label">Evergreen <small>Objective & next step</small></span><b class="eg-objective-brief">' + esc(brief) + '</b>', '<p>' + esc(r.objective) + '</p>' + (r.next ? '<p class="eg-next"><b>Next</b> ' + esc(r.next) + '</p>' : '') + '<p class="eg-source">' + esc(r.source) + ' · reconciled ' + esc(when(r.updatedAt)) + '</p>', 'eg-context') +
      '<div class="eg-dashboard">' + sectionCards(r) + '<aside class="eg-sidebar" data-eg-scroll="sidebar">' + recent(r.recent) +
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
