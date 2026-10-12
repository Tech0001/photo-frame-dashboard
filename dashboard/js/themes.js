import palettes from './theme-palettes.json';

// Scoped to the fixed stage; photograph overlays and night colors are independent.
var keys = [];
palettes.forEach(function (p) {
  Object.keys(p.colors).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
});
window.App.setTheme = function (id) {
  var palette = palettes.filter(function (p) { return p.id === id; })[0] || palettes[0];
  var stage = App.$('#stage');
  keys.forEach(function (k) {
    // Paper uses the original stylesheet verbatim, including all default signals.
    if (palette.id === 'paper' || palette.colors[k] == null) stage.style.removeProperty('--' + k);
    else stage.style.setProperty('--' + k, palette.colors[k]);
  });
  stage.dataset.theme = palette.id;
  stage.dataset.themeDark = String(!!palette.dark);
};
App.on('tune', function (t) { App.setTheme(t.theme); });
