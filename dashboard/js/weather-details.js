// Expanded forecast uses the hub's cached weather, without another provider request.
(function () {
  'use strict';
  var labels = { sun: 'Sunny', moon: 'Clear', partly: 'Partly cloudy', cloud: 'Overcast', rain: 'Rain' };
  function value(n, suffix) { return typeof n === 'number' && isFinite(n) ? n + (suffix || '') : '—'; }
  function time(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    var mins = Math.round(n * 60), h = Math.floor(mins / 60) % 24;
    return (h % 12 || 12) + ':' + ('0' + mins % 60).slice(-2) + (h >= 12 ? ' PM' : ' AM');
  }
  // Index is midnight today, not a wrapping 24-hour forecast of yesterday's values.
  App.forecastHours = function (w, day, start, count) {
    var series = w.hh || w.h48 || w, out = [];
    for (var h = start; h < Math.min(24, start + count); h++) {
      var i = day * 24 + h;
      if (!series.t || typeof series.t[i] !== 'number') continue;
      out.push({ hour: h, t: series.t[i], c: (series.c || [])[i], p: (series.p || [])[i] });
    }
    return out;
  };
  App.weatherSheet = function () {
    var selected = 0, root;
    function render() {
      var D = window.DATA, w = D.weather || {};
      if (App.live && !D.weatherLive) return '<h2 class="sheet-h serif">Weather</h2><p class="sheet-p">' + (D.weatherConfigured ? 'The forecast is unavailable. Try again when the hub has fresh weather.' : 'Choose a city in the server’s Weather & time settings first.') + '</p>';
      var now = App.weatherNow(), today = w.today || { hi: w.hi, lo: w.lo, c: now.cond }, days = [today].concat(w.days || []);
      selected = Math.min(selected, days.length - 1);
      var day = days[selected], unit = w.units || 'C';
      var title = selected === 0 ? 'Today' : selected === 1 ? 'Tomorrow' : new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
      var hours = App.forecastHours(w, selected, selected === 0 ? now.hour : 0, 24);
      var stats = selected === 0 ? [['Feels like', value(w.feels, '°' + unit)], ['Humidity', value(w.humidity, '%')], ['Wind', value(w.wind, unit === 'F' ? ' mph' : ' km/h')], ['Gusts', value(w.gust, unit === 'F' ? ' mph' : ' km/h')]] : [];
      stats = stats.concat([['Rain chance', value(day.p, '%')], ['UV index', value(day.uv)], ['Sunrise', time(day.rise)], ['Sunset', time(day.set)]]);
      return '<div class="label">Forecast · ' + App.esc(unit === 'F' ? 'Fahrenheit' : 'Celsius') + '</div><h2 class="sheet-h serif">Weather</h2>' +
        '<div class="wx-days" role="group" aria-label="Forecast day">' + days.map(function (d, i) {
          var date = d.date ? new Date(d.date + 'T12:00:00') : App.now();
          var name = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : date.toLocaleDateString('en-US', { weekday: 'short' });
          return '<button data-wx-day="' + i + '" aria-pressed="' + (selected === i) + '"><b>' + App.esc(name) + '</b>' + App.icon(d.c || 'cloud', 30) + '<span>' + value(d.hi, '°') + ' <small>' + value(d.lo, '°') + '</small></span></button>';
        }).join('') + '</div>' +
        '<div class="wx-overview"><div><span class="label">' + title + '</span><div class="wx-current">' + App.icon(selected === 0 ? now.cond : day.c || 'cloud', 52) + '<strong class="num">' + value(selected === 0 ? now.temp : day.hi, '°') + '</strong><span>' + App.esc(labels[selected === 0 ? now.cond : day.c] || 'Forecast') + '<small>High ' + value(day.hi, '°') + ' · Low ' + value(day.lo, '°') + '</small></span></div></div><dl class="wx-stats">' + stats.map(function (s) { return '<div><dt>' + s[0] + '</dt><dd>' + s[1] + '</dd></div>'; }).join('') + '</dl></div>' +
        '<h3 class="wx-hour-heading">' + (selected === 0 ? 'Rest of today' : title + ' · hourly') + '</h3><div class="wx-hours" tabindex="0" aria-label="Hourly forecast; scroll sideways for more hours">' + (hours.length ? hours.map(function (h) {
          return '<div class="wx-hour"><b>' + (selected === 0 && h.hour === now.hour ? 'Now' : (h.hour % 12 || 12) + (h.hour >= 12 ? ' PM' : ' AM')) + '</b>' + App.icon(h.c || 'cloud', 32) + '<strong class="num">' + value(h.t, '°') + '</strong><small>' + value(h.p, '%') + ' rain</small></div>';
        }).join('') : '<p>Hourly forecast unavailable for this day.</p>') + '</div><p class="wx-foot">Swipe the hours sideways for more. Forecast from Open-Meteo.' + (w.moon ? ' ' + App.esc(w.moon.name) + ' · ' + value(w.moon.lit, '%') + ' illuminated.' : '') + '</p>';
    }
    App.sheet('<div class="wx-body">' + render() + '</div>', { cls: 'sheet--weather', onClose: App.resetIdle, onMount: function (el) {
      root = el.querySelector('.wx-body');
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Detailed weather forecast');
      el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-wx-day]');
        if (!b) return;
        selected = +b.dataset.wxDay;
        root.innerHTML = render();
        root.querySelector('[data-wx-day="' + selected + '"]').focus();
      });
    }});
  };
})();
