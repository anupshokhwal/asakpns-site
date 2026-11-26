/* Plays the logo intro in the browser tab icon, in sync with the header logo.
   Each frame reads the live state of the header logo (dot positions, squash,
   how much of each line is drawn) and redraws it on a small canvas.
   Works in Chrome, Edge and Firefox; Safari keeps the static icon.
   Skipped entirely for visitors who prefer reduced motion. */
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var mark = document.querySelector('.logo-mark');
  var link = document.querySelector('link[rel="icon"]');
  if (!mark || !link) return;

  var staticHref = link.getAttribute('href');
  var staticType = link.getAttribute('type');
  link.setAttribute('type', 'image/png');
  var SIZE = 64;
  var canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Map logo coordinates (0-64 viewBox) into the tile, leaving room around the triangle.
  var S = 0.82, OX = 32 - 32 * S, OY = 34 - 33 * S;
  function X(x) { return OX + x * S; }
  function Y(y) { return OY + y * S; }

  var segs = [
    { el: mark.querySelector('.seg-l'), x1: 12, y1: 50, x2: 32, y2: 12 },
    { el: mark.querySelector('.seg-r'), x1: 52, y1: 50, x2: 32, y2: 12 },
    { el: mark.querySelector('.seg-b'), x1: 12, y1: 50, x2: 52, y2: 50 }
  ];
  var nodes = [
    { el: mark.querySelector('.n2'), cx: 12, cy: 50, color: '#FFFFFF' },
    { el: mark.querySelector('.n3'), cx: 52, cy: 50, color: '#FFFFFF' },
    { el: mark.querySelector('.n1'), cx: 32, cy: 12, color: '#FFCE00' }
  ];
  var R = 9;

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function parseMatrix(t) {
    if (!t || t === 'none') return [1, 0, 0, 1, 0, 0];
    var m = t.match(/matrix\(([^)]+)\)/);
    return m ? m[1].split(',').map(parseFloat) : [1, 0, 0, 1, 0, 0];
  }

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    roundRect(0, 0, SIZE, SIZE, 14);
    ctx.fillStyle = '#0B2A6B';
    ctx.fill();
    ctx.clip();

    // Lines: drawn as far as the header logo has drawn them
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 5 * S;
    ctx.lineCap = 'round';
    segs.forEach(function (s) {
      if (!s.el) return;
      var off = parseFloat(getComputedStyle(s.el).strokeDashoffset) || 0;
      var f = Math.max(0, Math.min(1, 1 - off));
      if (f <= 0) return;
      ctx.beginPath();
      ctx.moveTo(X(s.x1), Y(s.y1));
      ctx.lineTo(X(s.x1 + (s.x2 - s.x1) * f), Y(s.y1 + (s.y2 - s.y1) * f));
      ctx.stroke();
    });

    // Dots: position, squash and fade taken from the header logo
    nodes.forEach(function (n) {
      if (!n.el) return;
      var cs = getComputedStyle(n.el);
      var op = parseFloat(cs.opacity);
      if (!(op > 0)) return;
      var m = parseMatrix(cs.transform);
      // transform origin is the bottom centre of the dot
      var ox = n.cx, oy = n.cy + R;
      var cx = ox + m[0] * (n.cx - ox) + m[2] * (n.cy - oy) + m[4];
      var cy = oy + m[1] * (n.cx - ox) + m[3] * (n.cy - oy) + m[5];
      ctx.globalAlpha = Math.min(1, op);
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.ellipse(X(cx), Y(cy), Math.abs(R * m[0]) * S, Math.abs(R * m[3]) * S, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    ctx.restore();
    link.setAttribute('href', canvas.toDataURL('image/png'));
  }

  var start = performance.now();
  var DURATION = 2300; // the logo has fully formed by now
  var last = 0;
  function tick(now) {
    if (now - start > DURATION) {
      link.setAttribute('href', staticHref);
      if (staticType) link.setAttribute('type', staticType);
      return;
    }
    if (now - last > 45) { draw(); last = now; } // about 20 frames a second is plenty for a tab icon
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
