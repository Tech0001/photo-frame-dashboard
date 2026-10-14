// Ambient (idle photo frame) and Night (dim red clock) overlays.
(function () {
  'use strict';
  var D = window.DATA, $ = App.$;
  var amb = { show: null, notes: false }, shiftTimer = null;
  function art() { return App.tune('ambientStyle', 'classic') === 'art'; }
  function artNotes() {
    var next = App.nextEvent(), groceries = (D.groceries || []).filter(function (g) { return !g.done; });
    var routine = App.currentRoutine(), chores = (D.chores || []).filter(function (c) { return App.choresInRoutine(c, routine) && !c.done; });
    function names(list) { return list.slice(0, 3).map(function (x) { return App.esc(x.title || x.name); }).join(' · '); }
    return '<aside class="art-notes" aria-label="Household notes"><button type="button" class="art-close" data-art-close aria-label="Close household notes">' + App.icon('x', 24) + '</button><div class="art-eyebrow">A little reminder</div><h2 class="serif">At a glance</h2><div class="art-note-list">' +
      '<button type="button" class="art-note art-note--calendar" data-art-go="calendar"><span class="art-note-label">' + App.icon('calendar', 20) + ' ' + (next ? App.fmt.time(next.start) : 'Calendar') + '</span><strong>' + App.esc(next ? next.title : 'Nothing else scheduled') + '</strong><small>' + App.esc(next && next.notes ? next.notes : next && next.loc ? next.loc : 'Open the calendar') + '</small></button>' +
      '<button type="button" class="art-note art-note--shopping" data-art-go="shopping"><span class="art-note-label">' + App.icon('cart', 20) + ' Shopping</span><strong>' + groceries.length + (groceries.length === 1 ? ' thing to pick up' : ' things to pick up') + '</strong><small>' + (names(groceries) || 'The list is clear') + '</small></button>' +
      '<button type="button" class="art-note art-note--chores" data-art-go="tasks"><span class="art-note-label">' + App.icon('check', 20) + ' ' + App.esc(routine.name) + '</span><strong>' + (chores.length ? chores.length + (chores.length === 1 ? ' chore left' : ' chores left') : 'Nothing left to do') + '</strong><small>' + (names(chores) || 'Enjoy the quiet') + '</small></button></div><p class="art-notes-hint">Tap a note to open its page.</p></aside>';
  }
  function artInfo() {
    var n = App.now(), w = App.weatherNow(), slide = amb.show && amb.show.current;
    var p = slide && slide.photos[0], m = p && App.photoMeta(p);
    return '<div class="art-caption">' + (m && (m.place || m.monthYear) ? '<strong class="serif">' + App.esc(m.place || m.monthYear) + '</strong><span>' + App.esc(m.place ? m.monthYear : 'Your photo collection') + '</span>' : '<span>Your photo collection</span>') + '</div>' +
      '<div class="art-main"><div class="art-clock" aria-label="' + App.esc(App.fmt.time(n)) + '"><span class="art-hour num">' + (n.getHours() % 12 || 12) + '</span><span class="art-minute num">' + ('0' + n.getMinutes()).slice(-2) + '</span><small>' + (n.getHours() < 12 ? 'AM' : 'PM') + '</small></div><div class="art-date">' + App.fmt.day(n) + ' · ' + App.fmt.month(n) + ' ' + n.getDate() + '</div>' +
      ((!App.live || D.weatherLive) ? '<div class="art-weather">' + App.icon(w.cond, 28) + '<b>' + w.temp + '°</b><span>' + App.esc(w.summary) + '</span></div>' : '<div class="art-weather"><span>Weather unavailable</span></div>') +
      '<div class="art-actions"><button type="button" data-art-notes aria-expanded="' + amb.notes + '">At a glance ' + App.icon('right', 20) + '</button><button type="button" data-art-next>Next picture</button><button type="button" data-art-go="home">Dashboard</button></div></div>' + (amb.notes ? artNotes() : '');
  }
  function samplePalette(slide, node) {
    if (!art() || amb.show.current !== slide) return;
    var canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
    var image = node && node.querySelector('img:not(.blurfill)');
    function apply(pixels) {
      if (!art() || amb.show.current !== slide) return;
      var colors = App.artPalette(pixels), el = $('#ambient');
      Object.keys(colors).forEach(function (key) { el.style.setProperty('--art-' + key, colors[key]); });
    }
    function read(im) {
      try {
        if (!im || !im.naturalWidth) return false;
        var context = canvas.getContext('2d');
        context.drawImage(im, 0, 0, 8, 8); apply(context.getImageData(0, 0, 8, 8).data); return true;
      } catch (_) { return false; }
    }
    apply([]);
    if (read(image)) return;
    // Hub photos are same-origin. Public demo photos may require a CORS thumbnail;
    // if that also fails, keep the neutral palette and the original visible image.
    canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
    var thumbnail = new Image(); thumbnail.crossOrigin = 'anonymous';
    thumbnail.onload = function () { read(thumbnail); };
    thumbnail.src = App.photoSrc(slide.photos[0], false);
  }

  function ambientInfo() {
    var n = App.now(), w = App.weatherNow(), next = App.nextEvent();
    return '<div class="amb-clock"><div class="amb-time num">' + App.fmt.time(n, false) + '</div>' +
      '<div class="amb-date">' + App.fmt.day(n) + ', ' + App.fmt.month(n) + ' ' + n.getDate() + '</div></div>' +
      '<div class="amb-right">' +
      ((!App.live || D.weatherLive) ? '<div class="amb-wx">' + App.icon(w.cond, 44) + '<span class="num">' + w.temp + '°</span><small>' + w.summary + '</small></div>' : '') +
      (next ? '<div class="amb-next" style="' + App.pstyle(App.evColor(next)) + '"><i></i>' + App.esc(next.title) + ' · ' + App.fmt.time(next.start) + '</div>' : '') +
      '<div class="amb-who">' + D.people.map(function (p) { return App.avatar(p, 34, p.home ? '' : 'avatar--away'); }).join('') + '</div>' +
      '</div>';
  }
  function nightInfo() {
    var n = App.now(), tomorrow = App.addDays(n, n.getHours() < 6 ? 0 : 1);
    var first = App.timedOn(tomorrow)[0], w = App.weatherNow();
    return '<div class="nt-time num">' + App.fmt.time(n, false) + '</div>' +
      '<div class="nt-line">' + ((!App.live || D.weatherLive) ? App.icon(w.cond, 26) + ' ' + w.temp + '° · ' : '') + (first ? 'First up ' + App.fmt.rel(first.start).toLowerCase() + ': <b>' + App.esc(first.title) + '</b> ' + App.fmt.time(first.start) + ' · ' + App.person(first.people[0]).name : 'Nothing early tomorrow') + '</div>' +
      '<div class="nt-lock">' + App.icon('lock', 20) + ' House locked · alarm armed</div>';
  }

  function paint() {
    if (App.mode === 'ambient') {
      $('#ambient').classList.toggle('is-art', art());
      $('#ambient .amb-info').innerHTML = art() ? artInfo() : ambientInfo();
    }
    if (App.mode === 'night') $('#night .nt-inner').innerHTML = nightInfo();
  }

  // Nudge static content a few px every minute so nothing sits still for hours (image retention)
  function pixelShift() {
    var x = Math.round(Math.random() * 8 - 4), y = Math.round(Math.random() * 8 - 4);
    App.$$('.amb-info, .art-clock, .nt-inner').forEach(function (el) { el.style.transform = 'translate(' + x + 'px,' + y + 'px)'; });
  }

  App.on('ready', function () {
    $('#ambient').innerHTML = '<div class="amb-stage"></div><div class="amb-scrim"></div><div class="amb-info"></div>';
    $('#night').innerHTML = '<div class="nt-inner"></div>';
    amb.show = new App.Slideshow($('#ambient .amb-stage'), { layout: 'cover', captions: false, interval: 14000,
      onChange: function () { if (art()) paint(); }, onShown: samplePalette });
    $('#ambient').addEventListener('click', function (e) {
      if (art()) {
        if (e.target.closest('[data-art-notes]')) { amb.notes = !amb.notes; paint(); return; }
        if (e.target.closest('[data-art-close]')) { amb.notes = false; paint(); return; }
        if (e.target.closest('[data-art-next]')) { amb.show.next(); return; }
        var go = e.target.closest('[data-art-go]');
        if (go) { App.setMode('day'); App.go(go.dataset.artGo); return; }
        if (e.target.closest('.art-notes')) return;
      }
      App.setMode('day'); App.go('home');
    });
    $('#night').addEventListener('click', function () { App.setMode('nightdash'); });
  });

  App.on('mode', function (m) {
    clearInterval(shiftTimer);
    if (m === 'ambient') { amb.show.start(); paint(); shiftTimer = setInterval(pixelShift, 60000); }
    else { amb.show.stop(); amb.notes = false; }
    if (m === 'night') { paint(); shiftTimer = setInterval(pixelShift, 60000); }
    App.resetIdle();
  });
  App.on('minute', paint);
  App.on('data', paint);
  App.on('tune', function () {
    paint();
    if (art() && amb.show && amb.show.current) samplePalette(amb.show.current, $('#ambient .amb-stage').lastElementChild);
  });
})();
