/* gallery.js — interactive layer for the watercolor museum.
   Vanilla JS, no dependencies. Every feature null-checks and no-ops gracefully. */
(function () {
  'use strict';

  if (window.__galleryInit) return;
  window.__galleryInit = true;

  /* ------------------------------------------------------------------ *
   * Environment capabilities
   * ------------------------------------------------------------------ */
  var reducedMotion = false;
  var finePointer = false;

  function watchQuery(query, onChange) {
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
    } else if (typeof query.addListener === 'function') {
      query.addListener(onChange);
    }
  }

  try {
    var reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    var finePointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    reducedMotion = reducedMotionQuery.matches;
    finePointer = finePointerQuery.matches;
    watchQuery(reducedMotionQuery, function (event) {
      reducedMotion = event.matches;
      // Let existing blooms finish naturally elsewhere; on opt-in to reduced
      // motion, clear current blooms and stop the paint loop immediately.
      if (reducedMotion && paint) paint.stopAndClear();
    });
    watchQuery(finePointerQuery, function (event) {
      finePointer = event.matches;
    });
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

      if (!reducedMotion && finePointer) {
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
   * Cursor-wash parallax — background washes drift gently toward the cursor
   * ------------------------------------------------------------------ */
  // Writes only --wash-x / --wash-y (px); the scroll handler owns --parallax.
  // The CSS composes both: translate(var(--wash-x), calc(var(--parallax) + var(--wash-y))).
  (function initCursorWash() {
    var washes = document.querySelectorAll('.wash-field .wash');
    if (washes.length === 0) return;

    var BASE = 14;        // base drift amplitude in px before per-depth scaling
    var CAP = 20;         // hard cap on any single axis, px
    var LERP = 0.06;      // current -> target easing per frame (heavy smoothing)
    var SETTLE = 0.05;    // |current - target| below this (px) counts as at-rest

    // Target/current cursor offset as fractions in [-0.5..0.5] (0,0 = center).
    var targetX = 0;
    var targetY = 0;
    var curX = 0;
    var curY = 0;
    var rafId = 0;
    var lastMoveAt = 0;

    function render() {
      rafId = 0;
      curX += (targetX - curX) * LERP;
      curY += (targetY - curY) * LERP;

      for (var i = 0; i < washes.length; i++) {
        // Magnitude grows with depth; parity alternates the drift direction.
        var depth = BASE * (0.5 + (i % 3) * 0.35);
        var sign = (i % 2 === 0) ? 1 : -1;
        var dx = curX * depth * sign;
        var dy = curY * depth * sign;
        if (dx > CAP) dx = CAP; else if (dx < -CAP) dx = -CAP;
        if (dy > CAP) dy = CAP; else if (dy < -CAP) dy = -CAP;
        washes[i].style.setProperty('--wash-x', dx.toFixed(2) + 'px');
        washes[i].style.setProperty('--wash-y', dy.toFixed(2) + 'px');
      }

      // Self-stop once settled and no recent movement; pointermove restarts us.
      var settled = Math.abs(curX - targetX) < SETTLE / BASE &&
                    Math.abs(curY - targetY) < SETTLE / BASE;
      var quiet = performance.now() - lastMoveAt > 600;
      if (!settled || !quiet) {
        if (!document.hidden) rafId = window.requestAnimationFrame(render);
      }
    }

    function startLoop() {
      if (!rafId && !document.hidden) rafId = window.requestAnimationFrame(render);
    }

    window.addEventListener('pointermove', function (event) {
      if (!finePointer || reducedMotion) return;
      var w = window.innerWidth || 1;
      var h = window.innerHeight || 1;
      targetX = event.clientX / w - 0.5;
      targetY = event.clientY / h - 0.5;
      lastMoveAt = performance.now();
      startLoop();
    }, { passive: true });

    // Pointer leaving the window: ease the washes back to rest.
    window.addEventListener('pointerout', function (event) {
      if (event.relatedTarget) return; // still inside the document
      targetX = 0;
      targetY = 0;
      lastMoveAt = performance.now();
      startLoop();
    }, { passive: true });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (rafId) {
          window.cancelAnimationFrame(rafId);
          rafId = 0;
        }
      } else {
        startLoop();
      }
    });
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
      el.addEventListener('transitionend', function handler(e) {
        if (e.target !== el) return;
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

    // Cache rects per element (measured at rest, before any tilt rotation),
    // and gate CSS-var writes behind a single pending rAF.
    var rects = new WeakMap();
    var pendingFrame = 0;
    var pendingEl = null;
    var pendingX = 0;
    var pendingY = 0;

    function applyTilt() {
      pendingFrame = 0;
      var el = pendingEl;
      if (!el) return;
      var rect = rects.get(el);
      if (!rect || rect.width === 0 || rect.height === 0) return;
      var mx = (pendingX - rect.left) / rect.width;   // 0..1
      var my = (pendingY - rect.top) / rect.height;   // 0..1
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

    function onEnter(event) {
      var el = event.currentTarget;
      rects.set(el, el.getBoundingClientRect());
    }

    function onMove(event) {
      pendingEl = event.currentTarget;
      pendingX = event.clientX;
      pendingY = event.clientY;
      if (!pendingFrame) pendingFrame = window.requestAnimationFrame(applyTilt);
    }

    function onLeave(event) {
      var el = event.currentTarget;
      rects.delete(el);
      if (pendingEl === el) pendingEl = null;
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
      el.style.setProperty('--mx', '0.5');
      el.style.setProperty('--my', '0.5');
    }

    for (var i = 0; i < frames.length; i++) {
      frames[i].addEventListener('pointerenter', onEnter);
      frames[i].addEventListener('pointermove', onMove, { passive: true });
      frames[i].addEventListener('pointerleave', onLeave);
    }
  })();

  /* ------------------------------------------------------------------ *
   * Pigment buttons — ripple + splash
   * ------------------------------------------------------------------ */
  (function initPigmentButtons() {
    var buttons = document.querySelectorAll('.pigment');
    if (buttons.length === 0) return;

    function onClick(event) {
      var btn = event.currentTarget;
      var rect = btn.getBoundingClientRect();
      var x, y;
      if (event.detail === 0) {
        // Keyboard activation: center the ripple.
        x = rect.width / 2;
        y = rect.height / 2;
      } else {
        x = event.clientX - rect.left;
        y = event.clientY - rect.top;
      }

      var ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';
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

    var LIFESPAN = 7000;
    var FADE_IN = 150;
    var FADE_OUT = 2500;
    var GROW_TIME = 1200;
    var GROW_MAX = 1.6;
    var MAX_BLOOMS = 90;
    var maxBlooms = MAX_BLOOMS; // raised temporarily during the easter-egg burst

    function hexToRgb(hex) {
      var n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function lighten(rgb) {
      // Lift each channel 25% toward white. The evening exhibition flips the
      // canvas from multiply to screen blend (CSS); brightened pigment keeps
      // the blooms visible against the dark walls.
      return [
        Math.round(rgb[0] + (255 - rgb[0]) * 0.25),
        Math.round(rgb[1] + (255 - rgb[1]) * 0.25),
        Math.round(rgb[2] + (255 - rgb[2]) * 0.25)
      ];
    }

    function rgbaStrings(hexList) {
      // Precompute the base pigment RGB twice per color — a day set and a
      // brightened evening set. Per-stamp rgba strings (with their alpha,
      // lightness and hue tweaks) are baked at spawn time from these bases.
      var out = [];
      for (var i = 0; i < hexList.length; i++) {
        var rgb = hexToRgb(hexList[i]);
        out.push({ day: rgb, evening: lighten(rgb) });
      }
      return out;
    }

    var paletteRGBA = rgbaStrings(PALETTE_HEX);
    var goldenRGBA = rgbaStrings(GOLDEN_HEX);

    // Cached theme flag, refreshed via setEvening() when the theme toggles —
    // checked once per bloom per frame, never via classList in the hot loop.
    var evening = document.documentElement.classList.contains('evening');

    var blooms = [];
    var rafId = 0;
    var running = false;
    var paused = false; // page hidden
    var colorIndex = 0;
    var viewW = 0;
    var viewH = 0;
    var dpr = 1; // owned by resizeCanvas(); matches the current canvas bitmap

    /* --- sizing --- */
    function resizeCanvas() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
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
      resizeTimer = window.setTimeout(function () {
        resizeCanvas();
        measureSections();
      }, 150);
    }, { passive: true });
    resizeCanvas();

    /* --- section-aware pigment: bias the palette toward the current room --- */
    // Palette indices: 0 pond, 1 wisteria, 2 sage, 3 rose, 4 gold, 5 deep pond.
    // null = full cycle, no bias.
    var SECTION_PIGMENTS = {
      hero: null,
      artist: [1, 0],
      palette: null,
      gallery: [0, 5, 4],
      studies: [2, 4],
      contact: [3, 1]
    };
    var SECTION_IDS = ['hero', 'artist', 'palette', 'gallery', 'studies', 'contact'];
    var SECTION_BIAS = 0.6; // chance a spawn draws from the room's subset
    var sectionTops = [];   // [{ top, subset }] sorted by document top

    function measureSections() {
      // Cheap to call: only runs on resize/load settle, never in the move path.
      var next = [];
      for (var i = 0; i < SECTION_IDS.length; i++) {
        var el = document.getElementById(SECTION_IDS[i]);
        if (!el) continue;
        next.push({
          top: el.getBoundingClientRect().top + (window.scrollY || 0),
          subset: SECTION_PIGMENTS[SECTION_IDS[i]]
        });
      }
      next.sort(function (a, b) { return a.top - b.top; });
      sectionTops = next;
    }

    function sectionSubsetAt(clientY) {
      // Linear scan over <=6 precomputed tops; no layout reads here.
      var docY = (window.scrollY || 0) + clientY;
      var subset = null;
      for (var i = 0; i < sectionTops.length; i++) {
        if (sectionTops[i].top <= docY) subset = sectionTops[i].subset;
        else break;
      }
      return subset;
    }

    function pickPassColors(clientY) {
      if (Math.random() < SECTION_BIAS) {
        var subset = sectionSubsetAt(clientY);
        if (subset) return paletteRGBA[subset[(Math.random() * subset.length) | 0]];
      }
      return paletteRGBA[colorIndex++ % paletteRGBA.length];
    }

    measureSections();
    window.addEventListener('load', measureSections);
    window.setTimeout(measureSections, 3000); // re-measure after fonts settle

    /* --- bloom construction (recursive polygon edge-deformation model) --- *
     * A bloom is built from many overlapping translucent LAYERS, each a closed
     * polygon whose outline was fractally roughened by recursive midpoint
     * displacement (big wobbles first, finer detail each pass). All layers grow
     * from the same lumpy base polygon but re-run the deformation with fresh
     * randomness, so every layer has a slightly different ragged edge. Filled at
     * very low alpha with source-over, the stack accumulates: the deep interior
     * (reached by every layer) goes rich, the perimeter (reached by only a few
     * of the longest-reaching layers) dissolves into a continuous feathered
     * edge — never a circle, never a discrete dab. A few inset, slightly darker
     * layers pool pigment near the rim (the dried "cauliflower" backrun); tiny
     * separately-deformed mini-blobs read as spatter. All geometry is a flat
     * Float coordinate list baked once at spawn (unit mean radius ~1) and reused
     * each frame via setTransform — no per-frame allocation. */

    var TWO_PI = Math.PI * 2;

    function clampByte(v) {
      v = Math.round(v);
      return v < 0 ? 0 : (v > 255 ? 255 : v);
    }

    // Approx standard normal via sum of uniforms (Irwin-Hall), centered/scaled.
    function gauss() {
      return (Math.random() + Math.random() + Math.random() - 1.5) * 0.9;
    }

    // 1. BASE POLYGON — a closed lumpy blob (not a circle). Returns parallel
    //    angle/radius arrays so variant layers can re-deform from the same seed
    //    while keeping the bloom's overall character. ~8-12 vertices, each with
    //    jittered angle spacing and jittered radius.
    function makeBaseBlob() {
      var n = 8 + ((Math.random() * 5) | 0); // 8..12
      var pts = []; // [x0,y0,x1,y1,...]
      var step = TWO_PI / n;
      for (var i = 0; i < n; i++) {
        // Jitter the angle around its slot so spacing is uneven.
        var ang = i * step + (Math.random() - 0.5) * step * 0.7;
        var rad = 0.78 + Math.random() * 0.44; // 0.78..1.22 — already lumpy
        pts.push(Math.cos(ang) * rad, Math.sin(ang) * rad);
      }
      return pts;
    }

    // 2. RECURSIVE EDGE DEFORMATION — subdivide `depth` times. Each pass inserts
    //    a midpoint on every edge, displaced along that edge's normal by a random
    //    amount proportional to edge length * variance. Variance HALVES each
    //    level (fractal: large lobes first, fine ripples last). `rough` scales
    //    the overall wobble. Returns a fresh flat point list — the source `base`
    //    is never mutated, so each variant re-runs from the same seed.
    function deform(base, depth, rough) {
      var pts = base.slice();
      var variance = rough;
      for (var pass = 0; pass < depth; pass++) {
        var n = pts.length / 2;
        var out = [];
        for (var i = 0; i < n; i++) {
          var ax = pts[i * 2];
          var ay = pts[i * 2 + 1];
          var j = (i + 1) % n;
          var bx = pts[j * 2];
          var by = pts[j * 2 + 1];
          out.push(ax, ay);
          // Edge vector + length.
          var ex = bx - ax;
          var ey = by - ay;
          var len = Math.sqrt(ex * ex + ey * ey) || 0.0001;
          // Unit normal (perpendicular).
          var nx = -ey / len;
          var ny = ex / len;
          // Displace the midpoint along the normal (signed), plus a touch of
          // tangential jitter so vertices don't sit on a clean arc.
          var disp = (Math.random() - 0.5) * 2 * len * variance;
          var tang = (Math.random() - 0.5) * len * variance * 0.5;
          var mx = (ax + bx) * 0.5 + nx * disp + (ex / len) * tang;
          var my = (ay + by) * 0.5 + ny * disp + (ey / len) * tang;
          out.push(mx, my);
        }
        pts = out;
        variance *= 0.5; // fractal falloff
      }
      return pts;
    }

    // Build a smooth closed Path2D through a flat point list using midpoint
    // quadratics (Catmull-ish): control points are the vertices, curve passes
    // through edge midpoints. Gives a continuous organic outline with no kinks.
    function pathFromPoints(pts) {
      var n = pts.length / 2;
      var path = new Path2D();
      var startX = (pts[(n - 1) * 2] + pts[0]) * 0.5;
      var startY = (pts[(n - 1) * 2 + 1] + pts[1]) * 0.5;
      path.moveTo(startX, startY);
      for (var i = 0; i < n; i++) {
        var cx = pts[i * 2];
        var cy = pts[i * 2 + 1];
        var j = (i + 1) % n;
        var mx = (cx + pts[j * 2]) * 0.5;
        var my = (cy + pts[j * 2 + 1]) * 0.5;
        path.quadraticCurveTo(cx, cy, mx, my);
      }
      path.closePath();
      return path;
    }

    // Scale a flat point list about the origin (for inset rim layers).
    function scalePoints(pts, k) {
      var out = new Array(pts.length);
      for (var i = 0; i < pts.length; i++) out[i] = pts[i] * k;
      return out;
    }

    // One bloom layer: a baked Path2D + its rgba string. `lift` shifts lightness
    // (negative = darker/more pigment), with a tiny warm/cool hue drift so the
    // wash mottles instead of reading as one flat colour.
    function makeLayer(rgb, pts, alpha, lift) {
      var hue = (Math.random() - 0.5) * 14;
      var rr = clampByte(rgb[0] + lift + hue);
      var gg = clampByte(rgb[1] + lift);
      var bb = clampByte(rgb[2] + lift - hue);
      return {
        path: pathFromPoints(pts),
        color: 'rgba(' + rr + ',' + gg + ',' + bb + ',' + alpha + ')'
      };
    }

    // 3-6. LAYERED ACCUMULATION + rim darkening + granulation + spatter.
    // `rgb` is the base pigment [r,g,b]; layer count scales with radius so tiny
    // hover blooms stay cheap (~9 layers) and big splashes get a deep stack
    // (~34 layers). Returns a flat array of {path,color} drawn back-to-front.
    function makeBloomLayers(rgb, radius) {
      var base = makeBaseBlob();

      // Layer count scales with radius. radius ~12 (hover) -> ~9; ~90 -> ~34.
      var bodyCount = Math.round(7 + radius * 0.32);
      if (bodyCount < 8) bodyCount = 8;
      if (bodyCount > 34) bodyCount = 34;
      var deep = radius > 26; // big splash gets richer rim + spatter

      var layers = [];
      var i;

      // Body wash: full-size variants, each a fresh deformation of the base.
      // Most reach the full silhouette; a fraction are slightly inset, so the
      // outermost few layers feather the edge while the core stacks up dense.
      var depth = radius > 40 ? 6 : (radius > 18 ? 5 : 4);
      var rough = 0.30 + Math.random() * 0.06;
      for (i = 0; i < bodyCount; i++) {
        // The outermost ~third of layers reach further and ragged harder so the
        // silhouette fingers into the paper (a splash, not a soft disc); the
        // inner two-thirds stack tighter to build a rich, mottled core.
        var outer = i / bodyCount > 0.66;
        var pts = deform(base, depth, outer ? rough * 1.35 : rough);
        // Wide scale spread so layers never share one hard rim; the sparse
        // larger ones dissolve the outer edge into feathered tendrils.
        var k = outer ? (0.96 + Math.random() * 0.22) // 0.96..1.18 reach out
                      : (0.80 + Math.random() * 0.20); // 0.80..1.00 core
        pts = scalePoints(pts, k);
        // Centre-weighted lightness: interior wash a touch lighter than mid.
        // Outer reaching layers run fainter so the edge stays translucent.
        var lift = 10 + (Math.random() - 0.5) * 24;
        var alpha = outer ? (0.022 + Math.random() * 0.02)
                          : (0.035 + Math.random() * 0.028);
        layers.push(makeLayer(rgb, pts, alpha, lift));
      }

      // 4. EDGE DARKENING (cauliflower / backrun rim): several inset, slightly
      //    darker layers concentrated just inside the perimeter, each its own
      //    ragged deformation so the rim pools irregularly — never a clean ring.
      var rimCount = Math.round(bodyCount * (deep ? 0.6 : 0.45));
      for (i = 0; i < rimCount; i++) {
        var rpts = deform(base, depth, rough * 1.2);
        // Inset so darker pigment pools at/just inside the edge; a tight spread
        // of scales keeps the rim from ever reading as one clean ring.
        rpts = scalePoints(rpts, 0.88 + Math.random() * 0.11); // 0.88..0.99
        layers.push(makeLayer(
          rgb, rpts,
          0.045 + Math.random() * 0.035,
          -40 - Math.random() * 26 // darker pooled pigment
        ));
      }

      // 6. SPATTER: a few tiny separately-deformed mini-blobs flung 1.4..2.6x
      //    out, as if the brush were tapped (big blooms only). Still polygons.
      var speckCount = deep ? 3 + ((Math.random() * 4) | 0) : 0;
      for (i = 0; i < speckCount; i++) {
        var sa = Math.random() * TWO_PI;
        var sd = 1.4 + Math.random() * 1.2;
        var sx = Math.cos(sa) * sd;
        var sy = Math.sin(sa) * sd;
        var sk = 0.12 + Math.random() * 0.12; // tiny
        var speck = deform(makeBaseBlob(), 3, 0.3);
        // Scale down and translate out to the spatter position.
        for (var p = 0; p < speck.length; p += 2) {
          speck[p] = speck[p] * sk + sx;
          speck[p + 1] = speck[p + 1] * sk + sy;
        }
        layers.push(makeLayer(rgb, speck, 0.08 + Math.random() * 0.06, -18));
      }

      return layers;
    }

    function spawnBloom(x, y, radius, passColors, opts) {
      if (reducedMotion) return; // respect a mid-session toggle for new spawns
      if (!passColors) passColors = pickPassColors(y);
      blooms.push({
        x: x,
        y: y,
        radius: radius,
        // Two layer stacks: one baked from the day pigment, one from the
        // brightened evening pigment. The geometry differs slightly between
        // them but that's invisible (only one set is ever drawn per theme).
        layersDay: makeBloomLayers(passColors.day, radius),
        layersEve: makeBloomLayers(passColors.evening, radius),
        born: performance.now(),
        life: (opts && opts.life) || LIFESPAN,
        alpha: (opts && opts.alpha) || 1,
        // Slight asymmetric growth target so the wash doesn't bloom as a circle.
        sx: 0.9 + Math.random() * 0.2,
        sy: 0.9 + Math.random() * 0.2
      });
      if (blooms.length > maxBlooms) blooms.splice(0, blooms.length - maxBlooms);
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
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, viewW, viewH);

      var write = 0;
      for (var i = 0; i < blooms.length; i++) {
        var b = blooms[i];
        var age = Math.max(0, now - b.born);
        if (age >= b.life) continue; // dead — drop it
        blooms[write++] = b;

        // Alpha envelope: fade in, hold, fade out over the last stretch.
        var envelope = 1;
        if (age < FADE_IN) envelope = age / FADE_IN;
        else if (age > b.life - FADE_OUT) envelope = (b.life - age) / FADE_OUT;

        // Slow growth to 1.6x over the first 1200ms, ease-out.
        var growth = age >= GROW_TIME
          ? GROW_MAX
          : 1 + (GROW_MAX - 1) * easeOutCubic(age / GROW_TIME);
        var r = b.radius * growth;

        // Draw the precomputed layer stack. Every layer's Path2D is in unit
        // bloom space; growth + asymmetric scale + bloom position (+ DPR) bake
        // into ONE transform shared by the whole stack, so no geometry is
        // rebuilt per frame — growth just scales the precomputed silhouettes.
        // Many low-alpha source-over fills accumulate: the deep interior goes
        // rich, the perimeter (reached by only the largest few layers) feathers
        // into a continuous ragged edge. The canvas element's own multiply/
        // screen blend (CSS) composites the whole wash onto the page.
        ctx.globalAlpha = envelope * b.alpha;
        var rx = r * b.sx * dpr;
        var ry = r * b.sy * dpr;
        ctx.setTransform(rx, 0, 0, ry, b.x * dpr, b.y * dpr);
        var layers = evening ? b.layersEve : b.layersDay;
        for (var p = 0; p < layers.length; p++) {
          ctx.fillStyle = layers[p].color;
          ctx.fill(layers[p].path);
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

    function stopAndClear() {
      blooms.length = 0;
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      running = false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, viewW, viewH);
    }

    var burstCapTimer = 0;
    function boostBloomCap() {
      // The "monet" burst spawns far more blooms than the steady-state cap;
      // raise it temporarily so the burst doesn't evict its own splashes.
      maxBlooms = 160;
      window.clearTimeout(burstCapTimer);
      burstCapTimer = window.setTimeout(function () {
        maxBlooms = MAX_BLOOMS;
      }, 8000);
    }

    /* --- input: click/tap splash (all devices, incl. touch) --- */
    window.addEventListener('click', function (event) {
      if (event.target && event.target.closest &&
          event.target.closest('a,button,input,textarea,select')) return;
      spawnSplash(event.clientX, event.clientY);
    });

    /* --- hover accent: one small bloom where the cursor meets an object --- */
    var HOVER_TARGETS = '.frame, .frame--small, .exhibit-frame, .pigment, .placard-link, .contact-link';
    var ACCENT_GAP = 280; // global throttle, ms
    var lastAccentAt = 0;

    document.addEventListener('pointerover', function (event) {
      if (!finePointer || reducedMotion) return;
      var t = event.target;
      if (!t || !t.closest) return;
      var hit = t.closest(HOVER_TARGETS);
      if (!hit) return;
      // Ignore pointerover fired by moves between the element's own children.
      var from = event.relatedTarget;
      if (from && hit.contains(from)) return;
      var now = performance.now();
      if (now - lastAccentAt < ACCENT_GAP) return;
      lastAccentAt = now;
      // Bloom at the contact point — feels like the object responds where touched.
      spawnBloom(event.clientX, event.clientY, 12 + Math.random() * 6);
    }, { passive: true });

    /* --- page visibility --- */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause();
      else resume();
    });

    return {
      spawnSplash: spawnSplash,
      goldenRGBA: goldenRGBA,
      stopAndClear: stopAndClear,
      boostBloomCap: boostBloomCap,
      setEvening: function (on) { evening = !!on; }
    };
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
        paint.boostBloomCap();
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

  /* ------------------------------------------------------------------ *
   * Evening Exhibition — theme toggle, persistence, OS preference
   * ------------------------------------------------------------------ */
  (function initTheme() {
    var root = document.documentElement;
    var STORAGE_KEY = 'sh-theme';
    var EVENING_THEME_COLOR = '#232936';
    var DAY_THEME_COLOR = '#f6f1e7';

    var themeMeta = document.querySelector('meta[name="theme-color"]');
    var navHost = document.getElementById('nav') ||
                  document.querySelector('.exhibit-nav');

    function readStored() {
      // Returns 'evening', 'day', or null (absent, garbage, or storage blocked).
      try {
        var value = window.localStorage.getItem(STORAGE_KEY);
        return (value === 'evening' || value === 'day') ? value : null;
      } catch (e) { return null; }
    }

    function store(value) {
      try { window.localStorage.setItem(STORAGE_KEY, value); } catch (e) { /* private mode etc. */ }
    }

    var darkQuery = null;
    try {
      darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    } catch (e) { /* matchMedia unavailable; OS preference simply unfollowed */ }

    function isEvening() {
      return root.classList.contains('evening');
    }

    /* --- toggle button (homepage #nav or project-page .exhibit-nav) --- */
    var toggle = null;
    if (navHost) {
      toggle = document.createElement('button');
      toggle.className = 'theme-toggle';
      toggle.type = 'button';
      navHost.appendChild(toggle);
    }

    function render() {
      // Make button glyph/ARIA, the theme-color meta, and the paint engine
      // agree with the current class on <html>.
      var evening = isEvening();
      if (toggle) {
        // Glyph: "☾" invites the evening; "☀" invites the day back.
        toggle.textContent = evening ? '☀' : '☾';
        toggle.setAttribute('aria-label', evening
          ? 'Switch to light theme'
          : 'Switch to dark theme');
        toggle.setAttribute('aria-pressed', evening ? 'true' : 'false');
      }
      if (themeMeta) {
        themeMeta.setAttribute('content', evening ? EVENING_THEME_COLOR : DAY_THEME_COLOR);
      }
      if (paint) paint.setEvening(evening);
    }

    function applyEvening(on) {
      if (on) root.classList.add('evening');
      else root.classList.remove('evening');
      render();
    }

    /* --- brief cross-fade window around a theme change --- */
    var transitionTimer = 0;
    function flashTransition() {
      if (reducedMotion) return;
      root.classList.add('evening-transition');
      window.clearTimeout(transitionTimer); // guard rapid repeated toggles
      transitionTimer = window.setTimeout(function () {
        root.classList.remove('evening-transition');
      }, 700);
    }

    if (toggle) {
      toggle.addEventListener('click', function () {
        var evening = !isEvening();
        flashTransition();
        store(evening ? 'evening' : 'day');
        // Old blooms were tuned for the previous blend mode; clear them so
        // they don't linger looking wrong against the new walls.
        if (paint) paint.stopAndClear();
        applyEvening(evening);
      });
    }

    /* --- follow the OS only while the visitor hasn't chosen --- */
    if (darkQuery) {
      watchQuery(darkQuery, function (event) {
        if (readStored() !== null) return;
        if (paint) paint.stopAndClear();
        applyEvening(event.matches);
      });
    }

    // Reconcile: the inline head script already applied the class pre-paint;
    // here we only ensure class, button, meta, and paint engine agree
    // (and cover any page that lacks the head script).
    var stored = readStored();
    if (stored !== null) applyEvening(stored === 'evening');
    else if (darkQuery) applyEvening(darkQuery.matches);
    else render();
  })();
})();
