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

    var PASS_SCALES = [1, 0.82, 0.62, 0.4];
    var PASS_ALPHAS = [0.05, 0.06, 0.07, 0.09];
    var LIFESPAN = 7000;
    var FADE_IN = 150;
    var FADE_OUT = 2500;
    var GROW_TIME = 1200;
    var GROW_MAX = 1.6;
    var MAX_BLOOMS = 90;
    var maxBlooms = MAX_BLOOMS; // raised temporarily during the easter-egg burst
    var SPAWN_DIST = 34;

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
      // Precompute one rgba string per (color, pass) pair — twice: a day set
      // and a brightened evening set, selected at draw time.
      var out = [];
      for (var i = 0; i < hexList.length; i++) {
        var rgb = hexToRgb(hexList[i]);
        var lit = lighten(rgb);
        var day = [];
        var evening = [];
        for (var p = 0; p < PASS_ALPHAS.length; p++) {
          day.push('rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + PASS_ALPHAS[p] + ')');
          evening.push('rgba(' + lit[0] + ',' + lit[1] + ',' + lit[2] + ',' + PASS_ALPHAS[p] + ')');
        }
        out.push({ day: day, evening: evening });
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

    function spawnBloom(x, y, radius, passColors, opts) {
      if (reducedMotion) return; // respect a mid-session toggle for new spawns
      if (!passColors) passColors = pickPassColors(y);
      blooms.push({
        x: x,
        y: y,
        radius: radius,
        path: makeOutlinePath(),
        colors: passColors,
        born: performance.now(),
        life: (opts && opts.life) || LIFESPAN,
        alpha: (opts && opts.alpha) || 1,
        idle: !!(opts && opts.idle)
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

        // Reuse the unit-scale Path2D: bake position + scale (+ DPR) into the
        // transform so positions stay in CSS pixels. Layered low-alpha passes
        // give the soft pooled-pigment look without shadowBlur/filters.
        ctx.globalAlpha = envelope * b.alpha;
        var passColors = evening ? b.colors.evening : b.colors.day;
        for (var p = 0; p < PASS_SCALES.length; p++) {
          var s = r * PASS_SCALES[p] * dpr;
          ctx.setTransform(s, 0, 0, s, b.x * dpr, b.y * dpr);
          ctx.fillStyle = passColors[p];
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
      // Halt the idle-drip chain while hidden; resume() restarts it.
      if (idleTimer) {
        window.clearTimeout(idleTimer);
        idleTimer = 0;
      }
    }

    function resume() {
      paused = false;
      startLoop();
      resetIdleTimer();
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

    /* --- idle drip: air conditioning stirring a wet wash --- */
    // One setTimeout chain, never stacked: every arm is preceded by a clear
    // (resetIdleTimer) or by the previous link zeroing idleTimer (idleDrip),
    // and pause()/resume() clear/restart it around visibility changes.
    var IDLE_DELAY_MIN = 6000;
    var IDLE_DELAY_SPREAD = 3000;
    var IDLE_MAX = 3;
    var idleTimer = 0;

    function idleDelay() {
      return IDLE_DELAY_MIN + Math.random() * IDLE_DELAY_SPREAD;
    }

    function idleDrip() {
      idleTimer = 0;
      if (paused || document.hidden) return; // chain ends; resume() restarts it
      if (!reducedMotion) {
        var idleCount = 0;
        for (var i = 0; i < blooms.length; i++) {
          if (blooms[i].idle) idleCount++;
        }
        // Only drip onto a quiet canvas: nothing present but earlier drips.
        if (idleCount < IDLE_MAX && blooms.length === idleCount) {
          spawnBloom(
            viewW * (0.08 + Math.random() * 0.84),
            viewH * (1 / 3 + Math.random() * 0.6), // lower two-thirds, off the very edge
            6 + Math.random() * 6,
            null,
            { life: 9000, alpha: 0.5, idle: true }
          );
        }
      }
      idleTimer = window.setTimeout(idleDrip, idleDelay());
    }

    function resetIdleTimer() {
      if (idleTimer) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(idleDrip, idleDelay());
    }

    // Any pointer movement marks the visitor as present again.
    window.addEventListener('pointermove', resetIdleTimer, { passive: true });
    resetIdleTimer();

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
    });

    /* --- placard hover accent: a small bloom at the link's left edge --- */
    var ACCENT_GAP = 600; // global throttle, ms
    var lastAccentAt = 0;

    document.addEventListener('pointerover', function (event) {
      if (!finePointer || reducedMotion) return;
      var t = event.target;
      if (!t || !t.closest) return;
      var link = t.closest('.placard-link, .contact-link');
      if (!link) return;
      // Ignore pointerover fired by moves between the link's own children.
      var from = event.relatedTarget;
      if (from && link.contains(from)) return;
      var now = performance.now();
      if (now - lastAccentAt < ACCENT_GAP) return;
      lastAccentAt = now;
      // One rect read per hover entry — never in the move path.
      var rect = link.getBoundingClientRect();
      spawnBloom(rect.left, rect.top + rect.height / 2, 10 + Math.random() * 6);
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
