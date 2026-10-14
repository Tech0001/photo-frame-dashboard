// Homelab: our service, repository activity and backup panels.
(function () {
  'use strict';
  var V = {el:null,data:null,error:'',timer:null,at:0,busy:false,tab:'overview'}, POLL_MS = 5 * 60000;
  function esc(value) { return App.esc(String(value == null ? '' : value)); }
  function bytes(value) { if (value == null) return '—'; var units=['B','KB','MB','GB','TB'],i=0;while(value>=1024&&i<4){value/=1024;i++;}return value.toFixed(i?1:0)+' '+units[i]; }
  function upfmt(seconds) { return seconds == null ? '—' : Math.round(seconds/60)+' min'; }
  function dateTime(value) {
    if (!value) return 'Not recorded';
    var d = new Date(value), today = new Date();
    return (d.toDateString() === today.toDateString() ? 'Today' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + ' · ' + App.fmt.time(d);
  }
  function servicesBody(d, stale) {
    var services = d.services || [], b = d.backup || {}, active = services.filter(function (s) { return s.configured; });
    var labels = { ok: 'Responding', error: 'Needs attention', warning: 'Check sign-in', off: 'Not connected', unknown: 'Unknown', overdue: 'Overdue' };
    var count = active.filter(function (s) { return s.state === 'ok'; }).length;
    var summary = stale ? 'Status is out of date' : !active.length ? 'Connect your services' : count === active.length ? 'Services responding' : 'Check your services';
    var rows = services.map(function (s) {
      var state = stale && s.configured ? 'unknown' : s.state;
      return '<div class="lab-service"><i class="lab-dot lab-' + esc(state) + '"></i><div class="lab-service-name">' + esc(s.name) + '<span>' + esc(s.detail) + '</span></div><span class="lab-state lab-' + esc(state) + '">' + esc(stale && s.configured ? 'Last known' : labels[state] || 'Unknown') + '</span></div>';
    }).join('');
    var backupState = stale && b.configured ? 'unknown' : b.state;
    var backupTitle = stale && b.configured ? 'Last known backup' : b.state === 'ok' ? 'Backed up' : b.state === 'overdue' ? 'Backup overdue' : b.state === 'error' ? 'Backup needs attention' : b.configured ? 'Backup status unknown' : 'Connect Time Machine';
    return '<div class="lab-overview"><span class="lab-overview-title">' + summary + '</span><span>' + (active.length ? count + ' of ' + active.length + ' checks passed' : 'Set up in server Connections → Homelab') + '</span></div>' +
      '<section class="nas-card lab-services" aria-label="Services">' + rows + '</section>' +
      '<section class="nas-card lab-backup"><div class="lab-backup-heading"><div><div class="label">Time Machine · ' + esc(b.label || 'VM backup') + '</div><h2 class="serif lab-' + esc(backupState) + '">' + backupTitle + '</h2></div><div class="lab-last"><span class="label">Last successful backup</span><strong>' + esc(dateTime(b.lastSuccess)) + '</strong></div></div>' +
      '<div class="lab-backup-detail"><span>' + esc(b.detail || 'Add the backup status file in server settings') + '</span>' +
      (b.snapshots != null ? '<span><b class="num">' + b.snapshots + '</b> snapshots</span>' : '') +
      (b.repoBytes != null ? '<span><b class="num">' + bytes(b.repoBytes) + '</b> stored</span>' : '') +
      (b.durationSeconds != null ? '<span>Last run <b class="num">' + upfmt(b.durationSeconds) + '</b></span>' : '') + '</div></section>' +
      '<p class="lab-footnote">Checks run from the hub. Web and port checks show availability; backup results come from Time Machine.</p>';
  }
  function metric(label, value, hint) {
    return '<div class="lab-metric"><span class="label">' + esc(label) + '</span><strong class="num">' + esc(value == null ? '–' : value) + '</strong><span>' + esc(hint || '') + '</span></div>';
  }
  function count(value) { return value == null ? null : value.toLocaleString(); }
  function detailMessage(d) { return '<section class="nas-card"><h2 class="serif lab-detail-title">Connect ' + (V.tab === 'github' ? 'GitHub' : V.tab === 'gitea' ? 'Gitea' : 'Pi-hole') + '</h2><p>' + esc(d && d.detail || 'Add an API token in server Connections → Homelab') + '</p></section>'; }
  function giteaBody(d) {
    var github = V.tab === 'github';
    if (!d || d.state === 'off' || !d.login) return detailMessage(d);
    var c = d.contributions, days = c ? c.days : [], most = Math.max.apply(null, [1].concat(days.map(function (v) { return v.count; })));
    var heatmap = days.map(function (v) { var level = v.count === 0 ? 0 : Math.max(1, Math.ceil(v.count / most * 4)); return '<span class="lab-heat-' + level + '" title="' + esc(v.date + ': ' + v.count + ' contributions') + '"></span>'; }).join('');
    var feed = d.pushes === null ? '<p>Recent activity is unavailable.</p>' : !d.pushes.length ? '<p>No pushes in the recent activity feed.</p>' : '<ol class="lab-pushes">' + d.pushes.map(function (p) {
      return '<li><div class="lab-push-repo">' + esc(p.repository) + '<span>' + esc(dateTime(p.at)) + '</span></div><div class="lab-push-title">' + esc(p.title) + '</div><div class="lab-push-meta">' + esc(p.actor) + (p.branch ? ' · ' + esc(p.branch) : '') + (p.commits != null ? ' · ' + p.commits + (p.commits === 1 ? ' commit' : ' commits') : '') + '</div></li>';
    }).join('') + '</ol>';
    return (d.state !== 'ok' ? '<div class="nas-banner">' + esc(d.detail) + '</div>' : '') +
      '<div class="lab-details"><section class="nas-card lab-git-summary"><div class="lab-detail-heading"><h2 class="serif lab-detail-title">' + (github ? 'GitHub' : 'Gitea') + '</h2><span class="label">' + esc(github ? 'Public activity' : d.version || 'Version unknown') + '</span></div><p class="lab-footnote">' + (github ? 'Public repositories owned by ' : 'Repositories accessible to ') + esc(d.login) + '</p>' +
      '<div class="lab-metrics">' + metric('Repositories', count(d.repositories)) + metric('Open pull requests', count(d.openPulls)) + metric('Open issues', count(d.openIssues)) + metric('Contributions', c ? count(c.week) : null, 'Past 7 days · ' + d.login) + '</div>' +
      '<div class="label">' + esc(d.login) + ' · past 6 weeks</div><div class="lab-heatmap" aria-label="Contribution history">' + heatmap + '</div><p class="lab-footnote">' + (c ? c.today + ' contributions today. ' : 'History unavailable. ') + 'Contributions include more than commits.</p>' + (github ? '<p class="lab-footnote">From your public GitHub profile · GitHub calendar dates. Checked ' + esc(dateTime(d.updated)) + '. Refreshes every 15 minutes.</p>' : '') + '</section>' +
      '<section class="nas-card lab-git-feed"><div class="label">' + esc(d.organization || 'Your activity feed') + '</div><h2 class="serif lab-detail-title">Recent pushes</h2>' + feed + '<p class="lab-footnote">Latest pushes from up to 100 feed events.</p></section></div>';
  }
  function piholeBody(d) {
    if (!d || d.state === 'off') return detailMessage(d);
    var m = d.management || {};
    var versions = (d.versions || []).map(function (v) { return '<div class="lab-version"><div><strong>' + esc(v.name) + '</strong><span>' + esc(v.current || 'Version unavailable') + '</span></div><span class="' + (v.update === true ? 'lab-warning' : '') + '">' + (v.update === true ? 'Update: ' + esc(v.latest) : v.update === false ? 'Up to date' : 'Update unknown') + '</span></div>'; }).join('');
    return (d.state !== 'ok' ? '<div class="nas-banner">' + esc(d.detail) + '</div>' : '') +
      '<div class="lab-details"><section class="nas-card lab-pi-summary"><h2 class="serif lab-detail-title">Pi-hole</h2><p class="lab-blocking ' + (d.blocking === true ? 'lab-ok' : d.blocking === false ? 'lab-warning' : 'lab-unknown') + '">' + (d.blocking === true ? 'Blocking enabled' : d.blocking === false ? 'Blocking disabled' : 'Blocking status unknown') + '</p><div class="lab-metrics">' +
      metric('DNS queries', count(d.queries), d.period || 'Today') + metric('Blocked', d.blockedPercent == null ? null : d.blockedPercent.toFixed(1) + '%', d.blocked == null ? '' : count(d.blocked) + (d.period ? ' queries · ' + d.period.toLowerCase() : ' queries today')) + metric('Active clients', count(d.clients), d.period || 'Today') + metric('Blocked domains', count(d.domains), 'In blocklists') + '</div>' +
      (m.state === 'ok' ? '<div class="lab-gravity"><span class="label">Host uptime</span><strong>' + esc(upfmt(m.uptimeSeconds)) + '</strong><span>Last boot · ' + esc(dateTime(m.bootedAt)) + '</span></div><p class="lab-footnote">' + esc(m.os) + '</p>' : '<p class="lab-footnote">' + esc(m.configured ? 'Management connection unavailable; uptime unknown.' : 'Connect management in server settings for uptime and last boot.') + '</p>') + '</section>' +
      '<section class="nas-card lab-pi-updates"><h2 class="serif lab-detail-title">Updates</h2>' + versions + '<div class="lab-gravity"><span class="label">Blocklists last refreshed</span><strong>' + esc(dateTime(d.gravityUpdated)) + '</strong></div>' +
      (m.updateReason ? '<p class="lab-update-note">' + esc(m.updateReason) + '</p>' : '') + '<p class="lab-footnote">Last software update through the hub: ' + esc(dateTime(m.softwareUpdatedAt)) + '. Blocklist refresh is separate.</p></section></div>';
  }
  function tabs() {
    return '<nav class="lab-tabs" aria-label="Homelab sections">' + [['overview', 'Overview'], ['pihole', 'Pi-hole'], ['gitea', 'Gitea'], ['github', 'GitHub']].map(function (t) { return '<button type="button" data-lab-tab="' + t[0] + '" aria-pressed="' + (V.tab === t[0]) + '" class="' + (V.tab === t[0] ? 'is-active' : '') + '">' + t[1] + '</button>'; }).join('') + '</nav>';
  }
  function render() {
    if (!V.el) return;
    var d = V.data, legacy = false;
    var at = d && d.updated ? Date.parse(d.updated) : 0;
    var stale = !!V.error || (!!at && Date.now() - at > POLL_MS + 15000);
    var stamp = stale ? 'Connection lost · last known status' : at ? 'Checked ' + App.fmt.time(new Date(at)) : 'Loading…';
    var scroll = V.el.querySelector('.nas'), top = scroll ? scroll.scrollTop : 0;
    V.el.innerHTML = '<div class="nas' + (legacy ? '' : ' nas-services') + '">' +
      '<header class="nas-top"><div><div class="label">' + (legacy ? 'Proxmox · ProxMenux' : 'Services & backups') + (d && d.sample ? ' · sample data' : '') + '</div><h1 class="serif">Homelab</h1></div>' +
      '<div class="nas-sync"><span class="label">' + stamp + '</span><button class="icon-btn" data-refresh aria-label="Refresh">' + App.icon('undo', 26) + '</button></div></header>' +
      (stale ? '<div class="nas-banner">Current status unavailable. Check the hub connection.</div>' : '') +
      (tabs() + (d ? '<div class="lab-content' + (stale ? ' lab-stale' : '') + '">' + (V.tab === 'github' ? giteaBody(d.github) : V.tab === 'gitea' ? giteaBody(d.gitea) : V.tab === 'pihole' ? piholeBody(d.pihole) : servicesBody(d, stale)) + '</div>' : '<section class="nas-card nas-msg"><p>' + (V.error ? esc(V.error) : 'Checking services…') + '</p></section>')) + '</div>';
    V.el.querySelector('.nas').scrollTop = top;
  }

  function visible() { return App.current === 'nas' && !document.hidden && (App.mode === 'day' || App.mode === 'nightdash'); }
  function load(force) {
    if (V.busy || !visible()) return;
    if (!App.live) { V.data = { services:[],backup:{configured:false},sample:true }; V.at = Date.now(); render(); return; }
    V.busy = true;
    var controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, 10000);
    fetch('/api/homelab' + (force ? '?refresh=1' : ''), { cache: 'no-store', signal: controller.signal }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { V.data = d; V.error = ''; V.at = Date.now(); })
      .catch(function (e) { V.error = 'The hub could not be reached (' + e.message + ')';  })
      .then(function () { clearTimeout(timeout); V.busy = false; render(); });
  }
  function start() { stop(); if (!visible()) return; load(); V.timer = setInterval(load, POLL_MS); }
  function stop() { if (V.timer) { clearInterval(V.timer); V.timer = null; } }

  document.addEventListener('visibilitychange', start);
  App.on('mode', start);

  App.register('nas', {
    show: function (el) {
      if (!V.el) {
        V.el = el;
        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-refresh]')) { load(true); return; }
          var tab = e.target.closest('[data-lab-tab]');
          if (tab) { V.tab = tab.getAttribute('data-lab-tab'); render(); V.el.querySelector('.nas').scrollTop = 0; }
        });
      }
      render();
      start();
    },
    resume: function () { start(); },
    hide: stop
  });
})();
