/* ==========================================================================
   eats.js — "Tableau" (formerly Peckish) where-to-eat app.
   Vanilla JS, no dependencies (Google Maps JS API loaded lazily at runtime
   only when the user has supplied a key). No leaked globals besides one
   Maps loader callback. Demo mode runs with zero console errors / no key.

   Modules (closures within one IIFE):
     - store        localStorage helpers (key, visited)
     - state        in-memory app state
     - distance     haversine util
     - demo         sample restaurant + visited data
     - tabs         tablist router (Find / Visited / Friends / Popular)
     - find         Find-tab rendering, controls, pick-for-me, geolocation
     - gmaps        lazy Google Maps + Places integration (current API)
     - sheet        rating sheet (shared by Find + Visited)
     - visited      Visited store rendering + CRUD
     - social       MOCK SOCIAL API (friends feed + popular leaderboard)
     - friends      Friends-tab rendering (consumes social.* promises)
     - popular      Popular tab: trending / open near you / loved by your taste
     - settings     API key panel
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Small DOM + misc helpers
   * ------------------------------------------------------------------ */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function announce(msg) {
    var live = $('live-announce');
    if (live) live.textContent = msg;
  }
  var prefersReducedMotion = false;
  try { prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* ------------------------------------------------------------------ *
   * SITE CONFIG (assets/js/eats-config.js) — BETA flag + shipped Maps key.
   * BETA: only Find + Visited are real; Feed / Friends / Popular are
   * sample-data surfaces and are taken out of the app (see applyBeta).
   * CONFIG_KEY: a site-wide, referrer-restricted browser key ('' = none).
   * ------------------------------------------------------------------ */
  var CFG = (window.TABLEAU_CONFIG && typeof window.TABLEAU_CONFIG === 'object') ? window.TABLEAU_CONFIG : {};
  var BETA = CFG.beta === true;
  var CONFIG_KEY = (typeof CFG.mapsKey === 'string') ? CFG.mapsKey.trim() : '';
  /* Live "sweep" knobs (see eats-config.js): clamped, safe defaults. */
  function cfgNum(v, lo, hi, dflt) {
    v = Number(v);
    return (isFinite(v) && v >= lo) ? Math.min(hi, Math.round(v)) : dflt;
  }
  var SWEEP = {
    radius: cfgNum(CFG.sweepRadiusM, 300, 20000, 1500),
    maxCalls: cfgNum(CFG.sweepMaxCalls, 1, 200, 30),
    refillAt: cfgNum(CFG.sweepRefillAt, 1, 50, 6)
  };
  var configKeyDead = false;   // the shipped key was refused at runtime -> demo
  var BETA_HIDDEN = ['feed', 'friends', 'popular'];
  /* VISITED flag (eats-config.js `visited`): false hides every Visited
     surface; anything but an explicit false keeps the old behaviour. */
  var VISITED_ON = CFG.visited !== false;

  /* Beta: drop the three sample-data tabs from the tab bar (so they are out
     of the tab order AND the accessibility tree) and seal their panels
     (hidden + inert + aria-hidden). The panels stay in the DOM so the
     un-flagged code that holds references to them keeps working unchanged;
     flipping beta:false in the config restores the whole five-tab app. */
  (function applyBeta() {
    if (!BETA) return;
    BETA_HIDDEN.forEach(function (n) {
      var t = document.getElementById('tab-' + n);
      if (t && t.parentNode) t.parentNode.removeChild(t);
      var pnl = document.getElementById('panel-' + n);
      if (pnl) {
        pnl.hidden = true;
        pnl.classList.add('is-hidden');
        pnl.setAttribute('inert', '');
        pnl.setAttribute('aria-hidden', 'true');
        pnl.removeAttribute('tabindex');
        pnl.setAttribute('data-beta-hidden', '');
      }
    });
    var bar = document.querySelector('.bottom-bar-inner');
    if (bar) bar.setAttribute('data-beta', '');
    try { document.documentElement.classList.add('beta'); } catch (e) {}
  })();

  /* Visited off: drop the tab, seal the panel (hidden + inert + aria-hidden,
     like the beta-hidden panels) and flag <html class="no-visited"> so the
     few static copy lines that mention ratings swap (.v-only / .v-off-only).
     The Visited code stays intact; stored data is never touched. If that
     leaves a single tab (beta), the bar is pointless: <html class="no-bar">
     hides it and gives the page its bottom room back. visited:true restores. */
  (function applyVisitedFlag() {
    if (VISITED_ON) return;
    var t = document.getElementById('tab-visited');
    if (t && t.parentNode) t.parentNode.removeChild(t);
    var pnl = document.getElementById('panel-visited');
    if (pnl) {
      pnl.hidden = true;
      pnl.classList.add('is-hidden');
      pnl.setAttribute('inert', '');
      pnl.setAttribute('aria-hidden', 'true');
      pnl.removeAttribute('tabindex');
      pnl.setAttribute('data-beta-hidden', '');
    }
    var left = document.querySelectorAll('.bottom-bar-inner [role="tab"]').length;
    var bar = document.querySelector('.bottom-bar-inner');
    if (bar) bar.setAttribute('data-tabs', String(left));
    try {
      document.documentElement.classList.add('no-visited');
      if (left <= 1) document.documentElement.classList.add('no-bar');
    } catch (e) {}
  })();

  /* ------------------------------------------------------------------ *
   * MODAL — one open/close choreography for every sheet.
   * Both sheets (rate a place, live-data settings) hand their backdrop
   * here, so all of them behave identically: focus moves into the sheet,
   * Tab cycles inside it, Escape and a tap on the backdrop close it, and
   * focus goes back to whatever opened it. While a sheet is up the rest of
   * the page is sealed with `inert` + aria-hidden, so nothing behind it is
   * reachable by Tab, by pointer or by a screen reader's own cursor.
   * ------------------------------------------------------------------ */
  var modal = (function () {
    var current = null, lastFocused = null, onClosed = null;

    /* Seal every top-level sibling of the open sheet. Nodes that are
       already aria-hidden in the markup (the wash field) are left exactly
       as they were — we only undo what we did. */
    function seal(on, keep) {
      var kids = document.body.children;
      for (var i = 0; i < kids.length; i++) {
        var n = kids[i];
        if (n === keep || n.tagName === 'SCRIPT' || n.id === 'live-announce') continue;
        if (on) {
          n.setAttribute('inert', '');
          if (!n.hasAttribute('aria-hidden')) {
            n.setAttribute('aria-hidden', 'true');
            n.setAttribute('data-modal-sealed', '');
          }
        } else {
          n.removeAttribute('inert');
          if (n.hasAttribute('data-modal-sealed')) {
            n.removeAttribute('aria-hidden');
            n.removeAttribute('data-modal-sealed');
          }
        }
      }
    }

    function focusables() {
      if (!current) return [];
      var f = current.querySelectorAll('button, input, textarea, select, summary, a[href], [tabindex]:not([tabindex="-1"])');
      return Array.prototype.filter.call(f, function (n) {
        return !n.disabled && n.offsetParent !== null && n.tabIndex !== -1;
      });
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var list = focusables();
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      // the trap also catches focus that has already wandered out
      if (!current.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function open(backdrop, first, closed) {
      if (!backdrop) return;
      if (current) close();
      lastFocused = document.activeElement;
      onClosed = closed || null;
      current = backdrop;
      backdrop.hidden = false;
      document.body.style.overflow = 'hidden';
      seal(true, backdrop);
      document.addEventListener('keydown', onKey);
      window.setTimeout(function () {
        if (current !== backdrop) return;
        var target = first || focusables()[0];
        if (target && target.focus) target.focus();
      }, 30);
    }

    function close() {
      if (!current) return;
      var bd = current, back = lastFocused, done = onClosed;
      current = null; lastFocused = null; onClosed = null;
      bd.hidden = true;
      document.body.style.overflow = '';
      seal(false, bd);
      document.removeEventListener('keydown', onKey);
      if (back && back.focus && document.contains(back)) back.focus();
      if (done) done();
    }

    function isOpen(backdrop) { return backdrop ? current === backdrop : !!current; }

    return { open: open, close: close, isOpen: isOpen };
  })();

  /* Tiny haptic tap (Android Chrome etc.). Silent no-op where vibration is
     unsupported, and skipped under prefers-reduced-motion — a vibration is
     motion you can feel. Never throws. */
  function haptic(ms) {
    if (prefersReducedMotion) return;
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) { /* purely decorative — never break the flow */ }
  }

  /* Watercolor droplet burst at a fixed screen point (same spirit as the
     landing orb pop). Decorative; skipped under reduced motion. */
  function dropletBurst(cx, cy, base) {
    if (prefersReducedMotion) return;
    try {
      var layer = el('div', 'orb-burst');
      layer.style.left = cx + 'px';
      layer.style.top = cy + 'px';
      var palette = ['var(--rose)', 'var(--wisteria)', 'var(--sage)', 'var(--gold)', 'var(--pond)'];
      var DROPS = 12;
      for (var i = 0; i < DROPS; i++) {
        var d = el('span', 'orb-drop');
        var ang = (i / DROPS) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
        var dist = base * (0.34 + Math.random() * 0.32);
        var size = base * (0.06 + Math.random() * 0.10);
        d.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
        d.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
        d.style.width = size.toFixed(1) + 'px';
        d.style.height = size.toFixed(1) + 'px';
        d.style.background = palette[i % palette.length];
        d.style.animationDelay = (Math.random() * 60).toFixed(0) + 'ms';
        layer.appendChild(d);
      }
      document.body.appendChild(layer);
      window.setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 600);
    } catch (e) { /* decorative */ }
  }

  /* Small transient toast (paper pill above the tab bar) — visual companion
     to announce(); screen readers get the live region, sighted users get this.
     Optional second arg { label, onAction, duration } adds one action button
     (e.g. "Undo") and keeps the pill up a little longer. */
  var toastTimer = null;
  function toast(msg, opts) {
    try {
      var t = $('eats-toast');
      if (!t) {
        t = el('div', 'eats-toast');
        t.id = 'eats-toast';
        document.body.appendChild(t);
      }
      clear(t);
      t.appendChild(el('span', 'eats-toast-msg', msg));
      if (opts && opts.label && opts.onAction) {
        // an interactive toast must be reachable by AT — plain ones stay
        // hidden because announce() already covers them
        t.removeAttribute('aria-hidden');
        var act = el('button', 'eats-toast-act', opts.label);
        act.type = 'button';
        act.addEventListener('click', function () {
          if (toastTimer) { window.clearTimeout(toastTimer); toastTimer = null; }
          t.classList.remove('is-show');
          opts.onAction();
        });
        t.appendChild(act);
      } else {
        t.setAttribute('aria-hidden', 'true'); // announce() covers a11y
      }
      t.classList.remove('is-show');
      void t.offsetWidth; // restart the fade if a toast is already up
      t.classList.add('is-show');
      if (toastTimer) window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(function () {
        toastTimer = null;
        t.classList.remove('is-show');
      }, (opts && opts.duration) || 1900);
    } catch (e) { /* purely decorative — never break the flow */ }
  }

  /* Staggered list entrance (Friends feed / Popular rows) — soft rise + fade,
     ~40ms apart. The class is stripped on animationend so the cards' hover
     transforms work again afterwards. No-op under prefers-reduced-motion. */
  function enterStagger(node, i) {
    if (prefersReducedMotion) return;
    node.classList.add('social-enter');
    node.style.setProperty('--enter-delay', (i * 40) + 'ms');
    node.addEventListener('animationend', function onEnd(e) {
      if (e.target !== node || e.animationName !== 'social-rise') return;
      node.classList.remove('social-enter');
      node.style.removeProperty('--enter-delay');
      node.removeEventListener('animationend', onEnd);
    });
  }

  /* Tiny 7-point trend sparkline (Popular rows) — a stroke-only line over
     a soft area wash at 12% opacity, ~64x20. Built from real SVG nodes (no
     innerHTML). `color` is any CSS color, including var(...) tokens, so the
     evening theme restyles it for free. Decorative: aria-hidden (the trend
     arrow next to it already carries the semantics). */
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgSparkline(points, color) {
    var W = 64, H = 20, PAD = 2.5;
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('class', 'pop-spark');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var pts = (points || []).map(Number).filter(function (n) { return isFinite(n); });
    if (pts.length < 2) return svg; // nothing to draw — empty, invisible svg
    var min = Math.min.apply(null, pts);
    var max = Math.max.apply(null, pts);
    var span = (max - min) || 1;
    var step = (W - PAD * 2) / (pts.length - 1);
    var coords = pts.map(function (v, i) {
      var x = PAD + i * step;
      var y = H - PAD - ((v - min) / span) * (H - PAD * 2);
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    });
    var line = coords.map(function (c, i) { return (i ? 'L' : 'M') + c[0] + ' ' + c[1]; }).join(' ');
    var area = document.createElementNS(SVG_NS, 'path');
    area.setAttribute('d', line +
      ' L' + coords[coords.length - 1][0] + ' ' + (H - 1) +
      ' L' + coords[0][0] + ' ' + (H - 1) + ' Z');
    area.setAttribute('stroke', 'none');
    area.setAttribute('fill-opacity', '0.12');
    area.style.fill = color;
    svg.appendChild(area);
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', line);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.style.stroke = color;
    svg.appendChild(path);
    return svg;
  }

  /* ------------------------------------------------------------------ *
   * store — localStorage CRUD (graceful when storage is blocked)
   * ------------------------------------------------------------------ */
  var KEY_GMAPS = 'eats-gmaps-key';
  var KEY_VISITED = 'eats-visited';
  var KEY_PREFS = 'eats-prefs';
  var KEY_SEEN = 'eats-seen';
  /* Feed tab memory: {follows:[handle...], hearts:[place name...]}.
     `follows` are the sample creators you follow (they genuinely reweight
     the feed); `hearts` are the places you hearted from a post, kept by
     NAME because that is the join key every other surface here uses
     (myRatingFor, Popular's placeByName) and the only id that survives a
     reload in both demo and live mode. Hearts rehydrate the real
     shortlist on boot — a heart is a save, not a like. */
  var KEY_FEED = 'eats-feed';
  var SEEN_TTL_MS = 6 * 60 * 60 * 1000; // passes are remembered for ~one outing

  var store = {
    getPrefs: function () {
      try {
        var raw = localStorage.getItem(KEY_PREFS);
        if (!raw) return null;
        var obj = JSON.parse(raw);
        return (obj && typeof obj === 'object') ? obj : null;
      } catch (e) { return null; }
    },
    setPrefs: function (p) {
      try { localStorage.setItem(KEY_PREFS, JSON.stringify(p)); return true; } catch (e) { return false; }
    },
    /* The visitor's own saved key, if any. */
    getUserKey: function () {
      try { return localStorage.getItem(KEY_GMAPS) || ''; } catch (e) { return ''; }
    },
    /* The shipped site key, unless it was refused at runtime. */
    getConfigKey: function () { return configKeyDead ? '' : CONFIG_KEY; },
    /* The key actually in force. Resolution: the visitor's own key wins,
       else the site's shipped key, else '' (demo mode). */
    getKey: function () { return this.getUserKey() || this.getConfigKey(); },
    /* True when live data is on only because of the shipped key. */
    usingConfigKey: function () { return !this.getUserKey() && !!this.getConfigKey(); },
    setKey: function (k) {
      try { localStorage.setItem(KEY_GMAPS, k); return true; } catch (e) { return false; }
    },
    clearKey: function () {
      try { localStorage.removeItem(KEY_GMAPS); } catch (e) {}
    },
    getVisited: function () {
      try {
        var raw = localStorage.getItem(KEY_VISITED);
        if (!raw) return null; // null => never written; caller may seed demo
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch (e) { return []; }
    },
    setVisited: function (arr) {
      try { localStorage.setItem(KEY_VISITED, JSON.stringify(arr)); return true; } catch (e) { return false; }
    },
    /* seen memory — places passed on recently ({id: timestamp}, TTL-pruned) */
    getSeen: function () {
      try {
        var raw = localStorage.getItem(KEY_SEEN);
        var map = raw ? JSON.parse(raw) : {};
        if (!map || typeof map !== 'object') return {};
        var now = Date.now(), out = {}, dirty = false;
        for (var id in map) {
          if (now - map[id] < SEEN_TTL_MS) out[id] = map[id];
          else dirty = true;
        }
        if (dirty) localStorage.setItem(KEY_SEEN, JSON.stringify(out));
        return out;
      } catch (e) { return {}; }
    },
    addSeen: function (id) {
      if (!id) return;
      try {
        var map = this.getSeen();
        map[id] = Date.now();
        localStorage.setItem(KEY_SEEN, JSON.stringify(map));
      } catch (e) {}
    },
    removeSeen: function (id) {
      if (!id) return;
      try {
        var map = this.getSeen();
        delete map[id];
        localStorage.setItem(KEY_SEEN, JSON.stringify(map));
      } catch (e) {}
    },
    clearSeen: function () {
      try { localStorage.removeItem(KEY_SEEN); } catch (e) {}
    },
    /* feed memory — follows + hearted places (see KEY_FEED above) */
    getFeed: function () {
      var empty = { follows: [], hearts: [] };
      try {
        var raw = localStorage.getItem(KEY_FEED);
        if (!raw) return empty;
        var o = JSON.parse(raw);
        if (!o || typeof o !== 'object') return empty;
        return {
          follows: Array.isArray(o.follows) ? o.follows.slice() : [],
          hearts: Array.isArray(o.hearts) ? o.hearts.slice() : []
        };
      } catch (e) { return empty; }
    },
    setFeed: function (o) {
      try {
        localStorage.setItem(KEY_FEED, JSON.stringify({
          follows: (o && o.follows) || [],
          hearts: (o && o.hearts) || []
        }));
        return true;
      } catch (e) { return false; }
    }
  };

  /* Small typed wrappers over store.getFeed()/setFeed() so the feed, the
     deck and the shortlist all read and write the same two lists without
     re-parsing JSON at every call site. Names are compared case-folded. */
  var feedStore = (function () {
    function lc(s2) { return String(s2 == null ? '' : s2).toLowerCase(); }
    function has(list, v) {
      for (var i = 0; i < list.length; i++) if (lc(list[i]) === lc(v)) return true;
      return false;
    }
    function drop(list, v) {
      return list.filter(function (x) { return lc(x) !== lc(v); });
    }
    return {
      follows: function () { return store.getFeed().follows; },
      isFollowing: function (handle) { return has(store.getFeed().follows, handle); },
      setFollow: function (handle, on) {
        var f = store.getFeed();
        if (on && !has(f.follows, handle)) f.follows.push(handle);
        if (!on) f.follows = drop(f.follows, handle);
        store.setFeed(f);
      },
      hearts: function () { return store.getFeed().hearts; },
      isHearted: function (name) { return has(store.getFeed().hearts, name); },
      setHeart: function (name, on) {
        if (!name || BETA) return;   // no Feed in the beta -> no hearts to keep
        var f = store.getFeed();
        if (on && !has(f.hearts, name)) f.hearts.push(String(name));
        if (!on) f.hearts = drop(f.hearts, name);
        store.setFeed(f);
      }
    };
  })();

  /* ------------------------------------------------------------------ *
   * distance — haversine (miles)
   * ------------------------------------------------------------------ */
  function haversineMiles(a, b) {
    if (!a || !b) return null;
    var R = 3958.8; // Earth radius, miles
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLng = (b.lng - a.lng) * Math.PI / 180;
    var la1 = a.lat * Math.PI / 180;
    var la2 = b.lat * Math.PI / 180;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtDist(mi) {
    if (mi == null) return '';
    if (mi < 0.1) return (Math.round(mi * 5280)) + ' ft';
    return mi.toFixed(mi < 10 ? 1 : 0) + ' mi';
  }
  /* Friendly travel hint alongside the raw distance: close places as walking
     minutes (~3.1 mph), farther ones as urban driving minutes (~16 mph).
     Rounded up, never below 1 minute. */
  function fmtTravel(mi) {
    if (mi == null) return '';
    if (mi <= 1.3) return Math.max(1, Math.ceil((mi / 3.1) * 60)) + ' min walk';
    return Math.max(1, Math.ceil((mi / 16) * 60)) + ' min drive';
  }

  /* ------------------------------------------------------------------ *
   * demo — sample data (San Francisco)
   * ------------------------------------------------------------------ */
  // Search origin used for demo distance math (Ferry Building area, SF).
  var DEMO_ORIGIN = { lat: 37.7956, lng: -122.3934 };

  /* Demo restaurants — extended for the swipe deck. Each carries:
     rating (0-5), reviews, price (1-4), cuisine tag(s), open, distance,
     phone, plus per-segment story content: `vibe`/`food` (watercolor panel
     captions, since we have no real photos) and 2-3 review quotes, and
     dietary / dining / extras flags so Preferences visibly filter the deck.
     `cuisines` are normalized keys matching the Preferences chips. Spread at
     varied distances so the nearest-first expansion + distance cap read well. */
  var DEMO_RESTAURANTS = [
    { name: 'Little Wren Bakery', rating: 4.8, reviews: 1340, price: 1, type: 'Bakery · Café', cuisines: ['cafe'], lat: 37.7959, lng: -122.3949, open: true, phone: '+14155550178', openH: 7, closeH: 15,
      diet: ['vegetarian'], dining: ['dine-in', 'takeout'], extras: ['kids'],
      vibe: 'Sunlit corner café, marble counters, fresh flowers', food: 'Morning buns, laminated pastries, flat whites',
      reviews_q: [ { by: 'Maya O.', score: 96, text: 'The morning bun is a religious experience. Get there early.' }, { by: 'Devin P.', score: 90, text: 'Cozy, sunny, perfect for a slow Saturday.' } ] },
    { name: 'Tonkotsu Lane', rating: 4.7, reviews: 1582, price: 2, type: 'Ramen · Japanese', cuisines: ['japanese'], lat: 37.7948, lng: -122.3958, open: true, phone: '+14155550133', openH: 11, closeH: 22,
      diet: [], dining: ['dine-in'], extras: ['alcohol'],
      vibe: 'Tiny steamy counter, paper lanterns, jazz on vinyl', food: 'Rich tonkotsu, chashu, soft egg, chili oil',
      reviews_q: [ { by: 'Hana S.', score: 94, text: 'Broth so silky it ruined other ramen for me.' }, { by: 'Leo C.', score: 88, text: 'Tiny room, worth the wait. The chashu melts.' }, { by: 'Priya R.', score: 90, text: 'Order the spicy miso. Trust me.' } ] },
    { name: 'Marigold & Sage', rating: 4.6, reviews: 812, price: 3, type: 'Californian · Farm-to-table', cuisines: ['american', 'mediterranean'], lat: 37.7929, lng: -122.3971, open: true, phone: '+14155550142', openH: 17, closeH: 23,
      diet: ['vegetarian', 'gluten-free'], dining: ['dine-in'], extras: ['outdoor', 'alcohol'],
      vibe: 'Linen tablecloths, candlelight, garden patio', food: 'Heirloom tomato, roast chicken, market salads',
      reviews_q: [ { by: 'Theo B.', score: 92, text: 'Tasting menu was a quiet, beautiful treat.' }, { by: 'Maya O.', score: 89, text: 'Everything tastes like it was picked this morning.' } ] },
    { name: 'Casa Poblana', rating: 4.5, reviews: 967, price: 2, type: 'Mexican · Taquería', cuisines: ['mexican'], lat: 37.7901, lng: -122.4003, open: true, phone: '+14155550110', openH: 11, closeH: 23,
      diet: ['vegetarian', 'gluten-free'], dining: ['dine-in', 'takeout', 'delivery'], extras: ['groups', 'alcohol', 'kids'],
      vibe: 'Bright tiles, mariachi murals, buzzy and loud', food: 'Al pastor tacos, fresh salsa, horchata',
      reviews_q: [ { by: 'Leo C.', score: 93, text: 'Al pastor for days. Bring cash, bring friends.' }, { by: 'Devin P.', score: 85, text: 'Lines out the door for a reason.' } ] },
    { name: 'Verde Trattoria', rating: 4.5, reviews: 1104, price: 3, type: 'Italian · Pasta', cuisines: ['italian'], lat: 37.7966, lng: -122.3902, open: true, phone: '+14155550121', openH: 16, closeH: 23,
      diet: ['vegetarian'], dining: ['dine-in', 'takeout'], extras: ['alcohol'],
      vibe: 'Warm trattoria, exposed brick, cozy two-tops', food: 'Cacio e pepe, fresh pappardelle, tiramisu',
      reviews_q: [ { by: 'Hana S.', score: 91, text: 'Cacio e pepe done exactly right. Cozy little room.' }, { by: 'Theo B.', score: 87, text: 'The pasta is hand-rolled and it shows.' } ] },
    { name: 'Saffron House', rating: 4.6, reviews: 729, price: 2, type: 'Indian · Curry house', cuisines: ['indian'], lat: 37.7937, lng: -122.4012, open: true, phone: '+14155550188', openH: 11, closeH: 22,
      diet: ['vegetarian', 'vegan', 'gluten-free'], dining: ['dine-in', 'takeout', 'delivery'], extras: ['groups', 'kids'],
      vibe: 'Jewel-tone walls, brass lanterns, fragrant air', food: 'Butter chicken, garlic naan, dal makhani',
      reviews_q: [ { by: 'Priya R.', score: 90, text: 'Butter chicken was rich; staff were lovely.' }, { by: 'Maya O.', score: 88, text: 'Best dal in the city, and lots of vegan options.' } ] },
    { name: 'Foggy Bell Coffee', rating: 4.4, reviews: 455, price: 1, type: 'Coffee · Light bites', cuisines: ['cafe'], lat: 37.7972, lng: -122.3985, open: true, phone: '+14155550144', openH: 6, closeH: 16,
      diet: ['vegetarian', 'vegan'], dining: ['takeout', 'dine-in'], extras: ['outdoor'],
      vibe: 'Minimalist, big windows, foggy-day calm', food: 'Single-origin pour-overs, oat lattes, scones',
      reviews_q: [ { by: 'Devin P.', score: 86, text: 'Flat white + a window seat. My new spot.' }, { by: 'Leo C.', score: 82, text: 'Quiet enough to actually get work done.' } ] },
    { name: 'Olive & Thyme', rating: 4.3, reviews: 388, price: 3, type: 'Mediterranean', cuisines: ['mediterranean'], lat: 37.7918, lng: -122.3949, open: true, phone: '+14155550155', openH: 11, closeH: 22,
      diet: ['vegetarian', 'vegan', 'gluten-free'], dining: ['dine-in', 'takeout'], extras: ['outdoor', 'groups', 'alcohol'],
      vibe: 'Whitewashed walls, olive branches, sea-blue tile', food: 'Mezze platters, lamb kebab, lemony hummus',
      reviews_q: [ { by: 'Theo B.', score: 86, text: 'The mezze spread is a feast for two.' }, { by: 'Priya R.', score: 84, text: 'Great for a group with mixed diets.' } ] },
    { name: 'The Copper Kettle', rating: 4.2, reviews: 642, price: 2, type: 'Brunch · American', cuisines: ['american'], lat: 37.7983, lng: -122.3962, open: false, phone: '+14155550166', openH: 8, closeH: 14,
      diet: ['vegetarian'], dining: ['dine-in'], extras: ['groups', 'kids'],
      vibe: 'Copper pots, checkered floor, weekend bustle', food: 'Buttermilk pancakes, hash, bottomless coffee',
      reviews_q: [ { by: 'Hana S.', score: 83, text: 'Classic diner energy and giant pancakes.' }, { by: 'Maya O.', score: 80, text: 'Go on a weekday to skip the wait.' } ] },
    { name: 'Pier 9 Oyster Co.', rating: 4.4, reviews: 521, price: 4, type: 'Seafood · Raw bar', cuisines: ['seafood'], lat: 37.7995, lng: -122.3915, open: false, phone: '+14155550199', openH: 16, closeH: 22,
      diet: ['gluten-free'], dining: ['dine-in'], extras: ['outdoor', 'alcohol'],
      vibe: 'Waterfront deck, string lights, sunset views', food: 'Oysters, cioppino, grilled day-boat fish',
      reviews_q: [ { by: 'Leo C.', score: 88, text: 'Sunset on the patio is unbeatable.' }, { by: 'Devin P.', score: 78, text: 'Pricey and service lagged, but the view…' } ] },
    { name: 'Smoke & Ember BBQ', rating: 4.6, reviews: 980, price: 2, type: 'BBQ · Smokehouse', cuisines: ['bbq', 'american'], lat: 37.7912, lng: -122.3886, open: true, phone: '+14155550201', openH: 11, closeH: 21,
      diet: [], dining: ['dine-in', 'takeout'], extras: ['outdoor', 'groups', 'alcohol'],
      vibe: 'Reclaimed wood, smoke in the air, picnic tables', food: 'Brisket, burnt ends, smoked ribs, slaw',
      reviews_q: [ { by: 'Theo B.', score: 92, text: 'The brisket falls apart. Come hungry.' }, { by: 'Hana S.', score: 87, text: 'Burnt ends sell out by 2pm. Get there early.' } ] },
    { name: 'Seoul & Stone', rating: 4.5, reviews: 712, price: 2, type: 'Korean · BBQ', cuisines: ['korean'], lat: 37.8002, lng: -122.4001, open: true, phone: '+14155550213', openH: 17, closeH: 24,
      diet: ['vegetarian'], dining: ['dine-in'], extras: ['groups', 'alcohol'],
      vibe: 'Tabletop grills, neon glow, lively groups', food: 'Galbi, bibimbap, bubbling kimchi jjigae',
      reviews_q: [ { by: 'Priya R.', score: 90, text: 'Tabletop grill is so fun for a group.' }, { by: 'Maya O.', score: 85, text: 'The banchan alone is worth coming for.' } ] },
    { name: 'Pho & Lantern', rating: 4.4, reviews: 533, price: 1, type: 'Vietnamese · Noodles', cuisines: ['vietnamese'], lat: 37.7886, lng: -122.3961, open: true, phone: '+14155550224', openH: 10, closeH: 21,
      diet: ['vegetarian', 'vegan', 'gluten-free'], dining: ['dine-in', 'takeout', 'delivery'], extras: ['kids'],
      vibe: 'Steamy storefront, herbs on every table', food: 'Beef pho, fresh rolls, lemongrass tofu',
      reviews_q: [ { by: 'Devin P.', score: 88, text: 'Broth simmered all day — you can taste it.' }, { by: 'Leo C.', score: 84, text: 'Cheap, fast, and deeply comforting.' } ] },
    { name: 'Bangkok Orchid', rating: 4.5, reviews: 604, price: 2, type: 'Thai · Street food', cuisines: ['thai'], lat: 37.8021, lng: -122.3958, open: true, phone: '+14155550235', openH: 11, closeH: 22,
      diet: ['vegetarian', 'vegan'], dining: ['dine-in', 'takeout', 'delivery'], extras: ['groups'],
      vibe: 'Orchids, gold accents, gentle chimes', food: 'Pad see ew, green curry, mango sticky rice',
      reviews_q: [ { by: 'Hana S.', score: 89, text: 'Green curry with real heat — finally.' }, { by: 'Priya R.', score: 86, text: 'Mango sticky rice is the perfect finish.' } ] },
    { name: 'The Stacked Patty', rating: 4.3, reviews: 1190, price: 1, type: 'Burgers · American', cuisines: ['burgers', 'american'], lat: 37.7869, lng: -122.3922, open: true, phone: '+14155550246', openH: 11, closeH: 23,
      diet: ['vegetarian'], dining: ['dine-in', 'takeout', 'delivery'], extras: ['groups', 'kids'],
      vibe: 'Retro diner booths, chrome, milkshake machines', food: 'Smash burgers, crispy fries, thick shakes',
      reviews_q: [ { by: 'Theo B.', score: 87, text: 'Smash burger with the crispy edges. Yes.' }, { by: 'Maya O.', score: 82, text: 'Killer veggie burger too, not an afterthought.' } ] },
    { name: 'Crosta Pizzeria', rating: 4.6, reviews: 1420, price: 2, type: 'Pizza · Neapolitan', cuisines: ['pizza', 'italian'], lat: 37.7849, lng: -122.4005, open: true, phone: '+14155550257', openH: 12, closeH: 23,
      diet: ['vegetarian'], dining: ['dine-in', 'takeout', 'delivery'], extras: ['groups', 'alcohol', 'kids'],
      vibe: 'Wood-fired oven glow, communal tables', food: 'Blistered margherita, burrata, charred crust',
      reviews_q: [ { by: 'Leo C.', score: 91, text: 'Leopard-spotted crust, perfect char.' }, { by: 'Devin P.', score: 88, text: 'The margherita is all you need.' } ] },
    { name: 'Garden & Grain', rating: 4.4, reviews: 410, price: 2, type: 'Vegetarian · Bowls', cuisines: ['vegetarian', 'mediterranean'], lat: 37.8035, lng: -122.3902, open: true, phone: '+14155550268', openH: 9, closeH: 20,
      diet: ['vegetarian', 'vegan', 'gluten-free'], dining: ['dine-in', 'takeout', 'delivery'], extras: ['outdoor', 'kids'],
      vibe: 'Leafy, airy, reclaimed-wood and plants', food: 'Grain bowls, roasted veg, tahini everything',
      reviews_q: [ { by: 'Priya R.', score: 89, text: 'Finally a veg spot that feels indulgent.' }, { by: 'Hana S.', score: 85, text: 'Everything is vegan and you would not guess.' } ] },
    { name: 'Lupo Rosso', rating: 4.7, reviews: 860, price: 3, type: 'Italian · Wine bar', cuisines: ['italian'], lat: 37.7831, lng: -122.3948, open: false, phone: '+14155550279', openH: 17, closeH: 24,
      diet: ['vegetarian'], dining: ['dine-in'], extras: ['alcohol'],
      vibe: 'Dim, romantic, candle-lit wine cellar', food: 'Handmade ravioli, natural wine, affogato',
      reviews_q: [ { by: 'Maya O.', score: 93, text: 'Date-night perfection. The ravioli, swoon.' }, { by: 'Theo B.', score: 89, text: 'Ask the somm to pick — never wrong.' } ] }
  ];

  /* Watercolor panel descriptors (the deck builds gradient panels from these). */
  var DEMO_VIBE_GLYPH = '✨'; // sparkles
  var DEMO_FOOD_GLYPH = '🍴'; // fork & knife with plate

  /* ------------------------------------------------------------------ *
   * Procedural watercolor panel art — when a card has no real photo,
   * paint a cuisine-keyed pigment composition instead of a flat gradient.
   * Vibe = ambient washes; Food = a plate on a table with dish-color
   * pooling. Seeded per place so every card reads distinct.
   * ------------------------------------------------------------------ */
  var CUISINE_ART = {
    cafe:          ['#c9a97a', '#e8d9bd', '#8a6f4d'],
    japanese:      ['#5a6c86', '#d98ba0', '#e8e0cf'],
    italian:       ['#93b48b', '#c25a3a', '#f0e3c8'],
    mexican:       ['#d97f4e', '#93b48b', '#cdb878'],
    indian:        ['#d99a3d', '#c2547e', '#8a5a9e'],
    mediterranean: ['#7fa8c9', '#93b48b', '#e8dfc9'],
    seafood:       ['#6fa3c4', '#d98ba0', '#dceaf2'],
    bbq:           ['#8a5a44', '#c25a3a', '#4a4038'],
    korean:        ['#c2504a', '#3f4a5a', '#e8d9bd'],
    vietnamese:    ['#88a86f', '#cdb878', '#e9efdb'],
    thai:          ['#a292c4', '#cdb878', '#93b48b'],
    burgers:       ['#cda04e', '#a8512f', '#e8d9bd'],
    pizza:         ['#c25a3a', '#93b48b', '#f0e3c8'],
    vegetarian:    ['#93b48b', '#b4c98b', '#e9efdb'],
    american:      ['#7fa8c9', '#cdb878', '#e8dfc9']
  };

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h;
  }

  function panelArt(r, segKey, variant) {
    var pal = CUISINE_ART[(r.cuisines || [])[0]] || ['#a292c4', '#7fa8c9', '#e8dfc9'];
    var h = hashStr((r.name || r.id || '') + segKey + (variant ? '#' + variant : ''));
    var rnd = function (lo, hi, salt) {
      var x = ((h >> (salt % 24)) & 255) / 255;
      return Math.round(lo + x * (hi - lo));
    };
    var layers = [];
    if (segKey === 'food') {
      // dish pooling on a plate, plate on a table wash
      var px = rnd(42, 58, 3), py = rnd(40, 52, 7);
      layers.push('radial-gradient(circle at ' + (px - 6) + '% ' + (py - 4) + '%, ' + pal[1] + 'e6 0%, ' + pal[1] + '00 16%)');
      layers.push('radial-gradient(circle at ' + (px + 7) + '% ' + (py + 5) + '%, ' + pal[0] + 'd9 0%, ' + pal[0] + '00 14%)');
      layers.push('radial-gradient(circle at ' + px + '% ' + (py + 8) + '%, ' + pal[2] + 'cc 0%, ' + pal[2] + '00 12%)');
      layers.push('radial-gradient(circle at ' + px + '% ' + py + '%, #f6f1e7 0 26%, #e6dcc4 26.5% 29%, #f6f1e700 30%)');
      layers.push('radial-gradient(120% 90% at ' + rnd(20, 80, 11) + '% 110%, ' + pal[0] + '40 0%, ' + pal[0] + '00 60%)');
      layers.push('linear-gradient(' + rnd(150, 210, 13) + 'deg, #4c4438 0%, #6b5f4d 55%, #57503f 100%)');
    } else {
      // ambient room washes: three pigment pools glowing against dusk paper
      layers.push('radial-gradient(' + rnd(50, 80, 2) + '% ' + rnd(40, 65, 5) + '% at ' + rnd(12, 40, 9) + '% ' + rnd(18, 45, 4) + '%, ' + pal[0] + 'e6 0%, ' + pal[0] + '00 72%)');
      layers.push('radial-gradient(' + rnd(45, 75, 6) + '% ' + rnd(45, 70, 8) + '% at ' + rnd(60, 88, 10) + '% ' + rnd(25, 60, 12) + '%, ' + pal[1] + 'cc 0%, ' + pal[1] + '00 72%)');
      layers.push('radial-gradient(' + rnd(55, 90, 14) + '% ' + rnd(38, 58, 16) + '% at ' + rnd(30, 70, 18) + '% ' + rnd(75, 100, 20) + '%, ' + pal[2] + 'a6 0%, ' + pal[2] + '00 74%)');
      layers.push('linear-gradient(' + rnd(150, 200, 22) + 'deg, #46536a 0%, #4d4a63 55%, #574c60 100%)');
    }
    return layers.join(', ');
  }

  /* Paint a thumb: the watercolor panel first (it doubles as the placeholder
     while a photo loads), then swap the photo in ONLY once it has actually
     decoded. A photo that 404s, is blocked, or never arrives simply leaves
     the art in place — no broken tile, no error, no layout shift. Used by
     every surface that shows a place picture so live and demo modes look and
     fail the same way. */
  function paintThumb(node, url, artCss) {
    if (!node) return;
    node.style.background = artCss;
    node.classList.remove('has-photo');
    if (!url) return;
    var safe = String(url).replace(/["\\]/g, '');
    if (!/^https?:\/\//i.test(safe)) return;  // only ever load real http(s) photos
    var img = new Image();
    img.onload = function () {
      node.style.background = 'url("' + safe + '") center / cover';
      node.classList.add('has-photo');
    };
    img.onerror = function () { /* keep the watercolor — silently */ };
    img.src = safe;
  }

  /* Photo credit line ("Photo: Name"). Google's Places terms require the
     photo author be shown. Text only; when `asLink` and the author uri is a
     real https URL, the name becomes a safe external link. Never innerHTML. */
  function photoCreditEl(credit, cls, asLink) {
    if (!credit || !credit.by) return null;
    var node = el('span', cls);
    node.appendChild(document.createTextNode('Photo: '));
    if (asLink && credit.uri && /^https:\/\//i.test(credit.uri)) {
      var a = document.createElement('a');
      a.href = credit.uri;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = credit.by;
      node.appendChild(a);
    } else {
      node.appendChild(document.createTextNode(credit.by));
    }
    return node;
  }
  // which credit belongs to the photo painted at `url` (live places only)
  function photoCreditFor(r, url) {
    if (!r || !url) return null;
    var list = r.photos || [];
    for (var i = 0; i < list.length; i++) if (list[i].url === url && list[i].by) return list[i];
    return (url === r.photoUrl && r.photoBy) ? { by: r.photoBy, uri: r.photoUri } : null;
  }


  /* ================================================================== *
   * FOOD ART — procedural watercolor "living stills" for the Feed.
   *
   * panelArt() paints a CSS gradient stack good enough for a 120px thumb.
   * A full-bleed post is a different problem: at 390x844 a gradient stack
   * reads as an abstract blob, so the feed paints to a canvas instead —
   * real watercolor moves (pigment laid in overlapping translucent passes
   * with 'multiply', irregular wet edges, a darker rim where the wash
   * dried, paper grain over the top) arranged into one of five food
   * COMPOSITION ARCHETYPES:
   *
   *   plate  a plated dish seen from above (the classic food shot)
   *   bowl   a bowl of something brothy, three-quarter view, steam
   *   stack  a tall side-on build: burger, pancakes, layered things
   *   crop   a close crop of a dish edge — crust, field, toppings
   *   table  a table scene: two plates, a glass, candle glow, dusk room
   *
   * Everything is seeded from the place, so a place always paints the same
   * way, and every colour comes from that place's cuisine. Nothing here is
   * a photograph and nothing here pretends to be: it is paint.
   *
   * Canvases are cached (small LRU) and painted exactly once — never per
   * frame. The only motion is CSS on top of the finished canvas.
   * ================================================================== */
  var foodArt = (function () {
    var W = 336, H = 728;        // internal paint size; CSS scales to fill
    var CAP = 12;                // cached canvases (≈1.0MB each at this size)
    var cache = {};              // key -> canvas
    var order = [];              // LRU, oldest first

    /* ---- colour helpers (hex in, css out) ---- */
    function toRGB(hex) {
      var h = String(hex).replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    function rgba(hex, a) {
      var c = toRGB(hex);
      return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    }
    function toHex(c) {
      function p(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? '0' : '') + n.toString(16); }
      return '#' + p(c[0]) + p(c[1]) + p(c[2]);
    }
    function mix(a, b, t) {
      var x = toRGB(a), y = toRGB(b);
      return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
    }
    function shade(hex, t) { return t < 0 ? mix(hex, '#1c2129', -t) : mix(hex, '#fffaf0', t); }
    /* Some cuisine accents are cool (pond blue, wisteria). Ceramic can be
       blue; a drizzle of sauce cannot. Anything that goes ON the food asks
       for the warm version. */
    function warmOf(hex) {
      var c = toRGB(hex), r = c[0], g = c[1], b = c[2];
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx === mn) return '#d9a13d';
      var h;
      if (mx === r) h = ((g - b) / (mx - mn)) % 6;
      else if (mx === g) h = (b - r) / (mx - mn) + 2;
      else h = (r - g) / (mx - mn) + 4;
      h = h * 60; if (h < 0) h += 360;
      return (h >= 12 && h <= 65) ? hex : '#d9a13d';   // amber through gold only
    }

    /* ---- deterministic RNG (mulberry32) ---- */
    function rngFrom(seed) {
      var s = seed >>> 0;
      return function () {
        s = (s + 0x6D2B79F5) | 0;
        var t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    /* ---- paper grain, built once and stamped over everything ---- */
    var grainTile = null;
    function grain() {
      if (grainTile) return grainTile;
      var c = document.createElement('canvas');
      c.width = c.height = 96;
      var g = c.getContext('2d');
      var img = g.createImageData(96, 96);
      var d = img.data, rnd = rngFrom(20260907);
      for (var i = 0; i < d.length; i += 4) {
        var v = 128 + (rnd() - 0.5) * 96;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 26;
      }
      g.putImageData(img, 0, 0);
      grainTile = c;
      return c;
    }

    /* ---- one irregular closed watercolour edge ---- */
    function blobPath(ctx, rnd, cx, cy, rx, ry, wob, rot, n) {
      n = n || 13;
      var pts = [], i, a, k;
      for (i = 0; i < n; i++) {
        a = rot + (i / n) * Math.PI * 2;
        k = 1 + (rnd() * 2 - 1) * wob;
        pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
      }
      var mid = function (p, q) { return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; };
      var m = mid(pts[n - 1], pts[0]);
      ctx.beginPath();
      ctx.moveTo(m[0], m[1]);
      for (i = 0; i < n; i++) {
        var p = pts[i], q = pts[(i + 1) % n], mm = mid(p, q);
        ctx.quadraticCurveTo(p[0], p[1], mm[0], mm[1]);
      }
      ctx.closePath();
    }

    function comp(mode) {
      return mode === 'over' ? 'source-over' : (mode === 'light' ? 'screen' : 'multiply');
    }

    /* A pigment pool: several overlapping translucent passes (that is what
       makes watercolour read as watercolour), then a darker wet edge where
       the wash pulled to the rim as it dried. `mode` is 'multiply' for a
       glaze over what is underneath, 'over' for something solid sitting on
       top of it (a plate, a slice of meat), 'light' for a lit haze. */
    function pool(ctx, rnd, cx, cy, rx, ry, color, alpha, passes, wob, rim, mode) {
      passes = passes || 3;
      wob = wob == null ? 0.08 : wob;
      ctx.save();
      ctx.globalCompositeOperation = comp(mode);
      for (var i = 0; i < passes; i++) {
        var s = 1 - i * 0.11;
        ctx.globalAlpha = alpha * (i === 0 ? 1 : 0.68);
        ctx.fillStyle = i === 0 ? color : shade(color, i === 1 ? -0.1 : 0.12);
        blobPath(ctx, rnd, cx + (rnd() - 0.5) * rx * 0.09, cy + (rnd() - 0.5) * ry * 0.09,
                 rx * s, ry * s, wob, rnd() * 6.283);
        ctx.fill();
      }
      if (rim !== false) {
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = Math.min(1, alpha * 0.6);
        ctx.strokeStyle = shade(color, -0.42);
        ctx.lineWidth = Math.max(1.2, rx * 0.035);
        blobPath(ctx, rnd, cx, cy, rx, ry, wob * 0.8, rnd() * 6.283);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* Warm light thrown onto a scene (screen, so it lifts dark ground). */
    function soft(ctx, cx, cy, r, color, alpha) {
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba(color, alpha));
      g.addColorStop(1, rgba(color, 0));
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
    }

    /* The catch-light along the top of a piece of food — the single detail
       that separates "cooked" from "coloured shape". */
    function sheen(ctx, cx, cy, rx, ry, ang, alpha) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, 'rgba(255,250,236,' + alpha + ')');
      g.addColorStop(1, 'rgba(255,250,236,0)');
      ctx.fillStyle = g;
      ctx.scale(1, ry / rx);
      ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.283); ctx.fill();
      ctx.restore();
    }

    /* A soft cast shadow — what actually makes an object sit on a surface. */
    function shadowEllipse(ctx, cx, cy, rx, ry, alpha, blur) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = alpha;
      ctx.filter = 'blur(' + (blur || 10) + 'px)';
      ctx.fillStyle = '#2a231c';
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 6.283); ctx.fill();
      ctx.restore();
    }

    /* A loose brush stroke through a list of points. */
    function stroke(ctx, pts, color, width, alpha, cap, mode) {
      if (pts.length < 2) return;
      ctx.save();
      ctx.globalCompositeOperation = comp(mode);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = cap || 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length - 1; i++) {
        var mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      ctx.stroke();
      ctx.restore();
    }

    /* A small pointed leaf (herbs, greens, garnish). */
    function leaf(ctx, rnd, cx, cy, len, wid, ang, color, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(-len / 2, 0);
      ctx.quadraticCurveTo(0, -wid, len / 2, 0);
      ctx.quadraticCurveTo(0, wid * (0.7 + rnd() * 0.5), -len / 2, 0);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.5;
      ctx.strokeStyle = shade(color, -0.4);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    function dots(ctx, rnd, cx, cy, spread, n, r, color, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      for (var i = 0; i < n; i++) {
        var a = rnd() * 6.283, d = Math.sqrt(rnd()) * spread;
        var rr = r * (0.6 + rnd() * 0.8);
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, rr, rr * (0.7 + rnd() * 0.5), rnd() * 3, 0, 6.283);
        ctx.fill();
      }
      ctx.restore();
    }

    function vignette(ctx, strength) {
      var g = ctx.createRadialGradient(W * 0.5, H * 0.38, H * 0.20, W * 0.5, H * 0.42, H * 0.76);
      g.addColorStop(0, 'rgba(24,20,17,0)');
      g.addColorStop(1, 'rgba(24,20,17,' + strength + ')');
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    /* ---- backgrounds ----
       Dark, warm surfaces. Food photography reads through contrast: the
       ground has to be a real value or the plate never lifts off it. */
    function bgCloth(ctx, rnd, f) {
      var base = mix(f.table, '#241f1a', 0.42);
      ctx.save();
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      // brushed bands, both lighter and darker, so the surface has a weave
      for (var i = 0; i < 7; i++) {
        var y = H * (0.02 + i * 0.155) + rnd() * 26;
        stroke(ctx, [[-30, y], [W * 0.45, y + 20 - rnd() * 40], [W + 30, y + 30 - rnd() * 60]],
               i % 2 ? shade(base, 0.16) : shade(base, -0.18), 34 + rnd() * 40, 0.5, 'butt', 'over');
      }
      pool(ctx, rnd, W * 0.5, H * 0.42, W * 0.8, H * 0.42, shade(base, 0.13), 0.5, 2, 0.16, false, 'over');
      soft(ctx, W * 0.26, H * 0.14, H * 0.52, '#ffe6b8', 0.30);
      soft(ctx, W * 0.82, H * 0.86, H * 0.36, '#2a2118', 0.34);
    }
    function bgRoom(ctx, rnd, f) {
      var base = mix(f.table, '#1b202b', 0.55);
      ctx.save();
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, shade(base, -0.22));
      g.addColorStop(0.52, base);
      g.addColorStop(1, shade(base, -0.3));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      soft(ctx, W * 0.78, H * 0.2, H * 0.3, '#ffcf8c', 0.34);
      soft(ctx, W * 0.14, H * 0.26, H * 0.22, '#9fc2e0', 0.16);
    }

    /* ---- ARCHETYPE 1: a plated dish, seen from above ---- */
    function drawPlate(ctx, rnd, f) {
      bgCloth(ctx, rnd, f);
      var cx = W * 0.5, cy = H * 0.375, R = W * 0.475;

      // a second dish half out of frame, top left — depth, and it says
      // "this is a table", not "this is a diagram of a plate"
      shadowEllipse(ctx, W * 0.04, H * 0.075, R * 0.5, R * 0.5, 0.4, 14);
      ctx.save();
      var sg = ctx.createRadialGradient(W * 0.0, H * 0.02, R * 0.05, W * 0.02, H * 0.06, R * 0.6);
      sg.addColorStop(0, '#fffdf6'); sg.addColorStop(1, '#cdc0a8');
      ctx.fillStyle = sg;
      blobPath(ctx, rnd, W * 0.02, H * 0.055, R * 0.46, R * 0.46, 0.02, 0.7, 24); ctx.fill();
      ctx.restore();
      pool(ctx, rnd, W * 0.0, H * 0.05, R * 0.24, R * 0.2, f.deep, 0.85, 2, 0.2, true, 'over');

      // plate — opaque, lit from the upper left, with a cast shadow
      shadowEllipse(ctx, cx + 10, cy + 18, R * 1.0, R * 1.0, 0.5, 16);
      ctx.save();
      var pg = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.1, cx, cy, R * 1.08);
      pg.addColorStop(0, '#fffdf6');
      pg.addColorStop(0.62, '#f4ecdc');
      pg.addColorStop(1, '#d9cdb6');
      ctx.fillStyle = pg;
      blobPath(ctx, rnd, cx, cy, R, R, 0.012, 0.5, 30); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.35; ctx.strokeStyle = '#a89a80'; ctx.lineWidth = 2;
      blobPath(ctx, rnd, cx, cy, R * 0.82, R * 0.82, 0.014, 1.1, 28); ctx.stroke();
      ctx.restore();

      // WHAT is on the plate is the cuisine's business, not the painter's
      stagePlate(ctx, rnd, f, cx, cy, R * 0.68, 1);
      vignette(ctx, 0.5);
    }

    /* ---- ARCHETYPE 2: a bowl of something brothy ---- */
    function drawBowl(ctx, rnd, f) {
      bgCloth(ctx, rnd, f);
      var cx = W * 0.5, cy = H * 0.385, rx = W * 0.435, ry = W * 0.17;
      var deep = cy + W * 0.36;
      var glaze = mix(f.table, '#efe7d6', 0.5);

      shadowEllipse(ctx, cx + 8, cy + W * 0.30, rx * 0.9, W * 0.13, 0.5, 18);

      // bowl body, lit from the left
      ctx.save();
      var bg = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
      bg.addColorStop(0, shade(glaze, 0.18));
      bg.addColorStop(0.45, glaze);
      bg.addColorStop(1, shade(glaze, -0.34));
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(cx - rx, cy);
      ctx.bezierCurveTo(cx - rx * 0.99, deep - W * 0.08, cx - rx * 0.52, deep, cx, deep);
      ctx.bezierCurveTo(cx + rx * 0.52, deep, cx + rx * 0.99, deep - W * 0.08, cx + rx, cy);
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI, true);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.5; ctx.strokeStyle = shade(glaze, -0.5); ctx.lineWidth = 2.5; ctx.stroke();
      ctx.restore();
      stroke(ctx, [[cx - rx * 0.92, cy + W * 0.11], [cx, cy + W * 0.165], [cx + rx * 0.92, cy + W * 0.11]],
             shade(f.accent, -0.1), 11, 0.6, 'round', 'over');
      sheen(ctx, cx - rx * 0.56, cy + W * 0.13, rx * 0.2, W * 0.09, 0.25, 0.4);

      // broth
      ctx.save();
      ctx.fillStyle = shade(f.main, -0.08);
      blobPath(ctx, rnd, cx, cy, rx * 0.94, ry * 0.94, 0.02, 0.3, 30); ctx.fill();
      ctx.restore();
      pool(ctx, rnd, cx - rx * 0.22, cy - ry * 0.12, rx * 0.55, ry * 0.55, shade(f.main, -0.26), 0.4, 2, 0.16, false);
      shadowEllipse(ctx, cx, cy + ry * 0.1, rx * 0.9, ry * 0.85, 0.22, 14);

      // what is IN the bowl — the kit paints it, clipped to the broth and
      // squashed into the bowl's ellipse so kits stay written flat
      ctx.save();
      ctx.beginPath(); ctx.ellipse(cx, cy, rx * 0.95, ry * 0.95, 0, 0, 6.283); ctx.clip();
      ctx.translate(cx, cy); ctx.scale(1, ry / rx); ctx.translate(-cx, -cy);
      (f.kit.bowl || bowlGeneric)(ctx, rnd, f, cx, cy, rx * 0.94);
      ctx.restore();

      // what you eat it with: chopsticks over the far rim, or a spoon in it
      var ut = f.kit.utensil || 'chop';
      if (ut === 'chop') {
        stroke(ctx, [[cx + rx * 0.18, cy - ry * 2.5], [cx + rx * 1.3, cy + ry * 0.8]], '#8d6f4e', 6, 0.9, 'round', 'over');
        stroke(ctx, [[cx + rx * 0.03, cy - ry * 2.35], [cx + rx * 1.15, cy + ry * 0.95]], '#a08055', 6, 0.9, 'round', 'over');
      } else if (ut === 'spoon') {
        shadowEllipse(ctx, cx + rx * 0.46, cy + ry * 0.5, rx * 0.2, ry * 0.34, 0.3, 8);
        stroke(ctx, [[cx + rx * 0.44, cy + ry * 0.1], [cx + rx * 1.04, cy - ry * 1.6]], '#e6d9c0', 5, 0.9, 'round', 'over');
        ctx.save();
        ctx.fillStyle = '#efe4cd';
        ctx.beginPath(); ctx.ellipse(cx + rx * 0.4, cy + ry * 0.3, rx * 0.12, ry * 0.4, -0.5, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 0.45; ctx.strokeStyle = '#ada084'; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.restore();
        sheen(ctx, cx + rx * 0.36, cy + ry * 0.2, rx * 0.1, ry * 0.18, -0.5, 0.5);
      }

      // steam: painted soft and still (the CSS layer adds the drift)
      ctx.save();
      ctx.filter = 'blur(9px)';
      ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = '#fff2dc'; ctx.lineCap = 'round';
      for (var s2 = 0; s2 < 3; s2++) {
        var sx = cx + (s2 - 1) * rx * 0.42;
        ctx.globalAlpha = 0.16 - s2 * 0.02;
        ctx.lineWidth = 9 - s2;
        ctx.beginPath();
        ctx.moveTo(sx, cy - ry * 1.0);
        ctx.bezierCurveTo(sx - 34 + rnd() * 26, cy - ry * 2.3, sx + 34 - rnd() * 26, cy - ry * 3.3, sx + (rnd() - 0.5) * 26, cy - ry * 4.4);
        ctx.stroke();
      }
      ctx.restore();
      vignette(ctx, 0.5);
    }

    /* ---- ARCHETYPE 3: a tall stacked build, side on ---- */
    function drawStack(ctx, rnd, f) {
      bgCloth(ctx, rnd, f);
      var cx = W * 0.5, base = H * 0.605, wdt = W * 0.335;

      shadowEllipse(ctx, cx + 6, base + 20, wdt * 1.6, W * 0.085, 0.5, 16);
      ctx.save();
      var pg = ctx.createLinearGradient(cx - wdt * 1.6, 0, cx + wdt * 1.6, 0);
      pg.addColorStop(0, '#fffdf6'); pg.addColorStop(1, '#dbd0ba');
      ctx.fillStyle = pg;
      blobPath(ctx, rnd, cx, base + 10, wdt * 1.55, W * 0.082, 0.02, 0.2, 26); ctx.fill();
      ctx.restore();

      /* one layer of the build: a slab with a wavy underside so cheese
         drips and lettuce frills read as themselves */
      function slab(cy2, hw, hh, color, frill) {
        shadowEllipse(ctx, cx + 3, cy2 + hh * 0.8, hw * 0.95, hh * 0.5, 0.3, 8);
        ctx.save();
        var lg = ctx.createLinearGradient(cx - hw, 0, cx + hw, 0);
        lg.addColorStop(0, shade(color, 0.2));
        lg.addColorStop(0.42, color);
        lg.addColorStop(1, shade(color, -0.3));
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.moveTo(cx - hw, cy2 + (rnd() - 0.5) * hh * 0.3);
        var up = frill ? 5 : 4, i;
        for (i = 1; i <= up; i++) {
          var ux = cx - hw + (2 * hw) * (i / up);
          var uy = cy2 - hh * (0.55 + rnd() * 0.5) * Math.sin((i / up) * Math.PI) - (rnd() - 0.5) * hh * 0.25;
          ctx.quadraticCurveTo(ux - hw / up, uy, ux, cy2 + (rnd() - 0.5) * hh * 0.3);
        }
        var steps = frill ? 8 : 4;
        for (i = 0; i <= steps; i++) {
          var tx = cx + hw - (2 * hw) * (i / steps);
          var ty = cy2 + hh * (frill ? (i % 2 ? 1.6 : 0.7) : 1.0) + (rnd() - 0.5) * hh * 0.35;
          ctx.lineTo(tx, ty);
        }
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.4; ctx.strokeStyle = shade(color, -0.45); ctx.lineWidth = 1.6; ctx.stroke();
        ctx.restore();
        sheen(ctx, cx - hw * 0.42, cy2 - hh * 0.5, hw * 0.42, hh * 0.34, -0.06, 0.4);
      }

      /* the domed top of a build: a bun, the last pancake off the pan */
      function dome(y2, hw, color, seeds) {
        shadowEllipse(ctx, cx + 3, y2 + hw * 0.2, hw * 0.96, hw * 0.2, 0.25, 10);
        ctx.save();
        var dg = ctx.createRadialGradient(cx - hw * 0.4, y2 - hw * 0.24, hw * 0.05, cx, y2, hw * 1.2);
        dg.addColorStop(0, shade(color, 0.26));
        dg.addColorStop(0.55, color);
        dg.addColorStop(1, shade(color, -0.36));
        ctx.fillStyle = dg;
        ctx.beginPath();
        ctx.moveTo(cx - hw * 0.98, y2 + hw * 0.20);
        ctx.bezierCurveTo(cx - hw * 1.02, y2 - hw * 0.44, cx + hw * 1.02, y2 - hw * 0.44, cx + hw * 0.98, y2 + hw * 0.20);
        ctx.quadraticCurveTo(cx, y2 + hw * 0.34, cx - hw * 0.98, y2 + hw * 0.20);
        ctx.closePath(); ctx.fill();
        ctx.restore();
        if (seeds) dots(ctx, rnd, cx, y2 - hw * 0.04, hw * 0.62, 22, 1.8, shade(color, 0.34), 0.7);
        sheen(ctx, cx - hw * 0.3, y2 - hw * 0.22, hw * 0.3, hw * 0.08, -0.2, 0.34);
      }

      // WHAT is stacked is the cuisine's business
      (f.kit.stack || stackGeneric)(ctx, rnd, f, cx, base, wdt, slab, dome);
      vignette(ctx, 0.48);
    }

    /* ---- ARCHETYPE 4: a close crop of a dish edge ---- */
    function drawCrop(ctx, rnd, f) {
      var K = f.kit.crop || NO_KIT;
      var board = mix('#5a4632', f.table, 0.28);   // wood, always warm
      // the field: layered pigment across the whole frame
      ctx.save();
      ctx.fillStyle = shade(f.main, 0.04);
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      pool(ctx, rnd, W * 0.34, H * 0.22, W * 0.66, H * 0.3, shade(f.main, 0.24), 0.6, 3, 0.2, false);
      pool(ctx, rnd, W * 0.72, H * 0.44, W * 0.54, H * 0.26, shade(f.main, -0.24), 0.55, 3, 0.22, false);
      pool(ctx, rnd, W * 0.18, H * 0.5, W * 0.44, H * 0.22, shade(f.deep, 0.22), 0.4, 3, 0.24, false);
      // molten patches + a swirl of sauce combed through them
      for (var m = 0; m < 8; m++) {
        pool(ctx, rnd, W * rnd(), H * (0.04 + rnd() * 0.52), W * (0.11 + rnd() * 0.14), H * (0.045 + rnd() * 0.055),
             shade(f.cream, -0.08), 0.34, 2, 0.26, false);
      }
      soft(ctx, W * 0.3, H * 0.18, H * 0.42, '#ffdcaa', 0.26);
      for (var sw = 0; sw < 3; sw++) {
        var sy0 = H * (0.14 + sw * 0.16);
        stroke(ctx, [[-10, sy0 + 20], [W * 0.3, sy0 - 14], [W * 0.68, sy0 + 22], [W + 10, sy0 - 8]],
               shade(f.deep, 0.1), 9 + rnd() * 8, 0.28);
      }
      if (K.field) K.field(ctx, rnd, f);   // the cuisine's own field notes

      // the crust: a scalloped, blistered edge sweeping across the lower
      // third. This is the whole trick — an EDGE is what tells you the frame
      // is a crop of a dish and not a swatch of colour.
      var crust = K.crust || mix(f.cream, '#c8873a', 0.55);   // whose bread this is
      var crestY = H * 0.60, i;
      ctx.save();
      var cg = ctx.createLinearGradient(0, crestY - H * 0.03, 0, H * 0.84);
      cg.addColorStop(0, shade(crust, 0.16));
      cg.addColorStop(0.45, crust);
      cg.addColorStop(1, shade(crust, -0.34));
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(-12, H * 0.66);
      var lumps = 7;
      for (i = 0; i <= lumps; i++) {
        var lx = -12 + ((W + 24) * i) / lumps;
        var ly = crestY + Math.abs(i / lumps - 0.5) * H * 0.05 + (rnd() - 0.5) * H * 0.018;
        var cxp = lx - (W + 24) / lumps / 2;
        ctx.quadraticCurveTo(cxp, ly - H * 0.028, lx, ly);
      }
      ctx.lineTo(W + 12, H + 12);
      ctx.lineTo(-12, H + 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // the shadow the crust throws back onto the field
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.4; ctx.filter = 'blur(9px)';
      ctx.fillStyle = '#2a231c';
      ctx.beginPath();
      ctx.moveTo(-12, crestY - H * 0.02);
      ctx.quadraticCurveTo(W * 0.5, crestY - H * 0.10, W + 12, crestY - H * 0.01);
      ctx.lineTo(W + 12, crestY + H * 0.02); ctx.lineTo(-12, crestY + H * 0.03);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      // char blisters riding the crust
      for (var b = 0; b < 22; b++) {
        var bx = rnd() * W;
        var by = crestY + Math.abs(bx / W - 0.5) * H * 0.05 + H * (0.015 + rnd() * 0.09);
        dots(ctx, rnd, bx, by, 8, 2, 2.4 + rnd() * 3.4, shade(crust, -0.5), 0.34);
      }
      // the board it rests on, below the crust
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = board;
      ctx.beginPath();
      ctx.moveTo(-12, H * 0.80);
      ctx.quadraticCurveTo(W * 0.5, H * 0.74, W + 12, H * 0.81);
      ctx.lineTo(W + 12, H + 12); ctx.lineTo(-12, H + 12);
      ctx.closePath(); ctx.fill();
      ctx.restore();

      // what is ON it
      (K.over || cropOver)(ctx, rnd, f);
      // one broad specular sweep, fading out at both ends
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      var g5 = ctx.createLinearGradient(0, 0, W * 1.1, H * 0.7);
      g5.addColorStop(0, 'rgba(255,244,220,0)');
      g5.addColorStop(0.4, 'rgba(255,244,220,0.16)');
      g5.addColorStop(0.72, 'rgba(255,244,220,0)');
      ctx.fillStyle = g5;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      vignette(ctx, 0.42);
    }

    /* ---- ARCHETYPE 5: the restaurant table, dish in the foreground ---- */
    function drawTable(ctx, rnd, f) {
      bgRoom(ctx, rnd, f);
      var top = H * 0.36;
      // the table runs edge to edge — no seams, no floating panel
      ctx.save();
      var tg = ctx.createLinearGradient(0, top, 0, H);
      tg.addColorStop(0, mix(f.table, '#3a2f24', 0.5));
      tg.addColorStop(0.35, mix('#6a543c', f.table, 0.3));
      tg.addColorStop(1, mix('#2b2119', f.table, 0.2));
      ctx.fillStyle = tg;
      ctx.fillRect(0, top, W, H - top);
      ctx.restore();
      ctx.save(); ctx.filter = 'blur(3px)';
      stroke(ctx, [[-10, top + 2], [W * 0.5, top - 4], [W + 10, top + 3]], '#1d1712', 7, 0.34, 'butt', 'over');
      ctx.restore();
      for (var wgr = 0; wgr < 6; wgr++) {
        var wy = top + H * (0.04 + wgr * 0.1) + rnd() * 10;
        stroke(ctx, [[-10, wy], [W * 0.5, wy + 6 - rnd() * 12], [W + 10, wy - 4 + rnd() * 8]],
               wgr % 2 ? '#7a6047' : '#3e3126', 6 + rnd() * 10, 0.22, 'butt', 'over');
      }
      soft(ctx, W * 0.56, top + H * 0.02, H * 0.28, '#ffcf86', 0.42);

      // the hero plate, close and low in frame
      var px = W * 0.46, py = H * 0.575, pr = W * 0.40;
      shadowEllipse(ctx, px + 10, py + 16, pr, pr * 0.4, 0.55, 16);
      ctx.save();
      var pg = ctx.createRadialGradient(px - pr * 0.4, py - pr * 0.3, pr * 0.05, px, py, pr * 1.15);
      pg.addColorStop(0, '#fffdf6'); pg.addColorStop(0.58, '#f0e6d2'); pg.addColorStop(1, '#bfb096');
      ctx.fillStyle = pg;
      blobPath(ctx, rnd, px, py, pr, pr * 0.4, 0.02, 0.3, 28); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.3; ctx.strokeStyle = '#9c8f78'; ctx.lineWidth = 1.8;
      blobPath(ctx, rnd, px, py, pr * 0.82, pr * 0.33, 0.02, 1.0, 26); ctx.stroke();
      ctx.restore();

      // the same kit as the plate archetype, squashed into the table's
      // perspective — one cuisine, one set of components, two viewpoints
      stagePlate(ctx, rnd, f, px, py - pr * 0.02, pr * 0.62, 0.45);
      // fork resting on the cloth
      stroke(ctx, [[px - pr * 1.12, py + pr * 0.2], [px - pr * 1.02, py - pr * 0.28]], '#e2d6bd', 5, 0.75, 'round', 'over');

      // a second plate further back, half in shadow
      var qx2 = W * 0.86, qy2 = H * 0.45, qr = W * 0.2;
      shadowEllipse(ctx, qx2 + 5, qy2 + 8, qr, qr * 0.4, 0.45, 12);
      ctx.save();
      ctx.fillStyle = '#e8dcc4';
      blobPath(ctx, rnd, qx2, qy2, qr, qr * 0.4, 0.02, 0.6, 22); ctx.fill();
      ctx.restore();
      pool(ctx, rnd, qx2, qy2 - qr * 0.05, qr * 0.6, qr * 0.24, f.deep, 0.9, 2, 0.2, true, 'over');

      // wine glass, lit from behind
      var gx = W * 0.155, gy = H * 0.41;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fff3dc';
      ctx.beginPath();
      ctx.moveTo(gx - W * 0.062, gy - H * 0.055);
      ctx.bezierCurveTo(gx - W * 0.062, gy + H * 0.03, gx - W * 0.018, gy + H * 0.048, gx, gy + H * 0.05);
      ctx.bezierCurveTo(gx + W * 0.018, gy + H * 0.048, gx + W * 0.062, gy + H * 0.03, gx + W * 0.062, gy - H * 0.055);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      pool(ctx, rnd, gx, gy + H * 0.012, W * 0.052, H * 0.03, shade(warmOf(f.accent), -0.12), 0.75, 2, 0.05, false, 'over');
      stroke(ctx, [[gx, gy + H * 0.05], [gx, gy + H * 0.105]], '#efe3ca', 3, 0.6, 'round', 'over');
      stroke(ctx, [[gx - W * 0.03, gy + H * 0.108], [gx + W * 0.03, gy + H * 0.108]], '#efe3ca', 3, 0.5, 'round', 'over');
      stroke(ctx, [[gx - W * 0.052, gy - H * 0.05], [gx - W * 0.044, gy + H * 0.026]], '#fffaf0', 2.5, 0.7, 'round', 'over');

      // candle behind the plates
      soft(ctx, W * 0.66, H * 0.335, H * 0.12, '#ffcf86', 0.7);
      ctx.save();
      ctx.fillStyle = '#f0e1bf';
      ctx.beginPath(); ctx.ellipse(W * 0.66, H * 0.355, W * 0.024, H * 0.022, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#ffc95f';
      ctx.beginPath(); ctx.ellipse(W * 0.66, H * 0.326, W * 0.010, H * 0.016, 0, 0, 6.283); ctx.fill();
      ctx.restore();

      // the room behind: warm bokeh, kept small and few
      for (var k = 0; k < 7; k++) {
        soft(ctx, W * rnd(), H * (0.04 + rnd() * 0.24), W * (0.025 + rnd() * 0.045), '#ffd9a0', 0.2);
      }
      vignette(ctx, 0.55);
    }

    /* ================================================================
     * SUBJECT COMPONENTS — the food itself.
     *
     * The five painters above own FRAMING and LIGHT: the ground, the
     * ceramic, the cast shadows, the catch-lights, the vignette. They do
     * not own the SUBJECT. Everything below is the vocabulary a cuisine
     * draws from, built out of the same primitives (pool / blobPath /
     * shadowEllipse / sheen / stroke / leaf / dots) so a shell and a
     * an oyster shell are lit exactly like the plate they sit on.
     *
     * Components are drawn FLAT (as if from straight above). A painter
     * that needs perspective scales the context before calling in, so the
     * same kit serves the overhead plate and the plate on the table.
     * ================================================================ */

    /* one solid piece resting on a surface */
    function piece(ctx, rnd, x, y, rx, ry, color, wob) {
      shadowEllipse(ctx, x + rx * 0.12, y + ry * 0.36, rx * 0.95, ry * 0.85, 0.32, 7);
      pool(ctx, rnd, x, y, rx, ry, color, 0.96, 2, wob == null ? 0.12 : wob, true, 'over');
      sheen(ctx, x - rx * 0.28, y - ry * 0.34, rx * 0.5, ry * 0.3, -0.4, 0.42);
    }

    /* a heap of grain — rice, couscous, mash */
    function mound(ctx, rnd, x, y, rx, ry, color, grains) {
      shadowEllipse(ctx, x + rx * 0.1, y + ry * 0.5, rx * 0.95, ry * 0.6, 0.34, 10);
      pool(ctx, rnd, x, y, rx, ry, color, 0.97, 3, 0.1, true, 'over');
      pool(ctx, rnd, x - rx * 0.18, y - ry * 0.2, rx * 0.55, ry * 0.5, shade(color, 0.2), 0.6, 2, 0.14, false, 'over');
      if (grains !== false) {
        dots(ctx, rnd, x, y, rx * 0.8, 24, Math.max(1.2, rx * 0.05), shade(color, -0.18), 0.45);
        dots(ctx, rnd, x - rx * 0.1, y - ry * 0.15, rx * 0.6, 12, Math.max(1, rx * 0.04), '#fffaf0', 0.55);
      }
      sheen(ctx, x - rx * 0.3, y - ry * 0.42, rx * 0.5, ry * 0.28, -0.4, 0.4);
    }

    /* a flat bed of grain filling an area (a bowl base, couscous) */
    function grainBed(ctx, rnd, x, y, rx, ry, color) {
      pool(ctx, rnd, x, y, rx, ry, color, 0.95, 3, 0.12, true, 'over');
      dots(ctx, rnd, x, y, rx * 0.9, 40, Math.max(1.1, rx * 0.035), shade(color, -0.16), 0.4);
      dots(ctx, rnd, x, y, rx * 0.85, 22, Math.max(1, rx * 0.03), '#fffaf0', 0.45);
    }

    /* a citrus half — rind, pale flesh, radial segments */
    function citrusHalf(ctx, rnd, x, y, r, rind) {
      shadowEllipse(ctx, x + r * 0.12, y + r * 0.3, r, r * 0.9, 0.34, 7);
      pool(ctx, rnd, x, y, r, r * 0.96, rind, 0.97, 2, 0.05, true, 'over');
      pool(ctx, rnd, x, y, r * 0.8, r * 0.76, shade(rind, 0.36), 0.95, 2, 0.05, true, 'over');
      ctx.save();
      ctx.globalAlpha = 0.45; ctx.strokeStyle = shade(rind, -0.2); ctx.lineWidth = Math.max(1, r * 0.05);
      for (var i = 0; i < 8; i++) {
        var a = (i / 8) * 6.283 + rnd() * 0.12;
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * r * 0.74, y + Math.sin(a) * r * 0.7); ctx.stroke();
      }
      ctx.restore();
      sheen(ctx, x - r * 0.24, y - r * 0.28, r * 0.45, r * 0.22, -0.4, 0.5);
    }

    /* a wedge — lime, lemon, a triangle of pita */
    function wedge(ctx, rnd, x, y, r, ang, rind, flesh) {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      shadowEllipse(ctx, 2, r * 0.3, r * 0.82, r * 0.24, 0.3, 6);
      ctx.fillStyle = rind;
      ctx.beginPath();
      ctx.moveTo(-r, r * 0.3);
      ctx.quadraticCurveTo(0, -r * 0.18, r, r * 0.3);
      ctx.quadraticCurveTo(0, r * 0.62, -r, r * 0.3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = flesh;
      ctx.beginPath();
      ctx.moveTo(-r * 0.82, r * 0.28);
      ctx.quadraticCurveTo(0, -r * 0.02, r * 0.82, r * 0.28);
      ctx.quadraticCurveTo(0, r * 0.5, -r * 0.82, r * 0.28);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.45; ctx.strokeStyle = shade(flesh, -0.4); ctx.lineWidth = 1;
      for (var i = 1; i < 5; i++) {
        var t = -0.8 + (i / 5) * 1.6;
        ctx.beginPath(); ctx.moveTo(r * t, r * 0.28); ctx.lineTo(r * t * 0.45, r * 0.1); ctx.stroke();
      }
      ctx.restore();
      sheen(ctx, x, y + r * 0.1, r * 0.5, r * 0.14, ang, 0.4);
    }

    /* a fan shell — scallop, clam, a cockle */
    function shellFan(ctx, rnd, x, y, r, ang, color) {
      shadowEllipse(ctx, x + r * 0.1, y + r * 0.3, r * 0.95, r * 0.5, 0.34, 8);
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      var g = ctx.createLinearGradient(0, -r * 0.6, 0, r * 0.6);
      g.addColorStop(0, shade(color, 0.3)); g.addColorStop(1, shade(color, -0.24));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, r * 0.52);
      ctx.quadraticCurveTo(-r * 0.5, r * 0.4, -r, -r * 0.28);
      ctx.quadraticCurveTo(0, -r * 0.74, r, -r * 0.28);
      ctx.quadraticCurveTo(r * 0.5, r * 0.4, 0, r * 0.52);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.4; ctx.strokeStyle = shade(color, -0.42);
      ctx.lineWidth = Math.max(1, r * 0.045);
      for (var i = -3; i <= 3; i++) {
        ctx.beginPath(); ctx.moveTo(0, r * 0.46);
        ctx.quadraticCurveTo(i * r * 0.16, 0, i * r * 0.3, -r * 0.4); ctx.stroke();
      }
      ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1, r * 0.055);
      ctx.beginPath();
      ctx.moveTo(0, r * 0.52);
      ctx.quadraticCurveTo(-r * 0.5, r * 0.4, -r, -r * 0.28);
      ctx.quadraticCurveTo(0, -r * 0.74, r, -r * 0.28);
      ctx.quadraticCurveTo(r * 0.5, r * 0.4, 0, r * 0.52);
      ctx.stroke();
      ctx.restore();
      sheen(ctx, x, y - r * 0.15, r * 0.5, r * 0.2, ang, 0.4);
    }

    /* an oyster on the half shell — the pale meat sitting in its liquor */
    function oyster(ctx, rnd, x, y, r, ang, shellCol, meatCol) {
      shadowEllipse(ctx, x + r * 0.12, y + r * 0.34, r, r * 0.62, 0.36, 8);
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      var g = ctx.createLinearGradient(-r, -r * 0.5, r, r * 0.5);
      g.addColorStop(0, shade(shellCol, 0.36));
      g.addColorStop(0.5, shellCol);
      g.addColorStop(1, shade(shellCol, -0.3));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.68, 0, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 0.45; ctx.strokeStyle = shade(shellCol, -0.45);
      ctx.lineWidth = Math.max(1, r * 0.07); ctx.stroke();
      ctx.globalAlpha = 0.3;
      for (var i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.9, i * r * 0.2);
        ctx.quadraticCurveTo(0, i * r * 0.26, r * 0.9, i * r * 0.18);
        ctx.stroke();
      }
      ctx.restore();
      pool(ctx, rnd, x + r * 0.04, y + r * 0.02, r * 0.68, r * 0.42, shade(meatCol, -0.04), 0.9, 2, 0.16, false, 'over');
      pool(ctx, rnd, x - r * 0.06, y - r * 0.03, r * 0.42, r * 0.26, shade(meatCol, 0.26), 0.92, 2, 0.18, false, 'over');
      sheen(ctx, x - r * 0.1, y - r * 0.1, r * 0.4, r * 0.16, ang - 0.3, 0.6);
    }

    /* a prawn: a fat segmented comma with a tail fan */
    function prawn(ctx, rnd, x, y, r, ang, color) {
      shadowEllipse(ctx, x + r * 0.1, y + r * 0.4, r * 0.8, r * 0.4, 0.3, 7);
      var pts = [], i, a;
      for (i = 0; i <= 5; i++) {
        a = ang - 0.5 + (i / 5) * 3.4;
        pts.push([x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62]);
      }
      stroke(ctx, pts, color, r * 0.42, 0.96, 'round', 'over');
      stroke(ctx, pts, shade(color, 0.34), r * 0.14, 0.5, 'round', 'light');
      ctx.save();
      ctx.globalAlpha = 0.45; ctx.strokeStyle = shade(color, -0.34);
      ctx.lineWidth = Math.max(1, r * 0.07);
      for (i = 1; i < 5; i++) {
        var b = ang - 0.5 + (i / 5) * 3.4;
        var mx = x + Math.cos(b) * r * 0.62, my = y + Math.sin(b) * r * 0.62;
        ctx.beginPath();
        ctx.moveTo(mx - Math.cos(b + 1.57) * r * 0.2, my - Math.sin(b + 1.57) * r * 0.2);
        ctx.lineTo(mx + Math.cos(b + 1.57) * r * 0.2, my + Math.sin(b + 1.57) * r * 0.2);
        ctx.stroke();
      }
      ctx.restore();
      var ta = ang + 2.9;
      leaf(ctx, rnd, x + Math.cos(ta) * r * 0.78, y + Math.sin(ta) * r * 0.78,
           r * 0.4, r * 0.2, ta, shade(color, -0.16), 0.9);
    }

    /* a flake of cooked fish — soft slab, pale striations */
    function fillet(ctx, rnd, x, y, rx, ry, ang, color) {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang); ctx.translate(-x, -y);
      shadowEllipse(ctx, x + rx * 0.1, y + ry * 0.5, rx * 0.92, ry * 0.7, 0.34, 8);
      pool(ctx, rnd, x, y, rx, ry, color, 0.97, 2, 0.09, true, 'over');
      ctx.save();
      ctx.globalAlpha = 0.45; ctx.strokeStyle = shade(color, 0.42);
      ctx.lineWidth = Math.max(1.4, ry * 0.16);
      for (var i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(x - rx * 0.78, y + i * ry * 0.34);
        ctx.quadraticCurveTo(x, y + i * ry * 0.34 - ry * 0.14, x + rx * 0.78, y + i * ry * 0.3);
        ctx.stroke();
      }
      ctx.restore();
      sheen(ctx, x - rx * 0.2, y - ry * 0.3, rx * 0.5, ry * 0.3, 0, 0.45);
      ctx.restore();
    }

    /* nigiri: a rice pillow under a slab of topping */
    function nigiri(ctx, rnd, x, y, r, ang, top) {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang); ctx.translate(-x, -y);
      shadowEllipse(ctx, x + r * 0.1, y + r * 0.44, r * 0.95, r * 0.5, 0.34, 7);
      pool(ctx, rnd, x, y + r * 0.12, r * 0.88, r * 0.52, '#f7efdc', 0.98, 2, 0.06, true, 'over');
      dots(ctx, rnd, x, y + r * 0.14, r * 0.6, 12, Math.max(1, r * 0.05), '#e4d9c0', 0.45);
      pool(ctx, rnd, x, y - r * 0.08, r * 0.92, r * 0.42, top, 0.97, 2, 0.07, true, 'over');
      ctx.save();
      ctx.globalAlpha = 0.38; ctx.strokeStyle = shade(top, 0.42);
      ctx.lineWidth = Math.max(1.2, r * 0.07);
      for (var i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(x - r * 0.7, y - r * 0.08 + i * r * 0.14);
        ctx.quadraticCurveTo(x, y - r * 0.18 + i * r * 0.14, x + r * 0.7, y - r * 0.06 + i * r * 0.14);
        ctx.stroke();
      }
      ctx.restore();
      sheen(ctx, x - r * 0.2, y - r * 0.18, r * 0.5, r * 0.14, 0, 0.5);
      ctx.restore();
    }

    /* flatbread — naan, pita, a warm tortilla: soft oval, char blisters */
    function flatbread(ctx, rnd, x, y, rx, ry, ang, color, blisters) {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang); ctx.translate(-x, -y);
      shadowEllipse(ctx, x + rx * 0.08, y + ry * 0.44, rx * 0.95, ry * 0.8, 0.35, 9);
      pool(ctx, rnd, x, y, rx, ry, color, 0.98, 3, 0.13, true, 'over');
      pool(ctx, rnd, x - rx * 0.14, y - ry * 0.16, rx * 0.52, ry * 0.46, shade(color, 0.2), 0.55, 2, 0.2, false, 'over');
      if (blisters !== false) {
        for (var i = 0; i < 9; i++) {
          dots(ctx, rnd, x + (rnd() - 0.5) * rx * 1.4, y + (rnd() - 0.5) * ry * 1.3,
               rx * 0.05, 2, Math.max(1.6, rx * 0.05), '#4a3325', 0.36);
        }
      }
      sheen(ctx, x - rx * 0.2, y - ry * 0.3, rx * 0.45, ry * 0.2, 0, 0.36);
      ctx.restore();
    }

    /* a folded wrap — taco, enchilada, quesadilla. The filling showing
       along the open edge is the whole tell. */
    function fold(ctx, rnd, x, y, r, ang, shellCol, fill1, fill2) {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang); ctx.translate(-x, -y);
      shadowEllipse(ctx, x + r * 0.1, y + r * 0.48, r * 0.95, r * 0.3, 0.36, 8);
      pool(ctx, rnd, x, y + r * 0.08, r * 0.84, r * 0.34, fill1, 0.96, 2, 0.2, false, 'over');
      dots(ctx, rnd, x, y + r * 0.08, r * 0.6, 10, Math.max(1.4, r * 0.07), fill2, 0.85);
      ctx.save();
      var g = ctx.createLinearGradient(x, y - r * 0.6, x, y + r * 0.3);
      g.addColorStop(0, shade(shellCol, 0.24));
      g.addColorStop(1, shade(shellCol, -0.18));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - r, y + r * 0.12);
      ctx.quadraticCurveTo(x - r * 0.62, y - r * 0.7, x, y - r * 0.64);
      ctx.quadraticCurveTo(x + r * 0.62, y - r * 0.7, x + r, y + r * 0.12);
      ctx.quadraticCurveTo(x + r * 0.5, y - r * 0.06, x, y - r * 0.07);
      ctx.quadraticCurveTo(x - r * 0.5, y - r * 0.06, x - r, y + r * 0.12);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.35; ctx.strokeStyle = shade(shellCol, -0.42); ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
      for (var i = 0; i < 5; i++) {
        dots(ctx, rnd, x + (rnd() - 0.5) * r * 1.4, y - r * (0.18 + rnd() * 0.3),
             r * 0.05, 1, Math.max(1.4, r * 0.05), shade(shellCol, -0.5), 0.3);
      }
      sheen(ctx, x - r * 0.25, y - r * 0.38, r * 0.4, r * 0.14, -0.2, 0.36);
      ctx.restore();
    }

    /* a slice of smoked or roast meat: a dark bark edge and a smoke ring */
    function meatSlice(ctx, rnd, x, y, rx, ry, ang, meat, bark) {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang); ctx.translate(-x, -y);
      shadowEllipse(ctx, x + rx * 0.14, y + ry * 0.5, rx * 0.95, ry * 0.8, 0.36, 8);
      pool(ctx, rnd, x, y, rx, ry, meat, 0.97, 2, 0.1, true, 'over');
      pool(ctx, rnd, x, y + ry * 0.08, rx * 0.86, ry * 0.76, mix(meat, '#c4553f', 0.45), 0.45, 2, 0.12, false, 'over');
      ctx.save();
      ctx.globalAlpha = 0.95; ctx.fillStyle = bark;
      // the band follows the slice's own edge, so the bark never grows ears
      ctx.beginPath();
      ctx.moveTo(x - rx * 0.8, y - ry * 0.6);
      ctx.quadraticCurveTo(x, y - ry * 1.18, x + rx * 0.8, y - ry * 0.6);
      ctx.quadraticCurveTo(x, y - ry * 0.7, x - rx * 0.8, y - ry * 0.6);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      dots(ctx, rnd, x, y - ry * 0.8, rx * 0.44, 9, Math.max(1.2, ry * 0.1), shade(bark, 0.26), 0.42);
      sheen(ctx, x - rx * 0.2, y + ry * 0.12, rx * 0.45, ry * 0.24, 0, 0.4);
      ctx.restore();
    }

    /* a pickle chip: crinkle rim, pale heart */
    function pickle(ctx, rnd, x, y, r, color) {
      shadowEllipse(ctx, x + r * 0.12, y + r * 0.3, r * 0.9, r * 0.7, 0.3, 6);
      ctx.save();
      ctx.globalAlpha = 0.96; ctx.fillStyle = color;
      ctx.beginPath();
      for (var i = 0; i <= 16; i++) {
        var a = (i / 16) * 6.283, k = 1 + (i % 2 ? 0.08 : -0.08);
        var px2 = x + Math.cos(a) * r * k, py2 = y + Math.sin(a) * r * k * 0.92;
        if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
      }
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.65; ctx.fillStyle = shade(color, 0.36);
      ctx.beginPath(); ctx.ellipse(x, y, r * 0.54, r * 0.5, 0, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 0.45; ctx.fillStyle = shade(color, -0.14);
      ctx.beginPath(); ctx.ellipse(x, y, r * 0.24, r * 0.22, 0, 0, 6.283); ctx.fill();
      ctx.restore();
      sheen(ctx, x - r * 0.2, y - r * 0.26, r * 0.4, r * 0.16, -0.3, 0.4);
    }

    function olive(ctx, rnd, x, y, r, color) {
      shadowEllipse(ctx, x + r * 0.12, y + r * 0.34, r * 0.9, r * 0.7, 0.3, 5);
      pool(ctx, rnd, x, y, r, r * 0.86, color, 0.97, 2, 0.07, true, 'over');
      ctx.save();
      ctx.globalAlpha = 0.5; ctx.fillStyle = shade(color, -0.45);
      ctx.beginPath(); ctx.ellipse(x, y, r * 0.3, r * 0.26, 0, 0, 6.283); ctx.fill();
      ctx.restore();
      sheen(ctx, x - r * 0.26, y - r * 0.3, r * 0.34, r * 0.16, -0.4, 0.55);
    }

    /* a cube: feta, tofu, halloumi */
    function cube(ctx, rnd, x, y, r, ang, color) {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      shadowEllipse(ctx, r * 0.12, r * 0.52, r * 0.9, r * 0.4, 0.3, 6);
      var g = ctx.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, shade(color, 0.24)); g.addColorStop(1, shade(color, -0.22));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-r * 0.9, -r * 0.72); ctx.lineTo(r * 0.92, -r * 0.8);
      ctx.lineTo(r * 0.84, r * 0.78); ctx.lineTo(-r * 0.86, r * 0.7);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.32; ctx.strokeStyle = shade(color, -0.4); ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
      sheen(ctx, x - r * 0.2, y - r * 0.3, r * 0.4, r * 0.2, 0, 0.4);
    }

    function friedEgg(ctx, rnd, x, y, r) {
      shadowEllipse(ctx, x + r * 0.12, y + r * 0.34, r * 0.95, r * 0.7, 0.3, 8);
      pool(ctx, rnd, x, y, r, r * 0.88, '#fbf3e0', 0.98, 3, 0.17, true, 'over');
      pool(ctx, rnd, x + r * 0.06, y - r * 0.04, r * 0.4, r * 0.36, '#e8a733', 0.97, 2, 0.06, true, 'over');
      sheen(ctx, x - r * 0.02, y - r * 0.16, r * 0.2, r * 0.1, -0.3, 0.62);
    }

    /* strands combed across a surface */
    function noodles(ctx, rnd, x, y, rx, ry, color, n) {
      for (var i = 0; i < n; i++) {
        var y0 = y - ry * 0.7 + (i / (n - 1)) * ry * 1.4 + (rnd() - 0.5) * ry * 0.12;
        var x0 = x - rx * (0.4 + rnd() * 0.5), x1 = x + rx * (0.3 + rnd() * 0.5);
        stroke(ctx, [[x0, y0],
                     [x0 + (x1 - x0) * 0.35, y0 - ry * 0.1 + rnd() * ry * 0.2],
                     [x0 + (x1 - x0) * 0.7, y0 + ry * 0.09 - rnd() * ry * 0.18],
                     [x1, y0 + (rnd() - 0.5) * ry * 0.1]],
               shade(color, 0.04 + rnd() * 0.18), rx * (0.032 + rnd() * 0.018), 0.82, 'round', 'over');
      }
    }

    function herbs(ctx, rnd, x, y, spread, n, size, f) {
      for (var i = 0; i < n; i++) {
        var a = rnd() * 6.283, d = Math.sqrt(rnd()) * spread;
        leaf(ctx, rnd, x + Math.cos(a) * d, y + Math.sin(a) * d,
             size * (0.8 + rnd() * 0.6), size * (0.28 + rnd() * 0.22), rnd() * 3.14,
             mix(f.fresh, '#4e6a3c', rnd() * 0.55), 0.88);
      }
    }

    /* a wiped smear of sauce — a plate note, never a mound */
    function smear(ctx, rnd, x, y, rx, ry, color, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha == null ? 0.7 : alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - rx, y);
      ctx.quadraticCurveTo(x - rx * 0.4, y - ry * 1.5, x + rx * 0.2, y - ry * 0.6);
      ctx.quadraticCurveTo(x + rx * 0.9, y + ry * 0.1, x + rx, y + ry * 0.5);
      ctx.quadraticCurveTo(x + rx * 0.2, y + ry * 1.15, x - rx, y);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      dots(ctx, rnd, x + rx * 0.5, y, rx * 0.4, 5, Math.max(1.2, ry * 0.2), shade(color, -0.2), 0.45);
    }

    /* a drizzle spooned over a dish: two short ribbons that break, not one
       continuous rope looping the whole plate (which reads as string) */
    function drizzleArc(ctx, rnd, x, y, r, color, w, alpha) {
      var a0 = rnd() * 6.283, k, i;
      for (k = 0; k < 2; k++) {
        var pts = [], span = 1.5 + rnd() * 0.9, st = a0 + k * (2.5 + rnd() * 0.9);
        for (i = 0; i <= 5; i++) {
          var a = st + (i / 5) * span;
          var rr = r * (0.7 + (i % 2 ? 0.13 : -0.09));
          pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.94]);
        }
        stroke(ctx, pts, color, w * (0.75 + rnd() * 0.35),
               (alpha == null ? 0.62 : alpha) * 0.85, 'round', 'over');
      }
    }

    function chillis(ctx, rnd, x, y, spread, n, r, color) {
      ctx.save();
      for (var i = 0; i < n; i++) {
        var a = rnd() * 6.283, d = Math.sqrt(rnd()) * spread;
        var px2 = x + Math.cos(a) * d, py2 = y + Math.sin(a) * d;
        ctx.globalAlpha = 0.9; ctx.fillStyle = color;
        ctx.beginPath(); ctx.ellipse(px2, py2, r, r * 0.82, rnd() * 3, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 0.55; ctx.fillStyle = shade(color, 0.42);
        ctx.beginPath(); ctx.ellipse(px2, py2, r * 0.44, r * 0.34, 0, 0, 6.283); ctx.fill();
      }
      ctx.restore();
    }

    /* a little dish of dipping sauce, seen from above */
    function dipDish(ctx, rnd, x, y, r, sauce) {
      shadowEllipse(ctx, x + r * 0.12, y + r * 0.3, r, r * 0.9, 0.34, 8);
      ctx.save();
      var g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.05, x, y, r * 1.1);
      g.addColorStop(0, '#fffdf6'); g.addColorStop(1, '#d6cab2');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.96, 0, 0, 6.283); ctx.fill();
      ctx.restore();
      pool(ctx, rnd, x, y, r * 0.66, r * 0.62, sauce, 0.95, 2, 0.08, true, 'over');
      sheen(ctx, x - r * 0.2, y - r * 0.24, r * 0.3, r * 0.12, -0.4, 0.5);
    }

    /* scattered batons: fries, pickled sticks, skewered things */
    function sticks(ctx, rnd, x, y, spread, n, len, w, color) {
      for (var i = 0; i < n; i++) {
        var a = rnd() * 6.283, d = Math.sqrt(rnd()) * spread;
        var px2 = x + Math.cos(a) * d, py2 = y + Math.sin(a) * d;
        var ang = rnd() * 3.14;
        var dx = Math.cos(ang) * len * 0.5, dy = Math.sin(ang) * len * 0.5;
        shadowEllipse(ctx, px2 + 2, py2 + 5, len * 0.42, w * 0.7, 0.3, 6);
        stroke(ctx, [[px2 - dx, py2 - dy], [px2 + dx, py2 + dy]],
               shade(color, (rnd() - 0.4) * 0.3), w, 0.96, 'butt', 'over');
        stroke(ctx, [[px2 - dx * 0.7, py2 - dy * 0.7], [px2 + dx * 0.6, py2 + dy * 0.6]],
               shade(color, 0.32), w * 0.3, 0.5, 'butt', 'light');
      }
    }

    /* a translucent rice-paper roll, filling glowing through it */
    function riceRoll(ctx, rnd, x, y, rx, ry, ang, f) {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang); ctx.translate(-x, -y);
      shadowEllipse(ctx, x + rx * 0.3, y + ry * 0.2, rx * 0.95, ry * 0.9, 0.34, 9);
      pool(ctx, rnd, x, y, rx, ry, '#f2ecdc', 0.94, 2, 0.05, true, 'over');
      pool(ctx, rnd, x, y - ry * 0.24, rx * 0.62, ry * 0.34, mix(f.fresh, '#8ab45a', 0.35), 0.5, 2, 0.16, false, 'over');
      pool(ctx, rnd, x, y + ry * 0.26, rx * 0.58, ry * 0.28, mix(f.deep, '#d4907a', 0.6), 0.55, 2, 0.16, false, 'over');
      sheen(ctx, x - rx * 0.3, y - ry * 0.1, rx * 0.42, ry * 0.6, 0, 0.42);
      ctx.restore();
    }

    /* ---- the stage: run a cuisine's plate kit -----------------------
       `sq` squashes the vertical axis, so one kit reads flat from above
       (sq 1, the plate archetype) and in perspective on a table (sq ~0.45,
       the table archetype) without being written twice. */
    function stagePlate(ctx, rnd, f, cx, cy, r, sq) {
      ctx.save();
      if (sq !== 1) { ctx.translate(cx, cy); ctx.scale(1, sq); ctx.translate(-cx, -cy); }
      (f.kit.plate || plateGeneric)(ctx, rnd, f, cx, cy, r);
      ctx.restore();
    }

    /* ---- generic fallbacks (a cuisine with no kit still eats) ---- */
    function plateGeneric(ctx, rnd, f, cx, cy, fr) {
      shadowEllipse(ctx, cx + 4, cy + fr * 0.30, fr * 0.95, fr * 0.7, 0.28, 12);
      pool(ctx, rnd, cx + fr * 0.04, cy + fr * 0.06, fr * 1.02, fr * 0.94, f.main, 0.62, 3, 0.17, true, 'over');
      pool(ctx, rnd, cx, cy - fr * 0.04, fr * 0.72, fr * 0.64, f.deep, 0.9, 3, 0.14, true, 'over');
      pool(ctx, rnd, cx - fr * 0.20, cy - fr * 0.20, fr * 0.38, fr * 0.32, shade(f.main, 0.22), 0.7, 2, 0.18, true, 'over');
      var pieces = 5 + Math.floor(rnd() * 2), i;
      for (i = 0; i < pieces; i++) {
        var a = -2.1 + (i / (pieces - 1)) * 4.9 + (rnd() - 0.5) * 0.26;
        var d = fr * (0.66 + rnd() * 0.14);
        var px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d * 0.94;
        piece(ctx, rnd, px, py, fr * 0.30, fr * 0.21, i % 2 ? f.deep : shade(f.main, -0.16), 0.14);
      }
      herbs(ctx, rnd, cx, cy, fr * 0.9, 14, fr * 0.17, f);
      stroke(ctx, [[cx - fr * 0.92, cy + fr * 0.34], [cx - fr * 0.2, cy + fr * 0.62],
                   [cx + fr * 0.4, cy + fr * 0.26], [cx + fr * 0.95, cy + fr * 0.52]],
             shade(warmOf(f.accent), 0.12), 3.5, 0.55, 'round', 'over');
      dots(ctx, rnd, cx, cy, fr * 0.85, 26, 2.6, shade(f.deep, -0.25), 0.75);
      dots(ctx, rnd, cx - fr * 0.1, cy - fr * 0.18, fr * 0.55, 12, 2.4, '#fff6e2', 0.7);
      sheen(ctx, cx - fr * 0.35, cy - fr * 0.42, fr * 0.5, fr * 0.2, -0.5, 0.34);
    }

    function bowlGeneric(ctx, rnd, f, cx, cy, r) {
      noodles(ctx, rnd, cx, cy, r * 0.8, r * 0.5, f.cream, 8);
      piece(ctx, rnd, cx - r * 0.36, cy - r * 0.16, r * 0.3, r * 0.3, f.deep, 0.1);
      piece(ctx, rnd, cx - r * 0.04, cy + r * 0.24, r * 0.26, r * 0.26, shade(f.deep, 0.12), 0.1);
      var ex = cx + r * 0.44, ey = cy - r * 0.1;
      shadowEllipse(ctx, ex + 2, ey + 4, r * 0.21, r * 0.24, 0.3, 8);
      pool(ctx, rnd, ex, ey, r * 0.21, r * 0.25, '#fbf3e0', 0.98, 2, 0.05, true, 'over');
      pool(ctx, rnd, ex, ey + r * 0.02, r * 0.11, r * 0.13, '#e8a733', 0.96, 2, 0.07, true, 'over');
      sheen(ctx, ex - r * 0.05, ey - r * 0.08, r * 0.09, r * 0.04, -0.2, 0.55);
      ctx.save();
      ctx.globalAlpha = 0.94;
      ctx.fillStyle = mix(f.fresh, '#141c1e', 0.7);
      ctx.translate(cx + r * 0.1, cy - r * 0.5); ctx.rotate(-0.26);
      blobPath(ctx, rnd, 0, 0, r * 0.17, r * 0.3, 0.06, 0.2, 10); ctx.fill();
      ctx.restore();
      herbs(ctx, rnd, cx, cy, r * 0.62, 12, r * 0.12, f);
      dots(ctx, rnd, cx + r * 0.05, cy + r * 0.1, r * 0.65, 16, 3, shade(warmOf(f.accent), -0.05), 0.8);
    }

    function stackGeneric(ctx, rnd, f, cx, base, wdt, slab, dome) {
      var y = base;
      y -= wdt * 0.14; slab(y, wdt * 1.00, wdt * 0.15, mix(f.cream, '#c98b3f', 0.38), false);
      y -= wdt * 0.22; slab(y, wdt * 1.08, wdt * 0.19, f.deep, false);
      dots(ctx, rnd, cx, y + wdt * 0.06, wdt * 0.8, 16, 2.4, shade(f.deep, -0.4), 0.7);
      y -= wdt * 0.21; slab(y, wdt * 1.12, wdt * 0.11, shade(warmOf(f.accent), 0.06), true);
      y -= wdt * 0.14; slab(y, wdt * 1.18, wdt * 0.10, f.fresh, true);
      y -= wdt * 0.15; slab(y, wdt * 1.02, wdt * 0.11, f.main, false);
      y -= wdt * 0.30;
      dome(y, wdt, mix(f.cream, '#c98b3f', 0.5), true);
      for (var s = 0; s < 6; s++) {
        var sx = cx + wdt * (0.9 + rnd() * 0.42), sy = base + 6 - rnd() * 16;
        stroke(ctx, [[sx, sy], [sx + 10 - rnd() * 20, sy - 22 - rnd() * 22]],
               shade(warmOf(f.accent), -0.02), 10, 0.92, 'round', 'over');
      }
    }

    function cropOver(ctx, rnd, f) {
      var n = 9 + Math.floor(rnd() * 4), i;
      for (i = 0; i < n; i++) {
        var tx = W * (0.1 + rnd() * 0.8), ty = H * (0.06 + rnd() * 0.44);
        var rr = W * (0.06 + rnd() * 0.045);
        piece(ctx, rnd, tx, ty, rr, rr * 0.86, f.deep, 0.11);
      }
      for (i = 0; i < 15; i++) {
        leaf(ctx, rnd, W * (0.05 + rnd() * 0.9), H * (0.04 + rnd() * 0.5),
             W * (0.032 + rnd() * 0.036), W * (0.012 + rnd() * 0.012), rnd() * 3.14,
             mix(f.fresh, '#4e6a3c', rnd() * 0.55), 0.85);
      }
      dots(ctx, rnd, W * 0.5, H * 0.3, W * 0.55, 34, 2.4, shade(f.deep, -0.35), 0.45);
    }

    /* ---- shared food pigments (things that are that colour whatever
       the cuisine's palette says: rice is not blue, lime is not gold) ---- */
    var RICE = '#f6efdb', CREAMY = '#f7f0e0';
    var LIME_R = '#9bb84e', LIME_F = '#d7e39a';
    var LEM_R = '#dfc451', LEM_F = '#f2e8a8';
    var CHARC = '#3a2a20';

    /* ================================================================
     * CUISINE KITS — what is actually on the plate / in the bowl.
     * Each kit is a bag of optional painters; a missing one falls back to
     * the generic composition above. Every position and count is drawn
     * from the seeded rng, so a place always paints the same way and two
     * places of one cuisine never line up identically.
     * ================================================================ */

    /* -- seafood: shells, a fillet, citrus. No red sauce, ever. -- */
    function plateSeafood(ctx, rnd, f, cx, cy, r) {
      var shellCol = mix(f.table, '#efe8d8', 0.74);
      pool(ctx, rnd, cx, cy + r * 0.06, r * 1.0, r * 0.9, shade(f.cream, -0.05), 0.45, 3, 0.22, false, 'over');
      var n = 3 + Math.floor(rnd() * 2), i;
      for (i = 0; i < n; i++) {
        var a = -2.55 + (i / (n - 1)) * 4.6 + (rnd() - 0.5) * 0.26;
        var d = r * (0.6 + rnd() * 0.14);
        oyster(ctx, rnd, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9, r * 0.29, a + 1.57, shellCol, f.main);
      }
      fillet(ctx, rnd, cx - r * 0.06, cy - r * 0.06, r * 0.44, r * 0.28, -0.22, f.main);
      prawn(ctx, rnd, cx + r * 0.36, cy + r * 0.34, r * 0.3, 1.9 + rnd() * 0.6, shade(f.deep, 0.18));
      shellFan(ctx, rnd, cx + r * 0.6, cy - r * 0.46, r * 0.26, 0.4 + rnd() * 0.4, shellCol);
      citrusHalf(ctx, rnd, cx - r * 0.62, cy + r * 0.44, r * 0.21, LEM_R);
      herbs(ctx, rnd, cx, cy, r * 0.8, 9, r * 0.14, f);
      dots(ctx, rnd, cx, cy, r * 0.85, 12, 2.0, '#fff6e2', 0.6);
    }

    function bowlSeafood(ctx, rnd, f, cx, cy, r) {
      var shellCol = mix(f.table, '#efe8d8', 0.72);
      pool(ctx, rnd, cx, cy, r * 1.06, r * 1.06, shade(f.cream, -0.06), 0.82, 3, 0.1, false, 'over');
      var n = 3 + Math.floor(rnd() * 2), i;
      for (i = 0; i < n; i++) {
        var a = -2.3 + (i / (n - 1)) * 4.2 + (rnd() - 0.5) * 0.3;
        shellFan(ctx, rnd, cx + Math.cos(a) * r * 0.52, cy + Math.sin(a) * r * 0.48,
                 r * 0.26, a + 1.4, mix(shellCol, CHARC, 0.35));
      }
      prawn(ctx, rnd, cx - r * 0.1, cy - r * 0.1, r * 0.32, 2.4, shade(f.deep, 0.2));
      piece(ctx, rnd, cx + r * 0.3, cy + r * 0.22, r * 0.16, r * 0.14, mix(f.cream, '#e0c07a', 0.4), 0.2);
      piece(ctx, rnd, cx - r * 0.36, cy + r * 0.3, r * 0.14, r * 0.13, mix(f.cream, '#e0c07a', 0.4), 0.2);
      herbs(ctx, rnd, cx, cy, r * 0.62, 10, r * 0.12, f);
      wedge(ctx, rnd, cx + r * 0.5, cy - r * 0.42, r * 0.2, -0.5, LEM_R, LEM_F);
      dots(ctx, rnd, cx, cy, r * 0.7, 10, 2.2, '#fff6e2', 0.5);
    }

    /* -- japanese: a composed set, not a saucy heap -- */
    function plateJapanese(ctx, rnd, f, cx, cy, r) {
      var n = 3 + Math.floor(rnd() * 2), i;
      for (i = 0; i < n; i++) {
        var x = cx - r * 0.48 + (i / (n - 1)) * r * 0.96 + (rnd() - 0.5) * r * 0.06;
        var y = cy - r * 0.16 + (i % 2 ? r * 0.12 : -r * 0.04) + (rnd() - 0.5) * r * 0.06;
        nigiri(ctx, rnd, x, y, r * 0.29, -0.22 + rnd() * 0.44,
               i % 2 ? mix(f.main, '#e2895a', 0.55) : mix(f.deep, '#d99a6a', 0.4));
      }
      for (i = 0; i < 2; i++) {
        var mx = cx - r * 0.32 + i * r * 0.46, my = cy + r * 0.54;
        piece(ctx, rnd, mx, my, r * 0.2, r * 0.19, '#f7efdc', 0.06);
        ctx.save();
        ctx.globalAlpha = 0.9; ctx.strokeStyle = mix(f.fresh, '#141c1e', 0.78);
        ctx.lineWidth = Math.max(2, r * 0.055);
        ctx.beginPath(); ctx.ellipse(mx, my, r * 0.18, r * 0.17, 0, 0, 6.283); ctx.stroke();
        ctx.restore();
        pool(ctx, rnd, mx, my, r * 0.085, r * 0.08, shade(f.main, -0.06), 0.9, 2, 0.12, false, 'over');
      }
      dipDish(ctx, rnd, cx + r * 0.64, cy + r * 0.5, r * 0.2, mix(f.deep, '#241812', 0.62));
      pool(ctx, rnd, cx - r * 0.72, cy + r * 0.14, r * 0.1, r * 0.09, mix(f.fresh, '#a8c86a', 0.5), 0.95, 2, 0.24, true, 'over');
      for (i = 0; i < 5; i++) {
        leaf(ctx, rnd, cx - r * 0.68 + rnd() * r * 0.22, cy - r * 0.24 + rnd() * r * 0.18,
             r * 0.2, r * 0.055, 0.3 + rnd(), mix(f.accent, '#f4d8de', 0.45), 0.9);
      }
      dots(ctx, rnd, cx, cy, r * 0.7, 12, 1.8, '#fff6e2', 0.55);
    }

    function bowlJapanese(ctx, rnd, f, cx, cy, r) { bowlGeneric(ctx, rnd, f, cx, cy, r); }

    /* -- italian: a nest of pasta under sauce, cheese, basil -- */
    function plateItalian(ctx, rnd, f, cx, cy, r) {
      pool(ctx, rnd, cx, cy + r * 0.04, r * 0.98, r * 0.9, shade(f.main, -0.14), 0.55, 3, 0.2, true, 'over');
      var i, k;
      for (i = 0; i < 15; i++) {
        var a = rnd() * 6.283, rr = r * (0.18 + rnd() * 0.55), pts = [];
        for (k = 0; k <= 5; k++) {
          var t = a + (k / 5) * (2.0 + rnd() * 1.4);
          pts.push([cx + Math.cos(t) * rr * (0.9 + rnd() * 0.2),
                    cy + Math.sin(t) * rr * (0.85 + rnd() * 0.2)]);
        }
        stroke(ctx, pts, shade(f.cream, -0.04 + rnd() * 0.22), r * 0.05, 0.9, 'round', 'over');
      }
      pool(ctx, rnd, cx + r * 0.04, cy - r * 0.02, r * 0.46, r * 0.4, f.deep, 0.88, 3, 0.24, true, 'over');
      var n = 2 + Math.floor(rnd() * 2);
      for (i = 0; i < n; i++) {
        piece(ctx, rnd, cx + (rnd() - 0.5) * r * 0.9, cy + (rnd() - 0.4) * r * 0.7,
              r * 0.17, r * 0.15, mix(f.deep, '#6a3a24', 0.4), 0.13);
      }
      herbs(ctx, rnd, cx, cy, r * 0.8, 9, r * 0.17, f);
      dots(ctx, rnd, cx, cy, r * 0.8, 26, 2.2, '#fdf6e4', 0.72);
      drizzleArc(ctx, rnd, cx, cy, r * 0.72, shade(warmOf(f.accent), 0.1), 3.2, 0.5);
    }

    /* -- mexican: folded tortillas, filling edge showing, lime, crema -- */
    function plateMexican(ctx, rnd, f, cx, cy, r) {
      smear(ctx, rnd, cx - r * 0.05, cy + r * 0.6, r * 0.72, r * 0.18, mix(f.deep, '#38200f', 0.45), 0.55);
      var n = 2 + Math.floor(rnd() * 2), i;
      for (i = 0; i < n; i++) {
        var x = cx + (n === 1 ? 0 : (-r * 0.4 + (i / (n - 1)) * r * 0.8));
        fold(ctx, rnd, x, cy - r * 0.04 + (rnd() - 0.5) * r * 0.12, r * 0.44,
             -0.18 + rnd() * 0.36, mix(f.cream, '#e0bd7a', 0.45), shade(f.deep, 0.08), f.fresh);
      }
      wedge(ctx, rnd, cx + r * 0.66, cy + r * 0.46, r * 0.21, -0.5 + rnd() * 0.4, LIME_R, LIME_F);
      drizzleArc(ctx, rnd, cx, cy + r * 0.08, r * 0.62, CREAMY, r * 0.042, 0.8);
      dots(ctx, rnd, cx - r * 0.5, cy + r * 0.5, r * 0.3, 12, Math.max(1.6, r * 0.045), shade(f.main, -0.18), 0.8);
      herbs(ctx, rnd, cx, cy - r * 0.1, r * 0.8, 10, r * 0.12, f);
    }

    /* -- indian: a curry pool, a rice mound, a folded flatbread -- */
    function plateIndian(ctx, rnd, f, cx, cy, r) {
      pool(ctx, rnd, cx + r * 0.34, cy - r * 0.02, r * 0.58, r * 0.52, f.main, 0.92, 3, 0.16, true, 'over');
      pool(ctx, rnd, cx + r * 0.3, cy - r * 0.08, r * 0.36, r * 0.3, f.deep, 0.75, 2, 0.22, true, 'over');
      var i;
      for (i = 0; i < 3; i++) {
        piece(ctx, rnd, cx + r * (0.16 + rnd() * 0.38), cy + r * (-0.16 + rnd() * 0.32),
              r * 0.13, r * 0.11, shade(f.deep, 0.14), 0.18);
      }
      drizzleArc(ctx, rnd, cx + r * 0.34, cy - r * 0.02, r * 0.36, CREAMY, Math.max(2, r * 0.028), 0.7);
      mound(ctx, rnd, cx - r * 0.44, cy - r * 0.06, r * 0.42, r * 0.36, RICE);
      dots(ctx, rnd, cx - r * 0.44, cy - r * 0.06, r * 0.3, 8, Math.max(1.4, r * 0.035), shade(warmOf(f.accent), -0.1), 0.6);
      flatbread(ctx, rnd, cx + r * 0.04, cy + r * 0.64, r * 0.5, r * 0.24, -0.14 + rnd() * 0.28,
                mix(f.cream, '#d9a856', 0.48));
      herbs(ctx, rnd, cx + r * 0.3, cy, r * 0.42, 7, r * 0.12, f);
    }

    function bowlIndian(ctx, rnd, f, cx, cy, r) {
      pool(ctx, rnd, cx, cy, r * 0.92, r * 0.92, f.main, 0.9, 3, 0.1, false, 'over');
      pool(ctx, rnd, cx - r * 0.14, cy - r * 0.1, r * 0.5, r * 0.44, f.deep, 0.6, 3, 0.2, false, 'over');
      var i;
      for (i = 0; i < 5; i++) {
        piece(ctx, rnd, cx + (rnd() - 0.5) * r * 1.1, cy + (rnd() - 0.5) * r * 1.0,
              r * 0.15, r * 0.13, i % 2 ? shade(f.deep, 0.16) : mix(f.cream, '#d8b45e', 0.4), 0.2);
      }
      drizzleArc(ctx, rnd, cx, cy, r * 0.56, CREAMY, Math.max(2.4, r * 0.032), 0.78);
      mound(ctx, rnd, cx - r * 0.44, cy + r * 0.3, r * 0.3, r * 0.26, RICE);
      herbs(ctx, rnd, cx, cy, r * 0.6, 9, r * 0.12, f);
      dots(ctx, rnd, cx, cy, r * 0.6, 10, 2.2, shade(warmOf(f.accent), 0.1), 0.65);
    }

    /* -- mediterranean: grain, olives, feta, a wedge, herbed oil -- */
    function plateMediterranean(ctx, rnd, f, cx, cy, r) {
      grainBed(ctx, rnd, cx, cy + r * 0.04, r * 0.86, r * 0.74, mix(f.cream, '#dcc182', 0.45));
      var i, n = 5 + Math.floor(rnd() * 3);
      for (i = 0; i < n; i++) {
        olive(ctx, rnd, cx + (rnd() - 0.5) * r * 1.3, cy + (rnd() - 0.5) * r * 1.1,
              r * 0.1, mix(f.fresh, '#2a3326', 0.6));
      }
      for (i = 0; i < 3; i++) {
        cube(ctx, rnd, cx + (rnd() - 0.5) * r * 1.1, cy + (rnd() - 0.5) * r * 0.9, r * 0.12, rnd() * 1.2, '#f0e8d6');
      }
      for (i = 0; i < 3; i++) {
        piece(ctx, rnd, cx + (rnd() - 0.5) * r * 1.1, cy + (rnd() - 0.5) * r * 0.9,
              r * 0.15, r * 0.12, mix(f.deep, '#c4713a', 0.45), 0.2);
      }
      wedge(ctx, rnd, cx - r * 0.6, cy + r * 0.5, r * 0.22, 0.3 + rnd() * 0.3, LEM_R, LEM_F);
      drizzleArc(ctx, rnd, cx, cy, r * 0.74, mix(f.fresh, '#8aa84e', 0.45), Math.max(2.2, r * 0.028), 0.66);
      herbs(ctx, rnd, cx, cy, r * 0.85, 11, r * 0.13, f);
    }

    function bowlMediterranean(ctx, rnd, f, cx, cy, r) {
      grainBed(ctx, rnd, cx, cy, r * 0.92, r * 0.92, mix(f.cream, '#dcc182', 0.45));
      var i;
      for (i = 0; i < 6; i++) {
        olive(ctx, rnd, cx + (rnd() - 0.5) * r * 1.3, cy + (rnd() - 0.5) * r * 1.2, r * 0.1,
              mix(f.fresh, '#2a3326', 0.6));
      }
      for (i = 0; i < 3; i++) cube(ctx, rnd, cx + (rnd() - 0.5) * r * 1.2, cy + (rnd() - 0.5) * r * 1.0, r * 0.12, rnd() * 1.2, '#f0e8d6');
      for (i = 0; i < 8; i++) {
        piece(ctx, rnd, cx + (rnd() - 0.5) * r * 1.2, cy + (rnd() - 0.5) * r * 1.0,
              r * 0.09, r * 0.085, mix(f.cream, '#d8b45e', 0.5), 0.2);
      }
      wedge(ctx, rnd, cx + r * 0.5, cy - r * 0.4, r * 0.2, -0.4, LEM_R, LEM_F);
      drizzleArc(ctx, rnd, cx, cy, r * 0.6, mix(f.fresh, '#8aa84e', 0.45), Math.max(2.2, r * 0.028), 0.66);
      herbs(ctx, rnd, cx, cy, r * 0.7, 12, r * 0.12, f);
    }

    /* -- bbq: sliced meat with a bark edge, pickles, slaw -- */
    function plateBbq(ctx, rnd, f, cx, cy, r) {
      smear(ctx, rnd, cx + r * 0.1, cy + r * 0.58, r * 0.66, r * 0.17, shade(warmOf(f.accent), -0.28), 0.6);
      var n = 3 + Math.floor(rnd() * 2), i;
      for (i = 0; i < n; i++) {
        meatSlice(ctx, rnd, cx - r * 0.4 + (i / (n - 1)) * r * 0.78,
                  cy - r * 0.06 + (rnd() - 0.5) * r * 0.12, r * 0.28, r * 0.46,
                  -0.12 + rnd() * 0.24, f.main, mix(f.deep, '#221410', 0.55));
      }
      pool(ctx, rnd, cx - r * 0.62, cy + r * 0.5, r * 0.28, r * 0.2, '#f2ead6', 0.92, 2, 0.24, true, 'over');
      for (i = 0; i < 9; i++) {
        var sx = cx - r * 0.62 + (rnd() - 0.5) * r * 0.4, sy = cy + r * 0.5 + (rnd() - 0.5) * r * 0.28;
        stroke(ctx, [[sx - r * 0.08, sy], [sx + r * 0.09, sy + (rnd() - 0.5) * r * 0.06]],
               mix(f.fresh, '#c8d09a', rnd() * 0.6), Math.max(1.6, r * 0.025), 0.85, 'round', 'over');
      }
      pickle(ctx, rnd, cx + r * 0.6, cy + r * 0.4, r * 0.14, mix(f.fresh, '#7a9440', 0.5));
      pickle(ctx, rnd, cx + r * 0.74, cy + r * 0.6, r * 0.12, mix(f.fresh, '#7a9440', 0.5));
      dots(ctx, rnd, cx, cy - r * 0.1, r * 0.6, 12, 2.0, CHARC, 0.4);
    }

    function stackBbq(ctx, rnd, f, cx, base, wdt, slab, dome) {
      var y = base;
      y -= wdt * 0.12; slab(y, wdt * 1.06, wdt * 0.12, mix(f.cream, '#e0cba0', 0.5), false);  // white bread
      var n = 4 + Math.floor(rnd() * 2), i;
      for (i = 0; i < n; i++) {
        y -= wdt * 0.16;
        slab(y, wdt * (1.02 + rnd() * 0.12), wdt * 0.10, shade(f.main, -0.04 + rnd() * 0.16), false);
        ctx.save();
        ctx.globalAlpha = 0.8;
        stroke(ctx, [[cx - wdt * 0.99, y - wdt * 0.08], [cx, y - wdt * 0.12], [cx + wdt * 0.99, y - wdt * 0.07]],
               mix(f.deep, '#221410', 0.5), wdt * 0.09, 0.92, 'round', 'over');
        ctx.restore();
      }
      // pickle chips laid on the top slice and spilling onto the plate
      var pk = mix(f.fresh, '#7a9440', 0.5), s;
      for (s = 0; s < 3; s++) {
        pickle(ctx, rnd, cx + wdt * (-0.5 + s * 0.5 + (rnd() - 0.5) * 0.22),
               y - wdt * (0.12 + rnd() * 0.06), wdt * 0.2, pk);
      }
      for (s = 0; s < 3; s++) {
        pickle(ctx, rnd, cx + wdt * (0.95 + rnd() * 0.45), base - wdt * (0.02 + rnd() * 0.3), wdt * 0.17, pk);
      }
      stroke(ctx, [[cx - wdt * 1.2, base - wdt * 0.1], [cx - wdt * 0.7, base - wdt * 0.22]],
             shade(warmOf(f.accent), -0.24), wdt * 0.1, 0.6, 'round', 'over');
    }

    /* -- korean: rice and banchan, an egg, chilli -- */
    function plateKorean(ctx, rnd, f, cx, cy, r) {
      mound(ctx, rnd, cx, cy, r * 0.44, r * 0.4, RICE);
      var cols = [mix(f.main, '#d4453a', 0.35), mix(f.fresh, '#6a9440', 0.35), shade(f.deep, 0.12),
                  mix(f.cream, '#d9c08a', 0.45), mix(warmOf(f.accent), '#e0a83a', 0.35)];
      var n = 5, i, k;
      for (i = 0; i < n; i++) {
        var a = -1.95 + (i / (n - 1)) * 5.1 + (rnd() - 0.5) * 0.18;
        var x = cx + Math.cos(a) * r * 0.68, y = cy + Math.sin(a) * r * 0.64;
        var col = cols[i % cols.length];
        shadowEllipse(ctx, x + 2, y + r * 0.06, r * 0.24, r * 0.18, 0.3, 8);
        pool(ctx, rnd, x, y, r * 0.26, r * 0.2, col, 0.94, 2, 0.24, true, 'over');
        if (i % 2) {
          for (k = 0; k < 5; k++) {
            stroke(ctx, [[x - r * 0.19, y - r * 0.07 + k * r * 0.035],
                         [x + r * 0.19, y - r * 0.09 + k * r * 0.038]],
                   shade(col, -0.22), Math.max(1.2, r * 0.02), 0.6, 'round', 'over');
          }
        }
        sheen(ctx, x - r * 0.07, y - r * 0.06, r * 0.14, r * 0.05, -0.3, 0.4);
      }
      friedEgg(ctx, rnd, cx + r * 0.04, cy - r * 0.04, r * 0.24);
      chillis(ctx, rnd, cx, cy, r * 0.72, 7, Math.max(2, r * 0.05), mix(f.main, '#d4453a', 0.4));
      dots(ctx, rnd, cx, cy, r * 0.7, 16, 2.0, '#fff6e2', 0.6);
    }

    function bowlKorean(ctx, rnd, f, cx, cy, r) {
      grainBed(ctx, rnd, cx, cy, r * 0.92, r * 0.92, RICE);
      var cols = [mix(f.main, '#d4453a', 0.35), mix(f.fresh, '#6a9440', 0.35), shade(f.deep, 0.12),
                  mix(f.cream, '#d9c08a', 0.45)];
      var i;
      for (i = 0; i < 5; i++) {
        var a = -1.9 + (i / 4) * 5.0 + (rnd() - 0.5) * 0.2;
        var x = cx + Math.cos(a) * r * 0.56, y = cy + Math.sin(a) * r * 0.54;
        pool(ctx, rnd, x, y, r * 0.28, r * 0.22, cols[i % cols.length], 0.94, 2, 0.26, true, 'over');
        sheen(ctx, x - r * 0.08, y - r * 0.07, r * 0.14, r * 0.06, -0.3, 0.4);
      }
      friedEgg(ctx, rnd, cx, cy - r * 0.02, r * 0.26);
      chillis(ctx, rnd, cx, cy, r * 0.6, 6, Math.max(2, r * 0.05), mix(f.main, '#d4453a', 0.4));
      herbs(ctx, rnd, cx, cy, r * 0.6, 6, r * 0.1, f);
      dots(ctx, rnd, cx, cy, r * 0.6, 14, 2.0, '#fff6e2', 0.6);
    }

    /* a rice-and-beans bowl: the reading the crop archetype could not carry */
    function bowlMexican(ctx, rnd, f, cx, cy, r) {
      grainBed(ctx, rnd, cx, cy, r * 0.94, r * 0.94, RICE);
      // beans, salsa and guacamole laid in wedges around the rice
      pool(ctx, rnd, cx - r * 0.36, cy + r * 0.3, r * 0.4, r * 0.34, mix(f.deep, '#38200f', 0.45), 0.92, 2, 0.26, true, 'over');
      pool(ctx, rnd, cx + r * 0.36, cy - r * 0.26, r * 0.38, r * 0.32, shade(f.main, -0.06), 0.92, 2, 0.28, true, 'over');
      dots(ctx, rnd, cx + r * 0.36, cy - r * 0.26, r * 0.26, 10, Math.max(1.6, r * 0.04), shade(f.fresh, -0.08), 0.7);
      pool(ctx, rnd, cx - r * 0.32, cy - r * 0.32, r * 0.34, r * 0.28, mix(f.fresh, '#5d8a42', 0.42), 0.92, 3, 0.3, true, 'over');
      var i;
      for (i = 0; i < 5; i++) {
        piece(ctx, rnd, cx + r * (0.06 + rnd() * 0.5), cy + r * (0.08 + rnd() * 0.42),
              r * 0.13, r * 0.11, shade(f.deep, 0.12), 0.24);
      }
      drizzleArc(ctx, rnd, cx, cy, r * 0.58, CREAMY, Math.max(2.6, r * 0.045), 0.85);
      dots(ctx, rnd, cx, cy, r * 0.72, 16, Math.max(1.4, r * 0.03), mix(f.cream, '#e8c85a', 0.5), 0.75);
      wedge(ctx, rnd, cx + r * 0.44, cy + r * 0.42, r * 0.2, -0.4, LIME_R, LIME_F);
      herbs(ctx, rnd, cx, cy, r * 0.66, 10, r * 0.12, f);
    }

    /* -- vietnamese: rice-paper rolls, herbs, nuoc cham -- */
    function plateVietnamese(ctx, rnd, f, cx, cy, r) {
      var n = 3 + Math.floor(rnd() * 2), i;
      for (i = 0; i < n; i++) {
        var x = cx - r * 0.36 + (i / (n - 1)) * r * 0.72;
        var y = cy - r * 0.04 + (rnd() - 0.5) * r * 0.14;
        riceRoll(ctx, rnd, x, y, r * 0.17, r * 0.48, (rnd() - 0.5) * 0.3, f);
      }
      dipDish(ctx, rnd, cx + r * 0.64, cy + r * 0.44, r * 0.22, mix(warmOf(f.accent), '#b06a2a', 0.45));
      wedge(ctx, rnd, cx - r * 0.66, cy + r * 0.48, r * 0.2, 0.3, LIME_R, LIME_F);
      herbs(ctx, rnd, cx - r * 0.08, cy + r * 0.54, r * 0.42, 12, r * 0.15, f);
      dots(ctx, rnd, cx, cy + r * 0.56, r * 0.4, 12, Math.max(1.4, r * 0.03), shade(f.deep, 0.32), 0.65);
    }

    function bowlVietnamese(ctx, rnd, f, cx, cy, r) {
      pool(ctx, rnd, cx, cy, r * 0.92, r * 0.92, shade(f.main, -0.12), 0.5, 2, 0.1, false, 'over');
      noodles(ctx, rnd, cx, cy, r * 0.78, r * 0.5, '#f4eddb', 9);
      var i;
      for (i = 0; i < 4; i++) {
        var x = cx + (rnd() - 0.5) * r * 1.0, y = cy + (rnd() - 0.5) * r * 0.8;
        shadowEllipse(ctx, x + 2, y + 4, r * 0.22, r * 0.1, 0.3, 7);
        pool(ctx, rnd, x, y, r * 0.24, r * 0.11, mix(f.deep, '#b06a52', 0.4), 0.93, 2, 0.12, true, 'over');
        sheen(ctx, x - r * 0.06, y - r * 0.03, r * 0.12, r * 0.03, -0.3, 0.45);
      }
      for (i = 0; i < 8; i++) {
        var sx = cx + (rnd() - 0.5) * r * 1.3, sy = cy + (rnd() - 0.5) * r * 1.1;
        stroke(ctx, [[sx, sy], [sx + r * (0.06 + rnd() * 0.1), sy - r * (0.04 + rnd() * 0.08)]],
               '#f0ead4', Math.max(1.6, r * 0.024), 0.85, 'round', 'over');   // bean sprouts
      }
      herbs(ctx, rnd, cx, cy, r * 0.68, 14, r * 0.13, f);
      wedge(ctx, rnd, cx + r * 0.5, cy - r * 0.4, r * 0.19, -0.5, LIME_R, LIME_F);
      chillis(ctx, rnd, cx, cy, r * 0.6, 5, Math.max(1.8, r * 0.045), '#c4453a');
    }

    /* -- thai: rice, a curry with peppers and basil, lime -- */
    function plateThai(ctx, rnd, f, cx, cy, r) {
      mound(ctx, rnd, cx - r * 0.44, cy - r * 0.04, r * 0.4, r * 0.36, RICE);
      pool(ctx, rnd, cx + r * 0.3, cy + r * 0.02, r * 0.6, r * 0.52, f.main, 0.9, 3, 0.2, true, 'over');
      pool(ctx, rnd, cx + r * 0.28, cy - r * 0.02, r * 0.34, r * 0.28, mix(f.main, CREAMY, 0.42), 0.5, 2, 0.26, false, 'over');
      var i;
      for (i = 0; i < 5; i++) {
        piece(ctx, rnd, cx + r * (0.02 + rnd() * 0.58), cy + r * (-0.22 + rnd() * 0.44),
              r * 0.14, r * 0.1, i % 2 ? shade(f.deep, 0.12) : mix(f.fresh, '#6f9440', 0.35), 0.2);
      }
      for (i = 0; i < 4; i++) {
        var px2 = cx + r * (0.05 + rnd() * 0.5), py2 = cy + r * (-0.2 + rnd() * 0.4);
        stroke(ctx, [[px2, py2], [px2 + r * (0.1 + rnd() * 0.14), py2 - r * (0.02 + rnd() * 0.1)]],
               mix(f.deep, '#c4453a', 0.5), Math.max(2, r * 0.045), 0.9, 'round', 'over');
      }
      chillis(ctx, rnd, cx + r * 0.3, cy, r * 0.5, 6, Math.max(2, r * 0.045), '#c4453a');
      wedge(ctx, rnd, cx - r * 0.12, cy + r * 0.62, r * 0.19, 0.2, LIME_R, LIME_F);
      herbs(ctx, rnd, cx + r * 0.28, cy, r * 0.5, 9, r * 0.15, f);
      dots(ctx, rnd, cx + r * 0.3, cy + r * 0.08, r * 0.5, 12, Math.max(1.4, r * 0.035), shade(f.deep, 0.34), 0.7);
    }

    function bowlThai(ctx, rnd, f, cx, cy, r) {
      pool(ctx, rnd, cx, cy, r * 0.92, r * 0.92, f.main, 0.85, 3, 0.1, false, 'over');
      pool(ctx, rnd, cx - r * 0.16, cy - r * 0.12, r * 0.5, r * 0.44, mix(f.main, CREAMY, 0.45), 0.55, 3, 0.22, false, 'over');
      var i;
      for (i = 0; i < 5; i++) {
        piece(ctx, rnd, cx + (rnd() - 0.5) * r * 1.1, cy + (rnd() - 0.5) * r * 0.95,
              r * 0.15, r * 0.12, i % 2 ? shade(f.deep, 0.12) : mix(f.fresh, '#6f9440', 0.35), 0.2);
      }
      for (i = 0; i < 4; i++) {
        var px2 = cx + (rnd() - 0.5) * r * 1.0, py2 = cy + (rnd() - 0.5) * r * 0.9;
        stroke(ctx, [[px2, py2], [px2 + r * (0.1 + rnd() * 0.16), py2 - r * (0.02 + rnd() * 0.1)]],
               mix(f.deep, '#c4453a', 0.5), Math.max(2, r * 0.045), 0.9, 'round', 'over');
      }
      mound(ctx, rnd, cx - r * 0.5, cy + r * 0.36, r * 0.24, r * 0.22, RICE);
      chillis(ctx, rnd, cx, cy, r * 0.62, 6, Math.max(2, r * 0.045), '#c4453a');
      herbs(ctx, rnd, cx, cy, r * 0.66, 11, r * 0.14, f);
      dots(ctx, rnd, cx, cy, r * 0.6, 10, 2.2, shade(f.deep, 0.34), 0.7);
    }

    /* -- burgers: the burger from above, with fries -- */
    function plateBurgers(ctx, rnd, f, cx, cy, r) {
      var bun = mix(f.cream, '#c98b3f', 0.45), i;
      sticks(ctx, rnd, cx + r * 0.62, cy + r * 0.3, r * 0.3, 9, r * 0.5, Math.max(3, r * 0.085),
             mix(f.cream, '#d9a13d', 0.5));
      for (i = 0; i < 13; i++) {
        var la = (i / 13) * 6.283 + rnd() * 0.22;
        leaf(ctx, rnd, cx - r * 0.24 + Math.cos(la) * r * 0.62, cy - r * 0.06 + Math.sin(la) * r * 0.6,
             r * 0.26, r * 0.12, la + 1.57, mix(f.fresh, '#6f9a4e', rnd() * 0.5), 0.92);
      }
      // the patty edge and a slice of tomato peeking out under the bun
      pool(ctx, rnd, cx - r * 0.24, cy + r * 0.36, r * 0.58, r * 0.18, shade(f.deep, -0.04), 0.9, 2, 0.1, true, 'over');
      pool(ctx, rnd, cx - r * 0.5, cy + r * 0.4, r * 0.2, r * 0.1, f.main, 0.9, 2, 0.12, true, 'over');
      shadowEllipse(ctx, cx - r * 0.18, cy + r * 0.24, r * 0.62, r * 0.56, 0.42, 12);
      ctx.save();
      var g = ctx.createRadialGradient(cx - r * 0.5, cy - r * 0.42, r * 0.06, cx - r * 0.24, cy - r * 0.06, r * 0.8);
      g.addColorStop(0, shade(bun, 0.3)); g.addColorStop(0.6, bun); g.addColorStop(1, shade(bun, -0.3));
      ctx.fillStyle = g;
      blobPath(ctx, rnd, cx - r * 0.24, cy - r * 0.06, r * 0.58, r * 0.55, 0.03, 0.4, 22); ctx.fill();
      ctx.restore();
      dots(ctx, rnd, cx - r * 0.26, cy - r * 0.1, r * 0.42, 22, Math.max(1.4, r * 0.028), shade(bun, 0.38), 0.75);
      sheen(ctx, cx - r * 0.4, cy - r * 0.3, r * 0.3, r * 0.14, -0.3, 0.36);
      pool(ctx, rnd, cx + r * 0.68, cy - r * 0.5, r * 0.14, r * 0.13, mix(f.main, '#b8402c', 0.5), 0.9, 2, 0.2, true, 'over');
    }

    /* -- cafe: toast, a fried egg, avocado, greens -- */
    function plateCafe(ctx, rnd, f, cx, cy, r) {
      var i, toast = mix(f.cream, '#c98b3f', 0.42);
      for (i = 0; i < 2; i++) {
        var x = cx - r * 0.34 + i * r * 0.66, y = cy + r * 0.04 + (i ? r * 0.1 : 0);
        ctx.save();
        ctx.translate(x, y); ctx.rotate(-0.16 + i * 0.32); ctx.translate(-x, -y);
        shadowEllipse(ctx, x + 4, y + r * 0.4, r * 0.42, r * 0.3, 0.34, 9);
        pool(ctx, rnd, x, y, r * 0.4, r * 0.42, toast, 0.98, 2, 0.06, true, 'over');
        pool(ctx, rnd, x, y, r * 0.32, r * 0.34, shade(toast, 0.18), 0.55, 2, 0.09, false, 'over');
        ctx.restore();
      }
      for (i = 0; i < 5; i++) {
        leaf(ctx, rnd, cx - r * 0.44 + i * r * 0.1, cy + r * 0.02 + (rnd() - 0.5) * r * 0.06,
             r * 0.42, r * 0.1, 1.45, mix('#9dbf86', '#6f9a5e', rnd() * 0.7), 0.94);
      }
      friedEgg(ctx, rnd, cx + r * 0.36, cy + r * 0.02, r * 0.3);
      for (i = 0; i < 4; i++) {
        piece(ctx, rnd, cx + (rnd() - 0.2) * r * 0.7, cy + r * (0.42 + rnd() * 0.2),
              r * 0.09, r * 0.08, mix(f.accent, '#c8506a', 0.45), 0.22);   // berries
      }
      herbs(ctx, rnd, cx, cy + r * 0.46, r * 0.42, 8, r * 0.12, f);
      dots(ctx, rnd, cx - r * 0.36, cy, r * 0.32, 14, Math.max(1.2, r * 0.025), CHARC, 0.45);
    }

    function stackCafe(ctx, rnd, f, cx, base, wdt, slab, dome) {
      var y = base, n = 3 + Math.floor(rnd() * 2), i;
      for (i = 0; i < n; i++) {
        y -= wdt * 0.17;
        slab(y, wdt * (1.04 - i * 0.02), wdt * 0.11, shade(mix(f.cream, '#d59f4e', 0.42), -0.04 + rnd() * 0.14), false);
      }
      y -= wdt * 0.19;
      dome(y, wdt * 0.98, mix(f.cream, '#d9a94e', 0.4), false);
      cube(ctx, rnd, cx - wdt * 0.1, y - wdt * 0.26, wdt * 0.19, -0.2, '#f6e6a8');   // butter
      var syrup = mix(shade(warmOf(f.accent), -0.28), '#8a5a1e', 0.4);
      for (i = 0; i < 2; i++) {
        var sxs = cx - wdt * (0.16 + i * 0.46 + rnd() * 0.12);
        stroke(ctx, [[sxs, y - wdt * 0.24], [sxs - wdt * 0.18, y + wdt * 0.08],
                     [sxs - wdt * 0.13, y + wdt * (0.42 + rnd() * 0.42)]],
               syrup, wdt * 0.1, 0.72, 'round', 'over');   // syrup running down
      }
      for (i = 0; i < 5; i++) {
        piece(ctx, rnd, cx + wdt * (0.6 + rnd() * 0.7), base - wdt * (0.05 + rnd() * 0.5),
              wdt * 0.14, wdt * 0.13, mix(f.accent, '#b8425e', 0.5), 0.22);
      }
      dots(ctx, rnd, cx, y - wdt * 0.34, wdt * 0.5, 10, 2.2, '#fff6e2', 0.5);
    }

    /* -- pizza: the whole pie, crust to centre -- */
    function platePizza(ctx, rnd, f, cx, cy, r) {
      var crust = mix(f.cream, '#c8873a', 0.5), i;
      ctx.save();
      var g = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.4, r * 0.1, cx, cy, r * 1.25);
      g.addColorStop(0, shade(crust, 0.26)); g.addColorStop(1, shade(crust, -0.3));
      ctx.fillStyle = g;
      blobPath(ctx, rnd, cx, cy, r * 1.1, r * 1.08, 0.035, 0.4, 26); ctx.fill();
      ctx.restore();
      dots(ctx, rnd, cx, cy, r * 1.02, 22, Math.max(2, r * 0.05), shade(crust, -0.5), 0.3);
      pool(ctx, rnd, cx, cy, r * 0.92, r * 0.9, f.main, 0.9, 3, 0.07, true, 'over');
      for (i = 0; i < 9; i++) {
        pool(ctx, rnd, cx + (rnd() - 0.5) * r * 1.3, cy + (rnd() - 0.5) * r * 1.3,
             r * (0.16 + rnd() * 0.14), r * (0.13 + rnd() * 0.12), shade(f.cream, -0.02), 0.68, 2, 0.26, false, 'over');
      }
      var n = 6 + Math.floor(rnd() * 3);
      for (i = 0; i < n; i++) {
        var a = rnd() * 6.283, d = Math.sqrt(rnd()) * r * 0.76;
        piece(ctx, rnd, cx + Math.cos(a) * d, cy + Math.sin(a) * d,
              r * 0.15, r * 0.13, mix(f.deep, '#a8402c', 0.45), 0.1);
      }
      herbs(ctx, rnd, cx, cy, r * 0.8, 9, r * 0.14, f);
      dots(ctx, rnd, cx, cy, r * 0.8, 14, 2.0, '#fdf6e4', 0.6);
    }

    /* -- vegetarian: a grain bowl on a plate -- */
    function plateVegetarian(ctx, rnd, f, cx, cy, r) {
      grainBed(ctx, rnd, cx, cy + r * 0.04, r * 0.88, r * 0.76, mix(f.cream, '#d8cf94', 0.4));
      var cols = [mix(f.deep, '#c4713a', 0.5), mix(f.main, '#d4a03a', 0.4), mix(f.fresh, '#5d8a42', 0.4),
                  mix(f.accent, '#b4553a', 0.35)];
      var n = 6 + Math.floor(rnd() * 3), i;
      for (i = 0; i < n; i++) {
        var a = rnd() * 6.283, d = Math.sqrt(rnd()) * r * 0.72;
        piece(ctx, rnd, cx + Math.cos(a) * d, cy + Math.sin(a) * d,
              r * (0.13 + rnd() * 0.06), r * (0.11 + rnd() * 0.05), cols[i % cols.length], 0.24);
      }
      for (i = 0; i < 5; i++) {
        leaf(ctx, rnd, cx - r * 0.46 + i * r * 0.1, cy + r * 0.4, r * 0.36, r * 0.09, 1.45,
             mix('#9dbf86', '#6f9a5e', rnd() * 0.7), 0.94);
      }
      cube(ctx, rnd, cx + r * 0.44, cy - r * 0.36, r * 0.11, rnd(), '#efe6d2');
      drizzleArc(ctx, rnd, cx, cy, r * 0.7, CREAMY, Math.max(2.2, r * 0.03), 0.72);
      herbs(ctx, rnd, cx, cy, r * 0.85, 12, r * 0.13, f);
      dots(ctx, rnd, cx, cy, r * 0.8, 22, 2.0, shade(f.deep, 0.3), 0.6);
    }

    function bowlVegetarian(ctx, rnd, f, cx, cy, r) {
      grainBed(ctx, rnd, cx, cy, r * 0.92, r * 0.92, mix(f.cream, '#d8cf94', 0.4));
      var cols = [mix(f.deep, '#c4713a', 0.5), mix(f.main, '#d4a03a', 0.4), mix(f.fresh, '#5d8a42', 0.4)];
      var i;
      for (i = 0; i < 8; i++) {
        var a = rnd() * 6.283, d = Math.sqrt(rnd()) * r * 0.72;
        piece(ctx, rnd, cx + Math.cos(a) * d, cy + Math.sin(a) * d,
              r * (0.13 + rnd() * 0.06), r * (0.11 + rnd() * 0.05), cols[i % cols.length], 0.24);
      }
      for (i = 0; i < 5; i++) {
        leaf(ctx, rnd, cx - r * 0.4 + i * r * 0.1, cy + r * 0.34, r * 0.34, r * 0.09, 1.45,
             mix('#9dbf86', '#6f9a5e', rnd() * 0.7), 0.94);
      }
      cube(ctx, rnd, cx + r * 0.42, cy - r * 0.34, r * 0.11, rnd(), '#efe6d2');
      drizzleArc(ctx, rnd, cx, cy, r * 0.6, CREAMY, Math.max(2.2, r * 0.03), 0.72);
      herbs(ctx, rnd, cx, cy, r * 0.7, 12, r * 0.12, f);
      dots(ctx, rnd, cx, cy, r * 0.7, 20, 2.0, shade(f.deep, 0.3), 0.6);
    }

    /* -- american: a seared slab, mash, greens -- */
    function plateAmerican(ctx, rnd, f, cx, cy, r) {
      mound(ctx, rnd, cx - r * 0.46, cy + r * 0.06, r * 0.4, r * 0.34, '#f4ead0');
      var gravy = mix(shade(warmOf(f.accent), -0.4), '#4a2f18', 0.45);
      pool(ctx, rnd, cx - r * 0.54, cy + r * 0.04, r * 0.2, r * 0.13, gravy, 0.85, 2, 0.4, false, 'over');
      stroke(ctx, [[cx - r * 0.42, cy + r * 0.1], [cx - r * 0.3, cy + r * 0.24], [cx - r * 0.24, cy + r * 0.34]],
             gravy, Math.max(3, r * 0.05), 0.72, 'round', 'over');
      meatSlice(ctx, rnd, cx + r * 0.26, cy - r * 0.04, r * 0.44, r * 0.32, 0.1 + (rnd() - 0.5) * 0.2,
                mix(f.deep, '#8a4a28', 0.35), mix(f.deep, '#241610', 0.5));
      var i;
      for (i = 0; i < 6; i++) {
        var bx = cx + r * (0.02 + rnd() * 0.6), by = cy + r * (0.36 + rnd() * 0.24);
        stroke(ctx, [[bx, by], [bx + r * (0.14 + rnd() * 0.16), by - r * (0.02 + rnd() * 0.12)]],
               mix(f.fresh, '#4e7a3c', rnd() * 0.55), Math.max(2.4, r * 0.055), 0.92, 'round', 'over');
      }
      herbs(ctx, rnd, cx, cy, r * 0.72, 6, r * 0.12, f);
      dots(ctx, rnd, cx + r * 0.26, cy - r * 0.04, r * 0.4, 10, 2.0, CHARC, 0.4);
    }

    /* ---- crop kits: the close crop keeps its swept EDGE, but the edge
       is a different bread and the field is a different dish ---- */
    var CROP_ITALIAN = {
      crust: '#d8a556',
      field: function (ctx, rnd, f) {
        var i;
        for (i = 0; i < 6; i++) {
          pool(ctx, rnd, W * rnd(), H * (0.05 + rnd() * 0.48), W * (0.13 + rnd() * 0.16), H * (0.05 + rnd() * 0.06),
               shade(f.cream, 0.06), 0.4, 2, 0.28, false);
        }
      },
      over: function (ctx, rnd, f) {
        var i, n = 5 + Math.floor(rnd() * 3);
        for (i = 0; i < n; i++) {
          piece(ctx, rnd, W * (0.12 + rnd() * 0.76), H * (0.06 + rnd() * 0.42),
                W * (0.07 + rnd() * 0.04), W * (0.06 + rnd() * 0.035), mix(f.deep, '#a8402c', 0.4), 0.12);
        }
        for (i = 0; i < 12; i++) {
          leaf(ctx, rnd, W * (0.05 + rnd() * 0.9), H * (0.04 + rnd() * 0.5),
               W * (0.05 + rnd() * 0.05), W * (0.02 + rnd() * 0.016), rnd() * 3.14,
               mix(f.fresh, '#41633a', rnd() * 0.5), 0.9);
        }
        dots(ctx, rnd, W * 0.5, H * 0.28, W * 0.5, 26, 2.4, '#fdf6e4', 0.5);
      }
    };

    var CROP_INDIAN = {
      crust: '#e0bb78',
      field: function (ctx, rnd, f) {
        var i;
        for (i = 0; i < 4; i++) {
          pool(ctx, rnd, W * (0.1 + rnd() * 0.8), H * (0.06 + rnd() * 0.44), W * (0.2 + rnd() * 0.2), H * (0.07 + rnd() * 0.07),
               shade(f.deep, 0.08), 0.42, 3, 0.26, false);
        }
        for (i = 0; i < 3; i++) {
          drizzleArc(ctx, rnd, W * (0.2 + rnd() * 0.6), H * (0.1 + rnd() * 0.36), W * 0.2, CREAMY, 3.2, 0.6);
        }
      },
      over: function (ctx, rnd, f) {
        var i, n = 6 + Math.floor(rnd() * 3);
        for (i = 0; i < n; i++) {
          piece(ctx, rnd, W * (0.1 + rnd() * 0.8), H * (0.06 + rnd() * 0.44),
                W * (0.06 + rnd() * 0.04), W * (0.05 + rnd() * 0.035), shade(f.deep, 0.16), 0.2);
        }
        dots(ctx, rnd, W * 0.5, H * 0.28, W * 0.52, 28, 2.2, shade(warmOf(f.accent), 0.12), 0.5);
        for (i = 0; i < 14; i++) {
          leaf(ctx, rnd, W * (0.05 + rnd() * 0.9), H * (0.04 + rnd() * 0.5),
               W * (0.03 + rnd() * 0.03), W * (0.012 + rnd() * 0.012), rnd() * 3.14,
               mix(f.fresh, '#4e6a3c', rnd() * 0.55), 0.85);
        }
      }
    };

    /* ---- the register: cuisine -> what it puts on the plate ---- */
    var KITS = {
      cafe:          { plate: plateCafe, stack: stackCafe },
      japanese:      { plate: plateJapanese, bowl: bowlJapanese, utensil: 'chop' },
      italian:       { plate: plateItalian, crop: CROP_ITALIAN },
      mexican:       { plate: plateMexican, bowl: bowlMexican, utensil: 'spoon' },
      indian:        { plate: plateIndian, bowl: bowlIndian, crop: CROP_INDIAN, utensil: 'spoon' },
      mediterranean: { plate: plateMediterranean, bowl: bowlMediterranean, utensil: 'spoon' },
      seafood:       { plate: plateSeafood, bowl: bowlSeafood, utensil: 'spoon' },
      bbq:           { plate: plateBbq, stack: stackBbq },
      korean:        { plate: plateKorean, bowl: bowlKorean, utensil: 'chop' },
      vietnamese:    { plate: plateVietnamese, bowl: bowlVietnamese, utensil: 'chop' },
      thai:          { plate: plateThai, bowl: bowlThai, utensil: 'spoon' },
      burgers:       { plate: plateBurgers },
      pizza:         { plate: platePizza },
      vegetarian:    { plate: plateVegetarian, bowl: bowlVegetarian, utensil: 'spoon' },
      american:      { plate: plateAmerican }
    };
    var NO_KIT = {};

    var DRAW = { plate: drawPlate, bowl: drawBowl, stack: drawStack, crop: drawCrop, table: drawTable };
    var WITH_STEAM = { bowl: 1, table: 1 };

    /* Cuisine-keyed food pigments. `main` is the dish's dominant colour,
       `deep` its browned/roasted note, `fresh` the green, `cream` the
       starch/dairy, `table` the surface it sits on, `accent` the bright
       thing (chilli oil, gold, sauce). */
    var FOOD_PAL = {
      cafe:          { main: '#c8944f', deep: '#8a5a2e', fresh: '#9db877', cream: '#f4e6c9', table: '#8a7358', accent: '#d9a86a' },
      japanese:      { main: '#c98a45', deep: '#9c4f33', fresh: '#7e9b5e', cream: '#f3e7d2', table: '#48566e', accent: '#d98ba0' },
      italian:       { main: '#c2503a', deep: '#8e3524', fresh: '#7fa05f', cream: '#f2e4c4', table: '#77634b', accent: '#cdb878' },
      mexican:       { main: '#d0703a', deep: '#95391f', fresh: '#7fa25c', cream: '#f0dfb8', table: '#836348', accent: '#e0b453' },
      indian:        { main: '#d08a2e', deep: '#a1471f', fresh: '#7d9b57', cream: '#f2e2bd', table: '#75546a', accent: '#c2547e' },
      mediterranean: { main: '#c9a34e', deep: '#8d6a2c', fresh: '#7fa05f', cream: '#f3ead3', table: '#6a88a0', accent: '#7fa8c9' },
      seafood:       { main: '#dda089', deep: '#b25a4a', fresh: '#8fae7d', cream: '#f0ead8', table: '#54788e', accent: '#6fa3c4' },
      bbq:           { main: '#96522f', deep: '#54301c', fresh: '#84a05e', cream: '#e9d9b6', table: '#5a4c40', accent: '#c25a3a' },
      korean:        { main: '#c2453a', deep: '#8a2b26', fresh: '#7f9e58', cream: '#f0e0c2', table: '#48566e', accent: '#d9a13d' },
      vietnamese:    { main: '#c08a4a', deep: '#8a5a2e', fresh: '#7fa64f', cream: '#f3ecd6', table: '#66795a', accent: '#cdb878' },
      thai:          { main: '#cf9a3a', deep: '#94592a', fresh: '#79a457', cream: '#f4ecd6', table: '#75688a', accent: '#a292c4' },
      burgers:       { main: '#b9702f', deep: '#7d4420', fresh: '#86a95e', cream: '#e8c98a', table: '#7a6b5a', accent: '#c9a24e' },
      pizza:         { main: '#c2503a', deep: '#8c3220', fresh: '#7fa05f', cream: '#f0dfae', table: '#77634b', accent: '#e6d3a3' },
      vegetarian:    { main: '#8fae63', deep: '#5d7c42', fresh: '#a8c274', cream: '#f0efd8', table: '#77836a', accent: '#cdb878' },
      american:      { main: '#c08a4a', deep: '#8a5a2e', fresh: '#84a95e', cream: '#f2e6cd', table: '#7a6b5a', accent: '#7fa8c9' }
    };
    var DEFAULT_PAL = { main: '#c09055', deep: '#8a5a35', fresh: '#8aa869', cream: '#f2e8d3', table: '#7b6a58', accent: '#cdb878' };

    /* Which composition suits which cuisine — brothy things get the bowl,
       stacked things the stack, and so on. Every list still holds more than
       one archetype so a place with several posts does not repeat itself. */
    var CUISINE_ARCH = {
      japanese:      ['bowl', 'plate', 'table'],
      korean:        ['bowl', 'plate', 'table'],
      vietnamese:    ['bowl', 'plate', 'table'],
      thai:          ['bowl', 'plate', 'table'],
      cafe:          ['stack', 'plate', 'table'],
      burgers:       ['stack', 'plate', 'table'],
      pizza:         ['crop', 'plate', 'table'],
      italian:       ['plate', 'crop', 'table'],
      bbq:           ['plate', 'stack', 'table'],
      indian:        ['plate', 'bowl', 'crop'],
      mexican:       ['plate', 'table', 'bowl'],
      mediterranean: ['plate', 'table', 'bowl'],
      seafood:       ['plate', 'table', 'bowl'],
      vegetarian:    ['plate', 'bowl', 'table'],
      american:      ['stack', 'plate', 'table']
    };
    var ANY_ARCH = ['plate', 'bowl', 'stack', 'crop', 'table'];

    function cuisineOf(r) { return ((r && r.cuisines) || [])[0] || ''; }
    /* A painter is handed ONE object: the cuisine's pigments plus its
       subject kit. Threading the kit through the palette means no painter
       signature had to change and every helper that already takes `f` can
       reach the kit. */
    function palFor(r) {
      var c = cuisineOf(r), p = FOOD_PAL[c] || DEFAULT_PAL;
      return { main: p.main, deep: p.deep, fresh: p.fresh, cream: p.cream,
               table: p.table, accent: p.accent, cuisine: c, kit: KITS[c] || NO_KIT };
    }
    function archFor(r, variant) {
      var list = CUISINE_ARCH[cuisineOf(r)] || ANY_ARCH;
      var h = hashStr((r && (r.name || r.id)) || 'x');
      return list[(h + variant * 7) % list.length];
    }

    /* ---- the cache ---- */
    function evict() {
      var guard = order.length;   // a canvas that is on screen is never evicted
      while (order.length > CAP && guard-- > 0) {
        var k = order.shift();
        var c = cache[k];
        if (c && c.parentNode) { order.push(k); continue; } // in view — keep it
        delete cache[k];
      }
    }

    /* paint(place, variant) -> a finished <canvas>, painted once and reused. */
    function paint(r, variant, forceArch) {
      var key = ((r && (r.id || r.name)) || 'x') + '|' + variant + (forceArch ? '|' + forceArch : '');
      if (cache[key]) {
        var at = order.indexOf(key);
        if (at !== -1) order.splice(at, 1);
        order.push(key);
        return cache[key];
      }
      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      var arch = forceArch || archFor(r, variant);
      var rnd = rngFrom(hashStr(((r && (r.name || r.id)) || 'x') + '|feed|' + variant));
      (DRAW[arch] || drawPlate)(ctx, rnd, palFor(r));
      // paper grain over the finished paint
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.55;
      var pat = ctx.createPattern(grain(), 'repeat');
      if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H); }
      ctx.restore();
      cv.className = 'feed-art';
      cv.setAttribute('aria-hidden', 'true');
      cache[key] = cv;
      order.push(key);
      evict();
      return cv;
    }

    return {
      paint: paint,
      /* a place-less, data-less still life for decorative use (Find landing):
         fixed seed, neutral pigments, so it always paints the same way */
      still: function (arch) { return paint({ id: 'tableau-still', name: 'Tableau still life', cuisines: ['mediterranean'] }, 0, arch); },
      archOf: archFor,
      hasSteam: function (r, variant) { return !!WITH_STEAM[archFor(r, variant)]; },
      palOf: palFor
    };
  })();

  // Pre-built demo result objects (with distance to DEMO_ORIGIN).
  function demoResults() {
    return DEMO_RESTAURANTS.map(function (r, i) {
      // Derive open-now from the demo hours + the real clock so the "Open now"
      // filter and the card's status chip always agree (falls back to the
      // static flag if a place somehow lacks hours).
      var st = openState({ openH: r.openH, closeH: r.closeH, open: r.open });
      var isOpen = st ? (st.key === 'open' || st.key === 'soon') : r.open;
      return {
        id: 'demo-' + i,
        demo: true,   // the one flag every SAMPLE label reads
        name: r.name,
        rating: r.rating,
        reviews: r.reviews,
        price: r.price,
        type: r.type,
        cuisines: r.cuisines || [],
        diet: r.diet || [],
        dining: r.dining || [],
        extras: r.extras || [], // live results leave this undefined (not fetched)
        open: isOpen,
        openH: r.openH,
        closeH: r.closeH,
        phone: r.phone,
        photoUrl: null, // watercolor placeholder
        // story segments — demo content (live mode fills from Place details)
        segments: {
          vibe: { kind: 'vibe', glyph: DEMO_VIBE_GLYPH, caption: r.vibe || '' },
          food: { kind: 'food', glyph: DEMO_FOOD_GLYPH, caption: r.food || '' },
          reviews: { kind: 'reviews', quotes: (r.reviews_q || []).slice(0, 3).map(function (q) {
            // sample quotes carry invented first names; a name reads as a real
            // person, so demo reviews are credited to "Sample review" instead
            return { by: 'Sample review', score: q.score, text: q.text };
          }) }
        },
        location: { lat: r.lat, lng: r.lng },
        distance: haversineMiles(DEMO_ORIGIN, { lat: r.lat, lng: r.lng }),
        mapsUri: null,
        placeId: null,
        detailsLoaded: true
      };
    });
  }

  function demoVisited() {
    return [
      { id: 'demo-v-1', name: 'Tonkotsu Lane', food: 90, vibe: 75, service: 80, note: 'Tonkotsu was rich and silky. Tiny room, expect a wait.', date: '2026-05-02', loc: 'Embarcadero, SF', demo: true },
      { id: 'demo-v-2', name: 'Little Wren Bakery', food: 95, vibe: 80, service: 70, note: 'The morning bun is unreal. Coffee a touch weak.', date: '2026-04-18', loc: 'Embarcadero, SF', demo: true },
      { id: 'demo-v-3', name: 'Pier 9 Oyster Co.', food: 80, vibe: 90, service: 65, note: 'Beautiful patio at sunset. Pricey, slow service.', date: '2026-03-27', loc: 'Pier 9, SF', demo: true }
    ];
  }

  /* ------------------------------------------------------------------ *
   * state
   * ------------------------------------------------------------------ */
  var state = {
    results: [],          // current Find results (accumulated, nearest-first)
    origin: null,         // {lat,lng} search origin
    originLabel: null,    // human label for the origin ("you" or a typed query)
    prefs: null,          // current swipe preferences (see prefs.defaults)
    distanceCap: null,    // miles cap derived from prefs.distance (null = anywhere)
    hasMore: false,       // whether more results can be loaded (live pagination)
    loadingMore: false,   // a "load more" request is in flight
    nextPage: null,       // live pagination handle (PlacesService getNextPage)
    visited: [],          // visited entries
    sort: 'date',
    editingId: null,      // visited entry id being edited (sheet)
    pendingPlace: null,   // place context captured from a Find card
    mapsLoaded: false,
    mapsLoading: false,
    autocomplete: null
  };

  /* ------------------------------------------------------------------ *
   * Rating model helper
   * ------------------------------------------------------------------ */
  function overallOf(entry) {
    return (Number(entry.food) + Number(entry.vibe) + Number(entry.service)) / 3;
  }
  function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function fmtScore(n) { return String(Math.round(n)); }  /* ratings: whole numbers, 0-100 */

  /* Shared watercolor sub-score bar (reused by Visited + Friends). */
  function scoreBar(label, value, mod) {
    var row = el('div', 'v-bar v-bar--' + mod);
    row.appendChild(el('span', 'lbl', label));
    var track = el('div', 'track');
    var fill = el('div', 'fill');
    fill.style.width = value + '%';
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('span', 'val', fmtScore(value)));
    return row;
  }

  /* Your own Visited entry for a place, matched by name (case-insensitive). */
  function myRatingFor(name) {
    if (!name) return null;
    var n = String(name).toLowerCase();
    var hits = (state.visited || []).filter(function (v) {
      return String(v.name || '').toLowerCase() === n;
    });
    return hits.length ? hits[0] : null;
  }

  /* Relative time from an ISO date or a Date, e.g. "3 days ago". */
  function relTime(when) {
    var then = (when instanceof Date) ? when : new Date(when);
    if (isNaN(then.getTime())) return '';
    var secs = Math.round((Date.now() - then.getTime()) / 1000);
    if (secs < 45) return 'just now';
    var mins = Math.round(secs / 60);
    if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hrs / 24);
    if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');
    var wks = Math.round(days / 7);
    if (wks < 5) return wks + (wks === 1 ? ' week ago' : ' weeks ago');
    var mos = Math.round(days / 30);
    if (mos < 12) return mos + (mos === 1 ? ' month ago' : ' months ago');
    var yrs = Math.round(days / 365);
    return yrs + (yrs === 1 ? ' year ago' : ' years ago');
  }

  /* ================================================================== *
   * TABS — accessible tablist router
   * ================================================================== */
  var tabs = (function () {
    // Tab registry — add a tab by adding one entry here (keeps a11y wiring generic).
    var defs = [
      { name: 'feed', tab: $('tab-feed'), panel: $('panel-feed'), onShow: function () { feed.show(); }, onHide: function () { feed.hide(); } },
      { name: 'find', tab: $('tab-find'), panel: $('panel-find'), onShow: null },
      { name: 'visited', tab: $('tab-visited'), panel: $('panel-visited'), onShow: function () { visited.render(); } },
      { name: 'friends', tab: $('tab-friends'), panel: $('panel-friends'), onShow: function () { friends.render(); } },
      { name: 'popular', tab: $('tab-popular'), panel: $('panel-popular'), onShow: function () { popular.render(); } }
    ].filter(function (d) { return d.tab && d.panel; });

    var tabEls = defs.map(function (d) { return d.tab; });

    function activate(which, focus) {
      /* A tab that is not in the app (hidden by the beta flag) can never be
         activated: fall back to Find instead of leaving every panel closed. */
      var known = defs.some(function (d) { return d.name === which; });
      if (!known) which = 'find';
      defs.forEach(function (d) {
        var on = d.name === which;
        d.tab.classList.toggle('is-active', on);
        d.tab.setAttribute('aria-selected', on ? 'true' : 'false');
        d.tab.tabIndex = on ? 0 : -1;
        d.panel.classList.toggle('is-hidden', !on);
        d.panel.hidden = !on;
        if (on) {
          if (focus) d.tab.focus();
          if (d.onShow) d.onShow();
        } else if (d.onHide) { d.onHide(); }
      });
      /* The Feed is full-bleed and fixed: the room's own heading and the
         page scroll would sit behind it, so both step aside while it is up. */
      try { document.body.classList.toggle('feed-on', which === 'feed'); } catch (e) {}
      if (typeof find !== 'undefined' && find.syncHeaderChrome) find.syncHeaderChrome();
    }

    function init() {
      defs.forEach(function (d, idx) {
        d.tab.addEventListener('click', function () { activate(d.name); });
        // keyboard: arrows/home/end with roving tabindex
        d.tab.addEventListener('keydown', function (e) {
          var next = null;
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % defs.length;
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + defs.length) % defs.length;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = defs.length - 1;
          if (next != null) {
            e.preventDefault();
            activate(defs[next].name, true);
          }
        });
      });
    }
    return { init: init, activate: activate };
  })();

  function priceStr(p) {
    if (!p) return '';
    var s = '';
    for (var i = 0; i < p; i++) s += '$';
    return s;
  }

  /* ------------------------------------------------------------------ *
   * OPEN-HOURS AWARENESS
   * From a place's hours (openH/closeH, 0-24 local) + the current clock,
   * derive one of four gentle states for the deck chip / decision screen:
   *   open   — Open now (comfortably)
   *   soon   — Closes soon (open, within ~60 min of closing)
   *   opens  — Opens at H (closed now, but opens later today)
   *   closed — Closed (and not reopening today)
   * closeH may be 24 (midnight) or a touch past for late spots. When a
   * place has no hours (live Google results), we fall back to the binary
   * `open` flag and NEVER invent a precise time. Returns null when nothing
   * is known (no chip rather than a guess).
   * ------------------------------------------------------------------ */
  var CLOSES_SOON_MIN = 60;
  /* Hours are numbers 0-24 (local). Demo places sit on whole hours; real
     Google hours land on :30 and :45 constantly, so a fractional hour
     prints its minutes ("9:30pm") rather than being rounded into a time the
     kitchen never keeps. Whole hours read exactly as they always have. */
  function fmtHour(h) {
    var m = ((Math.round(h * 60) % 1440) + 1440) % 1440;
    var hr = Math.floor(m / 60), mn = m % 60;
    if (mn === 0) {
      if (hr === 0) return 'midnight';
      if (hr === 12) return 'noon';
      return (hr % 12) + (hr < 12 ? 'am' : 'pm');
    }
    return (hr % 12 === 0 ? 12 : hr % 12) + ':' + (mn < 10 ? '0' + mn : mn) +
      (hr < 12 ? 'am' : 'pm');
  }
  function openState(r, now) {
    if (!r) return null;
    var oh = r.openH, ch = r.closeH;
    if (oh == null || ch == null) {
      // Live / hours unknown — fall back to the binary flag, no fake times.
      if (r.open === true) return { key: 'open', label: 'Open now' };
      if (r.open === false) return { key: 'closed', label: 'Closed' };
      return null;
    }
    now = now || new Date();
    var mins = now.getHours() * 60 + now.getMinutes();
    var openM = oh * 60, closeM = ch * 60;
    var isOpen, toClose;
    if (closeM > openM) {           // same-day hours
      isOpen = mins >= openM && mins < closeM;
      toClose = closeM - mins;
    } else {                        // wraps past midnight
      isOpen = mins >= openM || mins < closeM;
      toClose = (mins >= openM) ? (closeM + 1440 - mins) : (closeM - mins);
    }
    if (isOpen) {
      if (toClose <= CLOSES_SOON_MIN) return { key: 'soon', label: 'Closes at ' + fmtHour(ch), close: ch };
      return { key: 'open', label: 'Open now', close: ch };
    }
    if (mins < openM) return { key: 'opens', label: 'Opens at ' + fmtHour(oh), open: oh };
    return { key: 'closed', label: 'Closed' };
  }
  /* Build a small watercolor status chip (or null). `base` sets the class
     family (ov-badge on cards, decision-chip on the pick screen) so each
     context keeps its own sizing; the state adds an is-<key> modifier. */
  function openChipEl(r, base, now) {
    var st = openState(r, now);
    if (!st) return null;
    var chip = el('span', base + ' is-' + st.key, st.label);
    return chip;
  }

  /* ------------------------------------------------------------------ *
   * LIVE vs SAMPLE — one honest answer, shared by every surface.
   * A result is "sample" when it came from the built-in demo set (its id is
   * demo-*, or it carries demo:true). The SAMPLE tag is only *drawn* in LIVE
   * mode: in demo mode the landing, the settings sheet and the panel banners
   * already say the whole app is sample data, so stamping every card would be
   * noise. In live mode the tag is the only way to tell a real Google result
   * from a fallback one — so there it always shows.
   * ------------------------------------------------------------------ */
  function liveMode() { return !!store.getKey(); }
  function isSampleResult(r) {
    if (!r) return false;
    if (r.demo === true) return true;
    return String(r.id || '').indexOf('demo-') === 0;
  }
  /* "Open in Google Maps" — keyless Maps URLs API (search + place id). A real
     <a> (not window.open) so it works in an installed iOS PWA and from the
     keyboard. Sample/demo places are not real: no link is invented (null). */
  function mapsSearchUrl(r) {
    if (!r || isSampleResult(r) || !r.name) return null;
    var q = String(r.name) + (r.address ? ' ' + String(r.address) : '');
    var u = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
    if (r.placeId) u += '&query_place_id=' + encodeURIComponent(String(r.placeId));
    return u;
  }
  function mapsLinkEl(r, cls) {
    var href = mapsSearchUrl(r);
    if (!href) return null;
    var a = el('a', cls);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', 'Open in Google Maps: ' + r.name + ' (opens in a new tab)');
    a.appendChild(el('span', 'maps-link-glyph', '↗'));
    a.lastChild.setAttribute('aria-hidden', 'true');
    a.appendChild(document.createTextNode('Open in Maps'));
    // the swipe card owns pointerdown (drag + pointer capture) and Enter/Space
    // (flip the set): a tap or key on this link must reach the link only.
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'keydown'].forEach(function (t) {
      a.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    return a;
  }
  /* Beta: a visitor must never mistake a sample place for a real one, so
     the SAMPLE tag is drawn in demo mode too (it is the only mode where
     every place is a sample). Outside beta the old convention holds. */
  function sampleTagsOn() { return BETA || liveMode(); }
  function sampleTagFor(r, cls) {
    if (!sampleTagsOn() || !isSampleResult(r)) return null;
    return el('span', 'v-demo-tag' + (cls ? ' ' + cls : ''), 'Sample');
  }

  /* ================================================================== *
   * OFFLINE — connectivity signal for the Find tab.
   * A small paper note appears when the network drops (searches quietly
   * run on the demo data) and slips away when the connection returns.
   * Driven by navigator.onLine + the online/offline events; the search
   * pipeline also asks isOffline() so live mode is never attempted
   * without a network.
   * ================================================================== */
  var offline = (function () {
    var note = null;

    function isOffline() { return navigator.onLine === false; }

    function ensureNote() {
      if (note) return note;
      var panel = $('panel-find');
      if (!panel) return null;
      note = el('div', 'offline-note');
      note.id = 'offline-note';
      note.setAttribute('role', 'note');
      note.hidden = true;
      var dot = el('span', 'offline-note-dot');
      dot.setAttribute('aria-hidden', 'true');
      note.appendChild(dot);
      note.appendChild(el('span', 'offline-note-text', 'You’re offline — demo kitchen’s still open'));
      panel.insertBefore(note, panel.firstChild);
      return note;
    }

    function sync() {
      var n = ensureNote();
      if (n) n.hidden = !isOffline();
    }

    function init() {
      sync();
      window.addEventListener('offline', function () {
        sync();
        announce('You’re offline — searches will use the demo data.');
      });
      window.addEventListener('online', function () {
        sync();
        announce('Back online.');
      });
    }

    return { init: init, isOffline: isOffline, sync: sync };
  })();

  /* ================================================================== *
   * FIND — bubble landing -> Preferences -> Swipe deck (router/orchestrator)
   *
   * Flow:
   *   landing (bubble)  --pop-->  Preferences screen  --start-->  Deck
   * The deck pulls nearest-first results matching the saved prefs; the
   * prefs module owns the filter controls; the deck module owns the cards.
   * ================================================================== */
  var find = (function () {
    var landingEl = $('find-landing');
    var prefsWrap = $('prefs-wrap');
    var deckWrap = $('deck-wrap');

    /* Hide the shared page header (eyebrow + "Tableau" wordmark) whenever the
       calm Find landing is the thing on screen. Other screens keep it. */
    function syncHeaderChrome() {
      var room = $('room');
      if (!room) return;
      var findTab = $('tab-find');
      var findActive = findTab ? findTab.getAttribute('aria-selected') === 'true' : true;
      var landingOn = findActive && landingEl && !landingEl.hidden;
      room.classList.toggle('find-landing-on', !!landingOn);
      // refresh the hero + memory strip once each time the landing comes on
      if (landingOn && !landingWasOn) refreshLanding();
      landingWasOn = !!landingOn;
      // the swipe screen sizes itself to the room above the tab bar
      if (typeof deck !== 'undefined' && deck && deck.layout) deck.layout();
    }

    /* ---- time-aware hero + quiet memory strip ----
       Computed once per landing show (no timer). The strip only ever states
       real local facts: your most recent REAL Visited entry (built-in SAMPLE
       entries are skipped, never shown) and your shortlist size. With nothing
       to say it stays hidden and the landing is exactly the plain layout. */
    var STILL_ARCH = 'bowl';   // a bowl of broth: calm, cuisine-neutral, reads as paint
    var landingWasOn = false;
    function heroCopy(h) {
      if (h < 11) return ['Where to, for breakfast?', 'A quiet nudge toward a slow morning.'];
      if (h < 16) return ['Where to, for lunch?', 'A quiet nudge toward midday.'];
      if (h < 21) return ['Where to, tonight?', 'A quiet nudge toward dinner.'];
      return ['Somewhere still open?', 'A quiet nudge toward a late bite.'];
    }
    function lastRealVisit() {
      var list = state.visited || [], best = null;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!e || e.demo || !e.name) continue;
        if (!best) { best = e; continue; }
        var da = e.date || '', db = best.date || '';
        if (da > db || (da === db && (e.ts || 0) > (best.ts || 0))) best = e;
      }
      return best;
    }
    /* Demo mode must be obvious on the front door: a quiet line under the
       hero says the places are samples. Gone the moment live data is on. */
    function syncDemoNote() {
      var n = $('find-demo-note');
      if (n) n.hidden = liveMode();
    }
    var stillPainted = false;
    function paintStill() {
      var host = $('find-still');
      if (!host || stillPainted) return;
      stillPainted = true;
      try {
        var cv = foodArt.still(STILL_ARCH);
        cv.className = 'find-still-art';   // not the Feed's animated class
        host.appendChild(cv);
      } catch (e) { /* decorative only: no still life is fine */ }
    }
    function refreshLanding() {
      syncDemoNote();
      paintStill();
      var copy = heroCopy(new Date().getHours());
      var t = $('find-hero-title'), sub = $('find-hero-sub');
      if (t) t.textContent = copy[0];
      if (sub) sub.textContent = copy[1];

      var wrap = $('find-memory'), lastEl = $('find-memory-last'), listEl = $('find-memory-list');
      if (!wrap || !lastEl || !listEl) return;
      var last = lastRealVisit();
      var n = deck.shortlistCount();
      lastEl.hidden = !last;
      if (last) lastEl.textContent = 'Last time: ' + last.name + ' · ' + fmtScore(overallOf(last));
      listEl.hidden = !(n > 0);
      if (n > 0) listEl.textContent = n + ' on your shortlist';
      var any = !!last || n > 0;
      wrap.hidden = !any;
      if (landingEl) landingEl.classList.toggle('has-memory', any);
      wrap.classList.remove('is-in');
      if (any && !prefersReducedMotion) {
        void wrap.offsetWidth; // restart the one-shot fade/rise
        wrap.classList.add('is-in');
      }
    }

    /* ---- live fallback note ----
       When a live search cannot be completed, the deck must never be an
       empty screen: it fills with the sample places and says so, once, in
       one honest line. Same paper slip as the offline note (they are
       mutually exclusive — offline has its own wording). Cleared the moment
       a live search succeeds. */
    var liveNote = null;
    function ensureLiveNote() {
      if (liveNote) return liveNote;
      var panel = $('panel-find');
      if (!panel) return null;
      liveNote = el('div', 'live-note');
      liveNote.id = 'live-note';
      liveNote.setAttribute('role', 'note');
      liveNote.hidden = true;
      var dot = el('span', 'live-note-dot');
      dot.setAttribute('aria-hidden', 'true');
      liveNote.appendChild(dot);
      liveNote.appendChild(el('span', 'live-note-text', ''));
      var retry = el('button', 'live-note-retry', 'Try again');
      retry.type = 'button';
      retry.hidden = true;
      liveNote.appendChild(retry);
      var off = $('offline-note');
      panel.insertBefore(liveNote, off ? off.nextSibling : panel.firstChild);
      return liveNote;
    }
    /* retry (optional): a function — the note then carries a calm
       "Try again" button that runs it. */
    function showLiveNote(text, retry) {
      var n = ensureLiveNote();
      if (!n) return;
      n.querySelector('.live-note-text').textContent = text;
      var b = n.querySelector('.live-note-retry');
      if (b) {
        b.hidden = !retry;
        b.onclick = retry ? function () { hideLiveNote(); retry(); } : null;
      }
      n.hidden = false;
    }
    function hideLiveNote() { if (liveNote) liveNote.hidden = true; }

    /* When true, the next batch of results goes to the Surprise-me roulette
       instead of the swipe deck ("Surprise me" on the Preferences screen). */
    var surprisePending = false;

    /* ---- Screen switching ---- */
    function hideAll() {
      liveSearchToken++;   // leaving a screen drops any live search still in flight
      if (landingEl) landingEl.hidden = true;
      if (prefsWrap) prefsWrap.hidden = true;
      if (deckWrap) deckWrap.hidden = true;
    }
    function showLanding() {
      hideAll();
      surprisePending = false;
      if (landingEl) landingEl.hidden = false;
      deck.teardown();
      state.results = [];
      state.hasMore = false;
      state.nextPage = null;
      syncHeaderChrome();
      var orb = $('find-near-me');
      if (orb) orb.focus();
    }
    function showPrefs(focusFirst) {
      hideAll();
      surprisePending = false;
      if (prefsWrap) prefsWrap.hidden = false;
      prefs.render();
      syncHeaderChrome();
      if (focusFirst) {
        var title = prefsWrap && prefsWrap.querySelector('.prefs-title');
        if (title) { title.setAttribute('tabindex', '-1'); title.focus(); }
      }
    }
    function showDeck() {
      hideAll();
      surprisePending = false;
      if (deckWrap) deckWrap.hidden = false;
      syncHeaderChrome();
      startSearch();
    }
    /* A place chosen somewhere else in the app (a Popular row) lands on the
       deck's own decision screen — no search runs, nothing is re-derived.
       `rest` becomes the queue behind it so "Keep looking" keeps working. */
    function showPick(r, rest) {
      hideAll();
      surprisePending = false;
      if (deckWrap) deckWrap.hidden = false;
      syncHeaderChrome();
      deck.pickFrom(r, rest);
    }
    /* "Surprise me": same search pipeline, but deliver() hands the matches
       to the roulette rather than the deck. */
    function showSurprise() {
      hideAll();
      surprisePending = true;
      if (deckWrap) deckWrap.hidden = false;
      syncHeaderChrome();
      startSearch();
    }

    /* ---- Origin label for the small chrome line ---- */
    function originLabel() { return state.originLabel || 'near you'; }
    function setOriginText(node) {
      if (!node) return;
      var lbl = originLabel();
      node.textContent = (lbl === 'near you') ? 'Near you' : ('Near ' + lbl);
    }

    /* ---- Distance cap helper (miles) from prefs.distance ---- */
    function capForDistance(d) {
      if (d === 'walk') return 1.2;   // ~1 mi (a little slack)
      if (d === 'drive') return 5;    // short drive
      return null;                    // anywhere
    }

    /* ================================================================
     * SEARCH — resolve origin, fetch nearest-first results, hand to deck.
     * Demo mode runs instantly; live mode resolves geolocation then Places.
     * ================================================================ */
    function startSearch() {
      state.prefs = prefs.current();
      state.distanceCap = capForDistance(state.prefs.distance);
      state.hasMore = false;
      state.nextPage = null;
      state.sweeper = null;       // a new search drops the old sweep (its late answers are ignored)
      state.loadingMore = false;
      sweepNoMatch = 0;
      hideLiveNote();
      deck.showLoading();

      if (store.getKey() && !offline.isOffline()) {
        var searchToken = ++liveSearchToken;
        resolveOriginLive(function (origin, label) {
          if (searchToken !== liveSearchToken) return;   // a newer search replaced this one
          // No location and nothing typed: do NOT quietly search somewhere
          // else (the demo origin is San Francisco). Say so and hand the
          // person the location field.
          if (!origin) { needLocation(); return; }
          if (label) state.originLabel = label;
          state.origin = origin;
          setOriginText($('deck-origin'));
          gmaps.searchNearby(origin, function (err, list, more) {
            if (searchToken !== liveSearchToken) return;
            if (err) {
              // A live search that cannot finish falls back to the sample
              // places rather than an empty deck — and says so plainly, on
              // screen and to screen readers. Every card it deals carries a
              // SAMPLE tag, so nothing here can be mistaken for real.
              if (offline.isOffline()) { offline.sync(); hideLiveNote(); loadDemoInto(origin); return; }
              settings.showError(err);
              showLiveNote(err + ' Sample places instead.');
              loadDemoInto(origin);
              // spoken last so the deck's own "N places matched" line does
              // not bury the reason the deck is full of sample places
              announce(err + ' Showing sample places instead.');
              return;
            }
            hideLiveNote();
            // new API: `more` is the sweeper (refills via refill()); legacy: a page handle
            state.sweeper = (more && more.sweep) ? more : null;
            state.nextPage = (more && !more.sweep) ? more : null;
            state.hasMore = !!state.nextPage;
            deliver(list, origin);
          });
        });
      } else {
        // DEMO MODE — instant. (Also the quiet offline path: no network,
        // no live calls — the demo kitchen is always open.)
        state.originLabel = state.originLabel || 'near you';
        loadDemoInto(state.origin || DEMO_ORIGIN);
      }
    }

    var liveSearchToken = 0;
    var sweepNoMatch = 0;   // consecutive sweep refills that added no card the filters allow

    /* Live: figure out the search origin (typed location, or geolocation).
       cb(null) means "no usable location" — the caller says so. */
    function resolveOriginLive(cb) {
      if (state.origin && state.originLabel && state.originLabel !== 'near you') {
        cb(state.origin, state.originLabel);
        return;
      }
      if (!navigator.geolocation) { cb(null); return; }
      var settled = false;
      function once(o, l) { if (settled) return; settled = true; cb(o, l); }
      navigator.geolocation.getCurrentPosition(
        function (pos) { once({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 'near you'); },
        function () { once(null); },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      );
    }

    /* Live mode, no location: back to the landing with the location field
       open and focused, and one calm line saying what to do. */
    function needLocation() {
      var msg = 'I couldn\u2019t get your location \u2014 type a place under \u201csearch a specific location\u201d.';
      showLanding();
      var form = $('loc-form'), reveal = $('loc-reveal'), inp = $('loc-input');
      if (form) form.hidden = false;
      if (reveal) reveal.setAttribute('aria-expanded', 'true');
      showLiveNote(msg);
      announce(msg);
      try { window.scrollTo(0, 0); } catch (e) {}   // the note sits at the top; make sure it is in view
      if (inp) { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } }
    }

    /* DEMO: all sample restaurants, re-based near the origin, nearest-first. */
    function loadDemoInto(origin) {
      var list = demoResults();
      if (origin && (origin.lat !== DEMO_ORIGIN.lat || origin.lng !== DEMO_ORIGIN.lng)) {
        var dLat = origin.lat - DEMO_ORIGIN.lat;
        var dLng = origin.lng - DEMO_ORIGIN.lng;
        list.forEach(function (r) {
          r.location = { lat: r.location.lat + dLat, lng: r.location.lng + dLng };
          r.distance = haversineMiles(origin, r.location);
        });
      }
      state.hasMore = false;
      state.nextPage = null;
      setOriginText($('deck-origin'));
      deliver(list, origin || DEMO_ORIGIN);
    }

    /* Sort nearest-first, apply prefs filters + distance cap, feed the deck. */
    function deliver(list, origin) {
      state.results = (list || []).slice();
      if (origin) state.origin = origin;
      state.results.sort(function (a, b) {
        if (a.distance == null) return 1;
        if (b.distance == null) return -1;
        return a.distance - b.distance;
      });
      var matched = filterByPrefs(state.results);
      // seen memory: places you passed on recently sink to the back of the
      // deck (nearest-first within each group) instead of repeating up front
      var seen = store.getSeen();
      var unseen = matched.filter(function (r) { return !seen[r.id]; });
      var repeats = matched.filter(function (r) { return seen[r.id]; });
      var ordered = unseen.concat(repeats);
      if (surprisePending) { surprisePending = false; deck.surprise(ordered); }
      else deck.load(ordered, unseen.length);
    }

    /* Apply the active preferences as filters. Distance cap included. */
    function filterByPrefs(list) {
      var p = state.prefs || prefs.defaults();
      var cap = state.distanceCap;
      return list.filter(function (r) {
        if (cap != null && r.distance != null && r.distance > cap) return false;
        if (p.openNow && r.open !== true) return false;
        // rating: app 0-100 scale; r.rating is 0-5 (Google) -> x20
        if (p.minRating && (r.rating * 20) < p.minRating) return false;
        if (p.minReviews && (r.reviews || 0) < p.minReviews) return false;
        if (p.price && p.price.length) {
          if (!r.price || p.price.indexOf(r.price) === -1) return false;
        }
        if (p.cuisine && p.cuisine.length) {
          var cz = r.cuisines || [];
          var hit = p.cuisine.some(function (c) { return cz.indexOf(c) !== -1; });
          if (!hit) return false;
        }
        if (p.dietary && p.dietary.length) {
          var dt = r.diet || [];
          var allDiet = p.dietary.every(function (d) { return dt.indexOf(d) !== -1; });
          if (!allDiet) return false;
        }
        if (p.dining && p.dining.length) {
          var dn = r.dining || [];
          var anyDine = p.dining.some(function (d) { return dn.indexOf(d) !== -1; });
          if (!anyDine) return false;
        }
        // extras: ALL selected must match (like dietary). Live (Google Places)
        // results don't carry these attributes — when r.extras is undefined
        // the place passes unfiltered rather than vanishing.
        if (p.extras && p.extras.length && r.extras !== undefined) {
          var ex = r.extras || [];
          var allExtras = p.extras.every(function (x) { return ex.indexOf(x) !== -1; });
          if (!allExtras) return false;
        }
        return true;
      });
    }

    /* ---- Sweep refill (new Places API) ----
       One probe per call. The deck asks when its un-swiped queue runs low
       (or empty); the answer is filtered by the active preferences and
       binary-inserted into the deck's upcoming queue by distance from the
       USER. Chains while the deck still wants more, but only while probes
       keep adding cards (3 fruitless ones in a row pause until the person
       swipes on) unless the person is already waiting at the end. */
    function sweepInfo() { return state.sweeper ? state.sweeper.info() : null; }
    function sweepOpen() { var i = sweepInfo(); return !!(i && i.state === 'open'); }
    function addResults(list) {
      if (!list || !list.length) return;
      state.results = state.results.concat(list);
      state.results.sort(function (a, b) {
        if (a.distance == null) return 1;
        if (b.distance == null) return -1;
        return a.distance - b.distance;
      });
    }
    function refill() {
      var sw = state.sweeper;
      if (!sw || state.loadingMore || !sweepOpen()) return;
      state.loadingMore = true;
      var tok = liveSearchToken;
      sw.fetch(function (err, fresh) {
        if (tok !== liveSearchToken || sw !== state.sweeper) return;   // a newer search replaced this one
        state.loadingMore = false;
        if (err) {
          if (offline.isOffline()) offline.sync();
          else {
            showLiveNote(err + ' Showing the places already found.');
            announce(err + ' No more places for now.');
            deck.layout();   // the note takes room above the deck: refit it above the tab bar
          }
          deck.sweepSettled();
          return;
        }
        addResults(fresh);
        var matched = filterByPrefs(fresh);
        deck.insertMore(matched);
        sweepNoMatch = matched.length ? 0 : sweepNoMatch + 1;
        if (!sweepOpen()) { deck.sweepSettled(); return; }
        if (deck.wantsMore() && (deck.isWaiting() || sweepNoMatch < 3)) refill();
      });
    }

    /* Live "Search farther": sweep -> widen the radius one step (explicit
       choice, only offered once the current radius is fully covered); legacy
       path -> next page. Both: append -> re-filter -> deck. */
    function searchFarther(cb) {
      if (state.sweeper) {
        if (!state.sweeper.info().canExtend || state.loadingMore) { if (cb) cb([]); return; }
        var rel = state.sweeper.extend();
        sweepNoMatch = 0;
        addResults(rel);
        if (cb) cb(filterByPrefs(rel));
        return;
      }
      if (!store.getKey() || !state.hasMore || state.loadingMore) { if (cb) cb([]); return; }
      state.loadingMore = true;
      if (state.nextPage && typeof state.nextPage.fetch === 'function') {
        state.nextPage.fetch(function (err, list, more) {
          state.loadingMore = false;
          if (err) {
            if (offline.isOffline()) offline.sync();
            else { settings.showError(err); showLiveNote(err + ' No more live places for now.'); announce(err); }
            state.hasMore = false; if (cb) cb([]); return;
          }
          state.nextPage = more || null;
          state.hasMore = !!more;
          var seen = {};
          state.results.forEach(function (r) { seen[r.id] = true; });
          var fresh = (list || []).filter(function (r) { return !seen[r.id]; });
          state.results = state.results.concat(fresh);
          state.results.sort(function (a, b) { return (a.distance || 0) - (b.distance || 0); });
          if (cb) cb(filterByPrefs(fresh));
        });
      } else {
        state.loadingMore = false; state.hasMore = false; if (cb) cb([]);
      }
    }
    function hasFarther() {
      if (state.sweeper) return !!state.sweeper.info().canExtend;
      return !!(store.getKey() && state.hasMore);
    }

    /* --- Quiet wash forward into the wizard ---
       Tapping the primary CTA fades the landing out, then shows the
       Preferences wizard with a gentle wash-in. A brief crossfade, nothing
       more — no droplet burst, no orb choreography. Under reduced motion the
       transition is instant. */
    var leaving = false;
    function popAndStart() {
      if (leaving) return;
      if (prefersReducedMotion || !landingEl) { showPrefs(true); return; }
      leaving = true;
      landingEl.classList.add('is-leaving');
      window.setTimeout(function () {
        showPrefs(true);
        landingEl.classList.remove('is-leaving');
        leaving = false;
        if (prefsWrap) {
          prefsWrap.classList.add('is-washing-in');
          window.setTimeout(function () { prefsWrap.classList.remove('is-washing-in'); }, 440);
        }
      }, 240);
    }

    function init() {
      var cta = $('find-near-me');
      if (cta) cta.addEventListener('click', function () {
        // "near me" means the device's location, never a place typed earlier
        // (a failed or old typed lookup must not hijack it).
        state.origin = null; state.originLabel = null;
        popAndStart();
      });

      var prefsBack = $('prefs-back');
      if (prefsBack) prefsBack.addEventListener('click', showLanding);
      var deckBack = $('deck-back');
      // the deck (and this button with it) disappears — focus has to travel
      // to the wizard, like every other route into it
      if (deckBack) deckBack.addEventListener('click', function () { showPrefs(true); });

      // "search a specific location" — reveal the input on demand (kept)
      var reveal = $('loc-reveal');
      var form = $('loc-form');
      var locInput = $('loc-input');
      if (reveal && form) {
        reveal.addEventListener('click', function () {
          var open = !form.hidden;
          form.hidden = open;
          reveal.setAttribute('aria-expanded', open ? 'false' : 'true');
          if (!open && locInput) locInput.focus();
        });
      }
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var q = locInput ? locInput.value.trim() : '';
          if (!q) { if (locInput) locInput.focus(); return; }
          if (store.getKey() && !offline.isOffline()) {
            gmaps.geocode(q, function (err, origin) {
              if (err || !origin) {
                // Calm and honest: say what happened once, keep the typed
                // text, offer a retry. The key sheet is not touched — a failed
                // lookup is not a key problem, and the other searches still work.
                var msg = err || 'Could not find that place \u2014 try a city or a fuller address.';
                showLiveNote(msg, function () { if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true })); });
                announce(msg);
                try { window.scrollTo(0, 0); } catch (x) {}
                return;
              }
              hideLiveNote();
              state.originLabel = q;
              state.origin = origin;
              showPrefs(true);
            });
          } else {
            state.originLabel = q;
            showPrefs(true);
          }
        });
      }

      prefs.init();
      deck.init();
      syncHeaderChrome();
    }

    return {
      init: init,
      showLanding: showLanding,
      showPrefs: showPrefs,
      showDeck: showDeck,
      showPick: showPick,
      showSurprise: showSurprise,
      syncHeaderChrome: syncHeaderChrome,
      refreshLanding: refreshLanding,
      syncDemoNote: syncDemoNote,
      startSearch: startSearch,
      showLiveNote: showLiveNote,
      hideLiveNote: hideLiveNote,
      searchFarther: searchFarther,
      hasFarther: hasFarther,
      refill: refill,
      sweepInfo: sweepInfo,
      sweepOpen: sweepOpen,
      sweepActive: function () { return !!state.sweeper; },
      sweepRefillAt: function () { return SWEEP.refillAt; },
      filterByPrefs: filterByPrefs
    };
  })();

  /* ================================================================== *
   * PREFS — tap-based preference controls, persisted to `eats-prefs`.
   * All optional; everything defaults to "Any". Repeat use is instant.
   * ================================================================== */
  var prefs = (function () {
    var CUISINES = [
      ['italian', 'Italian'], ['japanese', 'Japanese'], ['mexican', 'Mexican'],
      ['thai', 'Thai'], ['indian', 'Indian'], ['chinese', 'Chinese'],
      ['american', 'American'], ['mediterranean', 'Mediterranean'], ['korean', 'Korean'],
      ['vietnamese', 'Vietnamese'], ['pizza', 'Pizza'], ['burgers', 'Burgers'],
      ['seafood', 'Seafood'], ['cafe', 'Café/Bakery'], ['bbq', 'BBQ'], ['vegetarian', 'Vegetarian']
    ];
    var DIETARY = [['vegetarian', 'Vegetarian'], ['vegan', 'Vegan'], ['gluten-free', 'Gluten-free']];
    var DINING = [['dine-in', 'Dine-in'], ['takeout', 'Takeout'], ['delivery', 'Delivery']];
    var EXTRAS = [
      ['outdoor', 'Outdoor seating'], ['groups', 'Good for groups'],
      ['alcohol', 'Serves alcohol'], ['kids', 'Kid-friendly']
    ];
    var RATINGS = [[0, 'Any'], [70, '70+'], [80, '80+'], [90, '90+']];
    var REVIEWS = [[0, 'Any'], [100, '100+'], [500, '500+'], [1000, '1000+']];
    var DISTANCES = [['walk', 'Walking'], ['drive', 'Short drive'], ['any', 'Anywhere']];

    function defaults() {
      return {
        cuisine: [], price: [], minRating: 0, minReviews: 0,
        openNow: false, distance: 'any', dietary: [], dining: [], extras: []
      };
    }

    var cur = null;
    function current() { return cur || (cur = load()); }

    function load() {
      var saved = store.getPrefs();
      var d = defaults();
      if (!saved) return d;
      if (Array.isArray(saved.cuisine)) d.cuisine = saved.cuisine;
      if (Array.isArray(saved.price)) d.price = saved.price.map(Number).filter(function (n) { return n >= 1 && n <= 4; });
      if (typeof saved.minRating === 'number') d.minRating = saved.minRating;
      if (typeof saved.minReviews === 'number') d.minReviews = saved.minReviews;
      if (typeof saved.openNow === 'boolean') d.openNow = saved.openNow;
      if (typeof saved.distance === 'string') d.distance = saved.distance;
      if (Array.isArray(saved.dietary)) d.dietary = saved.dietary;
      if (Array.isArray(saved.dining)) d.dining = saved.dining;
      if (Array.isArray(saved.extras)) d.extras = saved.extras;
      return d;
    }
    function persist() { store.setPrefs(cur); }

    function buildChips(container, items, key, opts) {
      opts = opts || {};
      if (!container) return;
      clear(container);
      var withAny = opts.any !== false;
      if (withAny) {
        var any = el('button', 'pref-chip is-any' + (cur[key].length === 0 ? ' is-on' : ''), 'Any');
        any.type = 'button';
        any.setAttribute('aria-pressed', cur[key].length === 0 ? 'true' : 'false');
        any.addEventListener('click', function () {
          cur[key] = []; persist(); buildChips(container, items, key, opts); updateCount();
        });
        container.appendChild(any);
      }
      items.forEach(function (it) {
        var val = it[0], label = it[1];
        var on = cur[key].indexOf(val) !== -1;
        var c = el('button', 'pref-chip' + (on ? ' is-on' : ''), label);
        c.type = 'button';
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
        c.addEventListener('click', function () {
          var i = cur[key].indexOf(val);
          if (i === -1) cur[key].push(val); else cur[key].splice(i, 1);
          persist(); buildChips(container, items, key, opts); updateCount();
        });
        container.appendChild(c);
      });
    }

    function buildSeg(container, items, key) {
      if (!container) return;
      clear(container);
      items.forEach(function (it) {
        var val = it[0], label = it[1];
        var on = cur[key] === val;
        var isAny = (val === 0 || val === 'any');
        var b = el('button', 'seg-btn' + (on ? ' is-on' : '') + (isAny ? ' is-any' : ''), label);
        b.type = 'button';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.addEventListener('click', function () {
          cur[key] = val; persist(); buildSeg(container, items, key); updateCount();
        });
        container.appendChild(b);
      });
    }

    function buildPrice() {
      var container = $('pref-price');
      if (!container) return;
      clear(container);
      var any = el('button', 'pref-chip is-any' + (cur.price.length === 0 ? ' is-on' : ''), 'Any');
      any.type = 'button';
      any.setAttribute('aria-pressed', cur.price.length === 0 ? 'true' : 'false');
      any.addEventListener('click', function () { cur.price = []; persist(); buildPrice(); updateCount(); });
      container.appendChild(any);
      [1, 2, 3, 4].forEach(function (lvl) {
        var on = cur.price.indexOf(lvl) !== -1;
        var c = el('button', 'pref-chip' + (on ? ' is-on' : ''), priceStr(lvl));
        c.type = 'button';
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
        c.setAttribute('aria-label', 'Price level ' + lvl);
        c.addEventListener('click', function () {
          var i = cur.price.indexOf(lvl);
          if (i === -1) cur.price.push(lvl); else cur.price.splice(i, 1);
          persist(); buildPrice(); updateCount();
        });
        container.appendChild(c);
      });
    }

    function updateCount() {
      var countEl = $('prefs-count');
      if (!countEl) return;
      // The count is measured against the built-in SAMPLE catalog, which says
      // nothing about real places: with a usable key (live mode) it is hidden
      // rather than shown as if it were a live number.
      if (liveMode()) { countEl.textContent = ''; countEl.hidden = true; return; }
      countEl.hidden = false;
      // Live preview against the demo catalog (instant, no network) so the
      // user sees prefs bite immediately. Live mode filters real results too.
      state.prefs = cur;
      state.distanceCap = (cur.distance === 'walk') ? 1.2 : (cur.distance === 'drive' ? 5 : null);
      var pool = demoResults();
      var n = find.filterByPrefs(pool).length;
      countEl.textContent = n + ' sample place' + (n === 1 ? '' : 's') + ' match';
    }

    /* ---- one-at-a-time wizard over the pref groups ----
       Long scroll replaced by steps: one group visible at a time, Back /
       Skip to move, and the Start swiping + Surprise me escape hatches
       always in reach — quit the preferences early whenever you're done. */
    var step = 0;
    /* single-step mode: the end-of-deck "adjust one thing" chips open the
       wizard at exactly one question — Done → goes straight back to a
       fresh search instead of walking the remaining steps. */
    var single = false;
    function stepGroups() {
      return Array.prototype.slice.call(document.querySelectorAll('#prefs-form .pref-group'));
    }
    function showStep(i, focusLegend) {
      var groups = stepGroups();
      if (!groups.length) return;
      step = Math.max(0, Math.min(groups.length - 1, i));
      for (var g = 0; g < groups.length; g++) {
        groups[g].classList.toggle('is-step', g === step);
      }
      var back = $('step-back');
      var next = $('step-next');
      var where = $('step-where');
      if (back) back.style.visibility = (step === 0 || single) ? 'hidden' : 'visible';
      if (next) next.textContent = (single || step === groups.length - 1) ? 'Done →' : 'Continue →';
      var legend = groups[step].querySelector('.pref-legend');
      var title = legend ? legend.textContent.replace(/\(optional\)/, '').trim() : '';
      if (where) where.textContent = single ? 'just this one' : ((step + 1) + ' of ' + groups.length);
      announce(single
        ? (title + ' — change what you like, then Done to re-deal the deck.')
        : (title + ' — step ' + (step + 1) + ' of ' + groups.length));
      if (focusLegend && legend) { legend.setAttribute('tabindex', '-1'); legend.focus(); }
    }
    function nextStep() {
      var groups = stepGroups();
      if (single || step >= groups.length - 1) {
        // single-step tweak finished, or skipped past the last step —
        // you're done: start the search
        single = false;
        persist();
        find.showDeck();
        return;
      }
      showStep(step + 1, true);
    }
    /* find the wizard step whose fieldset contains the control `id` —
       robust against steps being reordered in the HTML */
    function stepIndexFor(id) {
      var groups = stepGroups();
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].querySelector('#' + id)) return i;
      }
      return 0;
    }
    /* open the wizard at just the step holding control `id` (single-step
       mode). Call AFTER find.showPrefs() — render() resets the mode. */
    function jumpTo(id) {
      single = true;
      showStep(stepIndexFor(id), true);
    }

    function render() {
      current();
      buildChips($('pref-cuisine'), CUISINES, 'cuisine');
      buildChips($('pref-dietary'), DIETARY, 'dietary', { any: false });
      buildChips($('pref-dining'), DINING, 'dining', { any: false });
      buildChips($('pref-extras'), EXTRAS, 'extras', { any: false });
      buildPrice();
      buildSeg($('pref-rating'), RATINGS, 'minRating');
      buildSeg($('pref-reviews'), REVIEWS, 'minReviews');
      buildSeg($('pref-distance'), DISTANCES, 'distance');
      var openTgl = $('pref-open');
      if (openTgl) openTgl.checked = !!cur.openNow;
      updateCount();
      single = false;        // full wizard unless jumpTo() re-enters single-step
      showStep(0, false); // every visit starts the wizard from the top
    }

    function init() {
      var form = $('prefs-form');
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          persist();
          find.showDeck();
        });
      }
      var back = $('step-back');
      if (back) back.addEventListener('click', function () { showStep(step - 1, true); });
      var next = $('step-next');
      if (next) next.addEventListener('click', nextStep);
      var surprise = $('prefs-surprise');
      if (surprise) surprise.addEventListener('click', function () {
        current(); persist(); find.showSurprise();
      });
      var openTgl = $('pref-open');
      if (openTgl) openTgl.addEventListener('change', function () {
        cur.openNow = openTgl.checked; persist(); updateCount();
      });
    }

    /* key -> human label across every preference vocabulary (cuisine,
       dietary, dining, extras). The match-reason chips speak the user's
       own words back to them, so they read labels from here rather than
       keeping a second copy of the list. Built once, lazily. */
    var LABELS = null;
    function labelFor(key) {
      if (!LABELS) {
        LABELS = {};
        [CUISINES, DIETARY, DINING, EXTRAS].forEach(function (set) {
          set.forEach(function (it) { if (!(it[0] in LABELS)) LABELS[it[0]] = it[1]; });
        });
      }
      return LABELS[key] || String(key);
    }

    return { init: init, render: render, current: current, defaults: defaults, jumpTo: jumpTo, labelFor: labelFor };
  })();

  /* ================================================================== *
   * MATCH REASONS — "why this pick"
   *
   * A card states FACTS (score, price, distance, open state). These chips
   * state the JUDGEMENT behind showing you the place: which of your own
   * preferences it answers, whose verdict backs it, whether it is close
   * enough to just walk. Everything below is derived from signals that
   * already exist in the app — your saved prefs, the real distance, the
   * shared openState(), your Visited log, your friends' feed. Nothing is
   * invented: if a place answers nothing, it gets no chips at all.
   *
   * Each candidate carries:
   *   group   one chip per group, max — keeps the row from repeating itself
   *   weight  usefulness. Personal history (100/96) > a friend's verdict
   *           (90/86) > a preference you explicitly set (84-80) > pure
   *           proximity (78-70) > quality (76-68) > urgency (72) >
   *           softer preference matches (66-54). Generic facts score low
   *           and therefore lose their slot to anything concrete.
   *   texts   phrasings, most concrete first. DEDUPE walks this list and
   *           takes the first phrasing the surrounding UI is not already
   *           showing, so a chip never parrots the line above it (e.g.
   *           "4 min walk" is dropped next to the card's travel hint and
   *           becomes "practically next door"). If every phrasing is
   *           already on screen the whole reason is dropped.
   * ================================================================== */

  /* One glyph family per reason kind; the kind also names the CSS modifier
     so the chip picks up its pigment (sage / gold / pond / wisteria / rose). */
  var REASON_GLYPH = {
    pref:   '✓', // ✓  answers something you asked for
    rating: '★', // ★  quality
    near:   '◎', // ◎  proximity
    time:   '◷', // ◷  hours
    mine:   '♡', // ♡  your own visit
    friend: '✧'  // ✧  a friend's visit
  };

  /* Normalise a phrase for the dedupe test: lowercase, punctuation to
     spaces, and drop the filler words that make two identical claims look
     different ("you rated THIS 82" vs "you rated IT 82"). */
  var REASON_STOP = { a: 1, an: 1, the: 1, is: 1, it: 1, this: 1, that: 1, at: 1, of: 1, and: 1, to: 1, in: 1 };
  function normReason(s) {
    var words = String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ');
    var out = [];
    for (var i = 0; i < words.length; i++) {
      if (words[i] && !REASON_STOP[words[i]]) out.push(words[i]);
    }
    return out.join(' ');
  }

  /* Honest relative claim: is this among the best-rated of what we actually
     found? Needs a real pool to compare against, else we say nothing. */
  function isTopRatedNearby(r) {
    var pool = (state.results || []).filter(function (x) { return x.rating; });
    if (!r.rating || pool.length < 5) return false;
    var better = 0;
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].id !== r.id && pool[i].rating > r.rating) better++;
    }
    return better < 3;
  }

  /* The warmest thing a friend said about this place (highest overall). */
  function bestFriendRating(name) {
    if (BETA) return null;   // friends' ratings are sample data: not in the beta
    var list = (social && social.ratingsFor) ? social.ratingsFor(name) : [];
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var o = overallOf(list[i]);
      if (!best || o > best.overall) best = { entry: list[i], overall: o };
    }
    return best;
  }
  function firstName(n) { return String(n == null ? '' : n).split(' ')[0]; }

  /* Will it still be open `hours` from now? Asked by probing the SHARED
     openState() at a future clock rather than re-deriving the hours math. */
  function stillOpenIn(r, hours) {
    var st = openState(r, new Date(Date.now() + hours * 3600000));
    return !!st && (st.key === 'open' || st.key === 'soon');
  }

  /* Build the ranked candidate list (before dedupe / capping). */
  function reasonCandidates(r) {
    var p = state.prefs || (prefs && prefs.current()) || {};
    var out = [];
    function add(group, weight, kind, texts) {
      out.push({ group: group, weight: weight, kind: kind, texts: texts });
    }
    var i;

    // --- you have been here, and it went well -------------------------
    var mine = myRatingFor(r.name);
    if (mine) {
      var mo = overallOf(mine);
      if (mo >= 78) add('mine', 100, 'mine', ['You rated it ' + fmtScore(mo), 'You loved it last time']);
      else if (mo >= 62) add('mine', 96, 'mine', ['You rated it ' + fmtScore(mo), 'You liked it before']);
    }

    // --- a friend's verdict -------------------------------------------
    var fr = bestFriendRating(r.name);
    if (fr) {
      var fn = firstName(fr.entry.friend && fr.entry.friend.name);
      if (fn && fr.overall >= 85) add('friend', 90, 'friend', [fn + ' loved it']);
      else if (fn && fr.overall >= 72) add('friend', 86, 'friend', [fn + ' rated it well']);
    }

    // --- a cuisine you picked -----------------------------------------
    if (p.cuisine && p.cuisine.length) {
      var cz = r.cuisines || [];
      for (i = 0; i < p.cuisine.length; i++) {
        if (cz.indexOf(p.cuisine[i]) !== -1) {
          add('cuisine', 84, 'pref', [prefs.labelFor(p.cuisine[i]) + ' — your pick']);
          break;
        }
      }
    }

    // --- a dietary need you set (all of them must be met) --------------
    if (p.dietary && p.dietary.length) {
      var dt = r.diet || [];
      var allDiet = p.dietary.every(function (d) { return dt.indexOf(d) !== -1; });
      if (allDiet) add('diet', 82, 'pref', [prefs.labelFor(p.dietary[0]) + ', as you asked']);
    }

    // --- close by ------------------------------------------------------
    if (r.distance != null) {
      if (p.distance === 'walk' && r.distance <= 1.3) {
        add('near', 80, 'near', [fmtTravel(r.distance), 'Close enough to walk']);
      } else if (r.distance <= 0.25) {
        add('near', 78, 'near', [fmtTravel(r.distance), 'Practically next door']);
      } else if (r.distance <= 0.5) {
        add('near', 70, 'near', [fmtTravel(r.distance), 'A short stroll away']);
      }
    }

    // --- how well it is rated ------------------------------------------
    var score = r.rating ? r.rating * 20 : 0;
    if (p.minRating && score >= p.minRating) {
      add('rating', 76, 'rating', ['Above your ' + p.minRating + ' bar']);
    } else if (score >= 90 && isTopRatedNearby(r)) {
      add('rating', 74, 'rating', ['One of the best nearby']);
    } else if (score >= 90 && (r.reviews || 0) >= 200) {
      // a high score with only a handful of votes isn't a reason yet
      add('rating', 68, 'rating', ['Very well loved']);
    }

    // --- the clock (reads the shared openState, never its own math) -----
    var ost = openState(r);
    if (ost && ost.key === 'soon') {
      add('time', 72, 'time', ['Closing soon — go now']);
    } else if (ost && ost.key === 'open' && r.closeH != null && stillOpenIn(r, 2)) {
      add('time', 58, 'time', ['Open till ' + fmtHour(r.closeH)]);
    }

    // --- price band you chose -------------------------------------------
    if (p.price && p.price.length && r.price && p.price.indexOf(r.price) !== -1) {
      add('price', 66, 'pref', ['Right in your price range']);
    }

    // --- how you want to eat --------------------------------------------
    if (p.dining && p.dining.length) {
      var dn = r.dining || [];
      for (i = 0; i < p.dining.length; i++) {
        if (dn.indexOf(p.dining[i]) !== -1) {
          add('dining', 62, 'pref', [prefs.labelFor(p.dining[i]) + ', as you asked']);
          break;
        }
      }
    }

    // --- the extras you ticked (live results carry none: r.extras undefined)
    if (p.extras && p.extras.length && r.extras) {
      var ex = r.extras || [];
      var allExtras = p.extras.every(function (x) { return ex.indexOf(x) !== -1; });
      if (allExtras) add('extras', 60, 'pref', [prefs.labelFor(p.extras[0]) + ', as you asked']);
    }

    // --- enough reviews to trust it --------------------------------------
    if (p.minReviews && (r.reviews || 0) >= p.minReviews) {
      add('reviews', 54, 'pref', ['Plenty of reviews behind it']);
    }

    return out;
  }

  /* matchReasons(place, { max, shown })
       max    how many chips this surface can hold (card 2, decision 3)
       shown  the text that surface is ALREADY displaying — used to dedupe
     Returns [] (render nothing) when nothing meaningful qualifies. */
  function matchReasons(r, opts) {
    if (!r) return [];
    opts = opts || {};
    var max = opts.max || 3;
    var shown = normReason(opts.shown || '');
    // `skip` drops whole groups a surface already says louder than a chip
    // could (the card's "You rated this 82" pill vs a `mine` verdict chip):
    // text dedupe can't catch that, and on a 2-slot surface the echo costs
    // half the reasons.
    var skip = opts.skip || {};
    var cands = reasonCandidates(r);
    cands.sort(function (a, b) { return b.weight - a.weight; });
    var seenGroup = {};
    var picked = [];
    for (var i = 0; i < cands.length && picked.length < max; i++) {
      var c = cands[i];
      if (skip[c.group]) continue;
      if (seenGroup[c.group]) continue;
      var text = null;
      for (var t = 0; t < c.texts.length; t++) {
        var n = normReason(c.texts[t]);
        if (!n) continue;
        if (shown && shown.indexOf(n) !== -1) continue; // already on screen
        text = c.texts[t];
        break;
      }
      if (!text) continue;      // every phrasing would only echo the UI
      seenGroup[c.group] = true;
      picked.push({ group: c.group, kind: c.kind, glyph: REASON_GLYPH[c.kind] || '', text: text });
      shown = shown ? (shown + ' ' + normReason(text)) : normReason(text);
    }
    return picked;
  }

  /* A row of reason chips, or null when there is nothing to say.
     `base` names the class family ('ov-reason' on cards, 'decision-reason'
     on the pick screen) so each surface keeps its own sizing. The row is a
     list so AT reads the chips as discrete items in rank order; the glyphs
     are decorative and hidden. Nothing here is focusable — these are text. */
  function reasonsRowEl(list, base) {
    if (!list || !list.length) return null;
    var row = el('div', base + 's');
    row.setAttribute('role', 'list');
    row.setAttribute('aria-label', 'Why this one');
    for (var i = 0; i < list.length; i++) {
      var chip = el('span', base + ' ' + base + '--' + list[i].kind);
      chip.setAttribute('role', 'listitem');
      chip.style.setProperty('--i', String(i));
      var g = el('span', base + '-glyph', list[i].glyph);
      g.setAttribute('aria-hidden', 'true');
      chip.appendChild(g);
      chip.appendChild(el('span', base + '-text', list[i].text));
      row.appendChild(chip);
    }
    return row;
  }

  /* ================================================================== *
   * DECK — Tinder-style swipe stack.
   *
   * Cards are absolutely-stacked; the TOP card is the nearest matching
   * restaurant. Pass (left) reveals the next-nearest; Like (right) opens
   * the decision screen. Each card has 3 story segments (Vibe/Food/Reviews)
   * cycled by TAP (distinguished from drag). Full button + keyboard parity.
   * Drag is transform-only and rAF-throttled for 60fps.
   * ================================================================== */
  var deck = (function () {
    var deckEl = $('deck');
    var hintEl = $('deck-hint');
    var controlsEl = $('deck-controls');
    var decisionEl = $('decision');
    var endEl = $('deck-end');
    var btnNo = $('deck-no');
    var btnYes = $('deck-yes');
    var btnInfo = $('deck-info');
    var btnUndo = $('deck-undo');
    var shortlistEl = $('shortlist-view');
    var badgeEl = $('shortlist-badge');
    var rouletteEl = $('deck-roulette');
    var rouletteName = $('roulette-name');

    var queue = [];
    var idx = 0;
    var sortEnd = 0;        // queue[0..sortEnd) is the distance-sorted, not-recently-passed run (sweep inserts land here)
    var sweepOn = false;    // this queue belongs to a live sweep (refills may insert into it)
    var waitingMore = false; // at the end of the queue, quietly waiting on a sweep refill
    var topCard = null;
    var animating = false;
    var keyHandler = null;
    var history = [];   // swipes this deck: {i, id, dir} — fuels Undo
    var shortlist = []; // liked-and-saved places for this outing
    var peekEl = null;  // "coming up" strip — built lazily below the deck

    /* Match-reason chips per surface. Two on the card (the info scrap is
       narrow — three wrap to a second row and crowd the name), three on the
       decision screen, where the pick has to justify itself. */
    var CARD_REASON_MAX = 2;
    var DECISION_REASON_MAX = 3;


    /* ---- fit the swipe screen to the viewport (beta wave 2) ----
       The deck, its controls and the hint must ALL sit above the fixed tab
       bar, at any phone size. layout() measures the bar's real top edge and
       gives .deck-wrap exactly the room between its own top and that edge
       (the deck stage flexes to fill it); the big page header steps aside
       while swiping (.deck-on). fitTrio() then scales the card scatter down,
       only if it would otherwise spill out of the stage. Re-run on resize,
       rotation, tab switch and every re-render. */
    var fitMode = false;
    var layoutQueued = false;
    function fitTrio() {
      var trio = topCard && topCard.querySelector('.trio');
      if (!trio || !deckEl) return;
      trio.style.setProperty('--fit', '1');
      var kids = trio.children, lo = Infinity, hi = -Infinity;
      for (var i = 0; i < kids.length; i++) {
        lo = Math.min(lo, kids[i].offsetTop);
        hi = Math.max(hi, kids[i].offsetTop + kids[i].offsetHeight);
      }
      if (!isFinite(lo)) return;
      var need = (hi - lo) + 24 + 8;     // the scatter + the bars' top gutter
      var have = deckEl.clientHeight;
      var k = have > 0 && need > have ? Math.max(0.7, have / need) : 1;
      trio.style.setProperty('--fit', k.toFixed(3));
    }
    var safeProbe = null;
    function safeBottom() {   // env(safe-area-inset-bottom) in px (no bar to measure)
      try {
        if (!safeProbe) {
          safeProbe = el('div');
          safeProbe.setAttribute('aria-hidden', 'true');
          safeProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;padding-bottom:env(safe-area-inset-bottom,0px)';
          document.body.appendChild(safeProbe);
        }
        return parseFloat(window.getComputedStyle(safeProbe).paddingBottom) || 0;
      } catch (e) { return 0; }
    }
    function viewH() { return (window.visualViewport && window.visualViewport.height) || window.innerHeight; }
    function layout() {
      var wrap = $('deck-wrap'), room = $('room');
      var bar = document.querySelector('.bottom-bar-inner');
      if (!wrap || !room) return;
      var shown = !wrap.hidden && wrap.offsetParent !== null;
      room.classList.toggle('deck-on', shown);
      var barShown = !!bar && bar.offsetParent !== null;   // hidden when Find is the only tab
      if (!shown || !fitMode || !bar) {
        wrap.classList.remove('deck-fit');
        wrap.style.removeProperty('--deck-avail');
        room.classList.remove('deck-clamped', 'deck-swiping');
        return;
      }
      var top = wrap.getBoundingClientRect().top + (window.pageYOffset || 0);
      var floor = barShown ? bar.getBoundingClientRect().top : viewH() - 12 - safeBottom();
      var avail = Math.floor(floor - top - 10);
      var clamped = avail < 380;          // landscape / tiny: let the page scroll instead
      if (clamped) avail = 380;
      room.classList.toggle('deck-clamped', clamped);
      room.classList.toggle('deck-swiping', !clamped);   // the page itself does not scroll while swiping
      wrap.style.setProperty('--deck-avail', avail + 'px');
      wrap.classList.add('deck-fit');
      fitTrio();
    }
    function queueLayout() {
      if (layoutQueued) return;
      layoutQueued = true;
      window.requestAnimationFrame(function () { layoutQueued = false; layout(); });
    }
    window.addEventListener('resize', queueLayout);
    window.addEventListener('orientationchange', queueLayout);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', queueLayout);

    function setMode(mode) {
      var onDeck = mode === 'deck';
      fitMode = onDeck;
      if (deckEl) deckEl.style.display = onDeck ? '' : 'none';
      if (hintEl) hintEl.style.display = onDeck ? '' : 'none';
      if (controlsEl) controlsEl.style.display = onDeck ? '' : 'none';
      if (!onDeck && peekEl) peekEl.hidden = true; // renderPeek re-shows on deck
      if (decisionEl) decisionEl.hidden = mode !== 'decision';
      if (endEl) endEl.hidden = mode !== 'end';
      if (shortlistEl) shortlistEl.hidden = mode !== 'shortlist';
      if (rouletteEl) rouletteEl.hidden = mode !== 'roulette';
      layout();
    }

    function showLoading() {
      clearRoulette();
      waitingMore = false; sweepOn = false;
      setMode('deck');
      clear(deckEl);
      if (peekEl) peekEl.hidden = true;
      var l = el('div', 'deck-loading');
      l.appendChild(el('span', 'social-spinner', ''));
      l.appendChild(el('span', null, 'Finding places near you…'));
      deckEl.appendChild(l);
      setControlsEnabled(false);
    }

    function setControlsEnabled(on) {
      [btnNo, btnYes, btnInfo].forEach(function (b) { if (b) b.disabled = !on; });
    }

    function load(matched, unseenCount) {
      clearRoulette();
      queue = matched || [];
      sortEnd = (typeof unseenCount === 'number') ? unseenCount : queue.length;
      idx = 0;
      waitingMore = false;
      sweepOn = !!(find.sweepActive && find.sweepActive());
      history = [];
      updateUndo();
      clear(deckEl);
      setMode('deck');
      if (!queue.length) {
        // a live sweep may still find matches: wait quietly rather than
        // declaring "nothing matched" on the first 20
        if (sweepOn && find.sweepOpen()) { showFindingMore(); find.refill(); return; }
        showEnd(true); return;
      }
      renderStack(true); // deal the opening hand onto the table
      setControlsEnabled(true);
      announce(queue.length + ' places matched. Showing ' + queue[0].name + ', the nearest.');
      // the wizard's Start button is gone with the wizard — land on the card
      // itself, the same place "Back to swiping" returns you to
      if (topCard) topCard.focus();
      maybeRefill();
    }

    /* ---- live sweep hooks (see find.refill) ---- */
    function remaining() { return Math.max(0, queue.length - idx - 1); }
    function wantsMore() { return sweepOn && (idx >= queue.length || remaining() < find.sweepRefillAt()); }
    function isWaiting() { return waitingMore; }
    function maybeRefill() { if (wantsMore()) find.refill(); }

    /* first index in queue[lo,hi) whose distance is > d (stable: ties go after) */
    function upperBound(lo, hi, d) {
      while (lo < hi) {
        var mid = (lo + hi) >> 1, md = queue[mid].distance;
        if (md == null || md > d) hi = mid; else lo = mid + 1;
      }
      return lo;
    }

    /* Merge freshly swept places (already filtered by preferences, nearest
       first) into the upcoming queue by distance from the user. The current
       card and everything already shown are never touched; places passed on
       recently go behind the sorted run, like the first deal. */
    function insertMore(matched) {
      if (!matched || !matched.length) return;
      var seen = store.getSeen();
      if (idx >= queue.length) {
        // at the end (or waiting at it): lay the new run down and resume
        var unseenRun = matched.filter(function (r) { return !seen[r.id]; });
        var repeatRun = matched.filter(function (r) { return seen[r.id]; });
        var start = queue.length;
        queue = queue.concat(unseenRun, repeatRun);
        sortEnd = start + unseenRun.length;
        idx = start;
        var was = waitingMore;
        waitingMore = false;
        setMode('deck'); renderStack(true); setControlsEnabled(true);
        if (was) announce('Found more places nearby. Showing ' + queue[idx].name + '.');
        if (topCard) topCard.focus();
        return;
      }
      for (var k = 0; k < matched.length; k++) {
        var r = matched[k], lo, hi;
        if (seen[r.id]) { lo = Math.max(sortEnd, idx + 1); hi = queue.length; }
        else { lo = idx + 1; hi = Math.max(sortEnd, lo); }
        var pos = upperBound(lo, hi, r.distance == null ? Infinity : r.distance);
        queue.splice(pos, 0, r);
        if (!seen[r.id]) sortEnd = hi + 1;
      }
      renderPeek();   // the "coming up" strip; the card in hand is left alone
    }

    /* The sweep has nothing more to give (complete / budget / stalled /
       error): if the person is waiting at the end, tell them honestly. */
    function sweepSettled() {
      if (!waitingMore) return;
      waitingMore = false;
      showEnd(queue.length === 0);
    }

    /* Quiet "finding more nearby…" state at the end of a live sweep. */
    function showFindingMore() {
      waitingMore = true;
      clearRoulette();
      setMode('deck');
      clear(deckEl);
      if (peekEl) peekEl.hidden = true;
      var l = el('div', 'deck-loading is-more');
      l.appendChild(el('span', 'social-spinner', ''));
      l.appendChild(el('span', null, 'Finding more nearby…'));
      deckEl.appendChild(l);
      setControlsEnabled(false);
      announce('Finding more places nearby.');
    }

    function append(matched) {
      if (!matched || !matched.length) return;
      var wasEmpty = idx >= queue.length;
      queue = queue.concat(matched);
      if (wasEmpty) { idx = queue.length - matched.length; setMode('deck'); renderStack(); setControlsEnabled(true); }
      else renderStack();
    }

    /* renderStack(deal) — `deal` staggers the cards in with a rise-and-settle
       "laid on the table" animation (fresh deck loads only; CSS swaps it for
       a plain fade under prefers-reduced-motion). */
    function renderStack(deal) {
      clear(deckEl);
      for (var d = 2; d >= 0; d--) {
        var i = idx + d;
        if (i >= queue.length) continue;
        var card = buildCard(queue[i], d);
        // only the visible top card deals in — the rest of the stack is
        // hidden now that blocks float freely (no cards peeking behind)
        if (deal && d === 0) {
          card.classList.add('is-dealing');
          card.addEventListener('animationend', onDealEnd);
        }
        deckEl.appendChild(card);
      }
      topCard = deckEl.querySelector('.swipe-card[data-depth="0"]');
      if (topCard) prefetchUpcoming();
      renderPeek(deal);
      layout();
    }

    function onDealEnd(e) {
      var c = e.currentTarget;
      c.classList.remove('is-dealing');
      c.style.animationDelay = '';
      c.removeEventListener('animationend', onDealEnd);
    }

    /* ---- "coming up" peek strip ----
       A quiet, display-only preview of the next places in the queue: tiny
       circular watercolor thumbs with the distance beneath each. Strictly
       decorative — aria-hidden (announce() already gives card counts),
       pointer-events: none in CSS, no handlers. On a fresh deal the thumbs
       ripple in with a slight stagger after the top card lands (skipped
       under prefers-reduced-motion: they simply appear). */
    function ensurePeek() {
      if (peekEl || !deckEl || !deckEl.parentNode) return;
      peekEl = el('div', 'peek-strip');
      peekEl.setAttribute('aria-hidden', 'true');
      peekEl.hidden = true;
      peekEl.appendChild(el('p', 'peek-label', 'coming up'));
      peekEl.appendChild(el('div', 'peek-row'));
      // sits directly beneath the card stage, above the a11y note + controls
      deckEl.parentNode.insertBefore(peekEl, deckEl.nextSibling);
    }

    function renderPeek(deal) {
      ensurePeek();
      if (!peekEl) return;
      var row = peekEl.querySelector('.peek-row');
      clear(row);
      var upcoming = queue.slice(idx + 1, idx + 4); // the next (up to) 3
      if (!upcoming.length) { peekEl.hidden = true; return; }
      peekEl.hidden = false;
      for (var i = 0; i < upcoming.length; i++) {
        var r = upcoming[i];
        var item = el('span', 'peek-item');
        item.setAttribute('data-id', r.id);
        item.setAttribute('data-name', r.name);
        var thumb = el('span', 'peek-thumb');
        var seg = (r.segments && r.segments.food) || {};
        paintThumb(thumb, seg.photoUrl || r.photoUrl, panelArt(r, 'vibe', 0));
        item.appendChild(thumb);
        item.appendChild(el('span', 'peek-dist', fmtDist(r.distance)));
        if (deal && !prefersReducedMotion) {
          // ripple in once the main card has settled on the table
          item.classList.add('is-rippling');
          item.style.animationDelay = (620 + i * 90) + 'ms';
        }
        row.appendChild(item);
      }
    }

    /* ---- trio playlist ----
       The card face is THREE EQUAL floating blocks (vibe / food / review),
       all clearly visible at once; a single tap advances all three to the
       next set. Pools are interleaved round-robin, and when one category
       runs dry the others backfill its slot so every set holds three real
       things (e.g. one review + three vibe shots still fills every page). */
    function mediaPlaylist(r) {
      var segs = r.segments || {};
      var pools = { vibe: [], food: [], review: [] };
      var livePhotos = (!r.demo && r.photos && r.photos.length) ? r.photos : null;
      ['vibe', 'food'].forEach(function (k, ki) {
        var seg = segs[k] || {};
        if (!r.demo) {
          // LIVE place: Google gives no photo categories, so nothing here is
          // called vibe or food. Photos alternate across the two pools (each
          // distinct, never repeated), tagged neutrally; a missing photo is
          // one honest painted tile, not two.
          var got = 0;
          if (livePhotos) {
            for (var pi = ki; pi < livePhotos.length; pi += 2) {
              pools[k].push({ kind: k, photoUrl: livePhotos[pi].url, by: livePhotos[pi].by, uri: livePhotos[pi].uri,
                tag: pi === 0 ? 'Photo' : 'More photos' });
              got++;
            }
          }
          if (!got) pools[k].push({ kind: k, art: ki, tag: 'No photo' });
        } else if (seg.photoUrl) {
          pools[k].push({ kind: k, photoUrl: seg.photoUrl, caption: seg.caption || '' });
        } else {
          // demo (or photo-less live place): two art variants per category
          pools[k].push({ kind: k, art: 0, caption: seg.caption || '' });
          pools[k].push({ kind: k, art: 1, caption: seg.caption || '' });
        }
      });
      var quotes = (segs.reviews && segs.reviews.quotes) || [];
      quotes.slice(0, 3).forEach(function (q) { pools.review.push({ kind: 'review', quote: q }); });
      if (!pools.review.length) pools.review.push({ kind: 'review', quote: null });

      // round-robin interleave until every pool is dry
      var flat = [];
      var order = ['vibe', 'food', 'review'];
      var idx = { vibe: 0, food: 0, review: 0 };
      var remaining = pools.vibe.length + pools.food.length + pools.review.length;
      while (remaining > 0) {
        for (var i = 0; i < order.length; i++) {
          var k2 = order[i];
          if (idx[k2] < pools[k2].length) { flat.push(pools[k2][idx[k2]++]); remaining--; }
        }
      }
      // chunk into sets of three; a short last set backfills from the top
      var pages = [];
      for (var p = 0; p < flat.length; p += 3) pages.push(flat.slice(p, p + 3));
      var last = pages[pages.length - 1];
      var scan = 0;
      while (last.length < 3 && scan < flat.length) {
        if (last.indexOf(flat[scan]) === -1) last.push(flat[scan]);
        scan++;
      }
      return pages;
    }

    function buildCard(r, depth) {
      var card = el('article', 'swipe-card');
      card.dataset.depth = depth === 0 ? '0' : (depth === 1 ? '1' : '2');
      card.dataset.id = r.id;
      card.tabIndex = depth === 0 ? 0 : -1;
      card.setAttribute('role', 'group');
      card.setAttribute('aria-roledescription', 'restaurant card');
      card._page = 0;
      card._pages = mediaPlaylist(r);
      card._data = r;

      // set indicator bars — one per trio set
      var bars = el('div', 'seg-bars');
      for (var bi = 0; bi < card._pages.length; bi++) {
        bars.appendChild(el('span', 'seg-bar' + (bi === 0 ? ' is-on' : '')));
      }
      card.appendChild(bars);

      // the trio: three equal floating blocks + the info strip
      var trio = el('div', 'trio');
      for (var ti = 0; ti < 3; ti++) trio.appendChild(el('div', 'trio-block'));

      var yes = el('div', 'stamp stamp-yes', 'Yes');
      var no = el('div', 'stamp stamp-no', 'Nope');
      yes.setAttribute('aria-hidden', 'true');
      no.setAttribute('aria-hidden', 'true');
      card.appendChild(yes);
      card.appendChild(no);

      var ov = el('div', 'trio-info');
      ov.appendChild(el('h3', 'ov-name', r.name));
      var meta = el('div', 'ov-meta');
      if (r.rating) {
        var rt = el('span', 'ov-rating');
        rt.appendChild(el('span', 'ov-star', '★ '));
        rt.appendChild(document.createTextNode(fmtScore(r.rating * 20)));
        if (r.reviews) rt.appendChild(document.createTextNode(' (' + r.reviews.toLocaleString() + ')'));
        meta.appendChild(rt);
      }
      if (r.price) {
        meta.appendChild(el('span', 'ov-dot', '·'));
        meta.appendChild(el('span', 'ov-price', priceStr(r.price)));
      }
      if (r.type) {
        meta.appendChild(el('span', 'ov-dot', '·'));
        meta.appendChild(el('span', 'ov-cuisine', r.type));
      }
      if (r.distance != null) {
        // "away" dropped here — the travel chip right after says it better.
        // dist · travel live in one non-wrapping group so a narrow screen
        // never strands the separator dot at the end of a line.
        meta.appendChild(el('span', 'ov-dot', '·'));
        var dg = el('span', 'ov-distgroup');
        dg.appendChild(el('span', 'ov-dist', fmtDist(r.distance)));
        dg.appendChild(el('span', 'ov-dot', '·'));
        dg.appendChild(el('span', 'ov-travel', fmtTravel(r.distance)));
        meta.appendChild(dg);
      }
      var chip = openChipEl(r, 'ov-badge');
      if (chip) meta.appendChild(chip);
      // live mode dealing a sample card (the fallback deck) says so on the
      // card itself — the one place you would otherwise trust it as real.
      var sTag = sampleTagFor(r, 'ov-sample');
      if (sTag) meta.appendChild(sTag);
      ov.appendChild(meta);
      var mapsA = depth === 0 ? mapsLinkEl(r, 'maps-link') : null;   // top card only; null for sample places
      if (mapsA) ov.appendChild(mapsA);
      // your own Visited score, if you've eaten here before
      var mine = myRatingFor(r.name);
      if (mine) {
        var you = el('span', 'ov-you', 'You rated this ' + fmtScore(overallOf(mine)));
        ov.appendChild(you);
      }
      // "why this pick" — capped at CARD_REASON_MAX on the card: the info
      // scrap is only ~88% of a 390px card, and three chips push the row to
      // two lines and crowd the name. The pick screen shows the fuller set.
      // the card already prints a prominent "You rated this 82" pill, so a
      // `mine` verdict chip beside it would spend one of only two slots
      // repeating it — let a fresher reason have the room instead. The pick
      // screen keeps `mine`: there the score is buried in a long meta line.
      var reasons = matchReasons(r, {
        max: CARD_REASON_MAX,
        shown: cardShownText(r),
        skip: myRatingFor(r.name) ? { mine: true } : null
      });
      var reasonRow = reasonsRowEl(reasons, 'ov-reason');
      if (reasonRow) ov.appendChild(reasonRow);
      trio.appendChild(ov);
      card.appendChild(trio);

      renderTrio(card, false);
      card.setAttribute('aria-label', a11ySummary(r, reasons));

      if (depth === 0) attachDrag(card);
      return card;
    }

    /* Everything the card's info scrap prints, verbatim — the dedupe input
       for matchReasons(). Kept next to buildCard so the two stay in step. */
    function cardShownText(r) {
      var bits = [r.name];
      if (r.rating) bits.push(fmtScore(r.rating * 20));
      if (r.reviews) bits.push(r.reviews.toLocaleString());
      if (r.price) bits.push(priceStr(r.price));
      if (r.type) bits.push(r.type);
      if (r.distance != null) { bits.push(fmtDist(r.distance)); bits.push(fmtTravel(r.distance)); }
      var ost = openState(r);
      if (ost) bits.push(ost.label);
      var mine = myRatingFor(r.name);
      if (mine) bits.push('You rated this ' + fmtScore(overallOf(mine)));
      return bits.join(' · ');
    }

    function a11ySummary(r, reasons) {
      var bits = [r.name];
      if (r.rating) bits.push(fmtScore(r.rating * 20) + ' out of 100');
      if (r.reviews) bits.push(r.reviews.toLocaleString() + ' reviews');
      if (r.price) bits.push('price ' + priceStr(r.price));
      if (r.type) bits.push(r.type);
      if (r.distance != null) {
        bits.push(fmtDist(r.distance) + ' away');
        bits.push('about ' + fmtTravel(r.distance));
      }
      var ost = openState(r);
      if (ost) bits.push(ost.label.toLowerCase());
      var mine = myRatingFor(r.name);
      if (mine) bits.push('you rated it ' + fmtScore(overallOf(mine)) + ' before');
      if (sampleTagsOn() && isSampleResult(r)) bits.push('sample data');
      // the strongest match reason rides along in the label so the "why"
      // lands the moment you enter the card, not only when you read on
      if (reasons && reasons.length) bits.push('why this one: ' + reasons[0].text);
      return bits.join(', ');
    }

    /* paint the current set into the three blocks (+ the indicator bars) */
    function renderTrio(card, animate) {
      var r = card._data;
      var page = card._pages[card._page] || [];
      var blocks = card.querySelectorAll('.trio-block');
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        var item = page[i];
        clear(b);
        b.style.background = '';
        b.style.animationDelay = '';
        if (!item) { b.className = 'trio-block trio-review'; continue; }
        b.className = 'trio-block trio-' + item.kind;
        if (item.kind === 'review') {
          var q = item.quote;
          var qt = q && typeof q.text === 'string' ? q.text.trim() : '';
          // never a quote mark pair around nothing: no words -> a plain line
          if (qt) b.appendChild(el('p', 'trio-quote', '“' + qt + '”'));
          else b.appendChild(el('p', 'trio-quote', q ? 'Rated, no written review.' : 'No reviews yet — be the first to rate it.'));
          if (q && (q.score > 0 || q.by)) {
            var by = el('p', 'trio-by');
            if (q.score > 0) by.appendChild(el('span', 'trio-score', '★ ' + fmtScore(q.score)));
            if (q.by) by.appendChild(document.createTextNode((q.score > 0 ? ' · ' : '') + q.by));
            b.appendChild(by);
          }
        } else {
          // the watercolor panel IS the placeholder; a photo replaces it
          // only once it has loaded, and never if it fails.
          paintThumb(b, item.photoUrl, panelArt(r, item.kind, item.art || 0));
          if (item.caption) b.appendChild(el('span', 'trio-cap', item.caption));
          var cr = item.by ? photoCreditEl(item, 'trio-attr', false) : null;
          if (cr) b.appendChild(cr);
        }
        b.appendChild(el('span', 'trio-tag', item.tag || (item.kind === 'review' ? 'Review' : item.kind === 'vibe' ? 'Vibe' : 'Food')));
        if (animate && !prefersReducedMotion) {
          b.classList.remove('is-turn');
          void b.offsetWidth;
          b.style.animationDelay = (i * 70) + 'ms';
          b.classList.add('is-turn');
        }
      }
      var barsEls = card.querySelectorAll('.seg-bar');
      for (var j = 0; j < barsEls.length; j++) {
        barsEls[j].classList.toggle('is-on', j === card._page);
        barsEls[j].classList.toggle('is-done', j < card._page);
      }
    }

    /* one tap advances ALL THREE blocks to the next set */
    function cycleSegment(card) {
      if (!card || !card._pages) return;
      card._page = (card._page + 1) % card._pages.length;
      renderTrio(card, true);
      announce('Set ' + (card._page + 1) + ' of ' + card._pages.length + ' for ' + card._data.name);
    }

    function attachDrag(card) {
      var startX = 0, startY = 0, dx = 0, dy = 0, dragging = false, moved = false, pid = null;
      var raf = null;
      var THRESH = 0.28;
      var yesStamp = card.querySelector('.stamp-yes');
      var noStamp = card.querySelector('.stamp-no');

      function paint() {
        raf = null;
        var w = card.offsetWidth || 320;
        var rot = (dx / w) * 16;
        card.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + rot + 'deg)';
        var p = Math.max(-1, Math.min(1, dx / (w * THRESH)));
        if (yesStamp) yesStamp.style.opacity = p > 0 ? Math.min(1, p) : 0;
        if (noStamp) noStamp.style.opacity = p < 0 ? Math.min(1, -p) : 0;
      }
      function schedule() { if (raf == null) raf = window.requestAnimationFrame(paint); }

      function down(e) {
        if (animating) return;
        if (e.button != null && e.button !== 0) return;
        dragging = true; moved = false;
        startX = e.clientX; startY = e.clientY; dx = 0; dy = 0;
        pid = e.pointerId;
        card.classList.add('is-dragging');
        card.classList.remove('is-settling');
        card.classList.remove('is-dealing'); // grabbing a card ends its deal-in
        try { card.setPointerCapture(pid); } catch (err) {}
      }
      function move(e) {
        if (!dragging) return;
        dx = e.clientX - startX; dy = e.clientY - startY;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
        schedule();
      }
      function up() {
        if (!dragging) return;
        dragging = false;
        card.classList.remove('is-dragging');
        try { card.releasePointerCapture(pid); } catch (err) {}
        var w = card.offsetWidth || 320;
        var commit = Math.abs(dx) > w * THRESH;
        if (!moved) { cycleSegment(card); resetCard(); return; }
        if (commit) fling(dx > 0 ? 'yes' : 'no');
        else resetCard();
      }
      function resetCard() {
        card.classList.add('is-settling');
        card.style.transform = '';
        if (yesStamp) yesStamp.style.opacity = 0;
        if (noStamp) noStamp.style.opacity = 0;
        dx = 0; dy = 0;
      }

      card.addEventListener('pointerdown', down);
      card.addEventListener('pointermove', move);
      card.addEventListener('pointerup', up);
      card.addEventListener('pointercancel', up);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          cycleSegment(card);
        }
      });
    }

    function fling(dir) {
      if (!topCard || animating) return;
      animating = true;
      var card = topCard;
      setControlsEnabled(false);
      haptic(10); // a committed swipe lands with a tap you can feel

      if (prefersReducedMotion) {
        card.classList.add('is-gone');
      } else {
        var w = (deckEl.offsetWidth || 360) * 1.4;
        var x = dir === 'yes' ? w : -w;
        var rot = dir === 'yes' ? 22 : -22;
        card.classList.add('is-gone');
        card.style.transform = 'translate(' + x + 'px, 40px) rotate(' + rot + 'deg)';
        var st = card.querySelector(dir === 'yes' ? '.stamp-yes' : '.stamp-no');
        if (st) st.style.opacity = 1;
      }

      announce(dir === 'yes' ? 'Liked ' + (card._data ? card._data.name : 'this place') : 'Passed');

      var liked = dir === 'yes';
      var picked = card._data;
      history.push({ i: idx, id: picked ? picked.id : null, dir: dir });
      updateUndo();
      if (!liked && picked) store.addSeen(picked.id); // remember the pass
      window.setTimeout(function () {
        animating = false;
        if (liked) onLike(picked);
        else advance();
      }, prefersReducedMotion ? 200 : 430);
    }

    function updateUndo() {
      if (btnUndo) btnUndo.disabled = !history.length;
    }

    function undoLast() {
      if (!history.length || animating) return;
      haptic(6); // soft nudge — the card slides back
      var h = history.pop();
      updateUndo();
      if (h.dir === 'no' && h.id) store.removeSeen(h.id); // un-remember the pass
      idx = h.i;
      waitingMore = false;
      setMode('deck');
      renderStack();
      setControlsEnabled(true);
      var r = queue[idx];
      announce('Brought back ' + (r ? r.name : 'the last place') + '.');
      if (topCard) topCard.focus();
    }

    function advance() {
      idx++;
      if (idx >= queue.length) {
        // live sweep still searching: hold a quiet state instead of an end
        if (sweepOn && find.sweepOpen()) { showFindingMore(); find.refill(); return; }
        showEnd(false); return;
      }
      renderStack();
      setControlsEnabled(true);
      if (topCard) topCard.focus();
      maybeRefill();
    }

    /* ---- watercolor bloom celebration behind the decision card ----
       A few soft pigment droplets bloom outward from behind "Tonight:",
       in the same spirit as the landing orb burst. Skipped entirely under
       prefers-reduced-motion (the decision card's own fade is enough). */
    var celebrateTimer = null;
    function celebrate() {
      if (prefersReducedMotion || !decisionEl) return;
      var cardEl = decisionEl.querySelector('.decision-card');
      if (!cardEl) return;
      var old = cardEl.querySelector('.bloom-burst');
      if (old) old.parentNode.removeChild(old);
      if (celebrateTimer) { window.clearTimeout(celebrateTimer); celebrateTimer = null; }

      var layer = el('div', 'bloom-burst');
      layer.setAttribute('aria-hidden', 'true');
      var palette = ['var(--rose)', 'var(--wisteria)', 'var(--sage)', 'var(--gold)', 'var(--pond)'];
      var DROPS = 9;
      for (var i = 0; i < DROPS; i++) {
        var d = el('span', 'bloom-drop');
        var ang = (i / DROPS) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
        var dist = 62 + Math.random() * 88;
        var size = 26 + Math.random() * 52;
        d.style.setProperty('--bx', (Math.cos(ang) * dist).toFixed(1) + 'px');
        d.style.setProperty('--by', (Math.sin(ang) * dist * 0.72).toFixed(1) + 'px');
        d.style.width = size.toFixed(1) + 'px';
        d.style.height = (size * 0.92).toFixed(1) + 'px';
        d.style.background = palette[i % palette.length];
        d.style.animationDelay = (60 + Math.random() * 220).toFixed(0) + 'ms';
        d.style.animationDuration = (950 + Math.random() * 450).toFixed(0) + 'ms';
        layer.appendChild(d);
      }
      cardEl.appendChild(layer);
      celebrateTimer = window.setTimeout(function () {
        celebrateTimer = null;
        if (layer.parentNode) layer.parentNode.removeChild(layer);
      }, 1900);
    }

    /* ---- Share the pick ----
       navigator.share when the platform offers it; otherwise copy the text +
       maps link to the clipboard with a "Copied!" toast. Everything is
       guarded — if both APIs are missing the button says so and the decision
       screen carries on untouched. */
    function buildShareAction(r, metaLine, mapsHref) {
      var share = el('button', 'decision-act', 'Share');
      share.type = 'button';
      var shareText = r.name + (metaLine ? ' — ' + metaLine : '');
      share.addEventListener('click', function () {
        // 1) Native share sheet
        try {
          if (navigator.share) {
            navigator.share({ title: 'Tonight: ' + r.name, text: shareText, url: mapsHref })
              .catch(function () { /* user dismissed the sheet — not an error */ });
            return;
          }
        } catch (e) { /* fall through to clipboard */ }
        // 2) Clipboard fallback
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(shareText + '\n' + mapsHref).then(function () {
              announce('Copied ' + r.name + ' and the maps link to your clipboard');
              toast('Copied!');
            }, function () {
              announce('Couldn’t copy — long-press the Maps link instead');
              toast('Couldn’t copy');
            });
            return;
          }
        } catch (e) { /* fall through to the quiet notice */ }
        // 3) Neither API exists — say so gently, never break the screen
        announce('Sharing isn’t available in this browser');
        toast('Sharing isn’t available here');
      });
      return share;
    }

    /* ---- Add to calendar ----
       Builds a tiny, valid .ics for a dinner tonight and hands it to the
       browser as a download (Blob URL, with a data-URI fallback). Floating
       local time — starts at the next round hour, runs ~90 min. Demo-safe:
       no backend, no dependency, never throws. */
    function icsEscape(s) {
      return String(s == null ? '' : s)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
    }
    function icsStamp(d, floating) {
      function p(n) { return (n < 10 ? '0' : '') + n; }
      if (floating) {
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
          'T' + p(d.getHours()) + p(d.getMinutes()) + '00';
      }
      return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
        'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
    }
    function buildCalendarAction(r) {
      var btn = el('button', 'decision-act', 'Add to calendar');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        try {
          var now = new Date();
          var start = new Date(now.getTime());
          start.setSeconds(0, 0);
          start.setMinutes(0);
          start.setHours(start.getHours() + 1); // next round hour
          var end = new Date(start.getTime() + 90 * 60000); // ~90 min
          var mapsHref = r.mapsUri ||
            (r.placeId ? 'https://www.google.com/maps/place/?q=place_id:' + encodeURIComponent(r.placeId) : null) ||
            'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(r.name);
          var lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Tableau//Dinner//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'BEGIN:VEVENT',
            'UID:tableau-' + (r.id || r.placeId || icsStamp(now)) + '-' + now.getTime() + '@tableau',
            'DTSTAMP:' + icsStamp(now, false),
            'DTSTART:' + icsStamp(start, true),
            'DTEND:' + icsStamp(end, true),
            'SUMMARY:' + icsEscape('Dinner at ' + r.name)
          ];
          if (r.address) lines.push('LOCATION:' + icsEscape(r.address));
          lines.push('DESCRIPTION:' + icsEscape('A Tableau pick for tonight.\n' + mapsHref));
          lines.push('END:VEVENT');
          lines.push('END:VCALENDAR');
          var ics = lines.join('\r\n');
          var fname = 'dinner-at-' + String(r.name || 'place').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '.ics';
          var href = null, revoke = null;
          try {
            if (window.Blob && window.URL && URL.createObjectURL) {
              var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
              href = URL.createObjectURL(blob);
              revoke = href;
            }
          } catch (e) { href = null; }
          if (!href) href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
          var a = el('a');
          a.href = href;
          a.download = fname;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          if (revoke) window.setTimeout(function () { try { URL.revokeObjectURL(revoke); } catch (e) {} }, 4000);
          announce('Calendar invite for dinner at ' + r.name + ' downloaded');
          toast('Calendar invite saved');
        } catch (e) {
          announce('Couldn’t build the calendar invite');
          toast('Couldn’t add to calendar');
        }
      });
      return btn;
    }

    function onLike(r) {
      setMode('decision');
      haptic(18); // arrival: the decision screen is the payoff moment
      celebrate();
      var nameEl = $('decision-name');
      var metaEl = $('decision-meta');
      var actionsEl = $('decision-actions');
      if (nameEl) nameEl.textContent = r.name;
      var bits = [];
      if (r.rating) bits.push('★ ' + fmtScore(r.rating * 20));
      if (r.price) bits.push(priceStr(r.price));
      if (r.type) bits.push(r.type);
      if (r.distance != null) {
        bits.push(fmtDist(r.distance));
        bits.push(fmtTravel(r.distance));
      }
      var mine = myRatingFor(r.name);
      if (mine) bits.push('you rated it ' + fmtScore(overallOf(mine)));
      var metaLine = bits.join('  ·  ');
      if (metaEl) metaEl.textContent = metaLine;

      // "Should we go now?" — the same open/closes-soon/opens-at/closed state
      // the deck card showed, restated on the pick screen. Rebuilt each visit.
      var dLabel = '';
      if (metaEl && metaEl.parentNode) {
        var prevChip = metaEl.parentNode.querySelector('.decision-chip');
        if (prevChip) prevChip.parentNode.removeChild(prevChip);
        var prevSample = metaEl.parentNode.querySelector('.decision-sample');
        if (prevSample) prevSample.parentNode.removeChild(prevSample);
        var dChip = openChipEl(r, 'decision-chip');
        if (dChip) { dLabel = dChip.textContent; metaEl.parentNode.insertBefore(dChip, metaEl.nextSibling); }
        // the pick screen is the most committing screen in the app — if the
        // place behind it is sample data in live mode, it says so here too.
        var dSample = sampleTagFor(r, 'decision-sample');
        if (dSample) metaEl.parentNode.insertBefore(dSample, metaEl.nextSibling);
      }

      // "Why this one" — the fuller set, sitting right under the name where
      // there is room for it. Rebuilt each visit like the status chip.
      var dReasons = [];
      if (metaEl && metaEl.parentNode) {
        var prevRow = metaEl.parentNode.querySelector('.decision-reasons');
        if (prevRow) prevRow.parentNode.removeChild(prevRow);
        dReasons = matchReasons(r, {
          max: DECISION_REASON_MAX,
          shown: r.name + ' · ' + metaLine + ' · ' + dLabel
        });
        var dRow = reasonsRowEl(dReasons, 'decision-reason');
        if (dRow) metaEl.parentNode.insertBefore(dRow, metaEl.nextSibling);
      }

      var mapsHref = r.mapsUri ||
        (r.placeId ? 'https://www.google.com/maps/dir/?api=1&destination_place_id=' + encodeURIComponent(r.placeId) + '&destination=' + encodeURIComponent(r.name) : null) ||
        'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(r.name);
      if (actionsEl) {
        clear(actionsEl);
        var map = el('a', 'decision-act decision-act--primary', 'Open in Maps · Directions');
        map.href = mapsHref; map.target = '_blank'; map.rel = 'noopener';
        actionsEl.appendChild(map);
        if (r.phone) {
          var call = el('a', 'decision-act', 'Call');
          call.href = 'tel:' + r.phone;
          actionsEl.appendChild(call);
        }
        actionsEl.appendChild(buildCalendarAction(r));
        actionsEl.appendChild(buildShareAction(r, metaLine, mapsHref));
        if (VISITED_ON) {
          var rate = el('button', 'decision-act', 'I ate here → Rate');
          rate.type = 'button';
          rate.addEventListener('click', function () {
            sheet.openForPlace({ name: r.name, placeId: r.placeId || null, loc: r.location || null, address: r.type || '', cuisines: r.cuisines || [] });
          });
          actionsEl.appendChild(rate);
        }

        // not ready to commit: bank it and keep flicking
        var already = shortlist.some(function (s) { return s.id === r.id; });
        var save = el('button', 'decision-act', already ? 'On your shortlist ✓' : 'Save to shortlist · keep swiping');
        save.type = 'button';
        save.disabled = already;
        save.addEventListener('click', function () {
          addToShortlist(r);
          setMode('deck');
          advance();
        });
        actionsEl.appendChild(save);
      }
      var dst = openState(r);
      var why = dReasons.map(function (x) { return x.text; }).join('; ');
      announce('Tonight: ' + r.name + (dst ? '. ' + dst.label : '') + (why ? '. Why this one: ' + why : ''));
      var nm = $('decision-name');
      if (nm) { nm.setAttribute('tabindex', '-1'); nm.focus(); }
    }

    function keepLooking() {
      setMode('deck');
      advance();
    }

    /* ---- "Surprise me": skip swiping, roulette-shuffle to a random pick ----
       The full matched list still becomes the deck queue (with the pick moved
       to the front), so "Keep looking" / "Save to shortlist · keep swiping"
       flow straight into the rest of the deck afterwards. */
    var rouletteTimers = [];
    function clearRoulette() {
      rouletteTimers.forEach(function (t) { window.clearTimeout(t); });
      rouletteTimers = [];
    }

    function surprise(matched) {
      clearRoulette();
      history = [];
      updateUndo();
      clear(deckEl);
      topCard = null;
      queue = (matched || []).slice();
      sweepOn = false; waitingMore = false; sortEnd = queue.length;   // the roulette owns this queue
      idx = 0;
      if (!queue.length) { showEnd(true); return; } // zero matches: same graceful end screen
      var pi = Math.floor(Math.random() * queue.length);
      var pick = queue[pi];
      queue.splice(pi, 1);
      queue.unshift(pick); // pick to the front; "keep looking" advances past it
      if (prefersReducedMotion || queue.length === 1) {
        announce('Surprise pick: ' + pick.name);
        onLike(pick);
        return;
      }
      setMode('roulette');
      announce('Choosing a place for you…');
      runRoulette(pick, function () {
        var dw = $('deck-wrap');
        if (!dw || dw.hidden) return; // user navigated away mid-shuffle
        onLike(pick);
      });
    }

    /* Rapid name shuffle that decelerates and lands on the pick. */
    function runRoulette(pick, done) {
      var names = queue.map(function (r) { return r.name; });
      var ticks = Math.min(12, 5 + names.length);
      var t = 0;
      var last = null;
      var setName = function (n) {
        if (!rouletteName) return;
        rouletteName.textContent = n;
        rouletteName.classList.remove('is-tick');
        void rouletteName.offsetWidth; // restart the tick animation
        rouletteName.classList.add('is-tick');
      };
      for (var i = 0; i < ticks; i++) {
        t += 55 + i * 16; // gaps widen — the wheel slows to a stop
        (function (i, at) {
          rouletteTimers.push(window.setTimeout(function () {
            var n;
            if (i === ticks - 1) {
              n = pick.name;
              if (rouletteEl) rouletteEl.classList.add('is-landed');
            } else {
              do { n = names[Math.floor(Math.random() * names.length)]; }
              while (names.length > 1 && n === last);
            }
            last = n;
            setName(n);
          }, at));
        })(i, t);
      }
      if (rouletteEl) rouletteEl.classList.remove('is-landed');
      setName('…');
      rouletteTimers.push(window.setTimeout(done, t + 650));
    }

    /* ---- shortlist: collect a few likes, compare, then commit ---- */
    /* `quiet` is for saves that already spoke for themselves (a heart on a
       Feed post announces its own line) and for rehydration at boot. */
    function addToShortlist(r, quiet) {
      if (!r || shortlist.some(function (s) { return s.id === r.id; })) return;
      shortlist.push(r);
      updateBadge();
      if (quiet) return;
      announce(r.name + ' saved to your shortlist. ' + shortlist.length + ' place' + (shortlist.length === 1 ? '' : 's') + ' saved.');
    }

    function removeFromShortlist(id) {
      var gone = null;
      shortlist = shortlist.filter(function (s) {
        if (s.id === id) { gone = s; return false; }
        return true;
      });
      // a place taken off the shortlist is no longer hearted in the Feed
      if (gone) feedStore.setHeart(gone.name, false);
      updateBadge();
    }

    function inShortlist(id) {
      return shortlist.some(function (s) { return s.id === id; });
    }

    /* Hearts are the one part of the shortlist that outlives the outing:
       on boot (and whenever the deck is torn down) the places you hearted
       in the Feed are put back on the shortlist, so the badge, the compare
       screen and the constellation all agree with the Feed. */
    function hydrateHearts() {
      if (BETA) return;   // the Feed is not in the beta; nothing was hearted
      var names = feedStore.hearts();
      if (!names.length) return;
      var pool = (state.results && state.results.length) ? state.results : demoResults();
      names.forEach(function (n) {
        var key = String(n).toLowerCase();
        for (var i = 0; i < pool.length; i++) {
          if (String(pool[i].name || '').toLowerCase() === key) { addToShortlist(pool[i], true); return; }
        }
      });
    }

    function updateBadge() {
      if (!badgeEl) return;
      badgeEl.hidden = !shortlist.length;
      var n = badgeEl.querySelector('.shortlist-count');
      if (n) n.textContent = String(shortlist.length);
    }

    function backFromShortlist() {
      if (slPicking) return; // the roulette is mid-shuffle — sit tight
      if (idx < queue.length) { setMode('deck'); setControlsEnabled(true); if (topCard) topCard.focus(); }
      else showEnd(false);
    }

    /* Deterministic 7-point buzz series for the compare sparkline — the same
       recipe as Popular's trendSeries (name-seeded wobble, direction from the
       hash, ending exactly at the place's 0-100 score); rebuilt here because
       that helper lives inside the popular closure. */
    function slTrendSeries(r) {
      if (!r.rating) return [];
      var score = r.rating * 20;
      var h = hashStr(r.name || r.id || '');
      var dir = (h % 3) - 1; // falling / steady / rising — stable per place
      var pts = [];
      for (var i = 0; i < 7; i++) {
        var ti = i / 6;
        pts.push(score - dir * (1 - ti) * 6 + Math.sin(h % 7 + i * 1.7) * 1.4);
      }
      pts[6] = score;
      return pts;
    }

    /* One compact compare card. Fact slots keep a fixed order on every card
       (score+spark / price+cuisine / distance+travel / your rating) so eyes
       can hop straight down the column when weighing A against B. */
    function buildCompareCard(r) {
      var card = el('article', 'slc');
      card.dataset.id = r.id;
      card.setAttribute('aria-label', a11ySummary(r));

      var main = el('div', 'slc-main');
      var thumb = el('div', 'slc-thumb');
      thumb.setAttribute('aria-hidden', 'true');
      var foodSeg = (r.segments && r.segments.food) || {};
      paintThumb(thumb, foodSeg.photoUrl || r.photoUrl, panelArt(r, 'food', 0));
      main.appendChild(thumb);

      var body = el('div', 'slc-body');
      var head = el('div', 'slc-head');
      head.appendChild(el('h3', 'slc-name', r.name));
      var slChip = openChipEl(r, 'slc-open');
      if (slChip) head.appendChild(slChip);
      var slSample = sampleTagFor(r, 'slc-sample');
      if (slSample) head.appendChild(slSample);
      body.appendChild(head);

      var scoreRow = el('div', 'slc-row');
      var score = el('span', 'slc-score');
      if (r.rating) {
        score.appendChild(el('span', 'slc-star', '★ ' + fmtScore(r.rating * 20)));
        if (r.reviews) score.appendChild(document.createTextNode(' (' + r.reviews.toLocaleString() + ')'));
      } else {
        score.appendChild(document.createTextNode('No rating yet'));
      }
      scoreRow.appendChild(score);
      var sparkPts = slTrendSeries(r);
      if (sparkPts.length) scoreRow.appendChild(svgSparkline(sparkPts, 'var(--pond-deep)'));
      body.appendChild(scoreRow);

      var mid = [];
      if (r.price) mid.push(priceStr(r.price));
      if (r.type) mid.push(r.type);
      body.appendChild(el('p', 'slc-fact', mid.length ? mid.join(' · ') : '—'));

      var dist = [];
      if (r.distance != null) { dist.push(fmtDist(r.distance)); dist.push(fmtTravel(r.distance)); }
      body.appendChild(el('p', 'slc-fact slc-fact--dist', dist.length ? dist.join(' · ') : '—'));

      var mine = myRatingFor(r.name);
      if (mine) body.appendChild(el('p', 'slc-you', 'You rated it ' + fmtScore(overallOf(mine))));
      var slCredit = photoCreditEl(photoCreditFor(r, foodSeg.photoUrl || r.photoUrl), 'slc-attr', true);
      if (slCredit) body.appendChild(slCredit);
      main.appendChild(body);
      card.appendChild(main);

      var acts = el('div', 'slc-acts');
      var choose = el('button', 'slc-choose', 'Choose this one');
      choose.type = 'button';
      choose.setAttribute('aria-label', 'Choose ' + r.name + ' for tonight');
      choose.addEventListener('click', function () {
        if (slPicking) return;
        haptic(10);
        onLike(r);
      });
      acts.appendChild(choose);
      var rm = el('button', 'slc-remove', 'Remove');
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remove ' + r.name + ' from shortlist');
      rm.addEventListener('click', function () { removeWithUndo(r); });
      acts.appendChild(rm);
      var slMaps = mapsLinkEl(r, 'slc-maps maps-link');
      if (slMaps) acts.appendChild(slMaps);
      card.appendChild(acts);
      return card;
    }

    /* ---- shortlist "constellation": a tiny no-deps relative map ----
       Plots YOU at center and each shortlisted place by its real bearing
       and distance from the search origin (state.origin), scaled so the
       farthest sits near the panel edge. Fewer than two places with usable
       coords → no panel (a one-dot map is just noise). Dots are real
       buttons: tapping one scrolls its compare card into view and pulses
       it. Inline SVG draws the faint rays — no map libraries. */
    var CONST_C = 50, CONST_MINR = 17, CONST_MAXR = 40; // in the 0..100 square

    // Reuse panelArt's palette hash: pull the first pigment hex it emits.
    function constTint(r, i) {
      var m = String(panelArt(r, 'const', i)).match(/#([0-9a-fA-F]{6})/);
      return m ? '#' + m[1] : 'var(--pond)';
    }

    function constPlace(p) { // recompute x,y from angle + distance-radius
      p.x = CONST_C + p.radius * Math.sin(p.ang);
      p.y = CONST_C - p.radius * Math.cos(p.ang); // north is up (−y)
    }

    function buildConstellation() {
      var origin = state.origin;
      if (!origin || origin.lat == null || origin.lng == null) return null;
      var cosLat = Math.cos(origin.lat * Math.PI / 180);
      var pts = [], maxDist = 0;
      shortlist.forEach(function (r) {
        var loc = r.location;
        if (!loc || loc.lat == null || loc.lng == null || r.distance == null) return;
        var east = (loc.lng - origin.lng) * cosLat;
        var north = loc.lat - origin.lat;
        var mag = Math.sqrt(east * east + north * north);
        if (!(mag > 0)) return; // sits exactly on the origin — no bearing
        if (r.distance > maxDist) maxDist = r.distance;
        pts.push({ r: r, ang: Math.atan2(east, north), dist: r.distance });
      });
      if (pts.length < 2 || !(maxDist > 0)) return null;

      // radius is a strictly increasing function of real distance, so the
      // farthest dot always renders farther from centre than the nearest.
      pts.forEach(function (p) {
        p.radius = CONST_MINR + (p.dist / maxDist) * (CONST_MAXR - CONST_MINR);
        constPlace(p);
      });
      // Bearing + distance stay true: each dot keeps its real angle (ang0) and
      // its distance-true radius. Only when two hit boxes would collide does
      // settle() (below, run once the panel has a real size) nudge a dot along
      // its own circle, and it measures that in PIXELS (a 45px box needs a
      // 45px Chebyshev gap), not in plot units, so a bigger plot means fewer
      // and smaller nudges rather than a falsified map.
      pts.forEach(function (p) { p.ang0 = p.ang; });

      var panel = el('div', 'slc-constellation');
      panel.setAttribute('role', 'group');
      panel.setAttribute('aria-label', 'Map of your shortlist relative to you');
      var plot = el('div', 'slc-const-plot');

      var svgNS = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'slc-const-web');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none'); // plot box is square
      svg.setAttribute('aria-hidden', 'true');
      pts.forEach(function (p) {
        var ln = document.createElementNS(svgNS, 'line');
        ln.setAttribute('x1', CONST_C); ln.setAttribute('y1', CONST_C);
        ln.setAttribute('x2', p.x.toFixed(2)); ln.setAttribute('y2', p.y.toFixed(2));
        ln.setAttribute('class', 'slc-const-ray');
        p.ray = ln;
        svg.appendChild(ln);
      });
      plot.appendChild(svg);

      // YOU, at the centre — a small feather/home dot.
      var you = el('div', 'slc-const-you');
      you.setAttribute('aria-hidden', 'true');
      you.appendChild(el('span', 'slc-const-you-pip'));
      you.appendChild(el('span', 'slc-const-you-tag', 'You'));
      plot.appendChild(you);

      pts.forEach(function (p, i) {
        var dot = el('button', 'slc-const-dot');
        dot.type = 'button';
        dot.style.setProperty('--x', p.x.toFixed(2) + '%');
        dot.style.setProperty('--y', p.y.toFixed(2) + '%');
        p.dot = dot;
        dot.setAttribute('aria-label', 'Highlight ' + p.r.name);
        var pip = el('span', 'slc-const-pip');
        pip.style.background = constTint(p.r, i);
        dot.appendChild(pip);
        var tag = el('span', 'slc-const-tag');
        tag.appendChild(el('span', 'slc-const-tag-name', p.r.name));
        tag.appendChild(el('span', 'slc-const-tag-dist', fmtDist(p.r.distance)));
        dot.appendChild(tag);
        (function (place) {
          dot.addEventListener('click', function () { highlightCard(place.id); });
        })(p.r);
        plot.appendChild(dot);
      });

      panel.appendChild(plot);

      /* settle(): called once the panel is in the DOM (and on resize). */
      var HALF = 22.5;   // default hit half-extent, px  (a 45px box)
      function wrapAng(x) { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; }
      panel._settle = function () {
        var W = plot.clientWidth;
        if (!W) return;
        var SEP = HALF * 2 * 100 / W;           // 45px, in plot units
        pts.forEach(function (p) { p.ang = p.ang0; constPlace(p); });
        for (var pass = 0; pass < 160; pass++) {
          var moved = false;
          for (var a = 0; a < pts.length; a++) {
            for (var b = a + 1; b < pts.length; b++) {
              var dx = pts[a].x - pts[b].x, dy = pts[a].y - pts[b].y;
              var cheb = Math.max(Math.abs(dx), Math.abs(dy));
              if (cheb >= SEP) continue;
              var rr = Math.max(8, (pts[a].radius + pts[b].radius) / 2);
              var push = ((SEP - cheb) / (2 * rr)) * 0.6 + 0.002;
              var dir = wrapAng(pts[a].ang - pts[b].ang) >= 0 ? 1 : -1;
              pts[a].ang += dir * push; pts[b].ang -= dir * push;
              constPlace(pts[a]); constPlace(pts[b]);
              moved = true;
            }
          }
          if (!moved) break;
        }
        // positions, rays, and non-overlapping (Voronoi-style) hit extents
        var px = W / 100;
        pts.forEach(function (p) { p.ext = { l: HALF, r: HALF, t: HALF, b: HALF }; });
        for (var i = 0; i < pts.length; i++) {
          for (var j = i + 1; j < pts.length; j++) {
            var ddx = (pts[j].x - pts[i].x) * px, ddy = (pts[j].y - pts[i].y) * px;
            if (Math.abs(ddx) >= HALF * 2 || Math.abs(ddy) >= HALF * 2) continue;   // boxes already clear
            if (Math.abs(ddx) >= Math.abs(ddy)) {                // split the gap on x
              var hx = Math.abs(ddx) / 2;
              if (ddx >= 0) { pts[i].ext.r = Math.min(pts[i].ext.r, hx); pts[j].ext.l = Math.min(pts[j].ext.l, hx); }
              else { pts[i].ext.l = Math.min(pts[i].ext.l, hx); pts[j].ext.r = Math.min(pts[j].ext.r, hx); }
            } else {                                             // split the gap on y
              var hy = Math.abs(ddy) / 2;
              if (ddy >= 0) { pts[i].ext.b = Math.min(pts[i].ext.b, hy); pts[j].ext.t = Math.min(pts[j].ext.t, hy); }
              else { pts[i].ext.t = Math.min(pts[i].ext.t, hy); pts[j].ext.b = Math.min(pts[j].ext.b, hy); }
            }
          }
        }
        pts.forEach(function (p) {
          p.dot.style.setProperty('--x', p.x.toFixed(2) + '%');
          p.dot.style.setProperty('--y', p.y.toFixed(2) + '%');
          p.dot.setAttribute('data-nudge-deg', String(Math.round(Math.abs(wrapAng(p.ang - p.ang0)) * 180 / Math.PI)));
          p.dot.style.setProperty('--hl', p.ext.l.toFixed(1) + 'px');
          p.dot.style.setProperty('--hr', p.ext.r.toFixed(1) + 'px');
          p.dot.style.setProperty('--ht', p.ext.t.toFixed(1) + 'px');
          p.dot.style.setProperty('--hb', p.ext.b.toFixed(1) + 'px');
          p.ray.setAttribute('x2', p.x.toFixed(2)); p.ray.setAttribute('y2', p.y.toFixed(2));
        });
      };
      // the map is only as real as the places on it
      var allSample = pts.every(function (q) { return isSampleResult(q.r); });
      if (sampleTagsOn() && allSample) {
        panel.appendChild(el('span', 'v-demo-tag slc-const-sample', 'Sample'));
      }
      return panel;
    }

    /* Tap a constellation dot → bring its compare card into view and pulse
       it (echoing the winner glow). Reduced motion: instant scroll + a
       static outline that clears after a beat, no animation. */
    var constHiTimer = null;
    function highlightCard(id) {
      if (!shortlistEl) return;
      var card = null, cards = shortlistEl.querySelectorAll('.slc');
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].dataset.id === id) { card = cards[i]; break; }
      }
      if (!card) return;
      haptic(8);
      if (constHiTimer) { window.clearTimeout(constHiTimer); constHiTimer = null; }
      var others = shortlistEl.querySelectorAll('.slc.is-highlight');
      for (var j = 0; j < others.length; j++) others[j].classList.remove('is-highlight');
      // reflow so re-tapping the same card restarts the pulse
      void card.offsetWidth;
      var name = card.querySelector('.slc-name');
      announce('Showing ' + (name ? name.textContent : 'place') + ' in your shortlist.');
      try {
        card.scrollIntoView({ block: 'center', behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      } catch (e) { try { card.scrollIntoView(); } catch (e2) {} }
      card.classList.add('is-highlight');
      constHiTimer = window.setTimeout(function () {
        card.classList.remove('is-highlight');
        constHiTimer = null;
      }, prefersReducedMotion ? 1400 : 1250);
    }

    window.addEventListener('resize', function () {
      var c = shortlistEl && !shortlistEl.hidden && shortlistEl.querySelector('.slc-constellation');
      if (c && c._settle) c._settle();
    });

    function renderShortlist() {
      var listEl = shortlistEl && shortlistEl.querySelector('.shortlist-list');
      if (!listEl) return;
      clear(listEl);
      if (!shortlist.length) { backFromShortlist(); return; }
      var con = buildConstellation();
      if (con) { listEl.appendChild(con); con._settle(); } // above the compare cards; settle needs its real size
      shortlist.forEach(function (r) { listEl.appendChild(buildCompareCard(r)); });
    }

    /* Remove a place but keep it one tap from coming back: the toast carries
       an Undo action that splices it back where it was. */
    function removeWithUndo(r) {
      if (slPicking) return;
      var at = -1;
      for (var i = 0; i < shortlist.length; i++) { if (shortlist[i].id === r.id) { at = i; break; } }
      if (at < 0) return;
      removeFromShortlist(r.id);
      renderShortlist(); // an emptied list falls back to the deck / end screen
      // the Remove button went with the card — land back on the list's title
      if (shortlistEl && !shortlistEl.hidden) {
        var slTitle = shortlistEl.querySelector('.shortlist-title');
        if (slTitle) { slTitle.setAttribute('tabindex', '-1'); slTitle.focus(); }
      }
      announce(r.name + ' removed from shortlist. Undo is available.');
      toast('Removed ' + r.name, {
        label: 'Undo',
        duration: 5200,
        onAction: function () {
          if (shortlist.some(function (s) { return s.id === r.id; })) return;
          shortlist.splice(Math.min(at, shortlist.length), 0, r);
          feedStore.setHeart(r.name, true);
          updateBadge();
          if (shortlistEl && !shortlistEl.hidden) renderShortlist();
          else if (endEl && !endEl.hidden) showEnd(false); // refresh count + copy
          announce(r.name + ' is back on your shortlist.');
        }
      });
    }

    /* ---- "Pick for me": roulette-shuffle across the compare cards ----
       The spotlight hops card to card with widening gaps, lands on a random
       pick, the winner lifts and glows for a beat, then the standard
       decision screen ("Tonight: …" + Maps/Call/Share/Rate) takes over.
       Reduced motion (or a one-place list) commits instantly — no shuffle. */
    var slPicking = false;
    function pickForMe() {
      if (slPicking || !shortlist.length) return;
      clearRoulette();
      var pi = Math.floor(Math.random() * shortlist.length);
      var pick = shortlist[pi];
      if (prefersReducedMotion || shortlist.length === 1) {
        announce('Tonight: ' + pick.name);
        onLike(pick);
        return;
      }
      var cards = shortlistEl ? Array.prototype.slice.call(shortlistEl.querySelectorAll('.slc')) : [];
      if (cards.length !== shortlist.length) { onLike(pick); return; } // stale DOM — just commit
      slPicking = true;
      shortlistEl.classList.add('is-picking');
      announce('Choosing from your shortlist…');
      haptic(8);
      var n = cards.length;
      var ticks = Math.min(15, 6 + n * 2);
      var offset = ((pi - (ticks - 1)) % n + n) % n; // last tick lands on the pick
      var lastLit = null;
      var t = 0;
      for (var i = 0; i < ticks; i++) {
        t += 65 + i * 15; // gaps widen — the spotlight slows to a stop
        (function (i, at) {
          rouletteTimers.push(window.setTimeout(function () {
            if (!shortlistEl || shortlistEl.hidden) return; // navigated away
            var c = cards[(offset + i) % n];
            if (lastLit) lastLit.classList.remove('is-spot');
            lastLit = c;
            c.classList.add('is-spot');
            if (i === ticks - 1) {
              c.classList.remove('is-spot');
              c.classList.add('is-winner'); // the lift + gold glow
              haptic(18);
              try { c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e2) {}
            }
          }, at));
        })(i, t);
      }
      rouletteTimers.push(window.setTimeout(function () {
        slPicking = false;
        if (shortlistEl) shortlistEl.classList.remove('is-picking');
        if (!shortlistEl || shortlistEl.hidden) return;
        onLike(pick); // "Tonight: <name>" + the standard decision actions
      }, t + 950));
    }

    function showShortlist() {
      if (!shortlist.length) return;
      clearRoulette();
      slPicking = false;
      if (shortlistEl) shortlistEl.classList.remove('is-picking');
      setMode('shortlist');
      renderShortlist();
      announce('Comparing ' + shortlist.length + ' shortlisted place' + (shortlist.length === 1 ? '' : 's') + '.');
      var t = shortlistEl && shortlistEl.querySelector('.shortlist-title');
      if (t) { t.setAttribute('tabindex', '-1'); t.focus(); }
    }

    /* Share the whole shortlist as a numbered plain-text list. */
    function shareShortlist() {
      if (!shortlist.length) return;
      var lines = shortlist.map(function (r, i) {
        var bits = [];
        if (r.rating) bits.push('★ ' + fmtScore(r.rating * 20));
        if (r.price) bits.push(priceStr(r.price));
        if (r.distance != null) bits.push(fmtTravel(r.distance));
        return (i + 1) + '. ' + r.name + (bits.length ? ' — ' + bits.join(' · ') : '');
      });
      var text = 'Tonight’s shortlist:\n' + lines.join('\n');
      try {
        if (navigator.share) {
          navigator.share({ title: 'Tonight’s shortlist', text: text })
            .catch(function () { /* dismissed */ });
          return;
        }
      } catch (e) { /* fall through */ }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            announce('Copied your shortlist to the clipboard');
            toast('Shortlist copied!');
          }, function () { toast('Couldn’t copy'); });
          return;
        }
      } catch (e) {}
      toast('Sharing isn’t available here');
    }

    /* ---- end-of-deck "adjust one thing" chips ----
       One tap opens the preferences wizard at exactly that question
       (prefs.jumpTo single-step mode); Done → re-runs the search and deals
       a fresh deck. Rebuilt on every showEnd so labels stay current. */
    function renderEndTweaks(emptyFromStart) {
      var card = endEl && endEl.querySelector('.deck-end-card');
      if (!card) return;
      var old = card.querySelector('.end-tweaks');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var wrap = el('div', 'end-tweaks');
      wrap.appendChild(el('p', 'end-tweaks-label',
        emptyFromStart ? 'Loosen one thing' : 'Adjust one thing'));
      var row = el('div', 'end-chips');
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', 'Adjust one preference');
      // [label, control id inside the wizard step to jump to]
      var TWEAKS = [
        ['Change cuisine', 'pref-cuisine'],
        ['Change price', 'pref-price'],
        ['Change rating', 'pref-rating'],
        ['Widen distance', 'pref-distance']
      ];
      TWEAKS.forEach(function (t) {
        var b = el('button', 'end-chip', t[0]);
        b.type = 'button';
        b.addEventListener('click', function () {
          find.showPrefs(false);   // renders the full wizard…
          prefs.jumpTo(t[1]);      // …then narrows it to this one step
        });
        row.appendChild(b);
      });
      var sur = el('button', 'end-chip end-chip--gold', '✦ Surprise me');
      sur.type = 'button';
      sur.addEventListener('click', surpriseFromEnd);
      row.appendChild(sur);
      wrap.appendChild(row);
      card.insertBefore(wrap, card.querySelector('.deck-end-actions'));
    }

    /* "Surprise me" from the end screen: roulette a place you haven't
       seen this outing (seen memory + shortlist excluded); if you've truly
       seen everything, clear the seen memory and deal the deck again. */
    function surpriseFromEnd() {
      var matched = find.filterByPrefs(state.results || []);
      if (!matched.length) {
        announce('Nothing matches your current preferences yet. Try adjusting one first.');
        toast('Loosen a preference first');
        return;
      }
      var seen = store.getSeen();
      var fresh = matched.filter(function (r) {
        if (seen[r.id]) return false;
        return !shortlist.some(function (s) { return s.id === r.id; });
      });
      if (fresh.length) { surprise(fresh); return; }
      store.clearSeen();
      announce('You had seen everything — memory cleared, dealing a fresh deck.');
      toast('Fresh deck!');
      find.startSearch();
    }

    function showEnd(emptyFromStart) {
      waitingMore = false;
      setMode('end');
      renderEndTweaks(emptyFromStart);
      var title = $('deck-end-title');
      var sub = $('deck-end-sub');
      var sw = sweepOn ? find.sweepInfo() : null;   // live sweep: honest copy about how far the search got
      var cnt = queue.length + ' place' + (queue.length === 1 ? '' : 's');
      var lim = sw ? (sw.calls + ' lookup' + (sw.calls === 1 ? '' : 's')) : '';
      if (emptyFromStart) {
        if (title) title.textContent = 'Nothing matched those filters';
        if (sub) sub.textContent = !sw ? 'Try widening your preferences or searching farther.'
          : sw.state === 'complete' ? 'Nothing within ' + fmtDist(sw.radius / 1609.344) + ' fits. Try widening your preferences.'
          : sw.state === 'error' ? sw.err + ' Try widening your preferences.'
          : 'The search stopped after ' + lim + ' without a match, so there may be more farther out. Try widening your preferences.';
      } else if (shortlist.length) {
        if (title) title.textContent = 'Down to your shortlist';
        if (sub) sub.textContent = (!sw || sw.state === 'complete' ? 'You’ve seen everything nearby — ' : 'You’ve seen ' + cnt + ' — ') +
          shortlist.length + ' place' + (shortlist.length === 1 ? ' is' : 's are') + ' waiting on your shortlist.' +
          (sw && sw.state !== 'complete' ? ' The search stopped early, so there may be more farther out.' : '');
      } else if (sw && sw.state === 'complete') {
        if (title) title.textContent = 'That’s everywhere within ' + fmtDist(sw.radius / 1609.344).replace(' ', '\u00a0');
        if (sub) sub.textContent = 'You’ve seen all ' + cnt + ' that matched.';
      } else if (sw && sw.state === 'error') {
        if (title) title.textContent = 'That’s all I could load';
        if (sub) sub.textContent = 'You’ve seen ' + cnt + '. ' + sw.err;
      } else if (sw) {
        if (title) title.textContent = sw.state === 'budget' ? 'That’s as far as I searched' : 'The search stopped here';
        if (sub) sub.textContent = 'You’ve seen ' + cnt + '. ' + (sw.state === 'budget'
          ? 'The search stopped at its limit of ' + lim + ', so there may be more places farther out.'
          : 'The search stopped after ' + lim + ' found nothing new, so there may be more farther out.');
      } else {
        if (title) title.textContent = 'That’s everywhere nearby that matched';
        if (sub) sub.textContent = 'You’ve seen every spot within your distance cap.';
      }
      var farther = $('end-farther');
      if (farther) farther.style.display = find.hasFarther() ? '' : 'none';
      var slBtn = $('end-shortlist');
      if (slBtn) {
        slBtn.style.display = shortlist.length ? '' : 'none';
        slBtn.textContent = 'Compare shortlist (' + shortlist.length + ')';
      }
      announce(emptyFromStart ? 'No places matched your preferences.' : 'You have reached the end of the deck.');
      var t = $('deck-end-title');
      if (t) { t.setAttribute('tabindex', '-1'); t.focus(); }
    }

    /* ---- live: lazily prefetch details for upcoming cards ----
       Only the top card and the next two are fetched, so we never request
       data for cards the user won't see. Cached per place via detailsLoaded.
       Live-only path: cannot run without a key + network. */
    function prefetchUpcoming() {
      if (!store.getKey()) return; // demo cards already carry everything
      for (var d = 0; d < 3; d++) {
        var i = idx + d;
        if (i >= queue.length) break;
        var r = queue[i];
        if (r && !r.detailsLoaded) {
          (function (rr) {
            rr.detailsLoaded = true; // mark in-flight to avoid duplicate fetches
            gmaps.fetchDetails(rr, function (err, enriched) {
              if (err || !enriched) return;
              var node = deckEl.querySelector('.swipe-card[data-id="' + rr.id + '"]');
              if (node) renderStack();
            });
          })(queue[i]);
        }
      }
    }

    function passTop() { if (!animating && topCard) fling('no'); }
    function likeTop() { if (!animating && topCard) fling('yes'); }
    function infoTop() { if (topCard) cycleSegment(topCard); }

    function teardown() {
      clearRoulette();
      if (rouletteEl) rouletteEl.classList.remove('is-landed');
      slPicking = false;
      if (shortlistEl) shortlistEl.classList.remove('is-picking');
      clear(deckEl);
      if (peekEl) { peekEl.hidden = true; clear(peekEl.querySelector('.peek-row')); }
      queue = []; idx = 0; sortEnd = 0; sweepOn = false; waitingMore = false; topCard = null; animating = false;
      history = []; shortlist = [];
      updateUndo(); updateBadge();
      hydrateHearts();   // hearted places survive "start over"
      setMode('deck');
    }

    function init() {
      if (btnNo) btnNo.addEventListener('click', passTop);
      if (btnYes) btnYes.addEventListener('click', likeTop);
      if (btnInfo) btnInfo.addEventListener('click', infoTop);
      if (btnUndo) btnUndo.addEventListener('click', undoLast);
      if (badgeEl) badgeEl.addEventListener('click', showShortlist);
      var slBack = shortlistEl && shortlistEl.querySelector('.shortlist-back');
      if (slBack) slBack.addEventListener('click', backFromShortlist);
      var slShare = shortlistEl && shortlistEl.querySelector('.shortlist-share');
      if (slShare) slShare.addEventListener('click', shareShortlist);
      var slPickBtn = shortlistEl && shortlistEl.querySelector('.shortlist-pickme');
      if (slPickBtn) slPickBtn.addEventListener('click', pickForMe);
      var endSl = $('end-shortlist');
      if (endSl) endSl.addEventListener('click', showShortlist);
      updateUndo(); updateBadge();

      var keep = $('decision-keep');
      if (keep) keep.addEventListener('click', keepLooking);

      var widen = $('end-widen');
      if (widen) widen.addEventListener('click', function () { find.showPrefs(true); });
      var restart = $('end-restart');
      if (restart) restart.addEventListener('click', function () { find.showLanding(); });
      var farther = $('end-farther');
      if (farther) farther.addEventListener('click', function () {
        find.searchFarther(function (more) {
          if (more && more.length) { insertMore(more); maybeRefill(); }
          else if (sweepOn && find.sweepOpen()) { showFindingMore(); find.refill(); }
          else if (sweepOn) showEnd(queue.length === 0);   // re-renders the end copy with the widened radius
          else announce('No more places farther out.');
        });
      });

      keyHandler = function (e) {
        var dw = $('deck-wrap');
        if (!dw || dw.hidden) return;
        if (decisionEl && !decisionEl.hidden) return;
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
        if (rouletteEl && !rouletteEl.hidden) return; // roulette is spinning — hands off
        // undo works from the deck AND the end screen (bring the last card back)
        if (e.key === 'Backspace' || e.key === 'z' || e.key === 'Z') { e.preventDefault(); undoLast(); return; }
        if (endEl && !endEl.hidden) return;
        if (shortlistEl && !shortlistEl.hidden) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); passTop(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); likeTop(); }
      };
      document.addEventListener('keydown', keyHandler);
    }

    /* Friends-tab CTA needs read access to the shortlist + the share flow. */
    function shortlistCount() { return shortlist.length; }

    /* ---- a pick chosen OUTSIDE the deck (a Popular row) -----------------
       Same screen, same actions, same announcements as a swipe-right: this
       only seeds the queue first so "Keep looking" walks the rest of the
       section the row came from instead of dead-ending. The shortlist is
       deliberately left alone — an outing's saves survive the detour. */
    function pickFrom(r, rest) {
      if (!r) return;
      clearRoulette();
      var seen = {};
      seen[r.id] = true;
      queue = [r];
      sweepOn = false; waitingMore = false;
      (rest || []).forEach(function (x) {
        if (!x || seen[x.id]) return;
        seen[x.id] = true;
        queue.push(x);
      });
      idx = 0;
      history = [];
      updateUndo();
      renderStack(false);      // the deck waiting behind the decision screen
      setControlsEnabled(true);
      onLike(r);
    }

    return { init: init, load: load, append: append, insertMore: insertMore, wantsMore: wantsMore, isWaiting: isWaiting, sweepSettled: sweepSettled, showLoading: showLoading, teardown: teardown, surprise: surprise, shortlistCount: shortlistCount, shareShortlist: shareShortlist, pickFrom: pickFrom, addToShortlist: addToShortlist, removeFromShortlist: removeFromShortlist, inShortlist: inShortlist, hydrateHearts: hydrateHearts, layout: layout };
  })();

  /* paint a wc-range fill % (shared) */
  function paintRange(input) {
    if (!input) return;
    var min = parseFloat(input.min), max = parseFloat(input.max), v = parseFloat(input.value);
    var pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', pct.toFixed(1) + '%');
  }

  /* ================================================================== *
   * LIVE FAILURE VOCABULARY
   * Every way live data can fail, and one calm sentence for each. Google
   * reports these differently depending on which surface answers, so
   * classifyLive() takes whatever we were handed — a PlacesServiceStatus
   * string, an Error from the modern Place API (whose message carries
   * Google's own words), or a code we raised ourselves — and names it.
   * Nothing here ever includes the key.
   * ================================================================== */
  /* Where this page lives, as a Google referrer rule — so the sentence can
     name the exact thing to paste into the key's referrer list. */
  function referrerRule() {
    try { return location.origin + '/*'; } catch (e) { return 'https://sky121.github.io/*'; }
  }
  /* LIVE_TEXT[code]() -> [sheet text, deck-slip text]. The sheet (room for the fix, and for the causes in
     likelihood order where Google does not say which); the slip is the paper
     slip on the deck. Both are built per call so the referrer rule is the
     real one. Neither ever contains the key. */
  var LIVE_TEXT = {
    shape: function () { return [
      'That doesn’t look like a Google Maps key — they begin with “AIza” and run about 39 characters. Paste the whole key.',
      'That doesn’t look like a Google key.']; },
    invalid: function () { return [
      'Google says that key isn’t valid. Copy it again from the Cloud Console — keys are easy to truncate.',
      'Google says that key isn’t valid — copy it again from the Cloud Console.']; },
    notenabled: function () { return [
      'Places API (New) isn’t enabled for this key’s Google Cloud project. In the Cloud Console open APIs & Services, enable “Places API (New)” (and “Maps JavaScript API”), then try again.',
      'Places API (New) isn’t enabled for this key’s project — enable it in the Cloud Console.']; },
    billing: function () { return [
      'Billing isn’t attached to this key’s Google Cloud project. Places needs a billing account even inside the free monthly credit — link one in the Cloud Console, then try again.',
      'Billing isn’t attached to this key’s Google Cloud project.']; },
    restricted: function () { return [
      'This key is restricted to other websites. In the Cloud Console, add ' + referrerRule() + ' to the key’s HTTP-referrer list.',
      'This key is restricted to other websites — add ' + referrerRule() + ' to its referrer list.']; },
    apiblocked: function () { return [
      'This key’s API restrictions leave out Places API (New). In the Cloud Console add “Places API (New)” and “Maps JavaScript API” to the key’s allowed APIs.',
      'This key’s API restrictions leave out Places API (New) — add it to the key.']; },
    quota: function () { return [
      'Google’s daily quota for this key is used up. Nothing is wrong with the key — try again tomorrow, or raise the cap in the Cloud Console.',
      'Google’s daily quota for this key is used up.']; },
    denied: function () { return [
      'Google refused the request and didn’t say why. In likely order: Places API (New) isn’t enabled for the project, billing isn’t attached, or the key is restricted to other websites (it needs ' + referrerRule() + ').',
      'Google refused the request without saying why — likely Places API (New) isn’t enabled, billing isn’t attached, or the key is restricted to other sites.']; },
    rejected: function () { return [
      'Google rejected the key and doesn’t say which way. In likely order: billing isn’t attached to the project, the key is restricted to other websites (it needs ' + referrerRule() + '), or it was mistyped.',
      'Google rejected the key — likely billing isn’t attached, it’s restricted to other websites (needs ' + referrerRule() + '), or it was mistyped.']; },
    network: function () { return [
      'Couldn’t reach Google — the connection dropped. Your key is kept; try again when you’re back online.',
      'Couldn’t reach Google — check your connection.']; },
    timeout: function () { return [
      'Google took too long to answer. Either the connection is poor, or Google is quietly refusing the key (Places API (New) not enabled, billing missing, or a referrer restriction). Try again; if it repeats, check those three in the Cloud Console.',
      'Google took too long to answer — check your connection, or the key’s API, billing and referrer settings.']; },
    timeoutload: function () { return [
      'Google Maps didn’t finish loading. Either the connection is poor, or Google is quietly refusing the key (billing missing, a referrer restriction, or a mistyped key). Try again; if it repeats, check the key in the Cloud Console.',
      'Google Maps didn’t load in time — check your connection, then the key’s billing and referrer settings.']; },
    unavailable: function () { return [
      'Live restaurants are unavailable right now.',
      'Live restaurants are unavailable right now.']; },
    reload: function () { return [
      'Key saved. Reload the page to switch Tableau over to it — Google Maps can only be keyed once per page.',
      'Reload the page to use the new key.']; },
    unknown: function () { return [
      'Google answered with something unexpected, so the cause isn’t clear. Try again in a minute; if it repeats, check the key in the Cloud Console (API enabled, billing, referrer list).',
      'Live search failed and Google didn’t say why — try again in a minute.']; }
  };
  function liveErrorText(code) { return (LIVE_TEXT[code] || LIVE_TEXT.unknown)()[0]; }
  function liveShortText(code) { return (LIVE_TEXT[code] || LIVE_TEXT.unknown)()[1]; }

  function classifyLive(x) {
    if (x == null) return 'unknown';
    var t = typeof x;
    var str = (t === 'string') ? x
      : [x.message, x.name, x.status, x.code, x.reason].join(' ');
    if (/API key not valid|API_?KEY_?INVALID|InvalidKey|MissingKey|keyInvalid|malformed|ExpiredKey/i.test(str)) return 'invalid';
    if (/quota|OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED|OverQuota|rate.?limit|dailyLimit|429/i.test(str)) return 'quota';
    if (/BillingNotEnabled|BILLING_DISABLED|requires billing|enable billing|billing (is not|must be|account)/i.test(str)) return 'billing';
    if (/SERVICE_DISABLED|ApiNotActivated|has not been used in project|is disabled|not enabled|not been enabled|legacy API|not activated/i.test(str)) return 'notenabled';
    if (/referer|referrer|RefererNotAllowed/i.test(str)) return 'restricted';
    if (/ApiTargetBlocked|API_KEY_SERVICE_BLOCKED|API restrictions?|API target/i.test(str)) return 'apiblocked';
    if (/REQUEST_DENIED|PERMISSION_DENIED|not authorized|forbidden|403/i.test(str)) return 'denied';  // cannot tell the causes apart
    if (/network|Failed to fetch|NetworkError|ERR_|timed? ?out|UNKNOWN_ERROR|offline/i.test(str)) return 'network';
    return 'unknown';
  }
  /* A pre-flight the API never has to answer: a key that cannot possibly be
     a Google key is caught here, before any request (and before any cost). */
  function keyLooksWrong(k) { return !/^AIza[0-9A-Za-z_\-]{20,}$/.test(String(k || '')); }

  /* ================================================================== *
   * GMAPS — lazy Google Maps + Places
   *
   * Loaded ONLY when a key exists, via the documented async bootstrap
   * loader (loading=async).
   *
   * WHICH PLACES API (2026-11-23): the NEW one first. Google's legacy Places
   * API (PlacesService / Autocomplete) is not available to Cloud projects
   * created recently, so a brand-new project that enables only "Places API
   * (New)" would be refused by the legacy service. runSearch therefore calls
   *   google.maps.places.Place.searchNearby({ fields, locationRestriction:
   *   {center, radius}, includedTypes:['restaurant'], maxResultCount:20,
   *   rankPreference: SearchNearbyRankPreference.DISTANCE })
   * which DOES rank by distance (nearest first) — the old comment here that
   * claimed otherwise was wrong. Its limits: at most 20 places per request
   * and NO pagination, so coverage beyond 20 comes from the SWEEP (see
   * makeSweeper): `more` is the sweeper ({sweep:true, fetch, extend, info}),
   * and "Search farther" widens its radius. If the new API throws something that says "not
   * available to you" (not enabled / denied / API-restricted key / an
   * unrecognised error) the LEGACY nearbySearch(rankBy DISTANCE) path runs as
   * a fallback for projects that still have it; that path keeps its ~60 place
   * pagination and its `more` handle.
   *
   * EVERY live search must finish: searchNearby() arms a 15 s watchdog that
   * covers script load + permission + request. A real answer, an auth
   * failure (gm_authFailure), a script error (onerror) or the watchdog —
   * whichever comes first — settles the search exactly once; the rest are
   * ignored. The caller always gets either places or a plain-language reason.
   *
   * searchNearby(origin, done) -> done(err, list, more)
   *   `err` is an already-humanised string (never contains the key).
   *   `more` is null when there is no further page, otherwise
   *   { fetch: function(cb){...} } (legacy path only).
   *
   * NOTE: written to the documented API; the app's handling is exercised
   * against a stub in tests, but real Google behaviour needs a real key.
   * ================================================================== */
  var gmaps = (function () {
    var readyCbs = [];
    // The key the Maps script was actually loaded with. Google Maps can only
    // be keyed once per page load, so a later, different key needs a reload —
    // we say that rather than pretending the swap worked. Kept in a closure
    // variable only: never logged, never rendered, never stored elsewhere.
    var loadedKey = '';
    var authFailCb = null;   // set while a key is being validated
    var loadFailCb = null;
    var SEARCH_TIMEOUT_MS = 15000;
    var pendingSearches = [];   // settle-functions of live searches in flight

    function shippedActive() {
      return !!(CONFIG_KEY && loadedKey === CONFIG_KEY && !store.getUserKey());
    }

    /* Settle every search still waiting, with one humanised reason.
       Returns true when at least one was waiting. */
    function flushPending(code) {
      var list = pendingSearches.slice(); pendingSearches.length = 0;
      var text = liveShortText(code);
      list.forEach(function (f) { try { f(text, null, null); } catch (e) {} });
      return list.length > 0;
    }

    /* The site's shipped key could not be used (script blocked, key refused,
       referrer not allowed). The visitor did nothing wrong and cannot fix it,
       so no settings sheet pops open: Tableau quietly drops to sample data,
       says so once, and releases any search that was waiting on Maps (those
       callbacks fail inside their own try/catch and take the normal
       "sample places instead" path). Returns true when it handled it. */
    function shippedKeyFailed() {
      if (!shippedActive()) return false;
      configKeyDead = true;
      var cbs = readyCbs.slice(); readyCbs.length = 0;
      cbs.forEach(function (cb) { try { cb(); } catch (e) {} });
      try { settings.refreshMode(); find.syncDemoNote(); } catch (e) {}
      toast('Live restaurants are unavailable right now — showing sample places');
      announce('Live restaurants are unavailable right now. Showing sample places.');
      return true;
    }

    /* ---- auxiliary-API failures (Geocoding / legacy Autocomplete) ----
       A key can be perfectly good for Places (New) while the project has not
       enabled "Geocoding API" or the legacy "Places API". Google reports that
       through the very same gm_authFailure as a dead key, so it is told apart
       by ONE cheap probe (the same 1-result, id-only call a key save makes):
       if Places answers, the key is fine and only the auxiliary API is off —
       the typed-location lookup says so plainly, the autocomplete widget is
       removed, and nothing else changes (live search keeps working). If the
       probe fails too, it really is the key, and the normal path runs. */
    var GEO_DENIED_MSG = 'Google refused the lookup \u2014 enable \u201cGeocoding API\u201d for this key\u2019s project, or use \u201cFind a place near me\u201d.';
    var geoPending = 0;        // typed-location lookups in flight
    var geoDeniedAt = 0;       // when a lookup last came back REQUEST_DENIED
    var auxOk = false;         // the key has been proven good for Places
    var auxProbing = false;
    var acOff = false;         // legacy Autocomplete removed; never re-attached
    var acTouched = false;     // it was attached at some point
    var acInput = null;
    var acObserver = null;

    function geoDenied(x) {
      if (x == null) return false;
      var str = (typeof x === 'string') ? x : [x.message, x.name, x.status, x.code, x.reason].join(' ');
      return /REQUEST_DENIED|ApiNotActivated|not activated|has not been used|SERVICE_DISABLED/i.test(str);
    }
    function scrubAcInput() {
      if (!acInput) return;
      try {
        if (acInput.classList.contains('gm-err-autocomplete')) acInput.classList.remove('gm-err-autocomplete');
        if (acInput.style && acInput.style.backgroundImage) acInput.style.backgroundImage = '';
      } catch (e) {}
    }
    /* Take the legacy Autocomplete widget away cleanly: its listeners, its
       dropdown, and the error icon Google paints on the input. */
    function disableAutocomplete() {
      acOff = true;
      try {
        var ev = window.google && google.maps && google.maps.event;
        if (ev && ev.clearInstanceListeners) {
          if (state.autocomplete) ev.clearInstanceListeners(state.autocomplete);
          if (acInput) ev.clearInstanceListeners(acInput);
        }
      } catch (e) {}
      state.autocomplete = null;
      try {
        document.documentElement.classList.add('eats-ac-off');
        Array.prototype.slice.call(document.querySelectorAll('.pac-container')).forEach(function (n) {
          if (n.parentNode) n.parentNode.removeChild(n);
        });
      } catch (e) {}
      scrubAcInput();
      if (acInput && !acObserver && window.MutationObserver) {
        try {
          acObserver = new MutationObserver(scrubAcInput);
          acObserver.observe(acInput, { attributes: true, attributeFilter: ['class', 'style'] });
        } catch (e) {}
      }
    }
    function rejectKey() {
      // a search is waiting: answer IT now (not after the watchdog)
      var flushed = flushPending(shippedActive() ? 'unavailable' : 'rejected');
      if (shippedKeyFailed()) return;
      // open() first: it writes its own "key saved" line, which would
      // otherwise overwrite the reason showCode() just set.
      if (!flushed) settings.open();   // nothing on screen explains it yet
      settings.showCode('rejected');
    }

    /* Settle only the typed-location lookups still waiting. */
    function settleGeo(text) {
      pendingSearches.slice().forEach(function (f) { if (f.geo) { try { f(text, null, null); } catch (e) {} } });
    }
    /* Returns true when this gm_authFailure was handled as auxiliary. */
    function auxAuthFailure() {
      if (!state.mapsLoaded) return false;
      if (auxOk) {   // key already proven good: this is one more auxiliary refusal
        disableAutocomplete(); settleGeo(GEO_DENIED_MSG); return true;
      }
      var maybeAux = geoPending > 0 || acTouched || (Date.now() - geoDeniedAt < 20000);
      if (!maybeAux) return false;
      if (auxProbing) return true;
      auxProbing = true;
      var timer = window.setTimeout(function () { conclude('rejected'); }, 8000), done = false;
      function conclude(code) {
        if (done) return;
        done = true; window.clearTimeout(timer); auxProbing = false;
        if (!code) { auxOk = true; disableAutocomplete(); settleGeo(GEO_DENIED_MSG); return; }
        rejectKey();
      }
      probeKey(conclude);
      return true;
    }

    // The async bootstrap loader (adapted from Google's documented snippet).
    // Exposes window.__eatsMapsReady as the loader callback.
    function loadOnce(key) {
      if (state.mapsLoaded || state.mapsLoading) return;
      if (!key) return; // never load without a key (avoids console errors)
      state.mapsLoading = true;
      loadedKey = key;

      window.__eatsMapsReady = function () {
        // Maps base is ready; the libraries are imported on demand below.
        state.mapsLoaded = true;
        state.mapsLoading = false;
        var cbs = readyCbs.slice(); readyCbs.length = 0;
        cbs.forEach(function (cb) { cb(); });
      };

      // Catch auth failures (invalid key / referrer / billing). Google does
      // not tell these apart here, so the message lists the likely causes in
      // order; the validation probe below is what separates them when it can.
      window.gm_authFailure = function () {
        state.mapsLoading = false;
        if (authFailCb) { var f = authFailCb; authFailCb = null; f('rejected'); return; }
        // The Maps SDK also fires this when ONE auxiliary API is not enabled
        // for an otherwise good key (ApiNotActivatedMapError from Geocoding or
        // from the legacy Autocomplete widget). Those must not kill Places.
        if (auxAuthFailure()) return;
        rejectKey();
      };
      try {
        var s = document.createElement('script');
        var params = [
          'key=' + encodeURIComponent(key),
          'loading=async',
          'libraries=places,geocoding',
          'callback=__eatsMapsReady',
          'v=weekly'
        ].join('&');
        s.src = 'https://maps.googleapis.com/maps/api/js?' + params;
        s.async = true;
        s.defer = true;
        s.onerror = function () {
          state.mapsLoading = false;
          if (loadFailCb) { var g = loadFailCb; loadFailCb = null; g('network'); return; }
          flushPending('network');
          if (shippedKeyFailed()) return;
          settings.showCode('network');
        };
        document.head.appendChild(s);
      } catch (e) {
        state.mapsLoading = false;
        flushPending('network');
        settings.showCode('network');
      }
    }

    function whenReady(cb) {
      if (state.mapsLoaded) { cb(); return; }
      readyCbs.push(cb);
      loadOnce(store.getKey());
    }

    // One PlacesService instance, reused (needs a DOM node or a Map).
    var placesService = null;
    function getService(places) {
      if (placesService) return placesService;
      // PlacesService can render attributions into any node; an offscreen
      // div is fine for a results-list UI (no visible map required).
      var attrNode = document.createElement('div');
      placesService = new places.PlacesService(attrNode);
      return placesService;
    }

    /* searchNearby — the public entry. Settles EXACTLY ONCE: first of a real
       answer, an auth/script failure (flushPending) or the watchdog. */
    function searchNearby(origin, done) {
      var finished = false, timer = null;
      function finish(err, list, more) {
        if (finished) return;            // a late answer after the watchdog is dropped
        finished = true;
        if (timer) { window.clearTimeout(timer); timer = null; }
        var i = pendingSearches.indexOf(finish);
        if (i !== -1) pendingSearches.splice(i, 1);
        done(err, list, more);
      }
      pendingSearches.push(finish);
      timer = window.setTimeout(function () {
        timer = null;
        // loaded-but-silent and never-loaded are different stories
        finish(liveShortText(state.mapsLoaded ? 'timeout' : 'timeoutload'), null, null);
      }, SEARCH_TIMEOUT_MS);
      whenReady(function () {
        if (finished) return;
        runSearch(origin, finish);
      });
    }

    /* Errors that mean "the NEW Places API is not usable by this key/project"
       — the legacy service is worth one try. Everything else (bad key, quota,
       billing, referrer, network) would hit the legacy API identically. */
    var LEGACY_RETRY = { notenabled: 1, denied: 1, apiblocked: 1, unknown: 1 };
    // Set once the new API has said "not for you" and the legacy one worked:
    // later calls (place details) go straight to the legacy service instead
    // of paying a failing request per card first.
    var newApiOff = false;

    function runSearch(origin, done) {
      try {
        google.maps.importLibrary('places').then(function (places) {
          if (places && places.Place && typeof places.Place.searchNearby === 'function') {
            searchNew(places, origin).then(function (res) {
              done(null, res.list, res.more);
            }, function (e) {
              var code = classifyLive(e);
              if (!LEGACY_RETRY[code]) { done(liveShortText(code), null, null); return; }
              searchLegacy(places, origin, function (err, list, more) {
                // both failed: the NEW api's reason is the useful one
                if (err) { done(liveShortText(code), null, null); return; }
                newApiOff = true;
                done(null, list, more);
              });
            });
          } else {
            searchLegacy(places, origin, done);
          }
        }).catch(function (e) {
          done(humanizeError(e), null, null);
        });
      } catch (e) {
        done(humanizeError(e), null, null);
      }
    }

    /* ---- NEW: Place.searchNearby, nearest first, up to 20 ---- */
    // Fields requested: every one is used below. regularOpeningHours +
    // utcOffsetMinutes feed the shared real-hours code; photos give a thumb.
    var NEW_FIELDS = ['id', 'displayName', 'location', 'formattedAddress', 'rating',
      'userRatingCount', 'priceLevel', 'regularOpeningHours', 'utcOffsetMinutes',
      'types', 'primaryType', 'businessStatus', 'photos'];

    var NEARBY_MAX = 20;
    /* Real Google sometimes returns 19 (or fewer) of a requested 20 in a dense
       area while many more places exist farther out (measured: 19 results with
       the 19th at 186 m, 6 probes). So "fewer than 20" does NOT prove the query
       radius was exhausted. Only a genuinely thin answer (< SAT_MIN) is trusted
       as "everything in the radius"; anything fuller counts as saturated and
       only the disc out to its farthest result is treated as complete. */
    var SAT_MIN = NEARBY_MAX - 5;
    var FIRST_RADIUS_M = 5000;      // first call + every probe: 5 km query
    var STALL_LIMIT = 5;
    var M_PER_MI = 1609.344;

    /* ---- cuisine-aware probing ----
       Google type -> our cuisine key is the ONE table (TYPE_CUISINE, below,
       shared with cuisineKeys). The Nearby request asks for the reverse of
       it, so what Google is asked for and what the app filters on can never
       disagree. No cuisine picked -> every restaurant. A picked cuisine with
       no Google type (cannot happen with today's chips, but a future bucket
       might) -> the whole request falls back to ['restaurant'] so nothing is
       silently dropped. Several cuisines are OR'd by Google. The client-side
       filter (filterByPrefs) stays the final authority. */
    var TYPE_CUISINE = {
      italian_restaurant: 'italian', japanese_restaurant: 'japanese', sushi_restaurant: 'japanese',
      ramen_restaurant: 'japanese', mexican_restaurant: 'mexican', thai_restaurant: 'thai',
      indian_restaurant: 'indian', chinese_restaurant: 'chinese', american_restaurant: 'american',
      mediterranean_restaurant: 'mediterranean', korean_restaurant: 'korean',
      vietnamese_restaurant: 'vietnamese', pizza_restaurant: 'pizza', hamburger_restaurant: 'burgers',
      seafood_restaurant: 'seafood', cafe: 'cafe', bakery: 'cafe', coffee_shop: 'cafe',
      barbecue_restaurant: 'bbq', vegetarian_restaurant: 'vegetarian'
    };
    var CUISINE_TYPES = {};
    Object.keys(TYPE_CUISINE).forEach(function (t) {
      var c = TYPE_CUISINE[t];
      (CUISINE_TYPES[c] = CUISINE_TYPES[c] || []).push(t);
    });
    function typesForPrefs(p) {
      var keys = (p && p.cuisine) || [];
      if (!keys.length) return ['restaurant'];
      var out = [];
      for (var i = 0; i < keys.length; i++) {
        var ts = CUISINE_TYPES[keys[i]];
        if (!ts) return ['restaurant'];
        ts.forEach(function (t) { if (out.indexOf(t) === -1) out.push(t); });
      }
      return out;
    }

    function nearbyRaw(places, center, radius, types) {
      var rank = places.SearchNearbyRankPreference;
      return places.Place.searchNearby({
        fields: NEW_FIELDS,
        locationRestriction: { center: { lat: center.lat, lng: center.lng }, radius: radius },
        includedTypes: types,
        maxResultCount: NEARBY_MAX,
        rankPreference: rank ? rank.DISTANCE : 'DISTANCE'
      }).then(function (res) { return (res && res.places) || []; });
    }

    /* A sweep probe is a billed call that must never hang: same 15 s guard
       as the first search. The promise settles once by construction. */
    function probeRaw(places, center, radius, types) {
      return new Promise(function (resolve, reject) {
        var t = window.setTimeout(function () { reject({ sweepTimeout: true }); }, SEARCH_TIMEOUT_MS);
        nearbyRaw(places, center, radius, types).then(
          function (a) { window.clearTimeout(t); resolve(a); },
          function (e) { window.clearTimeout(t); reject(e); });
      });
    }

    function searchNew(places, origin) {
      var calls = 0;
      /* Snapshot the type-set ONCE per search: the sweeper's covered discs are
         only valid for the types they were measured with, and a new search
         (any preference change goes through startSearch) builds a new sweeper
         with empty discs / seen ids. */
      var types = typesForPrefs(state.prefs);
      function ask(radius) { calls++; return nearbyRaw(places, origin, radius, types); }
      // 5 km first; a genuinely empty 5 km (rural) gets one 50 km retry.
      var usedRadius = FIRST_RADIUS_M;
      return ask(FIRST_RADIUS_M).then(function (arr) {
        if (arr.length) return arr;
        usedRadius = 50000;
        return ask(50000);
      }).then(function (raw) {
        var sw = makeSweeper(places, origin, calls, types);
        return sw.seed(raw, usedRadius).then(function (list) {
          return { list: list, more: sw };
        });
      });
    }

    /* ==================================================================
     * SWEEP — "see every restaurant nearby, closest first".
     *
     * Nearby (New) returns at most 20 places per call, NO pagination. With
     * rankPreference DISTANCE the response is the K closest to the query
     * centre, so a SATURATED response (20 results, farthest at d20) proves
     * the disc of radius d20 around that centre is COMPLETE; an UNSATURATED
     * one (<20) proves the whole query radius is. The sweeper keeps a list
     * of such "covered discs" (valid for ONE includedTypes set: the sweeper
     * is built per search with that set and never shared) and a hex grid of sample points over the
     * sweep radius around the USER. Each refill: pick the uncovered sample
     * nearest the user (nudged toward the candidate that would cover the
     * most uncovered samples, but only among samples within 0.75 x the last
     * disc radius of the nearest one, so it stays roughly nearest-first),
     * query Nearby centred there, record the disc, dedupe by place id.
     * "Complete" = every sample point is inside some covered disc (holes
     * narrower than the sample spacing, <= R/20, are not detectable).
     * Distances are ALWAYS from the user (mapPlaceNew(p, origin)). Places
     * a probe returns beyond the sweep radius are held back, not shown,
     * and released if the user extends the radius.
     * Stops: complete | budget (SWEEP.maxCalls) | stalled (5 probes in a
     * row found no new place id) | error (a probe failed).
     * ================================================================== */
    function makeSweeper(places, origin, callsUsed, types) {
      var MLAT = 110574;
      var MLNG = 111320 * Math.cos(origin.lat * Math.PI / 180);
      var ceilR = Math.max(5000, SWEEP.radius);
      var R = SWEEP.radius;
      var known = {}, held = [], discs = [];
      var calls = callsUsed, state = 'open', errText = '', zeroRun = 0, estR = 150, busy = false;
      var xs, ys, ds, cov, n = 0, cursor = 0;

      function buildGrid() {
        var step = Math.max(60, R / 20), rowH = step * 0.8660254;
        var pts = [], rows = Math.ceil(R / rowH), cols = Math.ceil(R / step) + 1;
        for (var j = -rows; j <= rows; j++) {
          for (var i = -cols; i <= cols; i++) {
            var x = (i + ((j & 1) ? 0.5 : 0)) * step, y = j * rowH;
            var d = Math.sqrt(x * x + y * y);
            if (d <= R) pts.push([d, x, y]);
          }
        }
        pts.sort(function (a, b) { return a[0] - b[0]; });
        n = pts.length;
        xs = new Float64Array(n); ys = new Float64Array(n); ds = new Float64Array(n); cov = new Uint8Array(n);
        for (var k = 0; k < n; k++) { ds[k] = pts[k][0]; xs[k] = pts[k][1]; ys[k] = pts[k][2]; }
        cursor = 0;
      }
      function markDisc(dc) {
        var r2 = dc.r * dc.r;
        for (var k = 0; k < n; k++) {
          if (cov[k]) continue;
          var dx = xs[k] - dc.x, dy = ys[k] - dc.y;
          if (dx * dx + dy * dy <= r2) cov[k] = 1;
        }
      }
      function anyUncovered() {
        while (cursor < n && cov[cursor]) cursor++;
        return cursor < n;
      }
      function pickProbe() {
        if (!anyUncovered()) return null;
        var first = cursor, lim = ds[first] + 0.75 * estR, r2 = estR * estR;
        var best = first, bestScore = -1, tried = 0;
        for (var i = first; i < n && tried < 40 && ds[i] <= lim; i++) {
          if (cov[i]) continue;
          tried++;
          var score = 0;
          for (var j = first; j < n && ds[j] <= ds[i] + estR; j++) {
            if (cov[j]) continue;
            var dx = xs[j] - xs[i], dy = ys[j] - ys[i];
            if (dx * dx + dy * dy <= r2) score++;
          }
          if (score > bestScore) { bestScore = score; best = i; }
        }
        return { x: xs[best], y: ys[best] };
      }
      function addDisc(x, y, r) {
        var dc = { x: x, y: y, r: Math.max(1, r * 0.995 - 1) };
        discs.push(dc);
        markDisc(dc);
      }
      function settleState() {
        if (!anyUncovered()) state = 'complete';
        else if (zeroRun >= STALL_LIMIT) state = 'stalled';
        else if (calls >= SWEEP.maxCalls) state = 'budget';
      }
      /* raw Place[] -> fresh, mapped, de-duplicated list (nearest first). */
      function ingest(raw, keepAll) {
        var arr = [], newIds = 0;
        raw.forEach(function (p) {
          if (!p || !p.id || known[p.id]) return;
          known[p.id] = 1; newIds++;
          if (p.businessStatus === 'CLOSED_PERMANENTLY') return;
          arr.push(p);
        });
        return Promise.all(arr.map(openFlag)).then(function (flags) {
          var fresh = [];
          arr.forEach(function (p, i) {
            var r = mapPlaceNew(p, origin, flags[i]);
            if (!keepAll && r.distance != null && r.distance * M_PER_MI > R) held.push(r);
            else fresh.push(r);
          });
          sortNearest(fresh);
          return { fresh: fresh, newIds: newIds };
        });
      }
      function discFromRaw(center, raw, queryRadius) {
        if (raw.length < SAT_MIN) return queryRadius;             // thin answer: whole radius is complete
        var far = 0;
        raw.forEach(function (p) {
          var ll = latLngOf(p && p.location);
          if (ll) far = Math.max(far, haversineMiles(center, ll) * M_PER_MI);
        });
        estR = Math.max(far, 20);
        return far;                                              // saturated: complete out to d20
      }
      function xyOf(c) { return { x: (c.lng - origin.lng) * MLNG, y: (c.lat - origin.lat) * MLAT }; }

      buildGrid();
      var sweeper = {
        sweep: true,
        seed: function (raw, queryRadius) {
          var c = xyOf(origin);
          addDisc(c.x, c.y, discFromRaw(origin, raw, queryRadius));
          return ingest(raw, true).then(function (o) { settleState(); return o.fresh; });
        },
        /* One probe (one billed call). cb(err, freshList, info) exactly once. */
        fetch: function (cb) {
          function out(e, l) { try { cb(e, l, sweeper.info()); } catch (x) {} }
          if (state !== 'open' || busy) { out(null, []); return; }
          var pr = pickProbe();
          if (!pr) { state = 'complete'; out(null, []); return; }
          if (calls >= SWEEP.maxCalls) { state = 'budget'; out(null, []); return; }
          calls++; busy = true;
          var center = { lat: origin.lat + pr.y / MLAT, lng: origin.lng + pr.x / MLNG };
          probeRaw(places, center, FIRST_RADIUS_M, types).then(function (raw) {
            addDisc(pr.x, pr.y, discFromRaw(center, raw, FIRST_RADIUS_M));
            return ingest(raw, false);
          }).then(function (o) {
            busy = false;
            zeroRun = o.newIds ? 0 : zeroRun + 1;
            settleState();
            out(null, o.fresh);
          }, function (e) {
            busy = false; state = 'error';
            errText = (e && e.sweepTimeout) ? liveShortText('timeout') : liveShortText(classifyLive(e));
            out(errText, null);
          });
        },
        /* User asked for farther: widen R one step; returns held places now in range. */
        extend: function () {
          if (!sweeper.info().canExtend) return [];
          R = Math.min(ceilR, R + SWEEP.radius);
          buildGrid();
          discs.forEach(markDisc);
          zeroRun = 0; state = 'open';
          var rel = [], keep = [];
          held.forEach(function (r) { (r.distance * M_PER_MI <= R ? rel : keep).push(r); });
          held = keep; sortNearest(rel);
          settleState();
          return rel;
        },
        info: function () {
          return { state: state, types: types.slice(), radius: R, calls: calls, max: SWEEP.maxCalls, err: errText,
                   discs: discs.length, canExtend: state === 'complete' && R < ceilR && calls < SWEEP.maxCalls };
        }
      };
      return sweeper;
    }

    // Place.isOpen() is computed locally from the fields we asked for (it
    // returns undefined when it cannot tell) — never a request of its own.
    function openFlag(p) {
      try {
        if (p && typeof p.isOpen === 'function') {
          return Promise.resolve(p.isOpen()).then(
            function (v) { return typeof v === 'boolean' ? v : null; },
            function () { return null; });
        }
      } catch (e) {}
      return Promise.resolve(null);
    }

    function sortNearest(list) {
      list.sort(function (a, b) {
        if (a.distance == null) return 1;
        if (b.distance == null) return -1;
        return a.distance - b.distance;
      });
    }

    /* ---- LEGACY: PlacesService.nearbySearch, rankBy DISTANCE (+ pages) ---- */
    function searchLegacy(places, origin, done) {
      try {
        var service = getService(places);
        var RankBy = places.RankBy;
        var request = {
          location: { lat: origin.lat, lng: origin.lng },
          // rankBy DISTANCE => nearest-first, and NO radius allowed.
          rankBy: RankBy ? RankBy.DISTANCE : undefined,
          // rankBy=DISTANCE requires keyword/name/type; food places.
          type: 'restaurant'
        };
        var first = true;
        service.nearbySearch(request, function (results, status, pagination) {
          var isFirst = first; first = false;
          handlePage(places, origin, results, status, pagination, done, isFirst);
        });
      } catch (e) {
        done(humanizeError(e), null, null);
      }
    }

    // Shared handler for the first page and every subsequent page.
    function handlePage(P, origin, results, status, pagination, done, isFirst) {
      if (status !== P.PlacesServiceStatus.OK && status !== P.PlacesServiceStatus.ZERO_RESULTS) {
        if (!isFirst && pendingMoreCb) { var ecb = pendingMoreCb; pendingMoreCb = null; ecb(humanizeStatus(status), null, null); return; }
        done(humanizeStatus(status), null, null);
        return;
      }
      var list = (results || []).map(function (p) { return mapPlace(p, origin); });
      // already nearest-first from the API, but enforce it defensively.
      sortNearest(list);

      // Build an outward-expanding "more" handle if another page exists.
      // pagination.nextPage() re-invokes the SAME nearbySearch callback
      // (handlePage, isFirst=false) with the next page of farther-out
      // results, routed to the caller's cb via a one-shot (with a timeout:
      // a page that never arrives must not freeze the button).
      var more = null;
      if (pagination && pagination.hasNextPage) {
        more = {
          fetch: function (cb) {
            var settled = false;
            var t = window.setTimeout(function () {
              if (settled) return;
              settled = true; pendingMoreCb = null;
              cb(liveShortText('timeout'), null, null);
            }, 12000);
            pendingMoreCb = function (e, l, m) {
              if (settled) return;
              settled = true; window.clearTimeout(t);
              cb(e, l, m);
            };
            pagination.nextPage();
          }
        };
      }
      // Deliver this page.
      if (!isFirst && pendingMoreCb) {
        var cb = pendingMoreCb; pendingMoreCb = null;
        cb(null, list, more);
      } else if (isFirst) {
        done(null, list, more);
      }
    }
    // One-shot callback used to route paginated pages back to find.loadMore.
    var pendingMoreCb = null;

    /* ================= REAL HOURS -> the shared openH/closeH ==========
       Google hands us `opening_hours.periods`: one entry per opening —
         { open:  { day: 0-6, hours, minutes, time:"1130" },
           close: { day: 0-6, hours, minutes, time:"2200" } }
       (the newer Place surface spells these `hour`/`minute` and nests them
       under `regularOpeningHours`; both shapes are read below). We fold a
       day's periods into the SAME two numbers a demo place carries —
       openH / closeH, hours 0-24 local — so openState() does all the clock
       reasoning exactly once, for both modes. No hours maths lives here.

       THE RULE (also written up in docs/peckish/README.md):
         1. the window CONTAINING this minute wins — including one that
            opened yesterday evening and runs past midnight, expressed the
            way the demo data already does it (closeH < openH);
         2. otherwise the NEXT window that starts later today wins, so a
            lunch-and-dinner place whose lunch is over says "Opens at 5pm"
            instead of pointing at a service that has already ended;
         3. otherwise — nothing left today, or the place is shut today —
            NO times are set at all and the binary flag speaks: "Closed",
            never an invented hour;
         4. open 24 hours (a period with no `close`) also drops to the
            binary flag: "Open now", with no closing time to fabricate;
         5. if Google's own open_now disagrees with the window we derived
            (holiday hours it knows about and `periods` does not), the times
            are dropped and Google's flag wins;
         6. if the place does not share this browser's UTC offset, the
            times are dropped too — openState reasons in the browser's
            timezone, so another zone's hours would print a confidently
            wrong clock. Binary only.
       ================================================================= */

    // One {day, min} from either spelling of a Google opening-hours time.
    function hoursTime(t) {
      if (!t) return null;
      var h = (t.hours != null) ? t.hours : t.hour;
      var m = (t.minutes != null) ? t.minutes : t.minute;
      if (h == null && typeof t.time === 'string' && /^\d{4}$/.test(t.time)) {
        h = parseInt(t.time.slice(0, 2), 10);
        m = parseInt(t.time.slice(2), 10);
      }
      if (h == null || isNaN(h)) return null;
      return { day: (t.day == null ? -1 : t.day), min: h * 60 + (m || 0) };
    }

    /* Every opening that can still be running or starting TODAY, in minutes
       from today 00:00 (a window that began yesterday has a negative start).
       Returns null for "open 24 hours" (a period with an open and no close). */
    function todayWindows(periods, dow) {
      var out = [];
      for (var i = 0; i < periods.length; i++) {
        var o = hoursTime(periods[i] && periods[i].open);
        var c = hoursTime(periods[i] && periods[i].close);
        if (!o) continue;
        if (!c) return null;                       // 24-hour place
        for (var k = -1; k <= 0; k++) {            // yesterday's + today's
          var day = ((dow + k) % 7 + 7) % 7;
          if (o.day !== -1 && o.day !== day) continue;
          var start = k * 1440 + o.min;
          // length of the service, walking forward from open to close
          var gap = (c.day === -1)
            ? (c.min <= o.min ? 1 : 0)
            : ((((c.day - o.day) % 7) + 7) % 7);
          var end = start + gap * 1440 + (c.min - o.min);
          if (end <= start) end += 1440;           // defensive, never empty
          out.push({ start: start, end: end });
        }
      }
      return out;
    }

    /* -> { openH, closeH } | 'always' | null  (see the rule above). */
    function hoursForNow(periods, now) {
      if (!periods || !periods.length) return null;
      var wins = todayWindows(periods, now.getDay());
      if (wins === null) return 'always';
      if (!wins.length) return null;
      var mins = now.getHours() * 60 + now.getMinutes();
      var active = null, next = null, i, w;
      for (i = 0; i < wins.length; i++) {
        w = wins[i];
        if (mins >= w.start && mins < w.end) {
          if (!active || w.end > active.end) active = w;      // longest cover
        } else if (w.start > mins && (!next || w.start < next.start)) {
          next = w;                                           // soonest ahead
        }
      }
      w = active || next;
      if (!w) return null;                                    // done for today
      if (w.end - w.start >= 1440) return 'always';
      var openH = ((w.start % 1440) + 1440) % 1440 / 60;
      var endMod = ((w.end % 1440) + 1440) % 1440;
      // A window that ends exactly at midnight is closeH 24 — the same
      // convention the demo places use, so openState reads it unchanged.
      var closeH = (endMod === 0) ? 24 : endMod / 60;
      return { openH: openH, closeH: closeH };
    }

    // Does this place keep the same clock as the browser? (unknown => yes)
    function sameClock(utcOffsetMinutes) {
      if (utcOffsetMinutes == null || isNaN(utcOffsetMinutes)) return true;
      return utcOffsetMinutes === -(new Date().getTimezoneOffset());
    }

    /* Write real hours (or an honest binary) onto a result. Called with the
       opening-hours object from a Place Details response. */
    function applyHours(r, oh, utcOffsetMinutes) {
      if (!r) return;
      // Google's own verdict first — it knows about holiday hours.
      var flag = null;
      try {
        if (oh && typeof oh.isOpen === 'function') flag = oh.isOpen();
      } catch (e) {}
      if (typeof flag !== 'boolean' && oh && typeof oh.open_now === 'boolean') flag = oh.open_now;
      if (typeof flag !== 'boolean' && oh && typeof oh.openNow === 'boolean') flag = oh.openNow;
      if (typeof flag === 'boolean') r.open = flag;

      r.openH = null; r.closeH = null;             // never keep stale hours
      if (!sameClock(utcOffsetMinutes)) return;    // other timezone: binary only
      var periods = oh && (oh.periods ||
        (oh.regularOpeningHours && oh.regularOpeningHours.periods));
      var mapped = hoursForNow(periods, new Date());
      if (!mapped || mapped === 'always') return;  // binary, no invented time

      // the derived window must agree with Google's own open_now
      var st = openState({ openH: mapped.openH, closeH: mapped.closeH });
      var derivedOpen = !!st && (st.key === 'open' || st.key === 'soon');
      if (typeof flag === 'boolean' && derivedOpen !== flag) return;
      r.openH = mapped.openH;
      r.closeH = mapped.closeH;
      if (typeof flag !== 'boolean') r.open = derivedOpen;
    }

    /* Photo author credit. New API: photo.authorAttributions[] with
       displayName + uri. Legacy: photo.html_attributions[] — an HTML string
       like '<a href="https://maps.google.com/...">Name</a>', parsed in an
       inert DOMParser document (nothing runs; only text + href are read).
       Returns {by, uri} (uri only when https) or null — absent is fine. */
    function httpsOnly(u) { return (typeof u === 'string' && /^https:\/\//i.test(u)) ? u : null; }
    function creditNew(ph) {
      try {
        var a = ph && ph.authorAttributions && ph.authorAttributions[0];
        var by = a && typeof a.displayName === 'string' ? a.displayName.trim() : '';
        return by ? { by: by, uri: httpsOnly(a.uri) } : null;
      } catch (e) { return null; }
    }
    function creditLegacy(ph) {
      try {
        var h = ph && ph.html_attributions && ph.html_attributions[0];
        if (typeof h !== 'string' || !h) return null;
        var doc = new DOMParser().parseFromString(h, 'text/html');
        var link = doc.querySelector('a');
        var by = ((link || doc.body).textContent || '').trim();
        return by ? { by: by, uri: link ? httpsOnly(link.getAttribute('href')) : null } : null;
      } catch (e) { return null; }
    }

    /* The ONE place a live result object is built, so the legacy and the new
       Places surfaces cannot drift apart. `f` carries already-normalised
       primitives; nothing here knows which API they came from. */
    function buildResult(f, origin) {
      var loc = f.loc || null;
      return {
        id: f.id,
        placeId: f.id,
        name: f.name || 'Unnamed place',
        rating: f.rating || 0,
        reviews: f.reviews || 0,
        price: f.price || 0,
        type: f.type || '',
        // Map Google `types` to our Preferences cuisine keys so prefs filter live results.
        cuisines: f.cuisines || [],
        diet: [],     // Places doesn't expose dietary flags; left empty (no false filtering)
        dining: [],   // not reliably exposed in search results
        // A search result carries at most a binary open flag (plus, on the
        // new API, periods) — applyHours fills these in below; no time is
        // ever invented.
        open: null,
        openH: null,
        closeH: null,
        phone: null, // the Details call (fetchDetails) adds it
        // Thumb-sized URL, built (not fetched) here. It carries Google's own
        // key parameter, so it lives in memory only: never logged, never
        // stored, never exported.
        photoUrl: f.photoUrl || null,
        photoBy: f.photoBy || null,   // author of photoUrl (Places terms)
        photoUri: f.photoUri || null,
        photos: [],                   // [{url, by, uri}] — filled by fetchDetails
        address: f.address || '',
        // story segments — populated lazily by fetchDetails (photos + reviews).
        // Until then they collapse to a labeled watercolor panel.
        segments: {
          vibe: { kind: 'vibe', glyph: '✨', caption: '' },
          food: { kind: 'food', glyph: '🍴', caption: '' },
          reviews: { kind: 'reviews', quotes: [] }
        },
        location: loc,
        distance: loc ? haversineMiles(origin, loc) : null,
        mapsUri: f.id ? 'https://www.google.com/maps/place/?q=place_id:' + f.id : null,
        detailsLoaded: false
      };
    }

    // Map a legacy PlaceResult to our internal result shape.
    function mapPlace(p, origin) {
      var loc = null;
      try {
        if (p.geometry && p.geometry.location) {
          loc = { lat: p.geometry.location.lat(), lng: p.geometry.location.lng() };
        }
      } catch (e) {}
      var photoUrl = null, photoCr = null;
      try {
        if (p.photos && p.photos.length && typeof p.photos[0].getUrl === 'function') {
          photoUrl = p.photos[0].getUrl({ maxWidth: 400, maxHeight: 400 });
          photoCr = creditLegacy(p.photos[0]);
        }
      } catch (e) {}
      var out = buildResult({
        id: p.place_id,
        name: p.name,
        rating: p.rating,
        reviews: p.user_ratings_total,
        price: (typeof p.price_level === 'number' && p.price_level > 0) ? p.price_level : 0,
        type: typeArr(p.types),
        cuisines: cuisineKeys(p.types),
        photoUrl: photoUrl,
        photoBy: photoCr && photoCr.by,
        photoUri: photoCr && photoCr.uri,
        loc: loc
      }, origin);
      // legacy nearbySearch only ever carries open_now, so this sets the
      // binary state and leaves openH/closeH null.
      applyHours(out, p.opening_hours, p.utc_offset_minutes);
      return out;
    }

    // Place.priceLevel -> our 0-4. The JS enum is FREE / INEXPENSIVE /
    // MODERATE / EXPENSIVE / VERY_EXPENSIVE (the REST spelling adds a
    // PRICE_LEVEL_ prefix) — both read here, numbers too.
    function priceFromNew(v) {
      if (typeof v === 'number') return (v > 0 && v <= 4) ? v : 0;
      var t = String(v == null ? '' : v).replace(/^PRICE_LEVEL_/i, '').toUpperCase();
      return ({ INEXPENSIVE: 1, MODERATE: 2, EXPENSIVE: 3, VERY_EXPENSIVE: 4 })[t] || 0;
    }
    function latLngOf(l) {
      if (!l) return null;
      try {
        var la = (typeof l.lat === 'function') ? l.lat() : l.lat;
        var ln = (typeof l.lng === 'function') ? l.lng() : l.lng;
        return (isFinite(la) && isFinite(ln)) ? { lat: +la, lng: +ln } : null;
      } catch (e) { return null; }
    }

    // Map a NEW-API Place (fields per NEW_FIELDS) to the same result shape.
    function mapPlaceNew(p, origin, openNow) {
      var photoUrl = null, photoCr = null;
      try {
        if (p.photos && p.photos.length && typeof p.photos[0].getURI === 'function') {
          photoUrl = p.photos[0].getURI({ maxWidth: 400, maxHeight: 400 });
          photoCr = creditNew(p.photos[0]);
        }
      } catch (e) {}
      // primaryType first ("italian_restaurant"), then the rest; a bare
      // "restaurant" label is noise next to a specific one.
      var all = [];
      if (p.primaryType) all.push(p.primaryType);
      (p.types || []).forEach(function (t) { if (all.indexOf(t) === -1) all.push(t); });
      var labelTypes = all.length > 1 ? all.filter(function (t) { return t !== 'restaurant'; }) : all;
      var out = buildResult({
        id: p.id,
        name: (typeof p.displayName === 'string') ? p.displayName : (p.displayName && p.displayName.text),
        rating: (typeof p.rating === 'number') ? p.rating : 0,
        reviews: (typeof p.userRatingCount === 'number') ? p.userRatingCount : 0,
        price: priceFromNew(p.priceLevel),
        type: typeArr(labelTypes),
        cuisines: cuisineKeys(all),
        photoUrl: photoUrl,
        photoBy: photoCr && photoCr.by,
        photoUri: photoCr && photoCr.uri,
        address: p.formattedAddress || '',
        loc: latLngOf(p.location)
      }, origin);
      var rh = p.regularOpeningHours;
      applyHours(out, (rh || openNow !== null)
        ? { periods: rh && rh.periods, openNow: (typeof openNow === 'boolean') ? openNow : undefined }
        : null, p.utcOffsetMinutes);
      return out;
    }

    // Turn the legacy `types` array into a friendly label.
    function typeArr(types) {
      if (!types || !types.length) return '';
      var skip = { point_of_interest: 1, establishment: 1, food: 1 };
      var nice = types.filter(function (t) { return !skip[t]; })
        .slice(0, 2)
        .map(function (t) { return t.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); });
      return nice.join(' · ');
    }

    /* Map Google Place `types` to our Preferences cuisine keys (best effort).
       Google has limited cuisine granularity, so many places only match
       generic keys; unmatched places simply won't be excluded unless the
       user picks a cuisine. */
    function cuisineKeys(types) {
      if (!types || !types.length) return [];
      var MAP = TYPE_CUISINE;
      var out = [];
      types.forEach(function (t) { if (MAP[t] && out.indexOf(MAP[t]) === -1) out.push(MAP[t]); });
      return out;
    }

    function humanizeStatus(status) {
      return liveShortText(classifyLive(status));
    }

    /* ================= KEY VALIDATION ================================
       Saving a key makes a real attempt rather than a hopeful shrug:

         · a string that cannot be a Google key is caught before any
           request at all (keyLooksWrong);
         · then the Maps script is loaded with the key. A script that never
           arrives is a network failure; gm_authFailure is Google refusing
           the key outright (it does not say which of the two reasons);
         · then ONE tiny search runs. We prefer the modern
           Place.searchNearby because its rejection carries Google's own
           error text — the only surface that separates "API key not
           valid" from "requests from this referer are blocked" from
           "quota exceeded". Without it we fall back to the legacy
           service's status codes, where REQUEST_DENIED covers both, and
           the message says so honestly instead of guessing.

       The probe asks for ONE result and the `id` field only — the
       cheapest request the API sells — and it is made once per key save. */
    function validateKey(key, done) {
      var settled = false, timer = null;
      function finish(code) {
        if (settled) return;
        settled = true;
        if (timer) { window.clearTimeout(timer); timer = null; }
        authFailCb = null;
        loadFailCb = null;
        done(code || null);
      }
      if (!key) { finish('invalid'); return; }
      if (keyLooksWrong(key)) { finish('shape'); return; }
      if (offline.isOffline()) { finish('network'); return; }
      if (state.mapsLoaded && loadedKey && loadedKey !== key) { finish('reload'); return; }
      timer = window.setTimeout(function () { finish('network'); }, 12000);
      authFailCb = finish;
      loadFailCb = finish;
      loadOnce(key);
      whenReady(function () { probeKey(finish); });
    }

    function probeKey(finish) {
      var origin = state.origin || DEMO_ORIGIN;
      function legacyProbe(places, newCode) {
        try {
          var service = getService(places);
          service.nearbySearch({
            location: { lat: origin.lat, lng: origin.lng },
            rankBy: places.RankBy ? places.RankBy.DISTANCE : undefined,
            type: 'restaurant'
          }, function (results, status) {
            var P = places;
            if (status === P.PlacesServiceStatus.OK ||
                status === P.PlacesServiceStatus.ZERO_RESULTS) { finish(null); return; }
            // both failed: the new API's reason is the useful one
            finish(newCode || classifyLive(status));
          });
        } catch (e) { finish(newCode || classifyLive(e)); }
      }
      try {
        google.maps.importLibrary('places').then(function (places) {
          if (places.Place && typeof places.Place.searchNearby === 'function') {
            places.Place.searchNearby({
              fields: ['id'],
              locationRestriction: {
                center: { lat: origin.lat, lng: origin.lng },
                radius: 500
              },
              includedTypes: ['restaurant'],
              maxResultCount: 1
            }).then(function () { finish(null); },
                    function (e) {
                      var code = classifyLive(e);
                      if (LEGACY_RETRY[code]) legacyProbe(places, code);
                      else finish(code);
                    });
            return;
          }
          legacyProbe(places, null);
        }).catch(function (e) { finish(classifyLive(e)); });
      } catch (e) { finish(classifyLive(e)); }
    }

    /* geocode — turn a typed address into {lat,lng} (Geocoding library). */
    function geocode(query, done) {
      var settled = false, timer = null;
      function fin(err, o) {
        if (settled) return;
        settled = true;
        if (timer) window.clearTimeout(timer);
        var i = pendingSearches.indexOf(hook);
        if (i !== -1) pendingSearches.splice(i, 1);
        done(err, o);
      }
      function hook(err) { fin(err, null); }
      hook.geo = true;
      geoPending++;
      var wasPending = true;
      var finRaw = fin;
      fin = function (err, o) {
        if (wasPending) { wasPending = false; geoPending = Math.max(0, geoPending - 1); }
        finRaw(err, o);
      };
      // same promise as the search: a lookup must finish, one way or another
      timer = window.setTimeout(function () {
        fin(liveShortText(state.mapsLoaded ? 'timeout' : 'timeoutload'), null);
      }, 12000);
      pendingSearches.push(hook);   // auth/script failure answers it now
      whenReady(function () {
        if (settled) return;
        try {
          google.maps.importLibrary('geocoding').then(function (geo) {
            var geocoder = new geo.Geocoder();
            function denied() {
              // the key is not dead: only this API is off. Nothing else changes.
              geoDeniedAt = Date.now();
              disableAutocomplete();
              fin(GEO_DENIED_MSG, null);
            }
            var pr = geocoder.geocode({ address: query }, function (results, status) {
              if (status === 'OK' && results && results[0]) {
                var l = results[0].geometry.location;
                fin(null, { lat: l.lat(), lng: l.lng() });
              } else if (status === 'REQUEST_DENIED') {
                denied();
              } else if (status === 'OVER_QUERY_LIMIT') {
                fin(liveShortText('quota'), null);
              } else {
                fin('Could not find \u201c' + query + '\u201d \u2014 try a city or a fuller address.', null);
              }
            });
            // newer SDKs also hand back a promise that rejects with the status
            if (pr && typeof pr.then === 'function') {
              pr.then(null, function (e) { if (geoDenied(e)) denied(); else fin(humanizeError(e), null); });
            }
          }).catch(function (e) { fin(humanizeError(e), null); });
        } catch (e) { fin(humanizeError(e), null); }
      });
    }

    /* Places Autocomplete on the location input (when API is ready). */
    function attachAutocomplete(input) {
      if (!input || state.autocomplete || acOff) return;
      whenReady(function () {
        try {
          google.maps.importLibrary('places').then(function (places) {
            // Legacy Autocomplete widget is still the simplest text-field binding.
            if (!places.Autocomplete || acOff || state.autocomplete) return;
            acInput = input; acTouched = true;
            state.autocomplete = new places.Autocomplete(input, {
              fields: ['geometry', 'name'],
              types: ['geocode']
            });
            state.autocomplete.addListener('place_changed', function () {
              var place = state.autocomplete.getPlace();
              if (place && place.geometry && place.geometry.location) {
                state.origin = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() };
                if (place.name) state.originLabel = place.name;
                // a chosen autocomplete location goes to Preferences, then the deck.
                find.showPrefs(true);
              }
            });
          }).catch(function () { acInput = input; disableAutocomplete(); });
        } catch (e) { acInput = input; disableAutocomplete(); }
      });
    }

    function humanizeError(e) {
      return liveShortText(classifyLive(e));
    }

    /* fetchDetails — lazily enrich ONE result's card segments with Place
       Details (photos + reviews + phone + opening hours). Called by the deck
       only for the top card and the next two, so we never fetch data for
       cards the user won't see. Minimal fields are requested. Cached per
       place via the result's `detailsLoaded` flag (set by the caller).

       Google does NOT label photos as "vibe" vs "food" (no categories exist),
       so live photos are shown with neutral labels, de-duplicated, and
       credited to their authors. Reviews fill the Reviews
       segment; any segment with no data collapses gracefully in the deck.

       NOTE: live-only; cannot be exercised here without a key + network. */
    function fetchDetails(r, done) {
      if (!r || !r.placeId) { done && done(null, null); return; }
      whenReady(function () {
        try {
          google.maps.importLibrary('places').then(function (places) {
            if (!newApiOff && places && places.Place && typeof places.Place.prototype.fetchFields === 'function') {
              detailsNew(places, r, function (err) {
                if (!err) { done && done(null, r); return; }
                var code = err.code;
                if (!LEGACY_RETRY[code]) { done && done(liveShortText(code), null); return; }
                detailsLegacy(places, r, function (e2) {
                  if (e2) { done && done(liveShortText(code), null); return; }
                  newApiOff = true;
                  done && done(null, r);
                });
              });
            } else {
              detailsLegacy(places, r, function (e2) {
                if (e2) done && done(e2, null); else done && done(null, r);
              });
            }
          }).catch(function (e) { done && done(humanizeError(e), null); });
        } catch (e) { done && done(humanizeError(e), null); }
      });
    }

    // Clip at a word boundary with an ellipsis (never mid-word).
    function clipWords(t, max) {
      if (t.length <= max) return t;
      var cut = t.slice(0, max);
      var sp = cut.lastIndexOf(' ');
      if (sp > max * 0.5) cut = cut.slice(0, sp);
      return cut.replace(/[\s,;:.\-\u2013\u2014!?]+$/, '') + '\u2026';
    }
    // Google's review text: a string, {text}, or null (ratings-only reviews
    // are common); originalText is the same shape in the author's language.
    function reviewTextOf(rv) {
      function pick(v) { return (typeof v === 'string') ? v : (v && typeof v.text === 'string' ? v.text : ''); }
      var t = pick(rv && rv.text).trim() || pick(rv && rv.originalText).trim();
      return t.replace(/\s+/g, ' ');
    }

    // photos -> distinct live photo list (Google gives no categories, so
    // nothing is labelled vibe/food); reviews -> quotes that have words.
    // photos: [{url, by, uri}]
    function applySegments(r, photos, reviews) {
      var seen = {}, uniq = [];
      (photos || []).forEach(function (ph) {
        if (ph && ph.url && !seen[ph.url] && uniq.length < 4) { seen[ph.url] = 1; uniq.push(ph); }
      });
      if (uniq.length) {
        r.photos = uniq;
        r.segments.vibe.photoUrl = uniq[0].url;
        r.segments.food.photoUrl = uniq[1] ? uniq[1].url : null;   // never the same photo twice
        r.segments.vibe.caption = '';
        r.segments.food.caption = '';
      }
      try {
        var withText = [], rated = null;
        reviews.forEach(function (q) {
          var t = q.text;
          if (t) withText.push({ by: q.by || 'A diner', score: Math.round((q.rating || 0) * 20), text: clipWords(t, 180) });
          else if (!rated && q.rating > 0) rated = { by: q.by || 'A diner', score: Math.round(q.rating * 20), text: '' };
        });
        // no review has words: one rating-only note (rendered without quotes)
        r.segments.reviews.quotes = withText.length ? withText.slice(0, 3) : (rated ? [rated] : []);
      } catch (e) {}
    }

    /* NEW: new Place({id}).fetchFields — minimal fields, all used. cb(null)
       on success, cb({code}) on failure. */
    function detailsNew(places, r, cb) {
      var place;
      try { place = new places.Place({ id: r.placeId }); } catch (e) { cb({ code: classifyLive(e) }); return; }
      place.fetchFields({
        fields: ['photos', 'reviews', 'nationalPhoneNumber', 'internationalPhoneNumber',
          'regularOpeningHours', 'utcOffsetMinutes']
      }).then(function () {
        r.phone = place.internationalPhoneNumber || place.nationalPhoneNumber || r.phone || null;
        return openFlag(place);
      }).then(function (flag) {
        try {
          var rh = place.regularOpeningHours;
          applyHours(r, { periods: rh && rh.periods, openNow: (typeof flag === 'boolean') ? flag : undefined },
            place.utcOffsetMinutes);
        } catch (e) {}
        var urls = [];
        try {
          // four at most, card-sized (the URL carries Google's key param;
          // memory only — never persisted)
          // (authorAttributions rides along with the 'photos' field)
          (place.photos || []).slice(0, 6).forEach(function (ph) {
            if (typeof ph.getURI !== 'function') return;
            var cr = creditNew(ph);
            urls.push({ url: ph.getURI({ maxWidth: 640, maxHeight: 800 }), by: cr && cr.by, uri: cr && cr.uri });
          });
        } catch (e) {}
        var revs = [];
        try {
          (place.reviews || []).forEach(function (rv) {
            revs.push({
              by: rv.authorAttribution && rv.authorAttribution.displayName,
              rating: rv.rating,
              text: reviewTextOf(rv)
            });
          });
        } catch (e) {}
        applySegments(r, urls, revs);
        cb(null);
      }, function (e) { cb({ code: classifyLive(e) }); });
    }

    /* LEGACY: PlacesService.getDetails. cb(null) or cb(errorText). */
    function detailsLegacy(places, r, cb) {
      var service;
      try { service = getService(places); } catch (e) { cb(humanizeError(e)); return; }
      service.getDetails({
        placeId: r.placeId,
        // Minimal, and every field is used: opening_hours carries the
        // real `periods` the status chip needs; utc_offset_minutes is
        // how we know those hours belong on this browser's clock.
        fields: ['photos', 'reviews', 'formatted_phone_number', 'international_phone_number',
          'opening_hours', 'utc_offset_minutes', 'name']
      }, function (place, status) {
        var P = places;
        if (status !== P.PlacesServiceStatus.OK || !place) { cb(humanizeStatus(status)); return; }
        r.phone = place.international_phone_number || place.formatted_phone_number || r.phone || null;
        // REAL HOURS: Details carries `periods`, so a live place stops being a
        // binary open/shut flag and starts saying "Closes at 9:30pm".
        try {
          applyHours(r, place.opening_hours,
            (place.utc_offset_minutes != null) ? place.utc_offset_minutes : place.utc_offset);
        } catch (e) {}
        var urls = [];
        try {
          (place.photos || []).slice(0, 6).forEach(function (ph) {
            if (typeof ph.getUrl !== 'function') return;
            var cr = creditLegacy(ph);
            urls.push({ url: ph.getUrl({ maxWidth: 640, maxHeight: 800 }), by: cr && cr.by, uri: cr && cr.uri });
          });
        } catch (e) {}
        var revs = [];
        try {
          (place.reviews || []).forEach(function (rv) { revs.push({ by: rv.author_name, rating: rv.rating, text: reviewTextOf(rv) }); });
        } catch (e) {}
        applySegments(r, urls, revs);
        cb(null);
      });
    }

    return {
      loadOnce: loadOnce,
      validateKey: validateKey,
      searchNearby: searchNearby,
      geocode: geocode,
      attachAutocomplete: attachAutocomplete,
      fetchDetails: fetchDetails
    };
  })();

  /* ================================================================== *
   * SHEET — rating sheet (Food / Vibe / Service -> Overall)
   * ================================================================== */
  var sheet = (function () {
    var backdrop = $('sheet-backdrop');
    var form = $('rating-form');
    var nameInput = $('rate-name');
    var locField = $('rate-loc-field');
    var locInput = $('rate-loc');
    var placeSub = $('rate-place-sub');
    var noteInput = $('rate-note');
    var dateInput = $('rate-date');
    var sFood = $('s-food'), sVibe = $('s-vibe'), sService = $('s-service');
    var nFood = $('s-food-num'), nVibe = $('s-vibe-num'), nService = $('s-service-num');
    var overallOut = $('overall-value');
    var overallWrap = overallOut ? overallOut.parentNode : null;   // .overall-num-wrap
    var overallBlot = overallWrap ? overallWrap.querySelector('.overall-blot') : null;
    var titleEl = $('sheet-title');

    /* Watercolor score tint: low ~rose -> mid ~gold -> high ~sage.
       Pure linear pigment mix; the CSS side anchors text colors to ink
       (day) / cream (evening) via color-mix so numbers stay AA-readable —
       the raw tint only ever paints decorative surfaces (track, thumb,
       overall blot). */
    var TINT_LOW = [217, 139, 160];   /* rose  #d98ba0 */
    var TINT_MID = [205, 184, 120];   /* gold  #cdb878 */
    var TINT_HIGH = [147, 180, 139];  /* sage  #93b48b */
    function scoreTint(v) {
      var a = TINT_LOW, b = TINT_MID, t;
      if (v <= 50) { t = v / 50; } else { a = TINT_MID; b = TINT_HIGH; t = (v - 50) / 50; }
      return 'rgb(' +
        Math.round(a[0] + (b[0] - a[0]) * t) + ',' +
        Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
        Math.round(a[2] + (b[2] - a[2]) * t) + ')';
    }

    function syncSlider(input, out) {
      var v = parseFloat(input.value);
      out.textContent = fmtScore(v);
      input.setAttribute('aria-valuetext', fmtScore(v) + ' out of 100');
      paintRange(input);
      // tint lives on the block so track, thumb AND number can read it
      if (input.parentNode) input.parentNode.style.setProperty('--score-tint', scoreTint(v));
    }
    var blotSwelling = false;
    function syncOverall(animate) {
      var avg = (parseFloat(sFood.value) + parseFloat(sVibe.value) + parseFloat(sService.value)) / 3;
      overallOut.textContent = fmtScore(avg);
      if (overallWrap) overallWrap.style.setProperty('--score-tint', scoreTint(avg));
      // gentle swell while sliding — transform/opacity keyframes only; one
      // pulse at a time (animationend clears the flag), none under
      // reduced motion (number + tint still update instantly above)
      if (animate && !prefersReducedMotion && overallBlot && !blotSwelling) {
        blotSwelling = true;
        overallBlot.classList.add('is-swell');
      }
    }
    function syncAll(animate) {
      syncSlider(sFood, nFood); syncSlider(sVibe, nVibe); syncSlider(sService, nService);
      syncOverall(animate);
    }

    /* input events can fire far faster than frames paint (fine-grained
       pointer drags) — coalesce them into one syncAll per frame */
    var rafPending = false;
    function scheduleSync() {
      if (rafPending) return;
      rafPending = true;
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(function () { rafPending = false; syncAll(true); });
      } else {
        rafPending = false;
        syncAll(true);
      }
    }

    function setValues(v) {
      sFood.value = v.food; sVibe.value = v.vibe; sService.value = v.service;
      syncAll();
    }

    /* One settled "Overall N", ~700ms after the last slider move. */
    var overallTimer = null;
    function announceOverallSoon() {
      if (overallTimer) window.clearTimeout(overallTimer);
      overallTimer = window.setTimeout(function () {
        overallTimer = null;
        if (!modal.isOpen(backdrop)) return;
        announce('Overall ' + overallOut.textContent);
      }, 700);
    }

    function show() {
      modal.open(backdrop, nameInput, function () {
        state.editingId = null;
        state.pendingPlace = null;
      });
    }
    function hide() { modal.close(); }

    function todayStr() {
      var d = new Date();
      var mm = ('0' + (d.getMonth() + 1)).slice(-2);
      var dd = ('0' + d.getDate()).slice(-2);
      return d.getFullYear() + '-' + mm + '-' + dd;
    }

    // Open from a Find result.
    function openForPlace(place) {
      if (!VISITED_ON) return;
      state.editingId = null;
      state.pendingPlace = place;
      titleEl.textContent = 'Rate ' + (place.name || 'this place');
      nameInput.value = place.name || '';
      placeSub.hidden = !place.address;
      placeSub.textContent = place.address || '';
      locField.hidden = true;
      noteInput.value = '';
      dateInput.value = todayStr();
      setValues({ food: 50, vibe: 50, service: 50 });
      show();
    }

    // Open blank for manual "+ Add a place".
    function openBlank() {
      if (!VISITED_ON) return;
      state.editingId = null;
      state.pendingPlace = null;
      titleEl.textContent = 'Add a place';
      nameInput.value = '';
      placeSub.hidden = true;
      locField.hidden = false;
      locInput.value = '';
      noteInput.value = '';
      dateInput.value = todayStr();
      setValues({ food: 50, vibe: 50, service: 50 });
      show();
    }

    // Open to edit an existing entry.
    function openForEdit(entry) {
      if (!VISITED_ON) return;
      state.editingId = entry.id;
      state.pendingPlace = null;
      titleEl.textContent = 'Edit ' + entry.name;
      nameInput.value = entry.name;
      placeSub.hidden = true;
      locField.hidden = false;
      locInput.value = entry.loc || '';
      noteInput.value = entry.note || '';
      dateInput.value = entry.date || todayStr();
      setValues({ food: entry.food, vibe: entry.vibe, service: entry.service });
      show();
    }

    function save(e) {
      e.preventDefault();
      var name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      var data = {
        name: name,
        food: parseFloat(sFood.value),
        vibe: parseFloat(sVibe.value),
        service: parseFloat(sService.value),
        note: noteInput.value.trim(),
        date: dateInput.value || todayStr(),
        loc: locField.hidden ? (state.pendingPlace && state.pendingPlace.address || '') : locInput.value.trim()
      };
      if (state.pendingPlace) {
        data.placeId = state.pendingPlace.placeId || null;
        data.coords = state.pendingPlace.loc || null;
        // remember the cuisine keys so Visited insights can group this entry
        data.cuisines = state.pendingPlace.cuisines || [];
      }
      var wasEdit = !!state.editingId;
      if (wasEdit) {
        visited.update(state.editingId, data);
        announce('Updated ' + name);
      } else {
        visited.add(data);
        announce('Saved ' + name + ' — overall ' + fmtScore(overallOf(data)));
      }
      // celebrate the save: a tiny droplet burst from the Save button
      // (rect captured BEFORE hide() — a hidden sheet measures 0x0).
      // dropletBurst itself no-ops under prefers-reduced-motion.
      var saveBtn = $('rate-save');
      var rr = saveBtn ? saveBtn.getBoundingClientRect() : null;
      hide();
      visited.render();
      haptic(14);
      if (rr && rr.width) dropletBurst(rr.left + rr.width / 2, rr.top + rr.height / 2, Math.min(rr.width, 150));
      toast((wasEdit ? 'Updated ' : 'Saved ') + name + ' · overall ' + fmtScore(overallOf(data)));
    }

    function init() {
      if (!backdrop) return;
      [sFood, sVibe, sService].forEach(function (input) {
        input.addEventListener('input', scheduleSync);
        // the readout used to be a live region, so every step of a drag
        // spoke a number over the slider's own value. One settled figure,
        // once the hand stops, says the same thing without the flood.
        input.addEventListener('input', announceOverallSoon);
      });
      if (overallBlot) {
        overallBlot.addEventListener('animationend', function () {
          overallBlot.classList.remove('is-swell');
          blotSwelling = false;
        });
      }
      form.addEventListener('submit', save);
      $('rate-cancel').addEventListener('click', hide);
      $('sheet-close').addEventListener('click', hide);
      backdrop.addEventListener('click', function (e) { if (e.target === backdrop) hide(); });
      syncAll();
    }

    return { init: init, openForPlace: openForPlace, openBlank: openBlank, openForEdit: openForEdit };
  })();

  /* ================================================================== *
   * VISITED — store + rendering + CRUD
   * ================================================================== */
  var visited = (function () {
    var listEl = $('visited-list');
    var statsEl = $('visited-stats');
    var sortSel = $('visited-sort');
    var tabCount = $('visited-tab-count');
    var filterWrap = $('visited-filter');
    var filterInput = $('visited-filter-input');
    var filterQ = ''; // live quick-filter text (only offered when the log > 5)
    var insightsEl = null; // "Your month in meals" recap (JS-built, above the log)

    function load() {
      /* flag off: the log is not read, seeded or written (storage untouched) */
      if (!VISITED_ON) { state.visited = []; return; }
      var v = store.getVisited();
      if (BETA) {
        // Beta: a new user has rated nothing, so nothing is seeded, and any
        // built-in SAMPLE entries from an older install (e.demo) are filtered
        // out of state, which every count, average, card pill, tab badge,
        // memory strip and cuisine-affinity chip reads. Real entries are
        // never touched. (Storage is only rewritten when the log changes.)
        state.visited = (v || []).filter(function (e) { return e && typeof e === 'object' && !e.demo; });
        return;
      }
      if (v === null) {
        // never written -> seed demo entries (clearly labeled)
        state.visited = demoVisited();
        store.setVisited(state.visited);
      } else {
        state.visited = v;
      }
    }

    function persist() { store.setVisited(state.visited); }

    function uid() { return 'v-' + Date.now() + '-' + Math.floor(Math.random() * 1e4); }

    function realCount() {
      return state.visited.filter(function (e) { return !e.demo; }).length;
    }

    function add(data) {
      // First real save clears demo seeds so they don't clutter the user's log,
      // but never removes anything the user actually entered.
      if (realCount() === 0) {
        state.visited = state.visited.filter(function (e) { return !e.demo; });
      }
      data.id = uid();
      data.demo = false;
      // log-time timestamp (new entries only; older entries without one are
      // treated as "earlier" by the insights recap)
      if (!data.ts) data.ts = Date.now();
      state.visited.unshift(data);
      persist();
    }

    function update(id, data) {
      for (var i = 0; i < state.visited.length; i++) {
        if (state.visited[i].id === id) {
          data.id = id;
          data.demo = false; // editing a demo entry makes it real
          // an edit rebuilds the entry from the sheet, which doesn't carry
          // these — keep the original log timestamp + cuisine keys
          if (state.visited[i].ts && !data.ts) data.ts = state.visited[i].ts;
          if (state.visited[i].cuisines && !data.cuisines) data.cuisines = state.visited[i].cuisines;
          state.visited[i] = data;
          break;
        }
      }
      persist();
    }

    function remove(id) {
      state.visited = state.visited.filter(function (e) { return e.id !== id; });
      persist();
    }

    function sorted() {
      var arr = state.visited.slice();
      if (state.sort === 'overall') {
        arr.sort(function (a, b) { return overallOf(b) - overallOf(a); });
      } else {
        arr.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      }
      return arr;
    }

    function fmtDate(s) {
      if (!s) return '';
      var parts = s.split('-');
      if (parts.length !== 3) return s;
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return months[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[2], 10) + ', ' + parts[0];
    }

    var bar = scoreBar; // shared watercolor bar renderer

    function buildCard(e) {
      var card = el('article', 'card v-card');
      var top = el('div', 'v-card-top');
      var left = el('div');
      left.appendChild(el('h3', 'v-name', e.name));
      if (e.loc) left.appendChild(el('p', 'v-loc', e.loc));
      if (e.demo) left.appendChild(el('span', 'v-demo-tag', 'Sample'));
      top.appendChild(left);

      var ov = el('div', 'v-overall');
      ov.appendChild(el('span', 'big', fmtScore(overallOf(e))));
      ov.appendChild(el('span', 'lbl', 'Overall'));
      top.appendChild(ov);
      card.appendChild(top);

      var bars = el('div', 'v-bars');
      bars.appendChild(bar('Food', e.food, 'food'));
      bars.appendChild(bar('Vibe', e.vibe, 'vibe'));
      bars.appendChild(bar('Service', e.service, 'service'));
      card.appendChild(bars);

      if (e.note) card.appendChild(el('p', 'v-note', e.note));
      card.appendChild(el('p', 'v-date', fmtDate(e.date)));

      var actions = el('div', 'v-actions');
      var editBtn = el('button', 'card-action', 'Edit');
      editBtn.type = 'button';
      editBtn.addEventListener('click', function () { sheet.openForEdit(e); });
      var rerateBtn = el('button', 'card-action', 'Re-rate');
      rerateBtn.type = 'button';
      rerateBtn.addEventListener('click', function () { sheet.openForEdit(e); });
      var delBtn = el('button', 'card-action', 'Delete');
      delBtn.type = 'button';
      delBtn.addEventListener('click', function () {
        if (window.confirm('Delete your rating for "' + e.name + '"?')) {
          remove(e.id);
          render();
          announce('Deleted ' + e.name);
          // the button that had focus was just thrown away with its card
          var addBtn = listEl.querySelector('.empty-primary') || $('add-place');
          if (addBtn) addBtn.focus();
        }
      });
      actions.appendChild(editBtn);
      actions.appendChild(rerateBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);
      return card;
    }

    /* -------------------------------------------------------------- *
     * Insights — "Your month in meals" (display-only recap above the log)
     * Timestamps: `date` ('YYYY-MM-DD', every sheet save has one) is the
     * source of truth; `ts` (added to new entries) is the fallback; entries
     * with neither are "earlier" — counted all-time, absent from the month.
     * -------------------------------------------------------------- */
    var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    var CUISINE_LABELS = {
      italian: 'Italian', japanese: 'Japanese', mexican: 'Mexican', thai: 'Thai',
      indian: 'Indian', chinese: 'Chinese', american: 'American',
      mediterranean: 'Mediterranean', korean: 'Korean', vietnamese: 'Vietnamese',
      pizza: 'Pizza', burgers: 'Burgers', seafood: 'Seafood', cafe: 'Café & bakery',
      bbq: 'BBQ', vegetarian: 'Vegetarian'
    };
    function cuisineLabel(k) { return CUISINE_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1)); }
    function cuisinePal(k) { return CUISINE_ART[k] || ['#a292c4', '#7fa8c9', '#e8dfc9']; }

    /* When did this entry happen? Local Date at noon (immune to DST edges),
       or null for undated legacy entries. */
    function entryDate(e) {
      if (e && e.date) {
        var p = String(e.date).split('-');
        if (p.length === 3) {
          var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 12);
          if (!isNaN(d.getTime())) return d;
        }
      }
      if (e && e.ts) {
        var t = new Date(e.ts);
        if (!isNaN(t.getTime())) return t;
      }
      return null;
    }

    /* Cuisine key for an entry: stored keys first (saved with ratings from a
       Find card), else best-effort name match against the sample list. */
    var demoCuisineByName = null;
    function cuisineKeyOf(e) {
      if (e.cuisines && e.cuisines.length) return e.cuisines[0];
      if (!demoCuisineByName) {
        demoCuisineByName = {};
        DEMO_RESTAURANTS.forEach(function (r) {
          if (r.cuisines && r.cuisines.length) demoCuisineByName[r.name.toLowerCase()] = r.cuisines[0];
        });
      }
      return demoCuisineByName[String(e.name || '').toLowerCase()] || null;
    }

    /* Week bucket (weeks start Monday, local time) for the streak count. */
    function weekIndex(d) {
      var days = Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
      return Math.floor((days + 3) / 7);
    }

    /* All the recap numbers, or null when there's nothing to recap (no
       entries dated this month or last month — incl. the fresh-demo case). */
    function computeInsights() {
      var all = state.visited || [];
      if (!all.length) return null;
      var dated = [];
      all.forEach(function (e) {
        var d = entryDate(e);
        if (d) dated.push({ e: e, d: d });
      });
      var now = new Date();
      var curKey = now.getFullYear() * 12 + now.getMonth();
      function inMonth(key) {
        return dated.filter(function (x) { return x.d.getFullYear() * 12 + x.d.getMonth() === key; });
      }
      var scopeKey = curKey, isLast = false;
      var scope = inMonth(scopeKey);
      if (!scope.length) { scopeKey = curKey - 1; isLast = true; scope = inMonth(scopeKey); }
      if (!scope.length) return null;

      // distinct places + average overall, this month
      var seenNames = {}, placesTried = 0;
      scope.forEach(function (x) {
        var k = String(x.e.name || '').toLowerCase();
        if (!seenNames[k]) { seenNames[k] = true; placesTried++; }
      });
      var avg = scope.reduce(function (s, x) { return s + overallOf(x.e); }, 0) / scope.length;

      // cuisine counts, this month (entries with no cuisine info sit out)
      var counts = {};
      scope.forEach(function (x) {
        var c = cuisineKeyOf(x.e);
        if (c) counts[c] = (counts[c] || 0) + 1;
      });
      var bars = [];
      for (var k in counts) bars.push({ key: k, label: cuisineLabel(k), count: counts[k] });
      bars.sort(function (a, b) { return (b.count - a.count) || a.label.localeCompare(b.label); });
      var top = bars.length ? bars[0] : null;
      bars = bars.slice(0, 4);

      // streak: consecutive weeks with >=1 visit, counting back from this
      // week (a quiet week-in-progress doesn't break it — last week anchors)
      var weeks = {};
      dated.forEach(function (x) { weeks[weekIndex(x.d)] = true; });
      var w = weekIndex(now);
      if (!weeks[w]) w--;
      var streak = 0;
      while (weeks[w]) { streak++; w--; }

      // all time: distinct places, total visits, most-revisited place
      var byName = {}, totalPlaces = 0, fav = null;
      all.forEach(function (e) {
        var k = String(e.name || '').toLowerCase();
        if (!byName[k]) { byName[k] = { name: e.name, count: 0 }; totalPlaces++; }
        byName[k].count++;
      });
      for (var nk in byName) {
        if (byName[nk].count > 1 && (!fav || byName[nk].count > fav.count)) fav = byName[nk];
      }

      return {
        monthLabel: MONTH_NAMES[((scopeKey % 12) + 12) % 12],
        isLast: isLast,
        placesTried: placesTried,
        avg: avg,
        top: top,
        streak: streak,
        bars: bars,
        allTime: { places: totalPlaces, visits: all.length, fav: fav }
      };
    }

    function viStat(num, label) {
      var s = el('div', 'vi-stat');
      s.appendChild(el('span', 'vi-num', num));
      s.appendChild(el('span', 'vi-lbl', label));
      return s;
    }

    function renderInsights() {
      if (!insightsEl) return;
      clear(insightsEl);
      var ins = computeInsights();
      insightsEl.hidden = !ins;
      if (!ins) return;

      var card = el('div', 'card vi-card');

      var head = el('div', 'vi-head');
      head.appendChild(el('h2', 'vi-title', 'Your month in meals'));
      head.appendChild(el('span', 'vi-when', ins.isLast ? ins.monthLabel + ' — last month' : ins.monthLabel));
      card.appendChild(head);

      var stats = el('div', 'vi-stats');
      stats.appendChild(viStat(String(ins.placesTried), ins.placesTried === 1 ? 'place tried' : 'places tried'));
      stats.appendChild(viStat(fmtScore(ins.avg), 'avg overall'));
      stats.appendChild(viStat(String(ins.streak), ins.streak === 1 ? 'week streak' : 'weeks streak'));
      card.appendChild(stats);

      if (ins.top) {
        var pal = cuisinePal(ins.top.key);
        var tc = el('p', 'vi-top');
        var dot = el('span', 'vi-dot');
        dot.setAttribute('aria-hidden', 'true');
        dot.style.background = 'radial-gradient(circle at 32% 30%, ' + pal[1] + ' 0%, ' + pal[0] + ' 72%)';
        tc.appendChild(dot);
        tc.appendChild(el('span', 'vi-top-lbl', 'Top cuisine'));
        tc.appendChild(el('strong', null, ins.top.label));
        card.appendChild(tc);
      }

      if (ins.bars.length) {
        card.appendChild(el('h3', 'vi-sub', 'What you ate'));
        var bwrap = el('div', 'vi-bars');
        var max = ins.bars[0].count;
        ins.bars.forEach(function (b) {
          var row = el('div', 'vi-bar');
          row.appendChild(el('span', 'lbl', b.label));
          var track = el('div', 'track');
          track.setAttribute('aria-hidden', 'true');
          var fill = el('div', 'fill');
          fill.style.width = Math.round((b.count / max) * 100) + '%';
          fill.style.background = 'linear-gradient(90deg, ' + cuisinePal(b.key)[0] + 'b3, ' + cuisinePal(b.key)[0] + ')';
          track.appendChild(fill);
          row.appendChild(track);
          row.appendChild(el('span', 'val', String(b.count)));
          bwrap.appendChild(row);
        });
        card.appendChild(bwrap);
      }

      var at = el('p', 'vi-alltime');
      at.appendChild(document.createTextNode('All time: '));
      at.appendChild(el('strong', null, String(ins.allTime.places)));
      at.appendChild(document.createTextNode(' place' + (ins.allTime.places === 1 ? '' : 's') + ' · '));
      at.appendChild(el('strong', null, String(ins.allTime.visits)));
      at.appendChild(document.createTextNode(' visit' + (ins.allTime.visits === 1 ? '' : 's')));
      if (ins.allTime.fav) {
        at.appendChild(document.createTextNode(' · most returned to '));
        at.appendChild(el('strong', null, ins.allTime.fav.name));
      }
      card.appendChild(at);

      insightsEl.appendChild(card);
    }

    /* quick-filter match: case-insensitive substring on name / note / location */
    function matchesFilter(e, q) {
      return (e.name || '').toLowerCase().indexOf(q) !== -1 ||
             (e.note || '').toLowerCase().indexOf(q) !== -1 ||
             (e.loc || '').toLowerCase().indexOf(q) !== -1;
    }

    function render() {
      if (!listEl) return;
      clear(listEl);

      // tab count + stats
      var n = state.visited.length;
      if (tabCount) tabCount.textContent = n ? '(' + n + ')' : '';
      // with nothing logged the empty state carries the one action; the
      // sort + add row would only repeat it
      var headEl = statsEl && statsEl.parentNode;
      if (headEl) headEl.hidden = n === 0;
      syncDataUi();

      // passive recap above the log (describes the whole log, never filtered)
      renderInsights();

      // quick filter: only worth offering once the log outgrows a glance
      var canFilter = n > 5;
      if (filterWrap) filterWrap.hidden = !canFilter;
      if (!canFilter && filterQ) {
        filterQ = '';
        if (filterInput) filterInput.value = '';
      }

      var arr = sorted();
      var q = canFilter ? filterQ.trim().toLowerCase() : '';
      if (q) arr = arr.filter(function (e) { return matchesFilter(e, q); });

      if (n && !arr.length) {
        // entries exist, the filter just matched none — say so plainly
        // (stats stay up: they describe the whole log, not the filtered view)
        var avgAll = state.visited.reduce(function (s, e) { return s + overallOf(e); }, 0) / n;
        renderStats(n, avgAll);
        listEl.appendChild(el('p', 'visited-nomatch', 'No matches for “' + filterQ.trim() + '”'));
        return;
      }

      if (!arr.length) {
        statsEl.textContent = '';
        // painterly empty state — a CSS-drawn place setting waiting for its
        // first meal (steam wisps pause under prefers-reduced-motion).
        // One clear primary action (add a place), one gentle way to go and
        // find somewhere, and a quiet door for people bringing a backup.
        var empty = el('div', 'empty empty--visited');
        var art = el('div', 'empty-table');
        art.setAttribute('aria-hidden', 'true');
        art.appendChild(el('span', 'empty-steam s1'));
        art.appendChild(el('span', 'empty-steam s2'));
        art.appendChild(el('span', 'empty-steam s3'));
        art.appendChild(el('span', 'empty-plate'));
        art.appendChild(el('span', 'empty-fork'));
        art.appendChild(el('span', 'empty-spoon'));
        empty.appendChild(art);
        empty.appendChild(el('p', 'empty-title', 'Your table is set'));
        empty.appendChild(el('p', 'empty-sub', 'Nothing here yet. After a meal, rate it on food, vibe and service and it settles in here, just for you.'));
        var addBtn = el('button', 'add-place-btn empty-primary', '+ Add a place');
        addBtn.type = 'button';
        addBtn.addEventListener('click', function () { sheet.openBlank(); });
        empty.appendChild(addBtn);
        var findBtn = el('button', 'empty-secondary', 'Or find somewhere to eat');
        findBtn.type = 'button';
        findBtn.addEventListener('click', function () { tabs.activate('find'); });
        empty.appendChild(findBtn);
        var restoreBtn = el('button', 'empty-restore', 'Have a backup file? Import it');
        restoreBtn.type = 'button';
        restoreBtn.addEventListener('click', function () { pickImport(); });
        empty.appendChild(restoreBtn);
        listEl.appendChild(empty);
        return;
      }

      var avg = state.visited.reduce(function (s, e) { return s + overallOf(e); }, 0) / n;
      renderStats(n, avg);

      arr.forEach(function (e) { listEl.appendChild(buildCard(e)); });
    }


    /* -------------------------------------------------------------- *
     * Backup — export / import (Visited lives only in this browser)
     * Envelope: { app:'tableau', version:1, exportedAt:ISO, visited:[...] }
     * Export = real entries only (never demo), whitelisted fields only:
     * no API key, no location, no place ids/coordinates. Import validates
     * strictly, sanitises every field, merges (never overwrites) and never
     * throws. Every string is written with textContent, never innerHTML.
     * -------------------------------------------------------------- */
    var KEY_BACKUP = 'eats-backup';     // {exportedAt, nudged}
    var BK_APP = 'tableau', BK_VERSION = 1;
    var LIM = { name: 120, loc: 160, note: 600 };   // same caps as the add-place form
    var MAX_FILE_BYTES = 1024 * 1024;   // 1 MB
    var MAX_IMPORT = 2000;              // entries in one file
    var MAX_TOTAL = 3000;               // entries in the log after merge
    var dataMsgEl = $('visited-data-msg');
    var exportBtn = $('visited-export');
    var importBtn = $('visited-import');
    var importFile = $('visited-import-file');
    var nudgeEl = $('visited-nudge');
    var nudgeLive = false;

    function backupMeta() {
      try {
        var o = JSON.parse(localStorage.getItem(KEY_BACKUP) || 'null');
        return (o && typeof o === 'object') ? o : {};
      } catch (e) { return {}; }
    }
    function setBackupMeta(patch) {
      var o = backupMeta();
      for (var k in patch) o[k] = patch[k];
      try { localStorage.setItem(KEY_BACKUP, JSON.stringify(o)); } catch (e) {}
    }
    function say(msg, isErr) {
      if (!dataMsgEl) return;
      dataMsgEl.classList.toggle('is-err', !!isErr);
      dataMsgEl.textContent = '';
      // clear-then-set on the next frame so a repeated message is re-announced
      window.requestAnimationFrame(function () { dataMsgEl.textContent = msg; });
    }
    function realEntries() { return state.visited.filter(function (e) { return !e.demo; }); }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function localDay() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

    function exportEntry(e) {
      var o = {
        id: String(e.id || ''), name: String(e.name || ''), loc: String(e.loc || ''),
        food: Number(e.food), vibe: Number(e.vibe), service: Number(e.service),
        note: String(e.note || ''), date: String(e.date || '')
      };
      if (isFinite(e.ts)) o.ts = Number(e.ts);
      if (Array.isArray(e.cuisines)) o.cuisines = e.cuisines.filter(function (c) { return typeof c === 'string'; }).slice(0, 6);
      return o;
    }
    function buildExport() {
      return { app: BK_APP, version: BK_VERSION, exportedAt: new Date().toISOString(), visited: realEntries().map(exportEntry) };
    }

    function exportData() {
      var real = realEntries();
      if (!real.length) { say('Nothing to export yet. Add a place first.', true); return; }
      var name = 'tableau-visited-' + localDay() + '.json';
      var json = JSON.stringify(buildExport(), null, 2);
      var blob, file = null;
      try { blob = new Blob([json], { type: 'application/json' }); } catch (e) { say('Could not prepare the backup on this browser.', true); return; }
      try { file = new File([blob], name, { type: 'application/json' }); } catch (e) { file = null; }
      var a = document.createElement('a');
      var done = function () {
        setBackupMeta({ exportedAt: new Date().toISOString() });
        say('Backup saved: ' + real.length + ' place' + (real.length === 1 ? '' : 's') + ' in ' + name + '.');
        nudgeLive = false;
        syncDataUi();
      };
      try {
        if ('download' in a && window.URL && URL.createObjectURL) {
          var url = URL.createObjectURL(blob);
          a.href = url; a.download = name; a.rel = 'noopener';
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          window.setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {} }, 4000);
          done();
        } else if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
          navigator.share({ files: [file], title: 'Tableau backup' }).then(done, function (err) {
            if (!err || err.name !== 'AbortError') say('Could not share the backup file.', true);
          });
        } else {
          say('This browser cannot save files from here. Try another browser to export.', true);
        }
      } catch (e) { say('Could not save the backup file.', true); }
    }

    /* ---- sanitising (every limit the add-place form uses) ---- */
    function cleanText(v, max, oneLine) {
      if (typeof v !== 'string') return '';
      if (oneLine) v = v.replace(/\s+/g, ' ');
      // drop control characters, collapse whitespace runs, cap the length
      return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
    }
    function cleanScore(v) {
      if (typeof v !== 'number' || !isFinite(v)) return null;
      return Math.max(0, Math.min(100, Math.round(v)));
    }
    function cleanDate(v) {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
      var p = v.split('-'), y = +p[0], m = +p[1], d = +p[2];
      if (y < 1970 || y > 2100) return '';
      var t = new Date(y, m - 1, d);
      return (t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d) ? v : '';
    }
    function cleanEntry(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      var name = cleanText(raw.name, LIM.name, true);
      var food = cleanScore(raw.food), vibe = cleanScore(raw.vibe), service = cleanScore(raw.service);
      if (!name || food === null || vibe === null || service === null) return null;
      var o = {
        name: name, loc: cleanText(raw.loc, LIM.loc, true),
        food: food, vibe: vibe, service: service,
        note: cleanText(raw.note, LIM.note), date: cleanDate(raw.date), demo: false
      };
      if (typeof raw.ts === 'number' && isFinite(raw.ts) && raw.ts > 0 && raw.ts < Date.now() + 864e5) o.ts = Math.floor(raw.ts);
      if (Array.isArray(raw.cuisines)) {
        var cu = raw.cuisines.filter(function (c) { return typeof c === 'string' && /^[a-z]{2,20}$/.test(c); }).slice(0, 6);
        if (cu.length) o.cuisines = cu;
      }
      if (typeof raw.id === 'string' && /^v-\d{6,15}-\d{1,5}$/.test(raw.id)) o.id = raw.id;
      return o;
    }
    function dedupeKey(e) {
      return String(e.name || '').toLowerCase() + '|' + (e.date || '') + '|' + Math.round(e.food) + '/' + Math.round(e.vibe) + '/' + Math.round(e.service);
    }

    /* Pure: text -> {ok, error} | {ok, entries, bad}. Never throws. */
    function parseBackup(text) {
      var env;
      try { env = JSON.parse(text); } catch (e) { return { ok: false, error: 'That file is not valid JSON, so it is not a Tableau backup.' }; }
      if (!env || typeof env !== 'object' || Array.isArray(env)) return { ok: false, error: 'That file is not a Tableau backup.' };
      if (env.app !== BK_APP) return { ok: false, error: 'That file is not a Tableau backup.' };
      if (env.version !== BK_VERSION) return { ok: false, error: 'That backup is from a version of Tableau this page cannot read.' };
      if (!Array.isArray(env.visited)) return { ok: false, error: 'That backup has no list of places in it.' };
      if (env.visited.length > MAX_IMPORT) return { ok: false, error: 'That backup is too big (over ' + MAX_IMPORT + ' places), so it was not imported.' };
      var entries = [], bad = 0;
      env.visited.forEach(function (raw) {
        var c = cleanEntry(raw);
        if (c) entries.push(c); else bad++;
      });
      return { ok: true, entries: entries, bad: bad };
    }

    function mergeEntries(entries) {
      var seen = {};
      state.visited.forEach(function (e) { seen[dedupeKey(e)] = true; });
      var usedIds = {};
      state.visited.forEach(function (e) { usedIds[e.id] = true; });
      var added = 0, dup = 0, capped = 0, fresh = [];
      entries.forEach(function (e) {
        var k = dedupeKey(e);
        if (seen[k]) { dup++; return; }
        if (state.visited.length + fresh.length >= MAX_TOTAL) { capped++; return; }
        seen[k] = true;
        if (!e.id || usedIds[e.id]) e.id = uid();
        usedIds[e.id] = true;
        fresh.push(e);
        added++;
      });
      if (added) {
        // same rule as add(): the first real entries replace any sample seeds
        if (realCount() === 0) state.visited = state.visited.filter(function (e) { return !e.demo; });
        state.visited = state.visited.concat(fresh);
        persist();
      }
      return { added: added, dup: dup, capped: capped };
    }

    function importText(text) {
      var res = parseBackup(text);
      if (!res.ok) { say(res.error, true); return res; }
      var m = mergeEntries(res.entries);
      if (m.added) { setBackupMeta({ imported: true }); nudgeLive = false; }   // they clearly have a backup
      var parts = [];
      if (m.dup) parts.push(m.dup + ' already here');
      if (res.bad) parts.push(res.bad + ' could not be read');
      if (m.capped) parts.push(m.capped + ' over the size limit');
      if (!m.added && !parts.length) say('That backup had no places in it.', false);
      else if (!m.added) say('Nothing new to import (' + parts.join(', ') + ').', false);
      else say('Imported ' + m.added + ' place' + (m.added === 1 ? '' : 's') + (parts.length ? ' (skipped: ' + parts.join(', ') + ')' : '') + '.', false);
      render();
      return { ok: true, added: m.added, dup: m.dup, bad: res.bad, capped: m.capped };
    }

    function importFromFile(file) {
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) { say('That file is too big to be a Tableau backup (over 1 MB), so it was not imported.', true); return; }
      try {
        var fr = new FileReader();
        fr.onload = function () { try { importText(String(fr.result || '')); } catch (e) { say('Could not import that file.', true); } };
        fr.onerror = function () { say('Could not read that file.', true); };
        fr.readAsText(file);
      } catch (e) { say('Could not read that file.', true); }
    }
    function pickImport() {
      if (!importFile) return;
      try { importFile.value = ''; } catch (e) {}
      importFile.click();
    }

    /* export button state + the one-time reminder */
    function syncDataUi() {
      var real = realCount();
      if (exportBtn) exportBtn.disabled = real === 0;
      if (!nudgeEl) return;
      var meta = backupMeta();
      var want = real >= 5 && !meta.exportedAt && !meta.imported && !meta.nudged && !meta.nudgeShown;
      if (want && !nudgeLive) {          // first time it is ever shown: remember, so it never returns on its own
        nudgeLive = true;
        setBackupMeta({ nudgeShown: true });
      }
      var visible = nudgeLive && !meta.exportedAt && !meta.imported && !meta.nudged && real >= 5;
      nudgeEl.hidden = !visible;
      var t = $('visited-nudge-text');
      if (visible && t) t.textContent = 'You have ' + real + ' places logged, and they live only in this browser. A quick backup keeps them safe if it is ever cleared.';
    }
    function dismissNudge() {
      setBackupMeta({ nudged: true });
      nudgeLive = false;
      if (nudgeEl) nudgeEl.hidden = true;
      announce('Reminder dismissed');
    }

    function renderStats(n, avg) {
      if (!statsEl) return;
      statsEl.innerHTML = '';
      statsEl.appendChild(document.createTextNode('You’ve logged '));
      statsEl.appendChild(el('strong', null, String(n)));
      statsEl.appendChild(document.createTextNode(' place' + (n === 1 ? '' : 's') + ' · average overall '));
      statsEl.appendChild(el('strong', null, fmtScore(avg)));
    }

    function init() {
      load();
      // insights host sits between the head row and the quick filter/log
      if (listEl && listEl.parentNode) {
        insightsEl = el('section', 'v-insights');
        insightsEl.setAttribute('aria-label', 'Your meal insights');
        insightsEl.hidden = true;
        listEl.parentNode.insertBefore(insightsEl, filterWrap || listEl);
      }
      if (sortSel) sortSel.addEventListener('change', function () { state.sort = sortSel.value; render(); });
      if (filterInput) {
        filterInput.addEventListener('input', function () {
          filterQ = filterInput.value || '';
          render();
        });
      }
      var addBtn = $('add-place');
      if (addBtn) addBtn.addEventListener('click', function () { sheet.openBlank(); });
      if (exportBtn) exportBtn.addEventListener('click', exportData);
      if (importBtn) importBtn.addEventListener('click', pickImport);
      if (importFile) importFile.addEventListener('change', function () {
        importFromFile(importFile.files && importFile.files[0]);
        // let the same file be picked again later (change fires only on a new value)
        window.setTimeout(function () { try { importFile.value = ''; } catch (e) {} }, 0);
      });
      var nx = $('visited-nudge-export'), nd = $('visited-nudge-dismiss');
      if (nx) nx.addEventListener('click', exportData);
      if (nd) nd.addEventListener('click', dismissNudge);
      // initialise tab count
      var n = state.visited.length;
      if (tabCount) tabCount.textContent = n ? '(' + n + ')' : '';
    }

    return { init: init, render: render, add: add, update: update, remove: remove,
             exportData: exportData, importText: importText, parseBackup: parseBackup, buildExport: buildExport };
  })();

  /* ================================================================== *
   * MOCK SOCIAL API
   * ------------------------------------------------------------------
   * Replace these resolvers with real backend (Firebase/Supabase) calls.
   * The UI already consumes promises + loading/error states, so dropping
   * in real network requests is a contained change: keep the same return
   * shapes (documented below) and the Friends/Popular tabs keep working.
   *
   *   social.getFriendsFeed({ sort }) ->
   *     Promise<Array<{
   *       id, friend:{name,initial,color}, place, loc,
   *       food, vibe, service, note, date (ISO), demo:true
   *     }>>
   *
   *   social.getPopular({ range }) ->          // range: 'today'|'month'|'year'
   *     Promise<Array<{
   *       rank, place, loc, cuisine, score (avg overall, 0-100),
   *       reviews (this period), trend: 'up'|'down'|'flat', demo:true
   *     }>>
   *
   * All entries are clearly flagged demo:true and labelled "Sample" in UI.
   * ================================================================== */
  var social = (function () {
    var FAKE_LATENCY = prefersReducedMotion ? 120 : 360; // ms — mimic a network

    // Friend palette tokens (watercolor accents for avatar chips).
    var FRIENDS = [
      { name: 'Maya Okafor', initial: 'M', color: 'rose' },
      { name: 'Devin Park', initial: 'D', color: 'pond' },
      { name: 'Priya Raman', initial: 'P', color: 'wisteria' },
      { name: 'Leo Castellanos', initial: 'L', color: 'sage' },
      { name: 'Hana Sato', initial: 'H', color: 'gold' },
      { name: 'Theo Brandt', initial: 'T', color: 'pond' }
    ];

    function friend(i) { return FRIENDS[i]; }
    function daysAgo(n) {
      var d = new Date();
      d.setDate(d.getDate() - n);
      return d.toISOString();
    }
    function hoursAgo(n) {
      var d = new Date();
      d.setHours(d.getHours() - n);
      return d.toISOString();
    }

    // --- DEMO FRIENDS FEED (sample data) ---
    var FRIENDS_FEED = [
      { id: 'f-1', friend: friend(0), place: 'Tonkotsu Lane', loc: 'Embarcadero, SF', food: 95, vibe: 80, service: 85, note: 'Best ramen south of Japantown. The chashu melts.', date: hoursAgo(5), demo: true },
      { id: 'f-2', friend: friend(1), place: 'Little Wren Bakery', loc: 'Embarcadero, SF', food: 90, vibe: 75, service: 80, note: 'Grabbed the morning bun before work — still warm.', date: daysAgo(1), demo: true },
      { id: 'f-3', friend: friend(2), place: 'Saffron House', loc: 'FiDi, SF', food: 85, vibe: 70, service: 90, note: 'Butter chicken was rich; lovely staff.', date: daysAgo(2), demo: true },
      { id: 'f-4', friend: friend(3), place: 'Casa Poblana', loc: 'Mission, SF', food: 90, vibe: 85, service: 75, note: 'Al pastor tacos for days. Bring cash.', date: daysAgo(3), demo: true },
      { id: 'f-5', friend: friend(4), place: 'Pier 9 Oyster Co.', loc: 'Pier 9, SF', food: 80, vibe: 95, service: 65, note: 'Sunset on the patio is unbeatable. Service lagged.', date: daysAgo(4), demo: true },
      { id: 'f-6', friend: friend(5), place: 'Verde Trattoria', loc: 'Waterfront, SF', food: 85, vibe: 80, service: 80, note: 'Cacio e pepe done right. Cozy little room.', date: daysAgo(6), demo: true },
      { id: 'f-7', friend: friend(0), place: 'Marigold & Sage', loc: 'Embarcadero, SF', food: 90, vibe: 85, service: 90, note: 'Farm-to-table tasting menu was a treat.', date: daysAgo(8), demo: true },
      { id: 'f-8', friend: friend(2), place: 'Foggy Bell Coffee', loc: 'Embarcadero, SF', food: 75, vibe: 80, service: 85, note: 'Flat white + a window seat. My new spot.', date: daysAgo(11), demo: true }
    ];

    // --- DEMO POPULAR LEADERBOARDS (distinct per range) ---
    var POPULAR = {
      today: [
        { rank: 1, place: 'Tonkotsu Lane', loc: 'Embarcadero, SF', cuisine: 'Ramen · Japanese', score: 91, reviews: 48, trend: 'up' },
        { rank: 2, place: 'Little Wren Bakery', loc: 'Embarcadero, SF', cuisine: 'Bakery · Café', score: 89, reviews: 41, trend: 'up' },
        { rank: 3, place: 'Casa Poblana', loc: 'Mission, SF', cuisine: 'Mexican · Taquería', score: 86, reviews: 33, trend: 'flat' },
        { rank: 4, place: 'Foggy Bell Coffee', loc: 'Embarcadero, SF', cuisine: 'Coffee · Light bites', score: 84, reviews: 27, trend: 'up' },
        { rank: 5, place: 'Saffron House', loc: 'FiDi, SF', cuisine: 'Indian · Curry house', score: 82, reviews: 22, trend: 'down' },
        { rank: 6, place: 'Verde Trattoria', loc: 'Waterfront, SF', cuisine: 'Italian · Pasta', score: 81, reviews: 19, trend: 'flat' }
      ],
      month: [
        { rank: 1, place: 'Little Wren Bakery', loc: 'Embarcadero, SF', cuisine: 'Bakery · Café', score: 90, reviews: 612, trend: 'up' },
        { rank: 2, place: 'Casa Poblana', loc: 'Mission, SF', cuisine: 'Mexican · Taquería', score: 88, reviews: 540, trend: 'up' },
        { rank: 3, place: 'Tonkotsu Lane', loc: 'Embarcadero, SF', cuisine: 'Ramen · Japanese', score: 87, reviews: 521, trend: 'down' },
        { rank: 4, place: 'Verde Trattoria', loc: 'Waterfront, SF', cuisine: 'Italian · Pasta', score: 85, reviews: 388, trend: 'up' },
        { rank: 5, place: 'Marigold & Sage', loc: 'Embarcadero, SF', cuisine: 'Californian · Farm-to-table', score: 84, reviews: 351, trend: 'flat' },
        { rank: 6, place: 'Pier 9 Oyster Co.', loc: 'Pier 9, SF', cuisine: 'Seafood · Raw bar', score: 80, reviews: 290, trend: 'down' }
      ],
      year: [
        { rank: 1, place: 'Casa Poblana', loc: 'Mission, SF', cuisine: 'Mexican · Taquería', score: 89, reviews: 7240, trend: 'up' },
        { rank: 2, place: 'Verde Trattoria', loc: 'Waterfront, SF', cuisine: 'Italian · Pasta', score: 87, reviews: 6810, trend: 'up' },
        { rank: 3, place: 'Little Wren Bakery', loc: 'Embarcadero, SF', cuisine: 'Bakery · Café', score: 86, reviews: 6502, trend: 'flat' },
        { rank: 4, place: 'Saffron House', loc: 'FiDi, SF', cuisine: 'Indian · Curry house', score: 85, reviews: 5980, trend: 'up' },
        { rank: 5, place: 'Tonkotsu Lane', loc: 'Embarcadero, SF', cuisine: 'Ramen · Japanese', score: 84, reviews: 5640, trend: 'down' },
        { rank: 6, place: 'Olive & Thyme', loc: 'Embarcadero, SF', cuisine: 'Mediterranean', score: 81, reviews: 4120, trend: 'flat' }
      ]
    };

    // Resolve a deep copy after a small artificial delay (mimics async backend).
    function resolveLater(data) {
      return new Promise(function (resolve) {
        window.setTimeout(function () {
          resolve(JSON.parse(JSON.stringify(data)));
        }, FAKE_LATENCY);
      });
    }

    function getFriendsFeed(opts) {
      var sort = (opts && opts.sort) || 'recent';
      return resolveLater(FRIENDS_FEED).then(function (list) {
        if (sort === 'overall') {
          list.sort(function (a, b) { return overallOf(b) - overallOf(a); });
        } else {
          list.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
        }
        return list;
      });
    }

    function getPopular(opts) {
      var range = (opts && opts.range) || 'today';
      var data = POPULAR[range] || POPULAR.today;
      return resolveLater(data);
    }

    function listFriends() { return FRIENDS.slice(); }

    /* Synchronous read of the feed for ONE place (name match, like
       myRatingFor). The match-reason chips are built inside a card render
       and cannot await the promise API; this reads the same entries
       getFriendsFeed() serves, so there is no second copy of the data.
       Returns [] when none of your friends has rated the place. */
    function ratingsFor(place) {
      if (!place) return [];
      var n = String(place).toLowerCase();
      return FRIENDS_FEED.filter(function (e) {
        return String(e.place || '').toLowerCase() === n;
      });
    }

    return { getFriendsFeed: getFriendsFeed, getPopular: getPopular, listFriends: listFriends, ratingsFor: ratingsFor };
  })();

  /* ================================================================== *
   * FRIENDS — feed of friends' ratings (consumes social.getFriendsFeed)
   * ================================================================== */
  var friends = (function () {
    var listEl = $('friends-list');
    var statsEl = $('friends-stats');
    var sortSel = $('friends-sort');
    var chipsEl = $('friend-chips');
    var ctaEl = null; // "share your shortlist" nudge, JS-built below the list
    var state2 = { sort: 'recent', filter: 'all', token: 0 };
    var hearts = {}; // session-local demo likes, keyed by entry id

    /* ---- taste match: your Visited log vs one friend's rated places ----
       For every place you have BOTH rated (matched by name via myRatingFor),
       closeness = 100 - |your overall - theirs|, floored at 0. The average
       closeness is then damped by n/(n+2) so one lucky overlap can't read
       as a near-perfect match (1 shared spot caps at 33%, 2 at 50%, ...).
       Works identically on the demo feed and any future backend feed with
       the same entry shape. Returns null when there is no overlap. */
    function tasteMatch(entries) {
      var seen = {};
      var shared = [];
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var key = String(e.place || '').toLowerCase();
        if (!key || seen[key]) continue; // one vote per place per friend
        seen[key] = true;
        var mine = myRatingFor(e.place);
        if (!mine) continue;
        shared.push({ place: e.place, mine: overallOf(mine), theirs: overallOf(e) });
      }
      if (!shared.length) return null;
      var sum = 0;
      for (var j = 0; j < shared.length; j++) {
        sum += Math.max(0, 100 - Math.abs(shared[j].mine - shared[j].theirs));
      }
      var pct = Math.round((sum / shared.length) * (shared.length / (shared.length + 2)));
      return { pct: pct, shared: shared };
    }

    /* Group the (unfiltered) feed by friend name -> tasteMatch per friend. */
    function matchByFriend(list) {
      var groups = {};
      list.forEach(function (e) {
        var n = e.friend && e.friend.name;
        if (!n) return;
        (groups[n] = groups[n] || []).push(e);
      });
      var out = {};
      for (var name in groups) out[name] = tasteMatch(groups[name]);
      return out;
    }

    /* One-line match caption: "72% taste match · 3 shared spots", or a
       quiet "no shared spots yet" when your logs don't overlap. */
    function matchBadge(m) {
      if (!m) return el('span', 'friend-match friend-match--none', 'no shared spots yet');
      var b = el('span', 'friend-match');
      b.appendChild(el('strong', 'friend-match-pct', m.pct + '% taste match'));
      b.appendChild(document.createTextNode(' · ' + m.shared.length + ' shared spot' + (m.shared.length === 1 ? '' : 's')));
      return b;
    }

    /* Small watercolor ring for the friend detail header — a soft track
       with a pigment arc swept to the match percentage. Decorative
       (aria-hidden): the matchBadge text alongside carries the meaning. */
    function matchRing(pct, color) {
      var R = 21, C = 2 * Math.PI * R;
      var svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 52 52');
      svg.setAttribute('class', 'match-ring match-ring--' + (color || 'pond'));
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      var track = document.createElementNS(SVG_NS, 'circle');
      track.setAttribute('cx', '26'); track.setAttribute('cy', '26'); track.setAttribute('r', String(R));
      track.setAttribute('class', 'match-ring-track');
      svg.appendChild(track);
      var arc = document.createElementNS(SVG_NS, 'circle');
      arc.setAttribute('cx', '26'); arc.setAttribute('cy', '26'); arc.setAttribute('r', String(R));
      arc.setAttribute('class', 'match-ring-arc');
      arc.setAttribute('stroke-dasharray', (C * Math.max(0, Math.min(100, pct)) / 100).toFixed(2) + ' ' + C.toFixed(2));
      arc.setAttribute('transform', 'rotate(-90 26 26)');
      svg.appendChild(arc);
      var num = document.createElementNS(SVG_NS, 'text');
      num.setAttribute('x', '26'); num.setAttribute('y', '31');
      num.setAttribute('text-anchor', 'middle');
      num.setAttribute('class', 'match-ring-num');
      num.textContent = pct + '%';
      svg.appendChild(num);
      return svg;
    }

    /* Detail header card, shown when the list is filtered to one friend:
       big avatar + name + match caption + watercolor ring, and — when you
       both scored places >= 80 — a "You both loved" strip of chips. */
    function buildDetailHead(f, m) {
      var card = el('article', 'card friend-detail');
      var head = el('div', 'friend-detail-head');
      head.appendChild(avatar(f));
      var who = el('div', 'friend-who');
      who.appendChild(el('span', 'friend-detail-name', f.name));
      who.appendChild(matchBadge(m));
      head.appendChild(who);
      if (m) head.appendChild(matchRing(m.pct, f.color));
      card.appendChild(head);

      if (m) {
        var loved = m.shared.filter(function (s) { return s.mine >= 80 && s.theirs >= 80; });
        if (loved.length) {
          var strip = el('div', 'both-loved');
          strip.appendChild(el('p', 'both-loved-title', 'You both loved'));
          var row = el('div', 'both-loved-row');
          loved.forEach(function (s) {
            var chip = el('span', 'loved-chip');
            chip.appendChild(el('span', 'loved-place', s.place));
            chip.appendChild(el('span', 'loved-scores', 'you ' + fmtScore(s.mine) + ' · them ' + fmtScore(s.theirs)));
            row.appendChild(chip);
          });
          strip.appendChild(row);
          card.appendChild(strip);
        }
      }
      return card;
    }

    /* Quiet nudge beneath the list: share the shortlist if one exists,
       otherwise hop to Find to start one. Hidden entirely when there's
       nothing to share AND nothing logged — never nag an empty app. */
    function renderCta() {
      if (!ctaEl) return;
      clear(ctaEl);
      var slN = deck.shortlistCount();
      var hasVisited = (state.visited || []).length > 0;
      if (!slN && !hasVisited) { ctaEl.hidden = true; return; }
      ctaEl.hidden = false;
      ctaEl.appendChild(el('p', 'friends-cta-line', 'Eaten somewhere great?'));
      var b = el('button', 'btn-ghost friends-cta-btn',
        slN ? 'Share your shortlist (' + slN + ')' : 'Share your shortlist');
      b.type = 'button';
      b.addEventListener('click', function () {
        if (deck.shortlistCount()) {
          deck.shareShortlist();
        } else {
          tabs.activate('find');
          toast('Swipe a few places to build tonight’s shortlist');
          announce('Opened Find — swipe a few places to build a shortlist to share.');
        }
      });
      ctaEl.appendChild(b);
    }

    function buildChips() {
      if (!chipsEl) return;
      clear(chipsEl);
      var mkChip = function (label, value, color) {
        var b = el('button', 'friend-chip' + (state2.filter === value ? ' is-active' : ''), label);
        b.type = 'button';
        b.setAttribute('aria-pressed', state2.filter === value ? 'true' : 'false');
        if (color) b.classList.add('friend-chip--' + color);
        b.addEventListener('click', function () { state2.filter = value; buildChips(); render(); });
        return b;
      };
      chipsEl.appendChild(mkChip('All friends', 'all', null));
      social.listFriends().forEach(function (f) {
        chipsEl.appendChild(mkChip(f.name.split(' ')[0], f.name, f.color));
      });
    }

    function avatar(f) {
      var a = el('span', 'friend-avatar friend-avatar--' + (f.color || 'pond'), f.initial);
      a.setAttribute('aria-hidden', 'true');
      return a;
    }

    function buildEntry(e, match) {
      var card = el('article', 'card friend-card');

      var head = el('div', 'friend-head');
      head.appendChild(avatar(e.friend));
      var who = el('div', 'friend-who');
      who.appendChild(el('span', 'friend-name', e.friend.name));
      var sub = el('span', 'friend-sub');
      sub.appendChild(document.createTextNode('rated '));
      sub.appendChild(el('strong', 'friend-place', e.place));
      who.appendChild(sub);
      if (e.loc) who.appendChild(el('span', 'friend-loc', e.loc));
      who.appendChild(matchBadge(match));
      head.appendChild(who);

      var ov = el('div', 'v-overall');
      ov.appendChild(el('span', 'big', fmtScore(overallOf(e))));
      ov.appendChild(el('span', 'lbl', 'Overall'));
      head.appendChild(ov);
      card.appendChild(head);

      var bars = el('div', 'v-bars');
      bars.appendChild(scoreBar('Food', e.food, 'food'));
      bars.appendChild(scoreBar('Vibe', e.vibe, 'vibe'));
      bars.appendChild(scoreBar('Service', e.service, 'service'));
      card.appendChild(bars);

      if (e.note) card.appendChild(el('p', 'v-note', '“' + e.note + '”'));

      var foot = el('div', 'friend-foot');
      foot.appendChild(el('span', 'v-date', relTime(e.date)));

      // session-local demo hearts (no persistence — this tab only)
      var liked = !!hearts[e.id];
      var baseN = (hashStr(e.id) % 9) + 1;
      var heart = el('button', 'friend-heart' + (liked ? ' is-liked' : ''));
      heart.type = 'button';
      heart.setAttribute('aria-pressed', liked ? 'true' : 'false');
      heart.setAttribute('aria-label', (liked ? 'Unlike ' : 'Like ') + e.friend.name + "'s rating");
      heart.innerHTML = '<span class="friend-heart-glyph" aria-hidden="true">' + (liked ? '♥' : '♡') + '</span> ' +
        '<span class="friend-heart-count">' + (baseN + (liked ? 1 : 0)) + '</span>';
      heart.addEventListener('click', function () {
        hearts[e.id] = !hearts[e.id];
        var on = hearts[e.id];
        heart.classList.toggle('is-liked', on);
        heart.setAttribute('aria-pressed', on ? 'true' : 'false');
        heart.setAttribute('aria-label', (on ? 'Unlike ' : 'Like ') + e.friend.name + "'s rating");
        heart.querySelector('.friend-heart-glyph').textContent = on ? '♥' : '♡';
        heart.querySelector('.friend-heart-count').textContent = String(baseN + (on ? 1 : 0));
        haptic(8);
        announce((on ? 'Liked ' : 'Unliked ') + e.friend.name + "'s rating");
      });
      foot.appendChild(heart);

      foot.appendChild(el('span', 'v-demo-tag', 'Sample'));
      card.appendChild(foot);
      return card;
    }

    function showLoading() {
      clear(listEl);
      var sk = el('div', 'social-loading');
      sk.appendChild(el('span', 'social-spinner', ''));
      sk.appendChild(el('span', null, 'Loading your friends’ feed…'));
      sk.setAttribute('role', 'status');
      listEl.appendChild(sk);
    }
    function showError() {
      clear(listEl);
      var empty = el('div', 'empty');
      empty.appendChild(el('div', 'empty-glyph', '⚠'));
      empty.appendChild(el('p', 'empty-title', 'Couldn’t load the feed'));
      empty.appendChild(el('p', 'empty-sub', 'Try switching tabs and back.'));
      listEl.appendChild(empty);
      announce('Couldn’t load your friends’ feed. Try switching tabs and back.');
    }

    function render() {
      if (!listEl) return;
      renderCta();
      var token = ++state2.token;
      showLoading();
      social.getFriendsFeed({ sort: state2.sort }).then(function (list) {
        if (token !== state2.token) return; // stale response
        var matches = matchByFriend(list); // from the FULL feed, pre-filter
        if (state2.filter !== 'all') {
          list = list.filter(function (e) { return e.friend.name === state2.filter; });
        }
        clear(listEl);
        if (statsEl) {
          var nFriends = social.listFriends().length;
          statsEl.textContent = list.length + ' rating' + (list.length === 1 ? '' : 's') + ' from ' + nFriends + ' friends';
        }
        // Filtered to one friend -> a detail header (match ring + shared loves)
        if (state2.filter !== 'all') {
          var fObj = null;
          social.listFriends().forEach(function (f) { if (f.name === state2.filter) fObj = f; });
          if (fObj) listEl.appendChild(buildDetailHead(fObj, matches[fObj.name] || null));
        }
        if (!list.length) {
          var empty = el('div', 'empty');
          empty.appendChild(el('div', 'empty-glyph', '👀'));
          empty.appendChild(el('p', 'empty-title', 'No ratings from them yet'));
          empty.appendChild(el('p', 'empty-sub', 'Pick “All friends” to see everyone.'));
          listEl.appendChild(empty);
          return;
        }
        list.forEach(function (e, i) {
          var entry = buildEntry(e, matches[e.friend.name] || null);
          enterStagger(entry, i);
          listEl.appendChild(entry);
        });
        announce(list.length + ' friend ratings shown');
      }).catch(function () {
        if (token === state2.token) showError();
      });
    }

    function init() {
      if (sortSel) sortSel.addEventListener('change', function () { state2.sort = sortSel.value; render(); });
      buildChips();
      // the nudge lives after the list, inside the Friends panel
      if (listEl && listEl.parentNode) {
        ctaEl = el('div', 'friends-cta');
        ctaEl.hidden = true;
        listEl.parentNode.insertBefore(ctaEl, listEl.nextSibling);
      }
    }

    /* The taste-match model is shared, not copied: Popular's "loved by people
       with your taste" section ranks friends with the same tasteMatch() the
       Friends tab prints on every entry. */
    return { init: init, render: render, tasteMatch: tasteMatch, matchByFriend: matchByFriend };
  })();

  /* ================================================================== *
   * POPULAR — three answers to "where is everyone eating?"
   *
   *   1. Trending now            the mock leaderboard (social.getPopular),
   *                              ordered by the one popularity signal the
   *                              feed actually carries: `reviews` — how many
   *                              people reviewed the place in the range.
   *   2. Near you right now      places OPEN this minute (or closing soon)
   *                              within a five-minute walk, closest first.
   *                              Hours come from the shared openState().
   *   3. Loved by your taste     places your best taste-matched friends
   *                              rated highly and you have NOT logged.
   *
   * Nothing here invents data: every row is a join between an existing feed
   * entry and the sample place record of the same name, and every section
   * that has nothing honest to say renders nothing at all.
   * ================================================================== */
  var popular = (function () {
    var listEl = $('popular-list');
    var toggle = $('range-toggle');
    var btns = toggle ? Array.prototype.slice.call(toggle.querySelectorAll('.range-btn')) : [];
    var state3 = { range: 'today', token: 0 };

    /* "I want to leave in five minutes": a ~12 minute walk, no farther. */
    var NEAR_MAX_MI = 0.6;
    var NEAR_MAX_ROWS = 5;
    /* A friend "loved" a place at 80+ overall — the same bar the Friends tab
       uses for its "You both loved" strip. */
    var LOVED_MIN = 80;
    var LOVED_MAX_ROWS = 4;
    var ROW_REASON_MAX = 2;   // rows are dense already; two chips, one line

    /* Movement, straight from the feed's own `trend` field — never inferred
       from the synthesized sparkline (that line is drawn FROM this). Rows
       whose feed entry carries no trend simply show no indicator. */
    var TREND = {
      up: { glyph: '▲', cls: 'up', text: 'Rising', label: 'trending up' },
      down: { glyph: '▼', cls: 'down', text: 'Cooling', label: 'trending down' },
      flat: { glyph: '—', cls: 'flat', text: 'Holding steady', label: 'holding steady' }
    };

    /* ---------------- the place pool behind every section --------------
       A real search wins (those places are genuinely near you); with no
       search yet we use the same sample set the rest of demo mode runs on.
       Rebuilt per render so open/closed is derived at the current clock. */
    function localPlaces() {
      return (state.results && state.results.length) ? state.results : demoResults();
    }
    function placeByName(pool, name) {
      var n = String(name || '').toLowerCase();
      for (var i = 0; i < pool.length; i++) {
        if (String(pool[i].name || '').toLowerCase() === n) return pool[i];
      }
      return null;
    }

    /* ---------------- sections 2 + 3 live in JS-built containers -------- */
    var secs = {};
    function ensureSection(key, title, sub) {
      if (secs[key]) return secs[key];
      var panel = $('panel-popular');
      if (!panel || !listEl) return null;
      var wrap = el('section', 'pop-sec');
      wrap.hidden = true;
      var head = el('div', 'pop-sec-head');
      var titleRow = el('div', 'pop-sec-titlerow');
      titleRow.appendChild(el('h3', 'pop-sec-title', title));
      // sample data says so once per section (the trending list sits under
      // the panel's own demo banner already)
      var tag = el('span', 'v-demo-tag', 'Sample');
      tag.hidden = true;
      titleRow.appendChild(tag);
      head.appendChild(titleRow);
      head.appendChild(el('p', 'pop-sec-sub', sub));
      wrap.appendChild(head);
      var list = el('ol', 'popular-list');
      wrap.appendChild(list);
      panel.appendChild(wrap);
      secs[key] = { wrap: wrap, list: list, tag: tag };
      return secs[key];
    }
    function hideSection(key) {
      if (secs[key]) { secs[key].wrap.hidden = true; clear(secs[key].list); }
    }

    /* One non-breaking meta group: "0.1 mi · 3 min walk". */
    function metaGroup(parts) {
      if (parts == null) return null;
      if (!(parts instanceof Array)) parts = [parts];
      var g = el('span', 'pop-mgroup');
      parts.forEach(function (part) {
        if (part == null || part === '') return;
        if (g.childNodes.length) g.appendChild(el('span', 'dotsep', '·'));
        g.appendChild(typeof part === 'string' ? document.createTextNode(part) : part);
      });
      return g.childNodes.length ? g : null;
    }

    /* ---------------- the shared row -----------------------------------
       Every section renders the same anatomy — watercolor thumb, name, one
       meta line, status chips, up to two match-reason chips, and a small
       right-hand stat — so the tab reads as one thing. The whole card is a
       single tap target: a transparent button stretched over it opens the
       SAME decision screen a swipe-right opens (deck.pickFrom via
       find.showPick). Rows with no place record behind them are not
       tappable rather than opening a screen with nothing in it.

       cfg: { place, name, mod, rank, source, meta:[groups], chips:[nodes],
              aside, shown, skip, siblings } */
    function buildRow(cfg) {
      var r = cfg.place;
      var li = el('li', 'pop-card pop-row' + (cfg.mod ? ' ' + cfg.mod : ''));
      li.setAttribute('data-name', cfg.name);
      if (r && r.distance != null) li.setAttribute('data-mi', r.distance.toFixed(3));

      // --- thumb: the place's own watercolor art (or its photo, live mode)
      var thumb = el('span', 'pop-thumb');
      thumb.setAttribute('aria-hidden', 'true');
      var photo = r && (((r.segments && r.segments.vibe) || {}).photoUrl || r.photoUrl);
      paintThumb(thumb, photo, panelArt(r || { name: cfg.name, cuisines: [] }, 'vibe', 0));
      if (cfg.rank) {
        var rk = el('span', 'pop-thumb-rank', String(cfg.rank));
        rk.setAttribute('aria-hidden', 'true');
        thumb.appendChild(rk);
      }
      li.appendChild(thumb);

      // --- body
      var body = el('span', 'pop-row-body');
      body.appendChild(el('span', 'pop-name', cfg.name));
      if (cfg.source) body.appendChild(cfg.source);
      // The meta line is a set of NON-BREAKING groups (score+reviews,
      // price+cuisine, distance+walk) laid out with a wide gap. Dots live
      // only inside a group, so a wrap can never strand or lead with one.
      var meta = el('span', 'pop-meta');
      (cfg.meta || []).forEach(function (group) {
        var g = metaGroup(group);
        if (g) meta.appendChild(g);
      });
      if (meta.childNodes.length) body.appendChild(meta);

      var chipRow = el('span', 'pop-chips');
      (cfg.chips || []).forEach(function (c) { if (c) chipRow.appendChild(c); });
      if (chipRow.childNodes.length) body.appendChild(chipRow);

      // --- why this one: the shared reason engine, deduped against what
      // this very row already prints (`shown`) and told which groups the
      // row states louder than a chip could (`skip`), exactly as the deck
      // card does it.
      var reasons = [];
      if (r) {
        reasons = matchReasons(r, { max: ROW_REASON_MAX, shown: cfg.shown || '', skip: cfg.skip || null });
        var rr = reasonsRowEl(reasons, 'ov-reason');
        if (rr) body.appendChild(rr);
      }
      li.appendChild(body);

      if (cfg.aside) li.appendChild(cfg.aside);

      if (r) {
        var hit = el('button', 'pop-row-hit');
        hit.type = 'button';
        var why = reasons.map(function (x) { return x.text; }).join(', ');
        hit.setAttribute('aria-label', 'Pick ' + cfg.name + ' — ' +
          String(cfg.shown || '').replace(/\s+/g, ' ') + (why ? '. Why: ' + why : ''));
        hit.addEventListener('click', function () { openPick(r, cfg.siblings); });
        li.appendChild(hit);
      } else {
        li.classList.add('pop-row--flat');
      }
      return li;
    }

    /* The deck's decision screen, opened from here. One flow, one screen. */
    function openPick(r, siblings) {
      if (!r) return;
      haptic(12);
      tabs.activate('find');
      find.showPick(r, siblings || []);
    }

    /* Small right-hand stat block (reuses the leaderboard's numeral style). */
    function statEl(big, lbl) {
      var s = el('span', 'pop-stat');
      var sc = el('span', 'pop-score');
      sc.appendChild(el('span', 'big', big));
      sc.appendChild(el('span', 'lbl', lbl));
      s.appendChild(sc);
      return s;
    }

    /* ================= 1. TRENDING NOW ================================ */

    /* Synthesize a plausible 7-point series ending at the row's score:
       up-trends climb ~6 points, down-trends fall, flat wobbles. Seeded
       by place name so every render draws the identical line. */
    function trendSeries(item) {
      var h = hashStr(item.place + item.rank);
      var dir = item.trend === 'up' ? 1 : item.trend === 'down' ? -1 : 0;
      var pts = [];
      for (var i = 0; i < 7; i++) {
        var ti = i / 6;
        var base = item.score - dir * (1 - ti) * 6;
        var wob = Math.sin(h % 7 + i * 1.7) * 1.4;
        pts.push(base + wob);
      }
      pts[6] = item.score;
      return pts;
    }

    function movementChip(item) {
      var t = TREND[item.trend];
      if (!t) return null;                 // no trend data — say nothing
      var chip = el('span', 'pop-move pop-move--' + t.cls);
      var g = el('span', 'pop-trend pop-trend--' + t.cls, t.glyph);
      g.setAttribute('aria-hidden', 'true');
      chip.appendChild(g);
      chip.appendChild(el('span', 'pop-move-text', t.text));
      chip.setAttribute('aria-label', t.label);
      return chip;
    }

    function renderTrending(list, pool) {
      clear(listEl);
      // Order by review volume — the feed's only genuine popularity signal
      // ("what people are reviewing most right now"). The mock's own `rank`
      // already agrees; recomputing keeps the row honest for a real backend.
      list = list.slice().sort(function (a, b) { return (b.reviews || 0) - (a.reviews || 0); });
      if (!list.length) { showTrendingEmpty(); return 0; }
      var places = list.map(function (it) { return placeByName(pool, it.place); });
      list.forEach(function (item, i) {
        item.rank = i + 1;
        var r = places[i];
        var rating = el('span', 'pop-rating');
        rating.appendChild(el('span', 'pop-star', '★ '));
        rating.appendChild(document.createTextNode(fmtScore(item.score)));
        var meta = [
          [rating, item.reviews.toLocaleString() + ' review' + (item.reviews === 1 ? '' : 's')],
          [(r && r.price) ? priceStr(r.price) : '', item.cuisine || (r && r.type) || '']
        ];
        if (r && r.distance != null) meta.push([fmtDist(r.distance), fmtTravel(r.distance)]);
        else if (item.loc) meta.push([item.loc]);

        var chips = [];
        var oChip = r ? openChipEl(r, 'ov-badge') : null;
        if (oChip) chips.push(oChip);
        var mv = movementChip(item);
        if (mv) chips.push(mv);

        var aside = el('span', 'pop-stat');
        var sparkColor = item.rank === 1 ? 'var(--gold)'
          : item.rank === 2 ? 'var(--wisteria)'
          : item.rank === 3 ? 'var(--pond-deep)'
          : 'var(--ink-soft)';
        aside.appendChild(svgSparkline(trendSeries(item), sparkColor));
        aside.appendChild(el('span', 'pop-stat-lbl', state3.range === 'today' ? 'today'
          : (state3.range === 'month' ? 'this month' : 'this year')));

        var shown = [item.place, fmtScore(item.score), item.reviews.toLocaleString() + ' reviews',
          (r && r.price ? priceStr(r.price) : ''), item.cuisine || '',
          (r && r.distance != null ? fmtDist(r.distance) + ' ' + fmtTravel(r.distance) : ''),
          (oChip ? oChip.textContent : ''), (mv ? TREND[item.trend].text : '')].join(' · ');

        var row = buildRow({
          place: r,
          name: item.place,
          mod: 'pop-row--trend' + (item.rank <= 3 ? ' pop-top pop-top-' + item.rank : ''),
          rank: item.rank,
          meta: meta,
          chips: chips,
          aside: aside,
          shown: shown,
          // the row already prints the review count and the walk, loudly
          skip: { reviews: true, near: true },
          siblings: places.filter(function (p, j) { return p && j !== i; })
        });
        enterStagger(row, i);
        listEl.appendChild(row);
      });
      return list.length;
    }
    /* The leaderboard's own quiet empty state (a backend could return none). */
    function showTrendingEmpty() {
      clear(listEl);
      var empty = el('li', 'empty');
      empty.appendChild(el('div', 'empty-glyph', '✧'));
      empty.appendChild(el('p', 'empty-title', 'Nothing trending yet'));
      empty.appendChild(el('p', 'empty-sub', 'Try another time range.'));
      listEl.appendChild(empty);
    }

    /* ================= 2. NEAR YOU RIGHT NOW ========================== */

    function nearbyRows(pool) {
      var rows = [];
      for (var i = 0; i < pool.length; i++) {
        var r = pool[i];
        if (r.distance == null || r.distance > NEAR_MAX_MI) continue;
        var st = openState(r);                       // shared clock logic
        if (!st || (st.key !== 'open' && st.key !== 'soon')) continue;
        rows.push({ r: r, st: st });
      }
      rows.sort(function (a, b) { return a.r.distance - b.r.distance; });
      return rows.slice(0, NEAR_MAX_ROWS);
    }

    function renderNearby(pool) {
      var sec = ensureSection('near', 'Near you right now',
        'Open this minute, close enough to leave in five.');
      if (!sec) return 0;
      var rows = nearbyRows(pool);
      if (!rows.length) { hideSection('near'); return 0; }
      sec.wrap.hidden = false;
      clear(sec.list);
      var all = rows.map(function (x) { return x.r; });
      rows.forEach(function (x, i) {
        var r = x.r;
        var meta = [];
        if (r.rating) {
          var rating = el('span', 'pop-rating');
          rating.appendChild(el('span', 'pop-star', '★ '));
          rating.appendChild(document.createTextNode(fmtScore(r.rating * 20)));
          meta.push([rating]);
        }
        meta.push([r.price ? priceStr(r.price) : '', r.type || '']);

        var chips = [];
        var oChip = openChipEl(r, 'ov-badge');
        if (oChip) chips.push(oChip);

        var aside = statEl(fmtDist(r.distance), fmtTravel(r.distance));
        var shown = [r.name, (r.rating ? fmtScore(r.rating * 20) : ''), priceStr(r.price), r.type || '',
          fmtDist(r.distance), fmtTravel(r.distance), x.st.label].join(' · ');

        var row = buildRow({
          place: r,
          name: r.name,
          // closing soon is the urgent case — warm border, same words
          mod: 'pop-row--near' + (x.st.key === 'soon' ? ' pop-row--urgent' : ''),
          meta: meta,
          chips: chips,
          aside: aside,
          shown: shown,
          // this section IS "how close" and "how long it's open"
          skip: { near: true, time: true },
          siblings: all.filter(function (p) { return p !== r; })
        });
        enterStagger(row, i);
        sec.list.appendChild(row);
      });
      // one shared answer to "is this real?" — the tag shows the moment
      // any row in the section is backed by sample data.
      if (sec.tag) sec.tag.hidden = !rows.some(function (x) { return isSampleResult(x.r); });
      return rows.length;
    }

    /* ================= 3. LOVED BY PEOPLE WITH YOUR TASTE ============== */

    /* Friends ranked by the SHARED taste-match model (friends.matchByFriend),
       then the places they rated 80+ that your Visited log has never seen.
       No overlap to measure -> no rows -> the section is not rendered at
       all (a taste match nobody can compute is not a recommendation). */
    function tasteRows(feed) {
      if (!feed || !feed.length) return [];
      var matches = friends.matchByFriend(feed);
      var ranked = [];
      for (var name in matches) {
        if (matches[name]) ranked.push({ name: name, m: matches[name] });
      }
      if (!ranked.length) return [];
      ranked.sort(function (a, b) { return (b.m.pct - a.m.pct) || a.name.localeCompare(b.name); });

      var seen = {}, out = [];
      ranked.forEach(function (f) {
        feed.forEach(function (e) {
          if (!e.friend || e.friend.name !== f.name) return;
          if (overallOf(e) < LOVED_MIN) return;          // they didn't love it
          if (myRatingFor(e.place)) return;              // already in your log
          var k = String(e.place || '').toLowerCase();
          if (!k || seen[k]) return;                     // best match names it
          seen[k] = true;
          out.push({ entry: e, friend: f });
        });
      });
      return out.slice(0, LOVED_MAX_ROWS);
    }

    function renderTaste(feed, pool) {
      var rows = tasteRows(feed);
      if (!rows.length) { hideSection('taste'); return 0; }
      var sec = ensureSection('taste', 'Loved by people with your taste',
        'Rated highly by the friends whose log looks most like yours — and new to you.');
      if (!sec) return 0;
      sec.wrap.hidden = false;
      clear(sec.list);
      var all = rows.map(function (x) { return placeByName(pool, x.entry.place); });
      rows.forEach(function (x, i) {
        var e = x.entry;
        var r = all[i];
        var who = firstName(e.friend.name);
        var theirs = fmtScore(overallOf(e));

        var source = el('span', 'pop-source');
        source.appendChild(el('strong', 'pop-source-who', who));
        source.appendChild(document.createTextNode(', ' + x.friend.m.pct + '% taste match'));

        var meta = [[(r && r.price) ? priceStr(r.price) : '', (r && r.type) || e.loc || '']];
        if (r && r.distance != null) meta.push([fmtDist(r.distance), fmtTravel(r.distance)]);

        var chips = [];
        var oChip = r ? openChipEl(r, 'ov-badge') : null;
        if (oChip) chips.push(oChip);
        if (e.note) {
          var q = el('span', 'pop-quote', '“' + e.note + '”');
          chips.push(q);
        }

        var aside = statEl(theirs, who + '’s score');
        var shown = [e.place, who, x.friend.m.pct + '% taste match', theirs,
          (r && r.price ? priceStr(r.price) : ''), (r && r.type) || '',
          (r && r.distance != null ? fmtDist(r.distance) + ' ' + fmtTravel(r.distance) : ''),
          (oChip ? oChip.textContent : ''), e.note || ''].join(' · ');

        var row = buildRow({
          place: r,
          name: e.place,
          mod: 'pop-row--taste',
          source: source,
          meta: meta,
          chips: chips,
          aside: aside,
          shown: shown,
          // the row names the friend AND prints the walk — a chip repeating
          // either in other words would waste one of only two slots
          skip: { friend: true, near: true },
          siblings: all.filter(function (p, j) { return p && j !== i; })
        });
        enterStagger(row, i);
        sec.list.appendChild(row);
      });
      // the friends feed behind this section is mock data in every mode,
      // so the tag stays on even when the rest of the app is live.
      if (sec.tag) sec.tag.hidden = !rows.some(function (x) { return x.entry.demo !== false; });
      return rows.length;
    }

    /* ================= render orchestration ============================ */

    function showLoading() {
      clear(listEl);
      var sk = el('li', 'social-loading');
      sk.appendChild(el('span', 'social-spinner', ''));
      sk.appendChild(el('span', null, 'Crunching the rankings…'));
      sk.setAttribute('role', 'status');
      listEl.appendChild(sk);
    }
    function showError() {
      clear(listEl);
      var empty = el('li', 'empty');
      empty.appendChild(el('div', 'empty-glyph', '⚠'));
      empty.appendChild(el('p', 'empty-title', 'Couldn’t load trends'));
      empty.appendChild(el('p', 'empty-sub', 'Try another time range.'));
      listEl.appendChild(empty);
      hideSection('taste');
      announce('Couldn’t load the trends. Try another time range.');
    }

    function setRange(range) {
      state3.range = range;
      btns.forEach(function (b) {
        var on = b.dataset.range === range;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      render();
    }

    function render() {
      if (!listEl) return;
      var token = ++state3.token;
      var pool = localPlaces();
      showLoading();
      // local sections need no network — paint them immediately
      var nNear = renderNearby(pool);
      Promise.all([
        social.getPopular({ range: state3.range }),
        social.getFriendsFeed({ sort: 'recent' })
      ]).then(function (res) {
        if (token !== state3.token) return;   // stale response
        var nTrend = renderTrending(res[0] || [], pool);
        var nTaste = renderTaste(res[1] || [], pool);
        var label = state3.range === 'today' ? 'today' : (state3.range === 'month' ? 'this month' : 'this year');
        var bits = ['Popular: ' + nTrend + ' trending ' + label];
        if (nNear) bits.push(nNear + ' open near you right now');
        if (nTaste) bits.push(nTaste + ' loved by people with your taste');
        announce(bits.join(', ') + '.');
      }).catch(function () {
        if (token === state3.token) showError();
      });
    }

    function init() {
      btns.forEach(function (b) {
        b.addEventListener('click', function () { setRange(b.dataset.range); });
      });
    }

    return { init: init, render: render };
  })();


  /* ================================================================== *
   * FEED — the app's front door.
   *
   * A full-bleed vertical snap feed of watercolor food posts. What is
   * REAL here: the scroll and snap, the art, the place behind every post
   * (always one from the current pool — your live search results, or the
   * sample set), hearting a post (it saves that place to the same
   * shortlist the deck fills, and the heart persists), "Go here" (it opens
   * the deck's own decision screen), and the ORDER, which is computed from
   * your Visited log, your preferences, who you follow and how far away
   * the place is.
   *
   * What is SAMPLE, and says so on every surface that shows it: the
   * creators, their handles, their follower counts and the captions. There
   * is no account and no backend behind them, and the banner at the top of
   * the feed says exactly that.
   *
   * There is no video anywhere in here. The posts are painted stills that
   * breathe — a drifting wash, a slow push, faint steam — and under
   * prefers-reduced-motion they hold perfectly still.
   * ================================================================== */
  var feed = (function () {
    var panelEl = $('panel-feed');
    var scrollEl = $('feed-scroll');
    var railEl = $('feed-rail');
    var emptyEl = $('feed-empty');

    var WINDOW = 2;          // posts kept mounted either side of the visible one
    var MAX_NODES = 7;       // hard cap on post nodes in the DOM (5 + 2 spare)
    var POSTS_PER_PLACE = 3;

    var posts = [];          // ranked post descriptors
    var mounted = {};        // index -> node
    var freeNodes = [];      // recycled node pool
    var poolSig = '';        // signature of the place pool these posts came from
    var postH = 0;
    var current = -1;
    var ticking = false;
    var announceTimer = null;
    var shown = false;

    /* ---- the creators. Sample data, labelled as such everywhere it
       appears — the same discipline the Friends tab keeps. Six of them are
       the Friends-tab names so the app reads as one world. ---- */
    var CREATORS = [
      { handle: '@mayaokafor', name: 'Maya Okafor', initial: 'M', color: 'rose', followers: '18.2k' },
      { handle: '@devineats', name: 'Devin Park', initial: 'D', color: 'pond', followers: '9,410' },
      { handle: '@priyaplates', name: 'Priya Raman', initial: 'P', color: 'wisteria', followers: '24.6k' },
      { handle: '@leoclate', name: 'Leo Castellanos', initial: 'L', color: 'sage', followers: '6,208' },
      { handle: '@hanasato', name: 'Hana Sato', initial: 'H', color: 'gold', followers: '31.9k' },
      { handle: '@theobrandt', name: 'Theo Brandt', initial: 'T', color: 'pond', followers: '4,072' },
      { handle: '@saltandpaper', name: 'Nour Haddad', initial: 'N', color: 'wisteria', followers: '52.1k' },
      { handle: '@slowbreakfast', name: 'Ines Duarte', initial: 'I', color: 'sage', followers: '11.7k' }
    ];

    /* Captions are written in the app's voice and are demo content like the
       creators are. For a live place we know nothing about beyond its name,
       type and distance, the caption states only that — it never invents a
       dish, a queue or a verdict for a real restaurant. */
    var CLOSERS = [
      'Worth the walk.', 'Still thinking about it.', 'Quietly perfect.',
      'Went twice this week.', 'No notes.', 'The good kind of full.',
      'Sat by the window for an hour.', 'Would go again tomorrow.'
    ];
    var LIVE_LINES = [
      'On the list for this week.', 'Saving this one.', 'Next dinner, maybe.',
      'Walked past it twice. Third time counts.'
    ];
    function captionFor(r, variant, h) {
      var segs = r.segments || {};
      var food = segs.food && segs.food.caption;
      var vibe = segs.vibe && segs.vibe.caption;
      var line = (variant % 2 === 0 ? food : vibe) || food || vibe || '';
      if (line) {
        return line.charAt(0).toUpperCase() + line.slice(1) + '. ' + CLOSERS[(h + variant) % CLOSERS.length];
      }
      var bits = [];
      if (r.type) bits.push(r.type);
      if (r.distance != null) bits.push(fmtDist(r.distance) + ' away');
      return (bits.length ? bits.join(' · ') + '. ' : '') + LIVE_LINES[(h + variant) % LIVE_LINES.length];
    }

    /* ---------------- the ranking model ----------------
       score = follow boost + taste + proximity + quality + open now, plus a
       small seeded jitter so two identical scores don't reshuffle between
       renders. Every term is derived from something real; nothing here is
       random per view. With no follows and no Visited history the first two
       terms are simply zero and the feed falls back to proximity + rating,
       which is still a sensible order — never a blank or arbitrary one. */
    var FOLLOW_BOOST = 34;

    var affinityCache = null;
    function cuisineAffinity() {
      if (affinityCache) return affinityCache;
      var byName = {};
      DEMO_RESTAURANTS.forEach(function (d) {
        if (d.cuisines && d.cuisines.length) byName[d.name.toLowerCase()] = d.cuisines;
      });
      var sums = {}, counts = {};
      (state.visited || []).forEach(function (e) {
        var keys = (e.cuisines && e.cuisines.length) ? e.cuisines : byName[String(e.name || '').toLowerCase()];
        if (!keys) return;
        var o = overallOf(e);
        if (!isFinite(o)) return;
        keys.forEach(function (k) {
          sums[k] = (sums[k] || 0) + o;
          counts[k] = (counts[k] || 0) + 1;
        });
      });
      affinityCache = { sums: sums, counts: counts };
      return affinityCache;
    }

    /* 0-40, plus the one honest sentence that explains it. */
    function tasteScore(r) {
      var mine = myRatingFor(r.name);
      if (mine) {
        var o = overallOf(mine);
        if (o >= 75) return { s: 30, why: { kind: 'mine', text: 'You rated it ' + fmtScore(o) } };
        if (o < 55) return { s: -18, why: null };
        return { s: 8, why: null };
      }
      var best = 0, why = null;
      var aff = cuisineAffinity();
      (r.cuisines || []).forEach(function (k) {
        if (!aff.counts[k]) return;
        var avg = aff.sums[k] / aff.counts[k];
        var damp = aff.counts[k] / (aff.counts[k] + 1);   // one visit can't carry it
        var v = Math.max(-10, ((avg - 62) / 38) * 26) * damp;
        if (v > best) {
          best = v;
          why = { kind: 'pref', text: 'More ' + prefs.labelFor(k) + ' — you rate it well' };
        }
      });
      var fr = bestFriendRating(r.name);
      if (fr && overallOf(fr) >= 80 && best < 16) {
        best = 16;
        why = { kind: 'friend', text: firstName(fr.friend.name) + ' loved it' };
      }
      return { s: best, why: why };
    }

    function scorePost(post) {
      var r = post.place, s = 0, why = null;
      if (feedStore.isFollowing(post.creator.handle)) {
        s += FOLLOW_BOOST;
        why = { kind: 'friend', text: 'You follow ' + firstName(post.creator.name) };
      }
      var t = tasteScore(r);
      s += t.s;
      if (!why && t.why && t.s >= 15) why = t.why;
      if (r.distance != null) {
        var near = Math.max(0, 18 - r.distance * 16);
        s += near;
        if (!why && near >= 13) why = { kind: 'near', text: fmtDist(r.distance) + ' from you' };
      }
      if (r.rating) s += (r.rating - 3.8) * 13;
      var st = openState(r);
      if (st && (st.key === 'open' || st.key === 'soon')) {
        s += 6;
        if (!why) why = { kind: 'time', text: 'Open right now' };
      }
      if (!why && r.rating >= 4.5) why = { kind: 'rating', text: 'Loved nearby' };
      s += (hashStr(post.key) % 1000) / 1000 * 6;
      post.why = why;
      post.score = s;
      return s;
    }

    /* Ranking alone would stack every post from your three favourite places
       at the top and the feed would feel like a loop. This walks the ranked
       list and takes the best post that is at least GAP_PLACE away from the
       last post of that place (and GAP_CREATOR from that creator); when
       nothing qualifies it takes the best one left rather than stalling. The
       ORDER within those constraints is still entirely the score's. */
    var GAP_PLACE = 4, GAP_CREATOR = 2;
    function spread(list) {
      var out = [], pending = list.slice();
      while (pending.length) {
        var pick = -1;
        for (var i = 0; i < pending.length; i++) {
          var c = pending[i], ok = true;
          for (var k = 1; k <= GAP_PLACE && out.length - k >= 0; k++) {
            var prev = out[out.length - k];
            if (prev.place === c.place) { ok = false; break; }
            if (k <= GAP_CREATOR && prev.creator === c.creator) { ok = false; break; }
          }
          if (ok) { pick = i; break; }
        }
        out.push(pending.splice(pick === -1 ? 0 : pick, 1)[0]);
      }
      return out;
    }

    function poolOf() {
      return (state.results && state.results.length) ? state.results : demoResults();
    }
    function signatureOf(pool) {
      return pool.length + ':' + (pool[0] ? pool[0].id : '') + ':' + (liveMode() ? 'live' : 'demo');
    }

    function build(pool) {
      var out = [];
      pool.forEach(function (r) {
        for (var v = 0; v < POSTS_PER_PLACE; v++) {
          var h = hashStr((r.id || r.name || '') + '|feedpost|' + v);
          out.push({
            key: (r.id || r.name || '') + '|' + v,
            place: r,
            variant: v,
            creator: CREATORS[(h + v * 3) % CREATORS.length],
            caption: captionFor(r, v, h)
          });
        }
      });
      out.forEach(scorePost);
      out.sort(function (a, b) { return b.score - a.score; });
      return spread(out);
    }

    /* Re-rank in place, keeping the post the reader is looking at exactly
       where it is — following someone reshapes what comes NEXT, it does not
       yank the current post out from under them. */
    function rerank(keepKey) {
      affinityCache = null;
      posts = build(poolOf());
      var at = 0;
      for (var i = 0; i < posts.length; i++) if (posts[i].key === keepKey) { at = i; break; }
      unmountAll();
      layout();
      // The order is rebuilt from scratch — the reader simply travels with
      // the post they were looking at, so nothing jumps and the ranking
      // stays exactly what the model says it should be.
      hardScroll(at * postH);
      sync(true);
    }

    /* ---------------- DOM ---------------- */
    function buildNode() {
      var art = el('div', 'feed-artwrap');
      art.setAttribute('aria-hidden', 'true');
      var steam = el('div', 'feed-steam');
      steam.setAttribute('aria-hidden', 'true');
      steam.appendChild(el('span', 'feed-steam-p'));
      steam.appendChild(el('span', 'feed-steam-p'));
      steam.appendChild(el('span', 'feed-steam-p'));
      art.appendChild(steam);
      var wash = el('div', 'feed-wash');
      wash.setAttribute('aria-hidden', 'true');
      art.appendChild(wash);

      var node = el('article', 'feed-post');
      node.tabIndex = -1;   // focusable only on purpose (keyboard paging)
      node.appendChild(art);
      var scrim = el('div', 'feed-scrim');
      scrim.setAttribute('aria-hidden', 'true');
      node.appendChild(scrim);

      var why = el('p', 'feed-why');
      var whyGlyph = el('span', 'feed-why-glyph');
      whyGlyph.setAttribute('aria-hidden', 'true');
      var whyText = el('span', 'feed-why-text');
      why.appendChild(whyGlyph);
      why.appendChild(whyText);
      node.appendChild(why);

      var body = el('div', 'feed-body');
      var crow = el('div', 'feed-creator');
      var avatar = el('span', 'feed-avatar');
      avatar.setAttribute('aria-hidden', 'true');
      var handle = el('span', 'feed-handle');
      var demoTag = el('span', 'v-demo-tag feed-sample', 'Sample');
      crow.appendChild(avatar);
      crow.appendChild(handle);
      crow.appendChild(demoTag);
      body.appendChild(crow);

      var name = el('h3', 'feed-place');
      body.appendChild(name);
      var meta = el('div', 'feed-meta');
      body.appendChild(meta);
      var cap = el('p', 'feed-caption');
      body.appendChild(cap);
      var reasons = el('div', 'feed-reasonhold');
      body.appendChild(reasons);
      node.appendChild(body);

      var rail = el('div', 'feed-acts');
      function act(cls, label) {
        var b = el('button', 'feed-act ' + cls);
        b.type = 'button';
        var g = el('span', 'feed-act-glyph');
        g.setAttribute('aria-hidden', 'true');
        var l = el('span', 'feed-act-label');
        b.appendChild(g);
        b.appendChild(l);
        rail.appendChild(b);
        return { btn: b, glyph: g, label: l };
      }
      var heart = act('feed-act--heart', 'Save');
      var follow = act('feed-act--follow', 'Follow');
      var go = act('feed-act--go', 'Go here');
      node.appendChild(rail);

      node._refs = {
        art: art, steam: steam, wash: wash, why: why, whyGlyph: whyGlyph, whyText: whyText,
        avatar: avatar, handle: handle, name: name, meta: meta, cap: cap,
        reasons: reasons, heart: heart, follow: follow, go: go, canvas: null
      };

      heart.btn.addEventListener('click', function () { onHeart(node); });
      follow.btn.addEventListener('click', function () { onFollow(node); });
      go.btn.addEventListener('click', function () { onGo(node); });
      return node;
    }

    function heartedFor(r) {
      return feedStore.isHearted(r.name) || deck.inShortlist(r.id);
    }

    function paintHeart(node) {
      var p = node._post;
      if (!p) return;
      var on = heartedFor(p.place);
      var h = node._refs.heart;
      h.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      h.btn.classList.toggle('is-on', on);
      h.glyph.textContent = on ? '♥' : '♡';
      h.label.textContent = on ? 'Saved' : 'Save';
      h.btn.setAttribute('aria-label',
        (on ? 'Remove ' : 'Save ') + p.place.name + (on ? ' from your shortlist' : ' to your shortlist'));
    }
    function paintFollow(node) {
      var p = node._post;
      if (!p) return;
      var on = feedStore.isFollowing(p.creator.handle);
      var f = node._refs.follow;
      f.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      f.btn.classList.toggle('is-on', on);
      f.glyph.textContent = on ? '✓' : '+';
      f.label.textContent = on ? 'Following' : 'Follow';
      f.btn.setAttribute('aria-label',
        (on ? 'Unfollow ' : 'Follow ') + p.creator.handle + ' (sample creator)');
    }

    function fill(node, i) {
      var p = posts[i], r = p.place, refs = node._refs;
      node._post = p;
      node._index = i;
      node.style.top = (i * postH) + 'px';
      node.setAttribute('aria-posinset', String(i + 1));
      node.setAttribute('aria-setsize', String(posts.length));

      if (refs.canvas && refs.canvas.parentNode === refs.art) refs.art.removeChild(refs.canvas);
      var cv = foodArt.paint(r, p.variant);
      refs.canvas = cv;
      refs.art.insertBefore(cv, refs.art.firstChild);
      refs.art.classList.toggle('has-steam', foodArt.hasSteam(r, p.variant));
      // a stable per-post offset so neighbouring posts don't drift in step
      refs.art.style.setProperty('--art-seed', String((hashStr(p.key) % 1000) / 1000));

      refs.avatar.textContent = p.creator.initial;
      refs.avatar.className = 'feed-avatar feed-avatar--' + p.creator.color;
      refs.handle.textContent = p.creator.handle;
      refs.name.textContent = r.name;

      clear(refs.meta);
      var chip = openChipEl(r, 'ov-badge');
      if (chip) refs.meta.appendChild(chip);
      var mbits = [];
      if (r.rating) mbits.push('★ ' + fmt1(r.rating));
      if (r.price) mbits.push(priceStr(r.price));
      if (r.distance != null) mbits.push(fmtDist(r.distance));
      if (mbits.length) refs.meta.appendChild(el('span', 'feed-metatext', mbits.join('  ·  ')));
      var stag = sampleTagFor(r, 'feed-sample');
      if (stag) refs.meta.appendChild(stag);
      refs.meta.appendChild(el('span', 'feed-followers', p.creator.followers + ' followers'));

      refs.cap.textContent = p.caption;

      clear(refs.reasons);
      var rlist = matchReasons(r, {
        max: 2,
        shown: r.name + ' ' + p.caption + ' ' + (chip ? chip.textContent : '') + ' ' + (p.why ? p.why.text : ''),
        // the "why you're seeing this" pill already said this louder
        skip: p.why ? (function () { var sk = {}; sk[p.why.kind === 'mine' ? 'mine' : p.why.kind] = 1; return sk; })() : null
      });
      var row = reasonsRowEl(rlist, 'feed-reason');
      if (row) refs.reasons.appendChild(row);

      if (p.why) {
        refs.why.hidden = false;
        refs.whyGlyph.textContent = REASON_GLYPH[p.why.kind] || '';
        refs.whyText.textContent = p.why.text;
      } else {
        refs.why.hidden = true;
      }

      paintHeart(node);
      paintFollow(node);
      refs.go.glyph.textContent = '↗';
      refs.go.label.textContent = 'Go here';
      refs.go.btn.setAttribute('aria-label', 'Go here — open the decision screen for ' + r.name);

      var st = openState(r);
      node.setAttribute('aria-label',
        r.name + (r.type ? ', ' + r.type : '') + (st ? ', ' + st.label : '') +
        '. Posted by ' + p.creator.handle + ', a sample creator.');
      return node;
    }

    function mountAt(i) {
      if (mounted[i]) return mounted[i];
      var node = freeNodes.pop() || buildNode();
      fill(node, i);
      if (node.parentNode !== railEl) railEl.appendChild(node);
      mounted[i] = node;
      return node;
    }
    function release(i) {
      var node = mounted[i];
      if (!node) return;
      delete mounted[i];
      var refs = node._refs;
      if (refs.canvas && refs.canvas.parentNode === refs.art) refs.art.removeChild(refs.canvas);
      refs.canvas = null;
      node._post = null;
      if (node.parentNode) node.parentNode.removeChild(node);
      if (freeNodes.length < MAX_NODES) freeNodes.push(node);
    }
    function unmountAll() {
      for (var k in mounted) if (mounted.hasOwnProperty(k)) release(Number(k));
      current = -1;
    }

    function layout() {
      if (!scrollEl || !railEl) return;
      postH = scrollEl.clientHeight || 0;
      scrollEl.style.setProperty('--post-h', postH + 'px');
      var topEl = panelEl.querySelector('.feed-top');
      if (topEl) {
        var tb = topEl.getBoundingClientRect();
        panelEl.style.setProperty('--feed-top-h', Math.round(tb.bottom) + 'px');
      }
      railEl.style.height = (postH * posts.length) + 'px';
      for (var k in mounted) {
        if (mounted.hasOwnProperty(k)) mounted[k].style.top = (Number(k) * postH) + 'px';
      }
    }

    /* scroll-snap-stop:always is what makes ONE swipe move ONE post — but
       it also stops any long programmatic jump at the first snap area it
       crosses. For deliberate jumps (Home/End, a re-rank, a resize) snapping
       is switched off for the one frame it takes to land. */
    function hardScroll(top) {
      var prev = scrollEl.style.scrollSnapType;
      scrollEl.style.scrollSnapType = 'none';
      scrollEl.scrollTop = top;
      // mount the window around the LANDING position before snapping is
      // turned back on: a virtualised feed has no snap areas where nothing
      // is mounted, and mandatory snapping would drag the scroll back to
      // the nearest node that still exists.
      sync(true);
      void scrollEl.offsetHeight;
      scrollEl.style.scrollSnapType = prev || '';
    }

    function indexAt() {
      if (!postH) return 0;
      var i = Math.round(scrollEl.scrollTop / postH);
      return Math.max(0, Math.min(posts.length - 1, i));
    }

    function sync(force) {
      if (!posts.length || !postH) return;
      var i = indexAt();
      var lo = Math.max(0, i - WINDOW), hi = Math.min(posts.length - 1, i + WINDOW);
      for (var k in mounted) {
        if (!mounted.hasOwnProperty(k)) continue;
        var n = Number(k);
        if (n < lo || n > hi) release(n);
      }
      for (var m = lo; m <= hi; m++) mountAt(m);
      /* only the post you are actually looking at is in the tab order —
         Tab must not walk into the actions of a post that is off screen */
      for (var q in mounted) {
        if (!mounted.hasOwnProperty(q)) continue;
        var node = mounted[q], on = Number(q) === i;
        node.classList.toggle('is-current', on);
        var acts = node._refs;
        acts.heart.btn.tabIndex = on ? 0 : -1;
        acts.follow.btn.tabIndex = on ? 0 : -1;
        acts.go.btn.tabIndex = on ? 0 : -1;
      }
      if (i !== current || force) {
        current = i;
        if (announceTimer) window.clearTimeout(announceTimer);
        announceTimer = window.setTimeout(function () {
          announceTimer = null;
          var p = posts[current];
          if (!p || !shown) return;
          var st = openState(p.place);
          announce(p.place.name + (st ? ', ' + st.label : '') + '. Post ' +
                   (current + 1) + ' of ' + posts.length + '.' +
                   (p.why ? ' ' + p.why.text + '.' : ''));
        }, 260);
      }
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () { ticking = false; sync(false); });
    }

    function goTo(i, focusIt) {
      i = Math.max(0, Math.min(posts.length - 1, i));
      if (Math.abs(i - indexAt()) > 1 || prefersReducedMotion) hardScroll(i * postH);
      else scrollEl.scrollTo({ top: i * postH, behavior: 'smooth' });
      sync(false);
      if (focusIt && mounted[i]) mounted[i].focus();
    }

    /* ---------------- actions ---------------- */
    function onHeart(node) {
      var p = node._post;
      if (!p) return;
      var on = !heartedFor(p.place);
      feedStore.setHeart(p.place.name, on);
      if (on) deck.addToShortlist(p.place, true);
      else deck.removeFromShortlist(p.place.id);
      // every mounted post for this place agrees at once
      for (var k in mounted) {
        if (mounted.hasOwnProperty(k) && mounted[k]._post && mounted[k]._post.place === p.place) paintHeart(mounted[k]);
      }
      haptic(on ? 14 : 8);
      if (on) {
        var rect = node._refs.heart.btn.getBoundingClientRect();
        dropletBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 74);
      }
      toast(on ? p.place.name + ' saved to your shortlist' : p.place.name + ' removed from your shortlist');
      announce(on
        ? p.place.name + ' saved to your shortlist.'
        : p.place.name + ' removed from your shortlist.');
    }

    function onFollow(node) {
      var p = node._post;
      if (!p) return;
      var on = !feedStore.isFollowing(p.creator.handle);
      feedStore.setFollow(p.creator.handle, on);
      for (var k in mounted) {
        if (mounted.hasOwnProperty(k) && mounted[k]._post && mounted[k]._post.creator === p.creator) paintFollow(mounted[k]);
      }
      haptic(12);
      toast(on ? 'Following ' + p.creator.handle : 'Unfollowed ' + p.creator.handle);
      announce((on ? 'Following ' : 'Unfollowed ') + p.creator.handle +
               '. Your feed leans ' + (on ? 'toward' : 'away from') + ' their posts from here on.');
      rerank(p.key);
    }

    function onGo(node) {
      var p = node._post;
      if (!p) return;
      var rest = [], seen = {};
      seen[p.place.id] = true;
      for (var i = current + 1; i < posts.length && rest.length < 12; i++) {
        var r = posts[i].place;
        if (seen[r.id]) continue;
        seen[r.id] = true;
        rest.push(r);
      }
      haptic(16);
      tabs.activate('find');
      find.showPick(p.place, rest);
    }

    /* ---------------- lifecycle ---------------- */
    function show() {
      shown = true;
      var pool = poolOf();
      var sig = signatureOf(pool);
      if (sig !== poolSig || !posts.length) {
        poolSig = sig;
        affinityCache = null;
        posts = build(pool);
        unmountAll();
        layout();
        hardScroll(0);
      }
      if (emptyEl) emptyEl.hidden = posts.length > 0;
      if (scrollEl) scrollEl.hidden = !posts.length;
      layout();
      sync(true);
    }
    function hide() { shown = false; }

    function init() {
      if (!panelEl || !scrollEl || !railEl) return;
      scrollEl.addEventListener('scroll', onScroll, { passive: true });
      scrollEl.addEventListener('keydown', function (e) {
        var k = e.key;
        if (k === 'ArrowDown' || k === 'PageDown') { e.preventDefault(); goTo(indexAt() + 1); }
        else if (k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); goTo(indexAt() - 1); }
        else if (k === 'Home') { e.preventDefault(); goTo(0); }
        else if (k === 'End') { e.preventDefault(); goTo(posts.length - 1); }
      });
      window.addEventListener('resize', function () {
        if (!shown) return;
        var keep = current;
        layout();
        if (keep >= 0 && postH) hardScroll(keep * postH);
        sync(true);
      });
      // hearts made on an earlier visit are already on the shortlist by the
      // time the feed opens (boot rehydrates them) — nothing to do here.
    }

    return { init: init, show: show, hide: hide };
  })();

  /* ================================================================== *
   * SETTINGS — API key panel
   * ================================================================== */
  var settings = (function () {
    var backdrop = $('settings-backdrop');
    var input = $('key-input');
    var msg = $('settings-msg');
    var navBtn = $('settings-open');
    var modeEl = $('settings-mode');
    var saveBtn = null;
    var ownOpen = false;   // the "use my own key" disclosure (shipped-key mode)
    var introEl = null, introOrig = '';
    var INTRO_SHIPPED = 'Optional: paste your own Google Maps API key and Tableau will use it instead of the shared one \u2014 your own Google quota, your own settings.';

    function refreshMode() {
      var has = !!store.getKey();
      var shipped = !!CONFIG_KEY && !configKeyDead;      // a site key is on offer
      var mine = !!store.getUserKey();
      if (navBtn) navBtn.classList.toggle('is-live', has);
      if (modeEl) {
        modeEl.textContent = !has
          ? (configKeyDead ? 'Live restaurants are unavailable right now — showing sample data.'
                           : 'Sample data is on — 18 hand-written places, no key needed.')
          : (mine && shipped ? 'Live data is on — using your own key.'
                             : 'Live data is on — results come from Google Places.');
        modeEl.className = 'settings-mode' + (has ? ' is-live' : '');
      }
      // shipped-key mode: say "live is on", never ask for a key up front,
      // and keep the own-key form behind a disclosure.
      var liveOn = $('settings-liveon'), tog = $('own-key-toggle'), body = $('own-key-body');
      var title = $('settings-title'), clr = $('key-clear');
      if (liveOn) liveOn.hidden = !(shipped && !mine);
      if (tog) tog.hidden = !(shipped && !mine);
      if (body) body.hidden = shipped && !mine && !ownOpen;
      if (tog) tog.setAttribute('aria-expanded', ownOpen ? 'true' : 'false');
      if (title) title.textContent = shipped ? 'Settings' : 'Use live data';
      if (clr) clr.textContent = shipped ? 'Remove my key' : 'Use sample data';
      var hint = $('key-clear-name'); if (hint) hint.textContent = clr ? clr.textContent.replace(/^./, function (c) { return c.toUpperCase(); }) : '';
      if (introEl) introEl.textContent = shipped ? INTRO_SHIPPED : introOrig;
      if (find && find.syncDemoNote) find.syncDemoNote();
    }

    function setMsg(text, kind) {
      if (!msg) return;
      msg.textContent = text || '';
      msg.className = 'settings-msg' + (kind ? ' is-' + kind : '');
    }
    function showError(text) {
      setMsg(text || liveErrorText('unknown'), 'error');
    }
    /* The whole app reports live failures by CODE, so every surface says the
       same sentence for the same failure — never one generic message. */
    function showCode(code) {
      setMsg(liveErrorText(code), code === 'reload' ? 'ok' : 'error');
    }
    function busy(on) {
      if (!saveBtn) return;
      saveBtn.disabled = !!on;
      saveBtn.textContent = on ? 'Checking with Google…' : 'Save & check key';
    }

    function open(where) {
      if (!backdrop) return;
      var mine = store.getUserKey();
      if (input) input.value = mine || '';
      setMsg(mine ? 'A key is saved on this device.' : '', mine ? 'ok' : '');
      refreshMode();
      var first = input;
      if (CONFIG_KEY && !configKeyDead && !mine && !ownOpen) first = $('own-key-toggle');
      var pn = $('privacy-note');
      if (where === 'privacy' && pn) first = pn;
      modal.open(backdrop, first);
      if (where === 'privacy' && pn) {
        window.setTimeout(function () { try { pn.scrollIntoView({ block: 'start' }); } catch (e) {} }, 40);
      }
    }
    function close() { modal.close(); }

    function init() {
      if (!backdrop) return;
      if (navBtn) navBtn.addEventListener('click', function () { open(); });
      introEl = backdrop.querySelector('.settings-intro');
      introOrig = introEl ? introEl.textContent : '';
      var ownTog = $('own-key-toggle');
      if (ownTog) ownTog.addEventListener('click', function () {
        ownOpen = !ownOpen;
        refreshMode();
        if (ownOpen && input) input.focus();
      });
      $('settings-close').addEventListener('click', close);
      backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });

      saveBtn = $('key-save');
      saveBtn.addEventListener('click', function () {
        var k = (input.value || '').trim();
        if (!k) { setMsg('Paste a key first.', 'error'); return; }
        // A string that cannot be a Google key never becomes a request.
        if (keyLooksWrong(k)) {
          showCode('shape');
          announce(liveErrorText('shape'));
          return;
        }
        if (!store.setKey(k)) {
          setMsg('Could not save — this browser is blocking storage.', 'error');
          return;
        }
        refreshMode();
        busy(true);
        setMsg('Checking this key with Google…', '');
        gmaps.validateKey(k, function (code) {
          busy(false);
          if (!code) {
            setMsg('Key accepted — live data is on.', 'ok');
            announce('Key accepted. Tableau is on live data.');
            refreshMode();
            find.hideLiveNote();
            window.setTimeout(close, 900);
            return;
          }
          // A key that cannot work as saved goes back out again, so the app
          // is never left half-live. Transient failures (quota, network,
          // needing a reload) keep the key — it is probably fine.
          var keep = (code === 'quota' || code === 'network' || code === 'reload');
          if (!keep) store.clearKey();
          setMsg(liveErrorText(code) + (keep ? '' : ' Tableau stays on sample data.'),
            code === 'reload' ? 'ok' : 'error');
          announce(liveShortText(code) + (keep ? '' : ' Staying on sample data.'));
          refreshMode();
        });
      });

      $('key-clear').addEventListener('click', function () {
        store.clearKey();
        if (input) input.value = '';
        var stillLive = !!store.getKey();   // the shipped key takes over
        setMsg(stillLive ? 'Your key has been removed — Tableau is using its shared live key.'
                         : 'Back on sample data — your key has been removed from this browser.', 'ok');
        announce(stillLive ? 'Your key has been removed. Live data stays on.'
                           : 'Sample data is on. Your key has been removed from this browser.');
        ownOpen = false;
        refreshMode();
        find.hideLiveNote();
        find.showLanding();
      });

      refreshMode();

      // If a key already exists, warm up the loader + autocomplete.
      if (store.getKey()) {
        gmaps.loadOnce(store.getKey());
        var locInput = $('loc-input');
        if (locInput) gmaps.attachAutocomplete(locInput);
      }
    }

    return { init: init, open: open, showError: showError, showCode: showCode, refreshMode: refreshMode };
  })();

  /* ================================================================== *
   * WELCOME — the first-run sheet (once per browser, localStorage flag)
   * Reuses the shared modal() choreography: focus moves in, Tab is
   * trapped, Escape / the close button / a backdrop tap dismiss it, focus
   * goes back. Says plainly what Tableau does, what it does with your
   * location, and whether results are live or samples.
   * ================================================================== */
  var welcome = (function () {
    var KEY_WELCOME = 'eats-welcomed';
    var seenMem = false;     // storage blocked -> still only once per page load
    var toSettings = false;
    var backdrop = null;

    function seen() {
      if (seenMem) return true;
      try { return localStorage.getItem(KEY_WELCOME) === '1'; } catch (e) { return false; }
    }
    function mark() {
      seenMem = true;
      try { localStorage.setItem(KEY_WELCOME, '1'); } catch (e) {}
    }

    function fill() {
      var live = liveMode();
      var loc = $('welcome-loc'), mode = $('welcome-mode');
      if (loc) loc.textContent = live
        ? 'It asks for your location only when you tap Find, and only to find places near you.'
        : 'It only asks for your location when live results are on \u2014 in demo mode it never does.';
      if (mode) {
        clear(mode);
        mode.className = 'welcome-mode ' + (live ? 'is-live' : 'is-demo');
        if (live) {
          mode.appendChild(el('strong', null, 'Live results are on.'));
          mode.appendChild(document.createTextNode(' Places come from Google, near you.'));
        } else {
          mode.appendChild(el('span', 'v-demo-tag', 'Sample'));
          mode.appendChild(document.createTextNode(' '));
          mode.appendChild(el('strong', null, 'Demo mode.'));
          mode.appendChild(document.createTextNode(' The places you\u2019ll see are samples, not real restaurants.'));
        }
      }
    }

    function closed() {
      mark();
      if (toSettings) { toSettings = false; return; }
      // nothing to hand focus back to on a fresh load: land it on Find
      var ae = document.activeElement;
      if (!ae || ae === document.body || (backdrop && backdrop.contains(ae))) {
        var cta = $('find-near-me');
        if (cta && cta.offsetParent !== null) cta.focus();
      }
    }

    function open() {
      if (!backdrop) return;
      fill();
      modal.open(backdrop, $('welcome-go'), closed);
    }

    function init() {
      backdrop = $('welcome-backdrop');
      if (!backdrop) return;
      $('welcome-go').addEventListener('click', function () { modal.close(); });
      $('welcome-close').addEventListener('click', function () { modal.close(); });
      backdrop.addEventListener('click', function (e) { if (e.target === backdrop) modal.close(); });
      $('welcome-privacy').addEventListener('click', function () {
        toSettings = true;
        settings.open('privacy');   // modal.open closes this sheet first
      });
    }

    function maybeShow() {
      init();
      if (!seen()) open();
    }

    return { maybeShow: maybeShow };
  })();

  /* ================================================================== *
   * BOOT
   * ================================================================== */
  function boot() {
    tabs.init();
    sheet.init();
    if (!BETA) feed.init();
    visited.init();
    if (!BETA) { friends.init(); popular.init(); }
    settings.init();
    find.init();
    offline.init();
    // places hearted in the Feed on an earlier visit go back on the shortlist
    deck.hydrateHearts();
    find.refreshLanding();
    // the Feed is the front door; in the beta there is no Feed, Find is
    tabs.activate(BETA ? 'find' : 'feed');
    welcome.maybeShow();

    // PWA: register the Tableau service worker (legacy filename
    // peckish-sw.js), scoped to '/eats' so it
    // never controls the rest of the portfolio. Network-first, so online
    // visitors always get fresh files; offline reopens keep demo mode alive.
    try {
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        // Update flow: when a NEW worker replaces the one controlling this
        // page, quietly mention it once. First-ever install also fires
        // controllerchange (clients.claim), so only speak when the page
        // was already controlled — and never reload, no loops.
        var hadController = !!navigator.serviceWorker.controller;
        var updateToasted = false;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          if (!hadController) { hadController = true; return; }
          if (updateToasted) return;
          updateToasted = true;
          toast('Tableau refreshed — new version ready');
        });
        navigator.serviceWorker.register('/peckish-sw.js', { scope: '/eats' }).catch(function () {
          /* registration is a progressive enhancement — never surface errors */
        });
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
