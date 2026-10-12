// The live Home page. The bundled/offline prototype keeps its separate demo view.
(function () {
  'use strict';
  var root = null, busy = false;
  var esc = App.esc;
  function text(v) { return esc(v == null ? '—' : v); }
  function stale(d) { return !!(d && (d.stale || (d.updated && Date.now() - Date.parse(d.updated) > 90000))); }
  function stamp(d) { return d && d.updated ? 'Checked ' + new Date(d.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Not checked yet'; }
  function pretty(s) { if (s === 'heat_cool') return 'Heat / cool'; return String(s || '').replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }
  function moment(s) {
    var d = new Date(s), now = new Date();
    if (!s || isNaN(d.getTime())) return 'No event reported';
    var day = App.sameDay(d, now) ? 'Today' : App.sameDay(d, App.addDays(now, 1)) ? 'Tomorrow' : App.sameDay(d, App.addDays(now, -1)) ? 'Yesterday' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return day + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function stem(e) { return e.id.split('.').slice(1).join('.'); }
  function belongs(e, key, name) {
    return stem(e) === key || stem(e).indexOf(key + '_') === 0 || (name && e.name.toLowerCase().indexOf(name.toLowerCase() + ' ') === 0);
  }
  function groupHome(d) {
    var remaining = (d.entities || []).slice(), sun = [], devices = [];
    remaining = remaining.filter(function (e) {
      if (/^sun_next_(dawn|dusk|rising|setting|noon|midnight)$/.test(stem(e))) { sun.push(e); return false; }
      // Selected temperature/humidity sensors can duplicate the thermostat's own readings.
      var c = d.climate, same = c && c.available && e.available && belongs(e, stem(c), c.name);
      return !(same && ((e.deviceClass === 'temperature' && e.unit === c.unit && Number(e.state) === c.current) || (e.deviceClass === 'humidity' && Number(e.state) === c.humidity)));
    });
    remaining.filter(function (e) { return e.domain === 'camera'; }).forEach(function (e) {
      var key = stem(e).replace(/_(live_view|last_recording|camera|snapshot)$/, ''), name = e.name.replace(/\s+(live view|last recording|camera|snapshot)$/i, '');
      if (!devices.some(function (g) { return g.key === key; })) devices.push({ key: key, name: name || e.name, entities: [] });
    });
    devices.sort(function (a, b) { return b.key.length - a.key.length; }); // Prefer the most specific shared entity prefix.
    remaining = remaining.filter(function (e) {
      var g = devices.find(function (g) { return belongs(e, g.key, g.name); });
      if (!g) return true; g.entities.push(e); return false;
    });
    devices.sort(function (a, b) { return a.name.localeCompare(b.name); });
    sun.sort(function (a, b) { return Date.parse(a.state) - Date.parse(b.state); });
    return { sun: sun, devices: devices, others: remaining };
  }
  function fact(label, value, unit) {
    return '<div class="ha-fact"><dt>' + text(label) + '</dt><dd>' + text(value) + (unit ? '<small>' + text(unit) + '</small>' : '') + '</dd></div>';
  }
  function thermostat(c) {
    if (!c) return '<section class="ha-climate"><h2 class="serif">Choose your thermostat</h2><p>Select it in Frame admin → Connections → Home Assistant.</p></section>';
    var good = c.available, target = c.low != null && c.high != null ? c.low + '–' + c.high : c.target;
    return '<section class="ha-climate" aria-label="' + text(c.name) + ' thermostat"><div class="ha-climate-title"><h2 class="serif">' + text(c.name) + '</h2><span class="ha-action' + (!good ? ' ha-warning' : '') + '">' + App.icon('thermo', 20) + text(good ? pretty(c.action || 'Status not reported') : 'Unavailable') + '</span></div>' +
      '<div class="ha-climate-body"><div class="ha-temperature num">' + text(good ? c.current : null) + '<small>' + text(c.unit || '') + '</small><span class="label">Inside</span></div>' +
      '<dl class="ha-facts">' + fact('Target', good ? target : null, good && target != null ? c.unit : '') + fact('Humidity', good ? c.humidity : null, good && c.humidity != null ? '%' : '') + fact('Mode', good ? pretty(c.state) : 'Unknown') + fact('Comfort', good ? pretty(c.preset === 'temp' ? 'Temperature hold' : c.preset || 'Not reported') : 'Unknown') + '</dl></div></section>';
  }
  function daylight(entities) {
    if (!entities.length) return '';
    var labels = { dawn: 'Dawn', dusk: 'Dusk', rising: 'Sunrise', setting: 'Sunset', noon: 'Solar noon', midnight: 'Solar midnight' };
    return '<section class="ha-daylight" aria-label="Sun times"><div class="label">' + App.icon('sun', 18) + ' Sun times</div>' + entities.map(function (e) {
      var kind = stem(e).replace('sun_next_', ''), d = e.available ? new Date(e.state) : null;
      return '<div class="ha-sun-time"><span>' + text(labels[kind] || e.name) + '</span><div><b>' + text(d && !isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—') + '</b><small>' + text(d ? moment(e.state).split(' · ')[0] : 'No reading') + '</small></div></div>';
    }).join('') + '</section>';
  }
  function valueOf(e) {
    var value = e.available ? e.state : e.state === 'unknown' ? 'No reading yet' : 'Unavailable';
    if ((e.available || e.state === 'unknown') && e.domain === 'event') value = e.eventAt ? moment(e.eventAt) : 'No event reported';
    else if (e.available && e.deviceClass === 'timestamp') value = moment(e.state);
    else if (e.available && e.domain === 'binary_sensor') {
      var pairs = { motion: ['Clear', 'Motion detected'], occupancy: ['Clear', 'Occupied'], door: ['Closed', 'Open'], window: ['Closed', 'Open'], connectivity: ['Disconnected', 'Connected'], battery: ['Normal', 'Low battery'], problem: ['Clear', 'Problem detected'] };
      value = pairs[e.deviceClass] ? pairs[e.deviceClass][e.state === 'on' ? 1 : 0] : pretty(e.state);
    }
    return value;
  }
  function sensor(e, groupName) {
    var label = e.name;
    if (groupName && label.toLowerCase().indexOf(groupName.toLowerCase() + ' ') === 0) label = label.slice(groupName.length).trim();
    if (e.domain === 'event' && /ding/i.test(label)) label = 'Doorbell';
    return '<div class="ha-reading' + (!e.available ? ' ha-unavailable' : '') + '"><dt>' + text(label) + '</dt><dd>' + text(valueOf(e)) + (e.available && e.domain === 'sensor' && e.unit ? '<small>' + text(e.unit) + '</small>' : '') + '</dd></div>';
  }
  function device(g) {
    var cameras = g.entities.filter(function (e) { return e.domain === 'camera'; }), readings = g.entities.filter(function (e) { return e.domain !== 'camera'; });
    var cameraStatus = cameras.map(function (e) { return e.available ? pretty(e.state) : 'Unavailable'; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' / ');
    return '<section class="ha-device" aria-label="' + text(g.name) + '"><div class="ha-device-title"><h3 class="serif">' + text(g.name) + '</h3><span class="ha-camera-status">' + App.icon('camera', 18) + ' Camera · ' + text(cameraStatus) + '</span></div><dl class="ha-device-readings">' + readings.map(function (e) { return sensor(e, g.name); }).join('') + '</dl><div class="ha-device-actions">' + cameras.map(function (e) {
      return '<button class="ha-image-btn" data-ha-camera="' + esc(e.id) + '" aria-label="View ' + text(e.name) + ' snapshot"' + (!e.available ? ' disabled' : '') + '>' + App.icon('photo', 20) + (cameras.length > 1 ? text(e.name.replace(g.name, '').trim()) : 'View snapshot') + '</button>';
    }).join('') + '</div></section>';
  }
  function render() {
    if (!root || App.current !== 'control') return;
    var d = App.homeData, warn = stale(d), msg = !d ? 'Connecting to Home Assistant…' : !d.configured ? 'Connect Home Assistant in Frame admin → Connections → Home Assistant.' : d.error || '';
    var groups = d ? groupHome(d) : null, scroller = root.querySelector('.ha-content'), scrollTop = scroller ? scroller.scrollTop : 0;
    root.innerHTML = '<div class="ha-home' + (warn ? ' is-stale' : '') + '"><header class="ha-top"><h1 class="serif">Home</h1><div class="ha-sync"><span class="label' + (warn ? ' ha-warning' : '') + '">' + (warn ? 'Connection needs attention · ' : '') + text(stamp(d)) + '</span><button class="icon-btn" data-ha-refresh aria-label="Refresh home status">' + App.icon('undo', 24) + '</button></div></header>' +
      (msg ? '<div class="ha-banner' + (warn ? ' ha-warning' : '') + '">' + text(msg) + (d && d.updated && warn ? ' Showing the last successful readings.' : '') + '</div>' : '') +
      (d && d.configured ? '<div class="ha-content"><div class="ha-overview' + (groups.sun.length ? ' has-sun' : '') + '">' + thermostat(d.climate) + daylight(groups.sun) + '</div>' +
        (groups.devices.length ? '<section class="ha-devices"><h2 class="label">Cameras & doorbells</h2><div class="ha-device-list">' + groups.devices.map(device).join('') + '</div></section>' : '') +
        (groups.others.length ? '<section class="ha-other"><h2 class="label">Other readings</h2><dl>' + groups.others.map(function (e) { return sensor(e); }).join('') + '</dl></section>' : '') +
        (!groups.devices.length && !groups.others.length && !d.climate ? '<p>Choose devices in Frame admin → Connections → Home Assistant.</p>' : '') + '</div>' : '') + '</div>';
    scroller = root.querySelector('.ha-content'); if (scroller) scroller.scrollTop = scrollTop;
  }
  function load() {
    if (!App.live || busy || document.hidden) return;
    busy = true;
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 12000);
    fetch('/api/home', { cache: 'no-store', signal: ctl.signal }).then(function (r) { if (!r.ok) throw Error(); return r.json(); })
      .then(function (d) { App.homeData = d; })
      .catch(function () { App.homeData = Object.assign({}, App.homeData || { configured: true, entities: [] }, { ok: false, stale: true, error: 'Home status could not be refreshed. Reconnecting…' }); })
      .then(function () { clearTimeout(timer); busy = false; render(); App.emit('home-data'); });
  }
  function image(id) {
    var e = (App.homeData && App.homeData.entities || []).filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    App.sheet('<h2 class="serif">' + text(e.name) + '</h2><p>Latest image available from Home Assistant. This is not a live video feed.</p><p data-ha-image-status>Loading image…</p><img class="ha-camera-image" alt="' + text(e.name) + '">', {
      onMount: function (el) {
        var img = el.querySelector('img'), label = el.querySelector('[data-ha-image-status]');
        img.onload = function () { label.textContent = 'Image received. Capture time is not provided.'; };
        img.onerror = function () { img.hidden = true; label.textContent = 'No image is available from this camera right now.'; };
        img.src = '/api/home/camera?entity=' + encodeURIComponent(id) + '&at=' + Date.now();
      }
    });
  }
  App.homeView = {
    show: function (el) {
      root = el;
      if (!el.dataset.haBound) {
        el.dataset.haBound = 'true'; el.addEventListener('click', function (e) {
          if (e.target.closest('[data-ha-refresh]')) load();
          var b = e.target.closest('[data-ha-camera]'); if (b) image(b.dataset.haCamera);
        });
      }
      render(); load();
    },
    resume: function () { render(); load(); },
    summary: function () {
      var d = App.homeData, c = d && d.climate;
      return '<div class="label">Home</div><div class="h-st-row">' + App.icon('thermo', 24) + (c && c.available ? '<b class="num">' + text(c.current) + text(c.unit || '') + '</b><span>inside</span>' : '<span>' + (!d ? 'Connecting…' : !d.configured ? 'Connect Home Assistant' : 'No thermostat reading') + '</span>') + '</div><div class="h-st-row' + (stale(d) ? ' is-warn' : '') + '"><span>' + text(stale(d) ? 'Readings need refreshing' : d && d.configured ? stamp(d) : 'Set up in Frame admin') + '</span></div>';
    }
  };
  App.on('ready', function () { if (App.live) { load(); setInterval(load, 30000); } });
  App.on('minute', render);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
})();
