import palettes from './theme-palettes.json';

(function () {
  'use strict';
  var esc = App.esc, opening = false;
  function options(values, current) {
    if (values.indexOf(current) < 0) values = values.concat([current]).sort(function (a, b) { return a - b; });
    return values.map(function (value) { return '<option value="' + value + '"' + (value === current ? ' selected' : '') + '>' + (value < 60 ? value + ' seconds' : value % 60 ? value + ' seconds' : value / 60 + (value === 60 ? ' minute' : ' minutes')) + '</option>'; }).join('');
  }
  function show(settings) {
    if (App.$('#demo').classList.contains('is-open')) return;
    App.resetIdle();
    var values = settings.values, selected = values.theme || 'paper', saving = false;
    App.sheet('<h2 class="serif">Display settings</h2><p class="ds-intro">Theme and idle timers</p><div class="ds-themes" role="group" aria-label="Color theme">' + palettes.map(function (p) {
      return '<button type="button" data-display-theme="' + p.id + '" aria-pressed="' + (p.id === selected) + '" style="--sample-bg:' + p.colors.paper + ';--sample-card:' + p.colors.card + ';--sample-ink:' + p.colors.ink + ';--sample-accent:' + p.colors.accent + '"><span class="ds-sample"><i></i><b>10:24</b></span><span>' + esc(p.label) + '</span></button>';
    }).join('') + '</div><div class="ds-timers"><label>Back to Today after<select data-display-home>' + options([15,30,60,120,300], values.homeSec) + '</select></label><label>Start slideshow after<select data-display-ambient>' + options([30,60,120,300,600,1800], values.ambientSec) + '</select></label></div><p class="ds-note">Night clock: 10 PM–6 AM. Photos keep the hollow white clock.</p><p class="ds-status" role="status"></p><div class="ds-actions"><button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--solid" data-display-save>Apply</button></div>', {
      cls: 'sheet--display-settings',
      onClose: App.resetIdle,
      onMount: function (root, close) {
        root.addEventListener('click', function (e) {
          var choice = e.target.closest('[data-display-theme]');
          if (choice && !saving) {
            selected = choice.dataset.displayTheme;
            root.querySelectorAll('[data-display-theme]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.displayTheme === selected)); });
          }
          if (!e.target.closest('[data-display-save]') || saving) return;
          var next = { theme: selected, homeSec: +root.querySelector('[data-display-home]').value, ambientSec: +root.querySelector('[data-display-ambient]').value };
          var status = root.querySelector('.ds-status');
          if (next.homeSec >= next.ambientSec) { status.textContent = 'Return to Today before starting the slideshow. Choose a longer slideshow timer.'; return; }
          saving = true; status.textContent = 'Saving…';
          root.querySelectorAll('button,select').forEach(function (b) { b.disabled = true; });
          var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 15000);
          var request = App.live ? fetch('/api/display-settings', { method: 'PUT', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'X-Display-Token': settings.token }, body: JSON.stringify({ values: next }) }).then(function (r) {
            return r.json().then(function (answer) { if (!r.ok) throw new Error(answer.error || 'Could not save display settings.'); return answer.values; });
          }) : Promise.resolve(next);
          request.then(function (saved) {
            clearTimeout(timer);
            window.TUNE = Object.assign({}, window.TUNE || {}, saved);
            App.emit('tune', window.TUNE);
            App.idle.home = saved.homeSec; App.idle.ambient = saved.ambientSec;
            if (root.isConnected) close();
            App.toast(App.live ? 'Display settings saved' : 'Preview settings applied', { ms: 2500 });
          }).catch(function (e) {
            clearTimeout(timer);
            saving = false;
            if (!root.isConnected) return;
            status.textContent = e.name === 'AbortError' ? 'Save timed out. Check Wi-Fi, then reopen settings to confirm the saved values.' : e.message || 'Could not save. Check the Wi-Fi and try again.';
            root.querySelectorAll('button,select').forEach(function (b) { b.disabled = false; });
          });
        });
      }
    });
  }
  App.openDisplaySettings = function () {
    if (opening) return;
    if (!App.live) { show({ values: { theme: App.tune('theme', 'paper'), homeSec: App.idle.home, ambientSec: App.idle.ambient } }); return; }
    opening = true;
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 8000);
    fetch('/api/display-settings', { cache: 'no-store', signal: ctl.signal }).then(function (r) {
      if (!r.ok) throw new Error('Could not load display settings.'); return r.json();
    }).then(show).catch(function () { App.toast('Could not open settings. Check Wi-Fi and tap the clock again.', { ms: 4500 }); }).then(function () { opening = false; clearTimeout(timer); });
  };
})();
