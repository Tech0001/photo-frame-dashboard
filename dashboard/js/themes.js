import palettes from './theme-palettes.json';

// Scoped to the fixed stage; photograph overlays and night colors are independent.
var keys = [];
palettes.forEach(function (p) {
  Object.keys(Object.assign({}, p.colors, p.appearance || {})).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
});
window.App.setTheme = function (id) {
  var palette = palettes.filter(function (p) { return p.id === id; })[0] || palettes[0];
  var stage = App.$('#stage');
  var values = Object.assign({}, palette.colors, palette.appearance || {});
  keys.forEach(function (k) {
    // Paper uses the original stylesheet verbatim, including all default signals.
    if (palette.id === 'paper' || values[k] == null) stage.style.removeProperty('--' + k);
    else stage.style.setProperty('--' + k, values[k]);
  });
  stage.dataset.theme = palette.id;
  stage.dataset.themeDark = String(!!palette.dark);
};
App.on('tune', function (t) { App.setTheme(t.theme); });

App.themes = palettes;
App.themeControls = function () {
  return '<div class="demo-sec"><div class="label label--light">Theme</div><div class="demo-grid">' + palettes.map(function (p) { return '<button data-theme-choice="' + p.id + '">' + p.label + '</button>'; }).join('') + '</div></div>';
};
App.chooseTheme = function (id) {
  App.setTheme(id);
  try { var saved = JSON.parse(localStorage.getItem('frame-display-settings') || '{}'); saved.theme = id; localStorage.setItem('frame-display-settings', JSON.stringify(saved)); } catch (e) {}
};
App.on('ready', function () {
  var saved = {}; try { saved = JSON.parse(localStorage.getItem('frame-display-settings') || '{}'); } catch (e) {}
  App.setTheme(window.TUNE && window.TUNE.theme || saved.theme || 'paper');
});
