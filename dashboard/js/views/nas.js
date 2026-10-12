// Homelab: Proxmox host, storage and guests from ProxMenux Monitor, via the hub (hub/lib/nas.js).
// The ProxMenux token never reaches this page; the hub returns summary numbers only.
(function () {
  'use strict';
  var V = { el: null, data: null, error: '', timer: null, at: 0, busy: false };
  var POLL_MS = 15000;

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

  function render() {
    if (!V.el) return;
    var d = V.data, ok = d && d.ok;
    var stamp = V.at ? 'Updated ' + App.fmt.time(new Date(V.at)) : 'Loading…';
    V.el.innerHTML = '<div class="nas">' +
      '<header class="nas-top"><div><div class="label">Proxmox · ProxMenux' + (d && d.sample ? ' · sample data' : '') + '</div><h1 class="serif">Homelab</h1></div>' +
      '<div class="nas-sync"><span class="label">' + stamp + '</span><button class="icon-btn" data-refresh aria-label="Refresh">' + App.icon('undo', 26) + '</button></div></header>' +
      (ok ? body(d) : empty(d)) + '</div>';
  }

  function load() {
    if (V.busy) return;
    if (!App.live) { V.data = SAMPLE; V.at = Date.now(); render(); return; }
    V.busy = true;
    fetch('/api/nas', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { V.data = d; V.error = ''; V.at = Date.now(); })
      .catch(function (e) { V.error = 'The hub could not be reached (' + e.message + ')'; V.data = V.data && V.data.ok ? V.data : null; })
      .then(function () { V.busy = false; render(); });
  }
  function start() { stop(); load(); V.timer = setInterval(load, POLL_MS); }
  function stop() { if (V.timer) { clearInterval(V.timer); V.timer = null; } }

  App.register('nas', {
    show: function (el) {
      if (!V.el) {
        V.el = el;
        el.addEventListener('click', function (e) { if (e.target.closest('[data-refresh]')) load(); });
      }
      render();
      start();
    },
    resume: function () { start(); },
    hide: stop
  });
})();
