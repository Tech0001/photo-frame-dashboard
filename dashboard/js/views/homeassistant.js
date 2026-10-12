// The live Home page. The bundled/offline prototype keeps its separate demo view.
(function () {
  'use strict';
  var root = null, busy = false;
  var esc = App.esc;
  function text(v) { return esc(v == null ? '—' : v); }
  function stale(d) { return !!(d && (d.stale || (d.updated && Date.now() - Date.parse(d.updated) > 90000))); }
  function stamp(d) { return d && d.updated ? 'Checked ' + new Date(d.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Not checked yet'; }
  function pretty(s) { if (s === 'heat_cool') return 'Heat / cool'; return String(s || '').replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }
  function when(s) { var d = new Date(s); return isNaN(d.getTime()) ? 'No event reported' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function thermostat(c) {
    if (!c) return '<section class="ha-card ha-climate"><div class="label">Climate</div><h2 class="serif">Choose your thermostat</h2><p>Select it in Frame admin → Connections → Home Assistant.</p></section>';
    var good = c.available;
    var target = c.low != null && c.high != null ? c.low + '–' + c.high : c.target;
    return '<section class="ha-card ha-climate"><div class="label">Thermostat</div><h2 class="serif">' + text(c.name) + '</h2>' +
      '<div class="ha-temperature num">' + text(good ? c.current : null) + '<small>' + text(c.unit || '') + '</small></div><div class="label">Inside</div>' +
      '<div class="ha-action' + (!good ? ' ha-warning' : '') + '">' + text(good ? pretty(c.action || 'Status not reported') : 'Unavailable') + '</div>' +
      '<div class="ha-facts"><div><span class="label">Target</span><b class="num">' + text(good ? target : null) + (good && target != null ? '<small>' + text(c.unit) + '</small>' : '') + '</b></div>' +
      '<div><span class="label">Humidity</span><b class="num">' + text(good ? c.humidity : null) + (good && c.humidity != null ? '<small>%</small>' : '') + '</b></div>' +
      '<div><span class="label">Mode</span><b>' + text(good ? pretty(c.state) : 'Unknown') + '</b></div><div><span class="label">Comfort</span><b>' + text(good ? pretty(c.preset || 'Not reported') : 'Unknown') + '</b></div></div>' +
      '<p class="ha-note">Readings from Home Assistant</p></section>';
  }
  function sensor(e) {
    var value = e.available ? e.state : e.state === 'unknown' ? 'No reading yet' : 'Unavailable', sub = '', button = '';
    if ((e.available || e.state === 'unknown') && e.domain === 'event') { value = e.eventAt ? when(e.eventAt) : 'No event reported'; sub = e.eventAt ? pretty(e.eventType || 'Last event') : 'No event timestamp from Home Assistant'; }
    else if (e.available && e.deviceClass === 'timestamp') value = when(e.state);
    else if (e.available && e.domain === 'binary_sensor') {
      var pairs = { motion: ['Clear', 'Motion detected'], occupancy: ['Clear', 'Occupied'], door: ['Closed', 'Open'], window: ['Closed', 'Open'], connectivity: ['Disconnected', 'Connected'], battery: ['Normal', 'Low battery'], problem: ['Clear', 'Problem detected'] };
      value = pairs[e.deviceClass] ? pairs[e.deviceClass][e.state === 'on' ? 1 : 0] : pretty(e.state);
    } else if (e.domain === 'camera') {
      value = e.available ? pretty(e.state) : 'Unavailable'; sub = 'Camera status';
      if (e.available) button = '<button class="ha-image-btn" data-ha-camera="' + esc(e.id) + '">View image</button>';
    }
    return '<section class="ha-card ha-reading' + (!e.available ? ' ha-unavailable' : '') + '"><div class="label">' + text(e.name) + '</div><div class="ha-value">' + text(value) + (e.available && e.domain === 'sensor' && e.unit ? '<small> ' + text(e.unit) + '</small>' : '') + '</div>' +
      (sub ? '<div class="ha-note">' + text(sub) + '</div>' : '') + button + '</section>';
  }
  function render() {
    if (!root || App.current !== 'control') return;
    var d = App.homeData, warn = stale(d), msg = !d ? 'Connecting to Home Assistant…' : !d.configured ? 'Connect Home Assistant in Frame admin → Connections → Home Assistant.' : d.error || '';
    root.innerHTML = '<div class="ha-home"><header class="ha-top"><div><div class="label">Home Assistant</div><h1 class="serif">Home</h1></div><div class="ha-sync"><span class="label' + (warn ? ' ha-warning' : '') + '">' + (warn ? 'Connection needs attention · ' : '') + text(stamp(d)) + '</span><button class="icon-btn" data-ha-refresh aria-label="Refresh home status">' + App.icon('undo', 26) + '</button></div></header>' +
      (msg ? '<div class="ha-banner' + (warn ? ' ha-warning' : '') + '">' + text(msg) + (d && d.updated && warn ? ' Showing the last successful readings.' : '') + '</div>' : '') +
      (d && d.configured ? '<div class="ha-layout' + (warn ? ' is-stale' : '') + '">' + thermostat(d.climate) + '<div class="ha-readings">' + ((d.entities || []).length ? d.entities.map(sensor).join('') : '<section class="ha-card"><h2 class="serif">Your home devices</h2><p>Choose Ring cameras, doorbell events and sensors in the server settings.</p></section>') + '</div></div>' : '') + '</div>';
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
