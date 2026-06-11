/* gallery.js — interactive layer for the watercolor museum.
   Vanilla JS, no dependencies. Every feature null-checks and no-ops gracefully. */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Environment capabilities
   * ------------------------------------------------------------------ */
  var reducedMotion = false;
  var finePointer = false;
  try {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch (e) { /* matchMedia unavailable; keep safe defaults */ }

  /* ------------------------------------------------------------------ *
   * Nav scroll state + wash parallax (shared rAF-throttled scroll handler)
   * ------------------------------------------------------------------ */
  (function initScrollEffects() {
    var nav = document.getElementById('nav');
    var washes = document.querySelectorAll('.wash-field .wash');
    if (!nav && washes.length === 0) return;

    var ticking = false;

    function update() {
      ticking = false;
      var y = window.scrollY || 0;

      if (nav) {
        if (y > 24) nav.classList.add('scrolled');
        else nav.classList.remove('scrolled');
      }

      if (!reducedMotion) {
        for (var i = 0; i < washes.length; i++) {
          // Alternating signs, magnitudes cycling through 0.02..0.06
          var mag = 0.02 + (i % 3) * 0.02;            // 0.02, 0.04, 0.06
          var factor = (i % 2 === 0 ? 1 : -1) * mag;  // alternate direction
          washes[i].style.setProperty('--parallax', (y * factor).toFixed(2) + 'px');
        }
      }
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    update();
  })();

  /* ------------------------------------------------------------------ *
   * Reveal-on-scroll with per-batch stagger
   * ------------------------------------------------------------------ */
  (function initReveals() {
    var targets = document.querySelectorAll('.reveal');
    if (targets.length === 0) return;

    if (!('IntersectionObserver' in window)) {
      // No observer support: just show everything.
      for (var i = 0; i < targets.length; i++) targets[i].classList.add('is-visible');
      return;
    }

    function clearDelayAfterTransition(el) {
      el.addEventListener('transitionend', function handler() {
        el.style.transitionDelay = '';
        el.removeEventListener('transitionend', handler);
      });
    }

    var observer = new IntersectionObserver(function (entries) {
      var batchIndex = 0;
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.isIntersecting) continue;
        var el = entry.target;
        var delay = Math.min(batchIndex * 90, 360);
        batchIndex++;
        if (delay > 0 && !reducedMotion) {
          el.style.transitionDelay = delay + 'ms';
          clearDelayAfterTransition(el);
        }
        el.classList.add('is-visible');
        observer.unobserve(el);
      }
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

    for (var j = 0; j < targets.length; j++) observer.observe(targets[j]);
  })();

  /* ------------------------------------------------------------------ *
   * Pointer tilt on framed pieces (.frame[data-tilt])
   * ------------------------------------------------------------------ */
  (function initTilt() {
    if (!finePointer || reducedMotion) return;
    var frames = document.querySelectorAll('.frame[data-tilt]');
    if (frames.length === 0) return;

    var MAX_DEG = 4;

    function onMove(event) {
      var el = event.currentTarget;
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      var mx = (event.clientX - rect.left) / rect.width;   // 0..1
      var my = (event.clientY - rect.top) / rect.height;   // 0..1
      mx = Math.min(1, Math.max(0, mx));
      my = Math.min(1, Math.max(0, my));
      // Tilt toward the cursor: top edge leans back when cursor is high, etc.
      var ry = (mx - 0.5) * 2 * MAX_DEG;    // cursor right -> rotateY positive
      var rx = (0.5 - my) * 2 * MAX_DEG;    // cursor up -> rotateX positive
      el.style.setProperty('--rx', rx.toFixed(2) + 'deg');
      el.style.setProperty('--ry', ry.toFixed(2) + 'deg');
      el.style.setProperty('--mx', mx.toFixed(3));
      el.style.setProperty('--my', my.toFixed(3));
    }

    function onLeave(event) {
      var el = event.currentTarget;
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
      el.style.setProperty('--mx', '0.5');
      el.style.setProperty('--my', '0.5');
    }

    for (var i = 0; i < frames.length; i++) {
      frames[i].addEventListener('pointermove', onMove);
      frames[i].addEventListener('pointerleave', onLeave);
    }
  })();

  /* ------------------------------------------------------------------ *
   * Pigment buttons — ripple + splash
   * ------------------------------------------------------------------ */
  (function initPigmentButtons() {
    var buttons = document.querySelectorAll('button.pigment');
    if (buttons.length === 0) return;

    function onClick(event) {
      var btn = event.currentTarget;

      var ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.style.left = event.offsetX + 'px';
      ripple.style.top = event.offsetY + 'px';
      btn.appendChild(ripple);
      window.setTimeout(function () {
        if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
      }, 900);

      btn.classList.add('splash');
      window.setTimeout(function () {
        btn.classList.remove('splash');
      }, 600);
    }

    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', onClick);
    }
  })();

  /* ------------------------------------------------------------------ *
   * THE CENTERPIECE — watercolor cursor painting on #paint-canvas
   * ------------------------------------------------------------------ */
  var paint = (function initPaintCanvas() {
    var canvas = document.getElementById('paint-canvas');
    if (!canvas || reducedMotion) return null;
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return null;
    var hasPath2D = typeof window.Path2D === 'function';
    if (!hasPath2D) return null; // keep the hot loop cheap; skip on ancient browsers

    // Palette: pond, wisteria, sage, rose, gold, deep pond.
    var PALETTE_HEX = ['#7fa8c9', '#a292c4', '#93b48b', '#d98ba0', '#cdb878', '#4a7299'];
    var GOLDEN_HEX = ['#cdb878', '#d98ba0', '#e0c98f', '#d6a07a'];

    var PASS_SCALES = [1, 0.82, 0.62, 0.4];
    var PASS_ALPHAS = [0.05, 0.06, 0.07, 0.09];
    var LIFESPAN = 7000;
    var FADE_IN = 150;
    var FADE_OUT = 2500;
    var GROW_TIME = 1200;
    var GROW_MAX = 1.6;
    var MAX_BLOOMS = 90;
    var SPAWN_DIST = 34;

    function hexToRgb(hex) {
      var n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function rgbaStrings(hexList) {
      // Precompute one rgba string per (color, pass) pair.
      var out = [];
      for (var i = 0; i < hexList.length; i++) {
        var rgb = hexToRgb(hexList[i]);
        var passes = [];
        for (var p = 0; p < PASS_ALPHAS.length; p++) {
          passes.push('rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + PASS_ALPHAS[p] + ')');
        }
        out.push(passes);
      }
      return out;
    }

    var paletteRGBA = rgbaStrings(PALETTE_HEX);
    var goldenRGBA = rgbaStrings(GOLDEN_HEX);

    var blooms = [];
    var rafId = 0;
    var running = false;
    var paused = false; // page hidden
    var colorIndex = 0;
    var viewW = 0;
    var viewH = 0;

    /* --- sizing --- */
    function resizeCanvas() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      viewW = window.innerWidth;
      viewH = window.innerHeight;
      canvas.width = Math.round(viewW * dpr);
      canvas.height = Math.round(viewH * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resizeCanvas, 150);
    }, { passive: true });
    resizeCanvas();

    /* --- bloom construction --- */
    function makeOutlinePath() {
      // Irregular blot at unit scale: 12 angle points, radius jitter 0.72..1.28,
      // closed smooth curve via quadratic curves through midpoints.
      var POINTS = 12;
      var xs = [];
      var ys = [];
      var i;
      for (i = 0; i < POINTS; i++) {
        var angle = (i / POINTS) * Math.PI * 2;
        var r = 0.72 + Math.random() * 0.56;
        xs.push(Math.cos(angle) * r);
        ys.push(Math.sin(angle) * r);
      }
      var path = new Path2D();
      var startX = (xs[0] + xs[POINTS - 1]) / 2;
      var startY = (ys[0] + ys[POINTS - 1]) / 2;
      path.moveTo(startX, startY);
      for (i = 0; i < POINTS; i++) {
        var next = (i + 1) % POINTS;
        var midX = (xs[i] + xs[next]) / 2;
        var midY = (ys[i] + ys[next]) / 2;
        path.quadraticCurveTo(xs[i], ys[i], midX, midY);
      }
      path.closePath();
      return path;
    }

    function spawnBloom(x, y, radius, passColors) {
      if (!passColors) {
        passColors = paletteRGBA[colorIndex % paletteRGBA.length];
        colorIndex++;
      }
      blooms.push({
        x: x,
        y: y,
        radius: radius,
        path: makeOutlinePath(),
        colors: passColors,
        born: performance.now()
      });
      if (blooms.length > MAX_BLOOMS) blooms.splice(0, blooms.length - MAX_BLOOMS);
      startLoop();
    }

    function spawnSplash(x, y, colorSet) {
      var set = colorSet || paletteRGBA;
      spawnBloom(x, y, 60 + Math.random() * 30, set[colorIndex++ % set.length]);
      var count = 5 + Math.floor(Math.random() * 4); // 5-8 satellites
      for (var i = 0; i < count; i++) {
        var angle = Math.random() * Math.PI * 2;
        var dist = 40 + Math.random() * 70;
        spawnBloom(
          x + Math.cos(angle) * dist,
          y + Math.sin(angle) * dist,
          3 + Math.random() * 6,
          set[colorIndex++ % set.length]
        );
      }
    }

    /* --- render loop (lazy: only runs while blooms exist) --- */
    function easeOutCubic(t) {
      var u = 1 - t;
      return 1 - u * u * u;
    }

    function frame(now) {
      rafId = 0;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, viewW, viewH);

      var write = 0;
      for (var i = 0; i < blooms.length; i++) {
        var b = blooms[i];
        var age = now - b.born;
        if (age >= LIFESPAN) continue; // dead — drop it
        blooms[write++] = b;

        // Alpha envelope: fade in, hold, fade out over the last stretch.
        var envelope = 1;
        if (age < FADE_IN) envelope = age / FADE_IN;
        else if (age > LIFESPAN - FADE_OUT) envelope = (LIFESPAN - age) / FADE_OUT;

        // Slow growth to 1.6x over the first 1200ms, ease-out.
        var growth = age >= GROW_TIME
          ? GROW_MAX
          : 1 + (GROW_MAX - 1) * easeOutCubic(age / GROW_TIME);
        var r = b.radius * growth;

        // Reuse the unit-scale Path2D: bake position + scale (+ DPR) into the
        // transform so positions stay in CSS pixels. Layered low-alpha passes
        // give the soft pooled-pigment look without shadowBlur/filters.
        ctx.globalAlpha = envelope;
        for (var p = 0; p < PASS_SCALES.length; p++) {
          var s = r * PASS_SCALES[p] * dpr;
          ctx.setTransform(s, 0, 0, s, b.x * dpr, b.y * dpr);
          ctx.fillStyle = b.colors[p];
          ctx.fill(b.path);
        }
      }
      blooms.length = write;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;

      if (blooms.length > 0 && !paused) {
        rafId = window.requestAnimationFrame(frame);
        running = true;
      } else {
        running = false;
        if (blooms.length === 0) ctx.clearRect(0, 0, viewW, viewH);
      }
    }

    function startLoop() {
      if (!running && !paused && blooms.length > 0) {
        running = true;
        rafId = window.requestAnimationFrame(frame);
      }
    }

    function pause() {
      paused = true;
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      running = false;
    }

    function resume() {
      paused = false;
      startLoop();
    }

    /* --- input: trail painting (fine pointers only) --- */
    if (finePointer) {
      var lastX = null;
      var lastY = null;
      window.addEventListener('pointermove', function (event) {
        var x = event.clientX;
        var y = event.clientY;
        if (lastX !== null) {
          var dx = x - lastX;
          var dy = y - lastY;
          if (dx * dx + dy * dy < SPAWN_DIST * SPAWN_DIST) return;
        }
        lastX = x;
        lastY = y;
        spawnBloom(x, y, 18 + Math.random() * 28);
      }, { passive: true });
    }

    /* --- input: click/tap splash (all devices, incl. touch) --- */
    window.addEventListener('click', function (event) {
      if (event.target && event.target.closest &&
          event.target.closest('a,button,input,textarea,select')) return;
      spawnSplash(event.clientX, event.clientY);
    }, { passive: true });

    /* --- page visibility --- */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause();
      else resume();
    });

    return { spawnSplash: spawnSplash, goldenRGBA: goldenRGBA };
  })();

  /* ------------------------------------------------------------------ *
   * Easter egg — type "monet" for a golden hour
   * ------------------------------------------------------------------ */
  (function initEasterEgg() {
    var SECRET = 'monet';
    var buffer = '';

    window.addEventListener('keydown', function (event) {
      var key = event.key;
      if (!key || key.length !== 1) return;
      // Don't hijack typing inside form fields.
      var t = event.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      buffer = (buffer + key.toLowerCase()).slice(-SECRET.length);
      if (buffer !== SECRET) return;
      buffer = '';

      var root = document.documentElement;
      root.classList.add('golden');
      window.setTimeout(function () {
        root.classList.remove('golden');
      }, 6000);

      if (paint) {
        var w = window.innerWidth;
        var h = window.innerHeight;
        for (var i = 0; i < 14; i++) {
          paint.spawnSplash(
            Math.random() * w,
            Math.random() * h,
            paint.goldenRGBA
          );
        }
      }
    });
  })();
})();
