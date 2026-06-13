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
      // Make the button glyph/ARIA and the theme-color meta agree with the
      // current class on <html>.
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
        applyEvening(evening);
      });
    }

    /* --- follow the OS only while the visitor hasn't chosen --- */
    if (darkQuery) {
      watchQuery(darkQuery, function (event) {
        if (readStored() !== null) return;
        applyEvening(event.matches);
      });
    }

    // Reconcile: the inline head script already applied the class early;
    // here we only ensure class, button, and meta agree
    // (and cover any page that lacks the head script).
    var stored = readStored();
    if (stored !== null) applyEvening(stored === 'evening');
    else if (darkQuery) applyEvening(darkQuery.matches);
    else render();
  })();
})();
