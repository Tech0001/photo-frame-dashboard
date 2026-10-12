// Homelab service availability and Time Machine backups. Legacy ProxMenux remains available.
(function () {
  'use strict';
  var V = { el: null, data: null, error: '', timer: null, at: 0, busy: false, tab: 'overview' };
  var POLL_MS = 5 * 60 * 1000;

  var SAMPLE = {
    ok: true, configured: true, sample: true, updated: new Date().toISOString(),
    host: { name: 'pve', pve: '8.x', kernel: '', cpu: 14.2, mem: 61.5, temp: 52, uptime: 1209600 },
    storage: { total: 8e12, used: 5.1e12, free: 2.9e12, pct: 63.7, disks: [
      { device: 'sda', model: 'Sample disk', size: '4 TB', temp: 34, health: 'PASSED' }, { device: 'sdb', model: 'Sample disk', size: '4 TB', temp: 36, health: 'PASSED' }] },
    guests: { total: 6, running: 5, list: [
      { id: 100, name: 'nas', type: 'lxc', status: 'running', cpu: 2.1 }, { id: 101, name: 'media', type: 'vm', status: 'running', cpu: 8.4 },
      { id: 102, name: 'home-assistant', type: 'vm', status: 'running', cpu: 1.3 }, { id: 105, name: 'debian', type: 'vm', status: 'running', cpu: 0.4 },
      { id: 110, name: 'caddy', type: 'lxc', status: 'running', cpu: 0.2 }, { id: 120, name: 'test', type: 'vm', status: 'stopped', cpu: 0 }] },
    net: [], health: { status: 'healthy', issues: 0 }, errors: []
  };

  function esc(s) { return App.esc ? App.esc(String(s == null ? '' : s)) : String(s == null ? '' : s); }
  function bytes(n) {
    if (n == null) return '–';
    var u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
  }
  function upfmt(s) {
    if (s == null) return '–';
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm';
  }
  function tone(p, warn, hot) { return p == null ? '' : p >= (hot || 90) ? ' is-hot' : p >= (warn || 70) ? ' is-warn' : ''; }

  function stat(label, value, unit, pct, sub, t) {
    return '<section class="nas-card nas-stat' + (t || '') + '"><div class="label">' + label + '</div>' +
      '<div class="nas-big num">' + (value == null ? '–' : value) + (value != null && unit ? '<small>' + unit + '</small>' : '') + '</div>' +
      (pct != null ? '<div class="nas-bar"><i style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div>' : '<div class="nas-bar nas-bar--none"></div>') +
      '<div class="nas-sub">' + sub + '</div></section>';
  }

  function guest(g) {
    var up = g.status === 'running';
    return '<li class="nas-guest' + (up ? '' : ' is-off') + '"><i class="nas-dot"></i><span class="nas-gname">' + esc(g.name) + '</span>' +
      '<span class="nas-gtype">' + esc((g.type || '').toUpperCase()) + ' ' + esc(g.id) + '</span>' +
      '<span class="nas-gcpu num">' + (up && g.cpu != null ? g.cpu + '%' : (up ? '' : esc(g.status))) + '</span></li>';
  }

  function body(d) {
    var h = d.host, s = d.storage, g = d.guests;
    var issues = d.health && d.health.status && !/^(ok|healthy|good)$/i.test(d.health.status);
    var banner = issues ? '<div class="nas-banner">' + App.icon('bolt', 18) + 'Health: ' + esc(d.health.status) + (d.health.issues ? ' · ' + d.health.issues + ' active' : '') + '</div>' : '';
    var disks = (s.disks || []).filter(function (k) { return k.size && !/^0(.0)?[A-Z]?$/.test(String(k.size)); }).slice(0, 8).map(function (k) {
      var bad = k.health && !/^(passed|ok|healthy|unknown)$/i.test(k.health);
      return '<li><span class="nas-dname">' + esc(k.device) + '</span><span class="nas-dmodel">' + esc(k.size || '') + ' · ' + esc(k.type || '') + '</span>' +
        '<span class="nas-dtemp num' + (bad ? ' is-hot' : '') + '">' + (k.temp != null ? k.temp + '°' : '') + (bad ? ' ' + esc(k.health) : '') + '</span></li>';
    }).join('');
    var list = (g.list || []).slice(0, 16).map(guest).join('');
    return banner +
      '<div class="nas-stats">' +
      stat('CPU', h.cpu, '%', h.cpu, esc(h.name || 'host') + (h.threads ? ' · ' + h.threads + ' threads' : '') + (h.load != null ? ' · load ' + h.load : ''), tone(h.cpu, 70, 90)) +
      stat('Memory', h.mem, '%', h.mem, h.memUsed != null && h.memTotal != null ? h.memUsed + ' of ' + h.memTotal + ' GB' : 'in use', tone(h.mem, 80, 92)) +
      stat('Temperature', h.temp, '°C', h.temp == null ? null : h.temp / 90 * 100, 'CPU package', tone(h.temp, 70, 85)) +
      stat('Uptime', upfmt(h.uptime), '', null, (h.pve ? 'Proxmox ' + esc(h.pve) : '') + (h.updates ? ' · ' + h.updates + (h.updates === 1 ? ' update' : ' updates') : ''), h.updates ? ' is-warn' : '') + '</div>' +
      '<div class="nas-lower">' +
      '<section class="nas-card nas-store' + tone(s.pct, 80, 92) + '"><div class="label">Storage' + (s.pools && s.pools[0] ? ' · ' + esc(s.pools[0].name) + (s.pools[0].health ? ' ' + esc(String(s.pools[0].health).toLowerCase()) : '') : '') + '</div>' +
      '<div class="nas-big num">' + (s.pct == null ? '–' : s.pct) + '<small>% full</small></div>' +
      '<div class="nas-bar"><i style="width:' + Math.max(0, Math.min(100, s.pct || 0)) + '%"></i></div>' +
      '<div class="nas-sub">' + bytes(s.used) + ' used of ' + bytes(s.total) + ' · ' + bytes(s.free) + ' free</div>' +
      (disks ? '<ul class="nas-disks">' + disks + '</ul>' : '') + '</section>' +
      '<section class="nas-card nas-guests"><div class="label">Guests · ' + g.running + ' of ' + g.total + ' running</div><ul>' + (list || '<li class="nas-empty">No VMs or containers reported</li>') + '</ul></section>' +
      '</div>';
  }

  function empty(d) {
    var why = (d && d.errors && d.errors[0]) || V.error || 'No data yet';
    var cfg = d && d.configured === false;
    return '<section class="nas-card nas-msg"><div class="serif nas-msg-h">' + (cfg ? 'Connect ProxMenux' : 'Can’t reach the NAS') + '</div>' +
      '<p>' + (cfg ? 'Add a ProxMenux API token to <b>hub/config/secrets.json</b> on the NAS (key <b>proxmenux_token</b>) and restart the hub.' : esc(why)) + '</p>' +
      (cfg ? '<p class="nas-sub">' + esc(why) + '</p>' : '') + '</section>';
  }

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
  function detailMessage(d) { return '<section class="nas-card"><h2 class="serif lab-detail-title">Connect ' + (V.tab === 'gitea' ? 'Gitea' : 'Pi-hole') + '</h2><p>' + esc(d && d.detail || 'Add an API token in server Connections → Homelab') + '</p></section>'; }
  function giteaBody(d) {
    if (!d || d.state === 'off' || !d.login) return detailMessage(d);
    var c = d.contributions, days = c ? c.days : [], most = Math.max.apply(null, [1].concat(days.map(function (v) { return v.count; })));
    var heatmap = days.map(function (v) { var level = v.count === 0 ? 0 : Math.max(1, Math.ceil(v.count / most * 4)); return '<span class="lab-heat-' + level + '" title="' + esc(v.date + ': ' + v.count + ' contributions') + '"></span>'; }).join('');
    var feed = d.pushes === null ? '<p>Recent activity is unavailable.</p>' : !d.pushes.length ? '<p>No pushes in the recent activity feed.</p>' : '<ol class="lab-pushes">' + d.pushes.map(function (p) {
      return '<li><div class="lab-push-repo">' + esc(p.repository) + '<span>' + esc(dateTime(p.at)) + '</span></div><div class="lab-push-title">' + esc(p.title) + '</div><div class="lab-push-meta">' + esc(p.actor) + (p.branch ? ' · ' + esc(p.branch) : '') + (p.commits != null ? ' · ' + p.commits + (p.commits === 1 ? ' commit' : ' commits') : '') + '</div></li>';
    }).join('') + '</ol>';
    return (d.state !== 'ok' ? '<div class="nas-banner">' + esc(d.detail) + '</div>' : '') +
      '<div class="lab-details"><section class="nas-card lab-git-summary"><div class="lab-detail-heading"><h2 class="serif lab-detail-title">Gitea</h2><span class="label">' + esc(d.version || 'Version unknown') + '</span></div><p class="lab-footnote">Repositories accessible to ' + esc(d.login) + '</p>' +
      '<div class="lab-metrics">' + metric('Repositories', count(d.repositories)) + metric('Open pull requests', count(d.openPulls)) + metric('Open issues', count(d.openIssues)) + metric('Contributions', c ? count(c.week) : null, 'Past 7 days · ' + d.login) + '</div>' +
      '<div class="label">' + esc(d.login) + ' · past 6 weeks</div><div class="lab-heatmap" aria-label="Contribution history">' + heatmap + '</div><p class="lab-footnote">' + (c ? c.today + ' contributions today. ' : 'History unavailable. ') + 'Contributions include more than commits.</p></section>' +
      '<section class="nas-card lab-git-feed"><div class="label">' + esc(d.organization || 'Your activity feed') + '</div><h2 class="serif lab-detail-title">Recent pushes</h2>' + feed + '<p class="lab-footnote">Latest pushes from up to 100 feed events.</p></section></div>';
  }
  function piholeBody(d) {
    if (!d || d.state === 'off') return detailMessage(d);
    var versions = (d.versions || []).map(function (v) { return '<div class="lab-version"><div><strong>' + esc(v.name) + '</strong><span>' + esc(v.current || 'Version unavailable') + '</span></div><span class="' + (v.update === true ? 'lab-warning' : '') + '">' + (v.update === true ? 'Update: ' + esc(v.latest) : v.update === false ? 'Up to date' : 'Update unknown') + '</span></div>'; }).join('');
    return (d.state !== 'ok' ? '<div class="nas-banner">' + esc(d.detail) + '</div>' : '') +
      '<div class="lab-details"><section class="nas-card lab-pi-summary"><h2 class="serif lab-detail-title">Pi-hole</h2><p class="lab-blocking ' + (d.blocking === true ? 'lab-ok' : d.blocking === false ? 'lab-warning' : 'lab-unknown') + '">' + (d.blocking === true ? 'Blocking enabled' : d.blocking === false ? 'Blocking disabled' : 'Blocking status unknown') + '</p><div class="lab-metrics">' +
      metric('DNS queries', count(d.queries), 'Today') + metric('Blocked', d.blockedPercent == null ? null : d.blockedPercent.toFixed(1) + '%', d.blocked == null ? '' : count(d.blocked) + ' queries today') + metric('Active clients', count(d.clients), 'Today') + metric('Blocked domains', count(d.domains), 'In blocklists') + '</div></section>' +
      '<section class="nas-card lab-pi-updates"><h2 class="serif lab-detail-title">Updates</h2>' + versions + '<div class="lab-gravity"><span class="label">Blocklists last refreshed</span><strong>' + esc(dateTime(d.gravityUpdated)) + '</strong></div><p class="lab-footnote">Blocklist refresh is separate from updating Pi-hole itself. This API does not report the last reboot or software installation date.</p></section></div>';
  }
  function tabs() {
    return '<nav class="lab-tabs" aria-label="Homelab sections">' + [['overview', 'Overview'], ['pihole', 'Pi-hole'], ['gitea', 'Gitea']].map(function (t) { return '<button type="button" data-lab-tab="' + t[0] + '" aria-pressed="' + (V.tab === t[0]) + '" class="' + (V.tab === t[0] ? 'is-active' : '') + '">' + t[1] + '</button>'; }).join('') + '</nav>';
  }
  function render() {
    if (!V.el) return;
    var d = V.data, legacy = d && d.kind === 'proxmenux', old = legacy ? d.legacy : null;
    var at = legacy ? V.at : d && d.updated ? Date.parse(d.updated) : 0;
    var stale = !!V.error || (!!at && Date.now() - at > POLL_MS + 15000);
    var stamp = stale ? 'Connection lost · last known status' : at ? 'Checked ' + App.fmt.time(new Date(at)) : 'Loading…';
    var scroll = V.el.querySelector('.nas'), top = scroll ? scroll.scrollTop : 0;
    V.el.innerHTML = '<div class="nas' + (legacy ? '' : ' nas-services') + '">' +
      '<header class="nas-top"><div><div class="label">' + (legacy ? 'Proxmox · ProxMenux' : 'Services & backups') + (d && d.sample ? ' · sample data' : '') + '</div><h1 class="serif">Homelab</h1></div>' +
      '<div class="nas-sync"><span class="label">' + stamp + '</span><button class="icon-btn" data-refresh aria-label="Refresh">' + App.icon('undo', 26) + '</button></div></header>' +
      (stale ? '<div class="nas-banner">Current status unavailable. Check the hub connection.</div>' : '') +
      (legacy ? old && old.ok ? body(old) : empty(old) : tabs() + (d ? '<div class="lab-content' + (stale ? ' lab-stale' : '') + '">' + (V.tab === 'gitea' ? giteaBody(d.gitea) : V.tab === 'pihole' ? piholeBody(d.pihole) : servicesBody(d, stale)) + '</div>' : '<section class="nas-card nas-msg"><p>' + (V.error ? esc(V.error) : 'Checking services…') + '</p></section>')) + '</div>';
    V.el.querySelector('.nas').scrollTop = top;
  }

  function visible() { return App.current === 'nas' && !document.hidden && (App.mode === 'day' || App.mode === 'nightdash'); }
  function load(force) {
    if (V.busy || !visible()) return;
    if (!App.live) { V.data = { kind: 'proxmenux', legacy: SAMPLE, sample: true }; V.at = Date.now(); render(); return; }
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
