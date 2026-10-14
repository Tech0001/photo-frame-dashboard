// Original palette sampler for the optional art display; no image leaves the frame.
(function () {
  'use strict';
  App.artPalette = function (pixels) {
    var total = [0, 0, 0], weight = 0;
    for (var i = 0; i + 3 < pixels.length; i += 4) {
      var alpha = pixels[i + 3] / 255;
      if (!alpha) continue;
      for (var c = 0; c < 3; c++) total[c] += pixels[i + c] * alpha;
      weight += alpha;
    }
    var rgb = weight ? total.map(function (n) { return n / weight; }) : [95, 99, 83];
    function color(base, scale) { return 'rgb(' + rgb.map(function (n) { return Math.round(base + n * scale); }).join(',') + ')'; }
    return { background: color(9, .17), ink: color(232, .06), muted: color(157, .16), accent: color(128, .38), note: color(224, .09) };
  };
})();
