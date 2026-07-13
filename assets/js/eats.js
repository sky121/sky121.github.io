/* ==========================================================================
   eats.js — "Peckish" where-to-eat app.
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
     - popular      Popular-tab rendering (consumes social.* promises)
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

  /* Tiny haptic tap (Android Chrome etc.). Silent no-op where vibration is
     unsupported, and skipped under prefers-reduced-motion — a vibration is
     motion you can feel. Never throws. */
  function haptic(ms) {
    if (prefersReducedMotion) return;
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) { /* purely decorative — never break the flow */ }
  }

  /* Small transient toast (paper pill above the tab bar) — visual companion
     to announce(); screen readers get the live region, sighted users get this. */
  var toastTimer = null;
  function toast(msg) {
    try {
      var t = $('eats-toast');
      if (!t) {
        t = el('div', 'eats-toast');
        t.id = 'eats-toast';
        t.setAttribute('aria-hidden', 'true'); // announce() covers a11y
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.classList.remove('is-show');
      void t.offsetWidth; // restart the fade if a toast is already up
      t.classList.add('is-show');
      if (toastTimer) window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(function () {
        toastTimer = null;
        t.classList.remove('is-show');
      }, 1900);
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
    getKey: function () {
      try { return localStorage.getItem(KEY_GMAPS) || ''; } catch (e) { return ''; }
    },
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
    }
  };

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
    { name: 'Little Wren Bakery', rating: 4.8, reviews: 1340, price: 1, type: 'Bakery · Café', cuisines: ['cafe'], lat: 37.7959, lng: -122.3949, open: true, phone: '+14155550178',
      diet: ['vegetarian'], dining: ['dine-in', 'takeout'], extras: ['kids'],
      vibe: 'Sunlit corner café, marble counters, fresh flowers', food: 'Morning buns, laminated pastries, flat whites',
      reviews_q: [ { by: 'Maya O.', score: 96, text: 'The morning bun is a religious experience. Get there early.' }, { by: 'Devin P.', score: 90, text: 'Cozy, sunny, perfect for a slow Saturday.' } ] },
    { name: 'Tonkotsu Lane', rating: 4.7, reviews: 1582, price: 2, type: 'Ramen · Japanese', cuisines: ['japanese'], lat: 37.7948, lng: -122.3958, open: true, phone: '+14155550133',
      diet: [], dining: ['dine-in'], extras: ['alcohol'],
      vibe: 'Tiny steamy counter, paper lanterns, jazz on vinyl', food: 'Rich tonkotsu, chashu, soft egg, chili oil',
      reviews_q: [ { by: 'Hana S.', score: 94, text: 'Broth so silky it ruined other ramen for me.' }, { by: 'Leo C.', score: 88, text: 'Tiny room, worth the wait. The chashu melts.' }, { by: 'Priya R.', score: 90, text: 'Order the spicy miso. Trust me.' } ] },
    { name: 'Marigold & Sage', rating: 4.6, reviews: 812, price: 3, type: 'Californian · Farm-to-table', cuisines: ['american', 'mediterranean'], lat: 37.7929, lng: -122.3971, open: true, phone: '+14155550142',
      diet: ['vegetarian', 'gluten-free'], dining: ['dine-in'], extras: ['outdoor', 'alcohol'],
      vibe: 'Linen tablecloths, candlelight, garden patio', food: 'Heirloom tomato, roast chicken, market salads',
      reviews_q: [ { by: 'Theo B.', score: 92, text: 'Tasting menu was a quiet, beautiful treat.' }, { by: 'Maya O.', score: 89, text: 'Everything tastes like it was picked this morning.' } ] },
    { name: 'Casa Poblana', rating: 4.5, reviews: 967, price: 2, type: 'Mexican · Taquería', cuisines: ['mexican'], lat: 37.7901, lng: -122.4003, open: true, phone: '+14155550110',
      diet: ['vegetarian', 'gluten-free'], dining: ['dine-in', 'takeout', 'delivery'], extras: ['groups', 'alcohol', 'kids'],
      vibe: 'Bright tiles, mariachi murals, buzzy and loud', food: 'Al pastor tacos, fresh salsa, horchata',
      reviews_q: [ { by: 'Leo C.', score: 93, text: 'Al pastor for days. Bring cash, bring friends.' }, { by: 'Devin P.', score: 85, text: 'Lines out the door for a reason.' } ] },
    { name: 'Verde Trattoria', rating: 4.5, reviews: 1104, price: 3, type: 'Italian · Pasta', cuisines: ['italian'], lat: 37.7966, lng: -122.3902, open: true, phone: '+14155550121',
      diet: ['vegetarian'], dining: ['dine-in', 'takeout'], extras: ['alcohol'],
      vibe: 'Warm trattoria, exposed brick, cozy two-tops', food: 'Cacio e pepe, fresh pappardelle, tiramisu',
      reviews_q: [ { by: 'Hana S.', score: 91, text: 'Cacio e pepe done exactly right. Cozy little room.' }, { by: 'Theo B.', score: 87, text: 'The pasta is hand-rolled and it shows.' } ] },
    { name: 'Saffron House', rating: 4.6, reviews: 729, price: 2, type: 'Indian · Curry house', cuisines: ['indian'], lat: 37.7937, lng: -122.4012, open: true, phone: '+14155550188',
      diet: ['vegetarian', 'vegan', 'gluten-free'], dining: ['dine-in', 'takeout', 'delivery'], extras: ['groups', 'kids'],
      vibe: 'Jewel-tone walls, brass lanterns, fragrant air', food: 'Butter chicken, garlic naan, dal makhani',
      reviews_q: [ { by: 'Priya R.', score: 90, text: 'Butter chicken was rich; staff were lovely.' }, { by: 'Maya O.', score: 88, text: 'Best dal in the city, and lots of vegan options.' } ] },
    { name: 'Foggy Bell Coffee', rating: 4.4, reviews: 455, price: 1, type: 'Coffee · Light bites', cuisines: ['cafe'], lat: 37.7972, lng: -122.3985, open: true, phone: '+14155550144',
      diet: ['vegetarian', 'vegan'], dining: ['takeout', 'dine-in'], extras: ['outdoor'],
      vibe: 'Minimalist, big windows, foggy-day calm', food: 'Single-origin pour-overs, oat lattes, scones',
      reviews_q: [ { by: 'Devin P.', score: 86, text: 'Flat white + a window seat. My new spot.' }, { by: 'Leo C.', score: 82, text: 'Quiet enough to actually get work done.' } ] },
    { name: 'Olive & Thyme', rating: 4.3, reviews: 388, price: 3, type: 'Mediterranean', cuisines: ['mediterranean'], lat: 37.7918, lng: -122.3949, open: true, phone: '+14155550155',
      diet: ['vegetarian', 'vegan', 'gluten-free'], dining: ['dine-in', 'takeout'], extras: ['outdoor', 'groups', 'alcohol'],
      vibe: 'Whitewashed walls, olive branches, sea-blue tile', food: 'Mezze platters, lamb kebab, lemony hummus',
      reviews_q: [ { by: 'Theo B.', score: 86, text: 'The mezze spread is a feast for two.' }, { by: 'Priya R.', score: 84, text: 'Great for a group with mixed diets.' } ] },
    { name: 'The Copper Kettle', rating: 4.2, reviews: 642, price: 2, type: 'Brunch · American', cuisines: ['american'], lat: 37.7983, lng: -122.3962, open: false, phone: '+14155550166',
      diet: ['vegetarian'], dining: ['dine-in'], extras: ['groups', 'kids'],
      vibe: 'Copper pots, checkered floor, weekend bustle', food: 'Buttermilk pancakes, hash, bottomless coffee',
      reviews_q: [ { by: 'Hana S.', score: 83, text: 'Classic diner energy and giant pancakes.' }, { by: 'Maya O.', score: 80, text: 'Go on a weekday to skip the wait.' } ] },
    { name: 'Pier 9 Oyster Co.', rating: 4.4, reviews: 521, price: 4, type: 'Seafood · Raw bar', cuisines: ['seafood'], lat: 37.7995, lng: -122.3915, open: false, phone: '+14155550199',
      diet: ['gluten-free'], dining: ['dine-in'], extras: ['outdoor', 'alcohol'],
      vibe: 'Waterfront deck, string lights, sunset views', food: 'Oysters, cioppino, grilled day-boat fish',
      reviews_q: [ { by: 'Leo C.', score: 88, text: 'Sunset on the patio is unbeatable.' }, { by: 'Devin P.', score: 78, text: 'Pricey and service lagged, but the view…' } ] },
    { name: 'Smoke & Ember BBQ', rating: 4.6, reviews: 980, price: 2, type: 'BBQ · Smokehouse', cuisines: ['bbq', 'american'], lat: 37.7912, lng: -122.3886, open: true, phone: '+14155550201',
      diet: [], dining: ['dine-in', 'takeout'], extras: ['outdoor', 'groups', 'alcohol'],
      vibe: 'Reclaimed wood, smoke in the air, picnic tables', food: 'Brisket, burnt ends, smoked ribs, slaw',
      reviews_q: [ { by: 'Theo B.', score: 92, text: 'The brisket falls apart. Come hungry.' }, { by: 'Hana S.', score: 87, text: 'Burnt ends sell out by 2pm. Get there early.' } ] },
    { name: 'Seoul & Stone', rating: 4.5, reviews: 712, price: 2, type: 'Korean · BBQ', cuisines: ['korean'], lat: 37.8002, lng: -122.4001, open: true, phone: '+14155550213',
      diet: ['vegetarian'], dining: ['dine-in'], extras: ['groups', 'alcohol'],
      vibe: 'Tabletop grills, neon glow, lively groups', food: 'Galbi, bibimbap, bubbling kimchi jjigae',
      reviews_q: [ { by: 'Priya R.', score: 90, text: 'Tabletop grill is so fun for a group.' }, { by: 'Maya O.', score: 85, text: 'The banchan alone is worth coming for.' } ] },
    { name: 'Pho & Lantern', rating: 4.4, reviews: 533, price: 1, type: 'Vietnamese · Noodles', cuisines: ['vietnamese'], lat: 37.7886, lng: -122.3961, open: true, phone: '+14155550224',
      diet: ['vegetarian', 'vegan', 'gluten-free'], dining: ['dine-in', 'takeout', 'delivery'], extras: ['kids'],
      vibe: 'Steamy storefront, herbs on every table', food: 'Beef pho, fresh rolls, lemongrass tofu',
      reviews_q: [ { by: 'Devin P.', score: 88, text: 'Broth simmered all day — you can taste it.' }, { by: 'Leo C.', score: 84, text: 'Cheap, fast, and deeply comforting.' } ] },
    { name: 'Bangkok Orchid', rating: 4.5, reviews: 604, price: 2, type: 'Thai · Street food', cuisines: ['thai'], lat: 37.8021, lng: -122.3958, open: true, phone: '+14155550235',
      diet: ['vegetarian', 'vegan'], dining: ['dine-in', 'takeout', 'delivery'], extras: ['groups'],
      vibe: 'Orchids, gold accents, gentle chimes', food: 'Pad see ew, green curry, mango sticky rice',
      reviews_q: [ { by: 'Hana S.', score: 89, text: 'Green curry with real heat — finally.' }, { by: 'Priya R.', score: 86, text: 'Mango sticky rice is the perfect finish.' } ] },
    { name: 'The Stacked Patty', rating: 4.3, reviews: 1190, price: 1, type: 'Burgers · American', cuisines: ['burgers', 'american'], lat: 37.7869, lng: -122.3922, open: true, phone: '+14155550246',
      diet: ['vegetarian'], dining: ['dine-in', 'takeout', 'delivery'], extras: ['groups', 'kids'],
      vibe: 'Retro diner booths, chrome, milkshake machines', food: 'Smash burgers, crispy fries, thick shakes',
      reviews_q: [ { by: 'Theo B.', score: 87, text: 'Smash burger with the crispy edges. Yes.' }, { by: 'Maya O.', score: 82, text: 'Killer veggie burger too, not an afterthought.' } ] },
    { name: 'Crosta Pizzeria', rating: 4.6, reviews: 1420, price: 2, type: 'Pizza · Neapolitan', cuisines: ['pizza', 'italian'], lat: 37.7849, lng: -122.4005, open: true, phone: '+14155550257',
      diet: ['vegetarian'], dining: ['dine-in', 'takeout', 'delivery'], extras: ['groups', 'alcohol', 'kids'],
      vibe: 'Wood-fired oven glow, communal tables', food: 'Blistered margherita, burrata, charred crust',
      reviews_q: [ { by: 'Leo C.', score: 91, text: 'Leopard-spotted crust, perfect char.' }, { by: 'Devin P.', score: 88, text: 'The margherita is all you need.' } ] },
    { name: 'Garden & Grain', rating: 4.4, reviews: 410, price: 2, type: 'Vegetarian · Bowls', cuisines: ['vegetarian', 'mediterranean'], lat: 37.8035, lng: -122.3902, open: true, phone: '+14155550268',
      diet: ['vegetarian', 'vegan', 'gluten-free'], dining: ['dine-in', 'takeout', 'delivery'], extras: ['outdoor', 'kids'],
      vibe: 'Leafy, airy, reclaimed-wood and plants', food: 'Grain bowls, roasted veg, tahini everything',
      reviews_q: [ { by: 'Priya R.', score: 89, text: 'Finally a veg spot that feels indulgent.' }, { by: 'Hana S.', score: 85, text: 'Everything is vegan and you would not guess.' } ] },
    { name: 'Lupo Rosso', rating: 4.7, reviews: 860, price: 3, type: 'Italian · Wine bar', cuisines: ['italian'], lat: 37.7831, lng: -122.3948, open: false, phone: '+14155550279',
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

  function panelArt(r, segKey) {
    var pal = CUISINE_ART[(r.cuisines || [])[0]] || ['#a292c4', '#7fa8c9', '#e8dfc9'];
    var h = hashStr((r.name || r.id || '') + segKey);
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

  // Pre-built demo result objects (with distance to DEMO_ORIGIN).
  function demoResults() {
    return DEMO_RESTAURANTS.map(function (r, i) {
      return {
        id: 'demo-' + i,
        name: r.name,
        rating: r.rating,
        reviews: r.reviews,
        price: r.price,
        type: r.type,
        cuisines: r.cuisines || [],
        diet: r.diet || [],
        dining: r.dining || [],
        extras: r.extras || [], // live results leave this undefined (not fetched)
        open: r.open,
        phone: r.phone,
        photoUrl: null, // watercolor placeholder
        // story segments — demo content (live mode fills from Place details)
        segments: {
          vibe: { kind: 'vibe', glyph: DEMO_VIBE_GLYPH, caption: r.vibe || '' },
          food: { kind: 'food', glyph: DEMO_FOOD_GLYPH, caption: r.food || '' },
          reviews: { kind: 'reviews', quotes: (r.reviews_q || []).slice(0, 3) }
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
      { name: 'find', tab: $('tab-find'), panel: $('panel-find'), onShow: null },
      { name: 'visited', tab: $('tab-visited'), panel: $('panel-visited'), onShow: function () { visited.render(); } },
      { name: 'friends', tab: $('tab-friends'), panel: $('panel-friends'), onShow: function () { friends.render(); } },
      { name: 'popular', tab: $('tab-popular'), panel: $('panel-popular'), onShow: function () { popular.render(); } }
    ].filter(function (d) { return d.tab && d.panel; });

    var tabEls = defs.map(function (d) { return d.tab; });

    function activate(which, focus) {
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
        }
      });
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

    /* Hide the shared page header (eyebrow + "Peckish" wordmark) whenever the
       calm Find landing is the thing on screen. Other screens keep it. */
    function syncHeaderChrome() {
      var room = $('room');
      if (!room) return;
      var findTab = $('tab-find');
      var findActive = findTab ? findTab.getAttribute('aria-selected') === 'true' : true;
      var landingOn = findActive && landingEl && !landingEl.hidden;
      room.classList.toggle('find-landing-on', !!landingOn);
    }

    /* When true, the next batch of results goes to the Surprise-me roulette
       instead of the swipe deck ("Surprise me" on the Preferences screen). */
    var surprisePending = false;

    /* ---- Screen switching ---- */
    function hideAll() {
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
      deck.showLoading();

      if (store.getKey()) {
        resolveOriginLive(function (origin, label) {
          if (label) state.originLabel = label;
          state.origin = origin;
          setOriginText($('deck-origin'));
          gmaps.searchNearby(origin, function (err, list, more) {
            if (err) {
              settings.showError(err);
              loadDemoInto(origin);
              return;
            }
            state.nextPage = more || null;
            state.hasMore = !!more;
            deliver(list, origin);
          });
        });
      } else {
        // DEMO MODE — instant.
        state.originLabel = state.originLabel || 'near you';
        loadDemoInto(state.origin || DEMO_ORIGIN);
      }
    }

    /* Live: figure out the search origin (typed location, or geolocation). */
    function resolveOriginLive(cb) {
      if (state.origin && state.originLabel && state.originLabel !== 'near you') {
        cb(state.origin, state.originLabel);
        return;
      }
      if (!navigator.geolocation) { cb(DEMO_ORIGIN, 'near you'); return; }
      navigator.geolocation.getCurrentPosition(
        function (pos) { cb({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 'near you'); },
        function () { cb(DEMO_ORIGIN, 'near you'); },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      );
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
      else deck.load(ordered);
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

    /* Live "Search farther": next page -> append -> re-filter -> deck. */
    function searchFarther(cb) {
      if (!store.getKey() || !state.hasMore || state.loadingMore) { if (cb) cb([]); return; }
      state.loadingMore = true;
      if (state.nextPage && typeof state.nextPage.fetch === 'function') {
        state.nextPage.fetch(function (err, list, more) {
          state.loadingMore = false;
          if (err) { settings.showError(err); state.hasMore = false; if (cb) cb([]); return; }
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
    function hasFarther() { return !!(store.getKey() && state.hasMore); }

    /* --- Watercolor bubble POP, then go to Preferences --- */
    var popping = false;
    function popAndStart() {
      if (popping) return;
      var orb = $('find-near-me');
      if (!orb || prefersReducedMotion) { showPrefs(true); return; }
      popping = true;

      var rect = orb.getBoundingClientRect();
      var layer = el('div', 'orb-burst');
      layer.style.left = (rect.left + rect.width / 2) + 'px';
      layer.style.top = (rect.top + rect.height / 2) + 'px';

      var palette = ['var(--rose)', 'var(--wisteria)', 'var(--sage)', 'var(--gold)', 'var(--pond)'];
      var DROPS = 14;
      var base = Math.min(rect.width, rect.height);
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
      orb.classList.add('is-popping');

      window.setTimeout(function () {
        if (layer.parentNode) layer.parentNode.removeChild(layer);
        orb.classList.remove('is-popping');
        popping = false;
        showPrefs(true);
      }, 480);
    }

    function init() {
      var orb = $('find-near-me');
      if (orb) orb.addEventListener('click', popAndStart);

      var prefsBack = $('prefs-back');
      if (prefsBack) prefsBack.addEventListener('click', showLanding);
      var deckBack = $('deck-back');
      if (deckBack) deckBack.addEventListener('click', function () { showPrefs(false); });

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
          state.originLabel = q;
          if (store.getKey()) {
            gmaps.geocode(q, function (err, origin) {
              if (err || !origin) { settings.showError(err || 'Could not find that place.'); return; }
              state.origin = origin;
              showPrefs(true);
            });
          } else {
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
      showSurprise: showSurprise,
      syncHeaderChrome: syncHeaderChrome,
      startSearch: startSearch,
      searchFarther: searchFarther,
      hasFarther: hasFarther,
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
      // Live preview against the demo catalog (instant, no network) so the
      // user sees prefs bite immediately. Live mode filters real results too.
      state.prefs = cur;
      state.distanceCap = (cur.distance === 'walk') ? 1.2 : (cur.distance === 'drive' ? 5 : null);
      var pool = demoResults();
      var n = find.filterByPrefs(pool).length;
      countEl.textContent = n + ' sample place' + (n === 1 ? '' : 's') + ' match';
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
      var skip = $('prefs-skip');
      if (skip) skip.addEventListener('click', function () {
        cur = defaults(); persist(); render(); find.showDeck();
      });
      var surprise = $('prefs-surprise');
      if (surprise) surprise.addEventListener('click', function () {
        current(); persist(); find.showSurprise();
      });
      var openTgl = $('pref-open');
      if (openTgl) openTgl.addEventListener('change', function () {
        cur.openNow = openTgl.checked; persist(); updateCount();
      });
    }

    return { init: init, render: render, current: current, defaults: defaults };
  })();

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
    var topCard = null;
    var animating = false;
    var keyHandler = null;
    var history = [];   // swipes this deck: {i, id, dir} — fuels Undo
    var shortlist = []; // liked-and-saved places for this outing

    var SEGMENTS = ['vibe', 'food', 'reviews'];
    var SEG_LABEL = { vibe: 'Vibe', food: 'Food', reviews: 'Reviews' };

    function setMode(mode) {
      var onDeck = mode === 'deck';
      if (deckEl) deckEl.style.display = onDeck ? '' : 'none';
      if (hintEl) hintEl.style.display = onDeck ? '' : 'none';
      if (controlsEl) controlsEl.style.display = onDeck ? '' : 'none';
      if (decisionEl) decisionEl.hidden = mode !== 'decision';
      if (endEl) endEl.hidden = mode !== 'end';
      if (shortlistEl) shortlistEl.hidden = mode !== 'shortlist';
      if (rouletteEl) rouletteEl.hidden = mode !== 'roulette';
    }

    function showLoading() {
      clearRoulette();
      setMode('deck');
      clear(deckEl);
      var l = el('div', 'deck-loading');
      l.appendChild(el('span', 'social-spinner', ''));
      l.appendChild(el('span', null, 'Finding places near you…'));
      deckEl.appendChild(l);
      setControlsEnabled(false);
    }

    function setControlsEnabled(on) {
      [btnNo, btnYes, btnInfo].forEach(function (b) { if (b) b.disabled = !on; });
    }

    function load(matched) {
      clearRoulette();
      queue = matched || [];
      idx = 0;
      history = [];
      updateUndo();
      clear(deckEl);
      setMode('deck');
      if (!queue.length) { showEnd(true); return; }
      renderStack(true); // deal the opening hand onto the table
      setControlsEnabled(true);
      announce(queue.length + ' places matched. Showing ' + queue[0].name + ', the nearest.');
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
        if (deal) {
          card.classList.add('is-dealing');
          // bottom of the stack lands first, top card last
          card.style.animationDelay = ((2 - d) * 95) + 'ms';
          card.addEventListener('animationend', onDealEnd);
        }
        deckEl.appendChild(card);
      }
      topCard = deckEl.querySelector('.swipe-card[data-depth="0"]');
      if (topCard) prefetchUpcoming();
    }

    function onDealEnd(e) {
      var c = e.currentTarget;
      c.classList.remove('is-dealing');
      c.style.animationDelay = '';
      c.removeEventListener('animationend', onDealEnd);
    }

    function buildCard(r, depth) {
      var card = el('article', 'swipe-card');
      card.dataset.depth = depth === 0 ? '0' : (depth === 1 ? '1' : '2');
      card.dataset.id = r.id;
      card.tabIndex = depth === 0 ? 0 : -1;
      card.setAttribute('role', 'group');
      card.setAttribute('aria-roledescription', 'restaurant card');
      card._seg = 0;
      card._data = r;

      var media = el('div', 'card-media');
      SEGMENTS.forEach(function (segKey, si) {
        var panel = el('div', 'card-seg-panel seg-' + segKey + (si === 0 ? ' is-active' : ''));
        if (segKey === 'reviews') {
          var rv = el('div', 'card-reviews');
          var quotes = (r.segments && r.segments.reviews && r.segments.reviews.quotes) || [];
          if (quotes.length) {
            quotes.forEach(function (q) {
              var box = el('div', 'card-review');
              box.appendChild(el('p', 'card-review-text', '“' + q.text + '”'));
              var by = el('p', 'card-review-by');
              by.appendChild(el('span', 'card-review-score', '★ ' + fmtScore(q.score)));
              by.appendChild(document.createTextNode(' · ' + q.by));
              box.appendChild(by);
              rv.appendChild(box);
            });
          } else {
            var note = el('div', 'card-review');
            note.appendChild(el('p', 'card-review-text', 'No reviews to show yet.'));
            rv.appendChild(note);
          }
          panel.appendChild(rv);
        } else {
          var seg = r.segments && r.segments[segKey];
          if (seg && seg.photoUrl) {
            // live mode: real Place photo for this segment
            panel.style.backgroundImage = 'url("' + String(seg.photoUrl).replace(/"/g, '') + '")';
            panel.style.backgroundSize = 'cover';
            panel.style.backgroundPosition = 'center';
          } else {
            // no photo: procedural watercolor composition keyed to the cuisine
            panel.style.background = panelArt(r, segKey);
          }
          panel.appendChild(el('span', 'card-seg-kind', SEG_LABEL[segKey]));
        }
        media.appendChild(panel);
      });
      card.appendChild(media);
      card.appendChild(el('div', 'card-scrim'));

      var bars = el('div', 'seg-bars');
      SEGMENTS.forEach(function (s, si) {
        bars.appendChild(el('span', 'seg-bar' + (si === 0 ? ' is-on' : '')));
      });
      card.appendChild(bars);

      // three-at-once: mini previews of the two non-hero segments;
      // a single tap rotates all three (hero -> peek, next peek -> hero)
      var peeks = el('div', 'card-peeks');
      peeks.setAttribute('aria-hidden', 'true');
      peeks.appendChild(el('div', 'peek'));
      peeks.appendChild(el('div', 'peek'));
      card.appendChild(peeks);
      card._peeks = peeks;
      updatePeeks(card);

      var yes = el('div', 'stamp stamp-yes', 'Yes');
      var no = el('div', 'stamp stamp-no', 'Nope');
      yes.setAttribute('aria-hidden', 'true');
      no.setAttribute('aria-hidden', 'true');
      card.appendChild(yes);
      card.appendChild(no);

      var ov = el('div', 'card-overlay');
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
      if (r.open != null) {
        meta.appendChild(el('span', 'ov-badge' + (r.open ? '' : ' is-closed'), r.open ? 'Open now' : 'Closed'));
      }
      ov.appendChild(meta);
      // your own Visited score, if you've eaten here before
      var mine = myRatingFor(r.name);
      if (mine) {
        var you = el('span', 'ov-you', 'You rated this ' + fmtScore(overallOf(mine)));
        ov.appendChild(you);
      }
      var tagLine = el('p', 'ov-tags');
      tagLine.textContent = (r.segments && r.segments.vibe && r.segments.vibe.caption) || '';
      ov.appendChild(tagLine);
      card._tagLine = tagLine;
      card.appendChild(ov);

      card.setAttribute('aria-label', a11ySummary(r));

      if (depth === 0) attachDrag(card);
      return card;
    }

    function a11ySummary(r) {
      var bits = [r.name];
      if (r.rating) bits.push(fmtScore(r.rating * 20) + ' out of 100');
      if (r.reviews) bits.push(r.reviews.toLocaleString() + ' reviews');
      if (r.price) bits.push('price ' + priceStr(r.price));
      if (r.type) bits.push(r.type);
      if (r.distance != null) {
        bits.push(fmtDist(r.distance) + ' away');
        bits.push('about ' + fmtTravel(r.distance));
      }
      if (r.open != null) bits.push(r.open ? 'open now' : 'closed');
      var mine = myRatingFor(r.name);
      if (mine) bits.push('you rated it ' + fmtScore(overallOf(mine)) + ' before');
      return bits.join(', ');
    }

    function cycleSegment(card) {
      if (!card) return;
      card._seg = (card._seg + 1) % SEGMENTS.length;
      applySegment(card);
    }

    /* fill one mini preview tile with a compact rendering of a segment */
    function peekContent(node, r, segKey) {
      clear(node);
      node.className = 'peek peek-' + segKey;
      var seg = r.segments && r.segments[segKey];
      if (segKey === 'reviews') {
        node.style.background = '';
        var q = seg && seg.quotes && seg.quotes[0];
        node.appendChild(el('span', 'peek-quote', q ? '“' + q.text + '”' : 'What people say'));
      } else if (seg && seg.photoUrl) {
        node.style.background = 'url("' + String(seg.photoUrl).replace(/"/g, '') + '") center / cover';
      } else {
        node.style.background = panelArt(r, segKey);
      }
      node.appendChild(el('span', 'peek-label', SEG_LABEL[segKey]));
    }

    /* the two peeks always show whatever the hero is not */
    function updatePeeks(card) {
      if (!card._peeks) return;
      var r = card._data;
      var tiles = card._peeks.children;
      for (var i = 0; i < 2; i++) {
        var segKey = SEGMENTS[(card._seg + 1 + i) % SEGMENTS.length];
        peekContent(tiles[i], r, segKey);
        if (!prefersReducedMotion) {
          tiles[i].classList.remove('is-in');
          void tiles[i].offsetWidth;
          tiles[i].classList.add('is-in');
        }
      }
    }
    function applySegment(card) {
      var panels = card.querySelectorAll('.card-seg-panel');
      var bars = card.querySelectorAll('.seg-bar');
      SEGMENTS.forEach(function (s, i) {
        if (panels[i]) panels[i].classList.toggle('is-active', i === card._seg);
        if (bars[i]) {
          bars[i].classList.toggle('is-on', i === card._seg);
          bars[i].classList.toggle('is-done', i < card._seg); // earlier chapters stay filled
        }
      });
      var r = card._data;
      var segKey = SEGMENTS[card._seg];
      var caption = '';
      if (segKey === 'vibe') caption = (r.segments && r.segments.vibe && r.segments.vibe.caption) || '';
      else if (segKey === 'food') caption = (r.segments && r.segments.food && r.segments.food.caption) || '';
      else caption = 'What people are saying';
      if (card._tagLine) card._tagLine.textContent = caption;
      updatePeeks(card);
      announce(SEG_LABEL[segKey] + ' featured: ' + (caption || r.name));
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
      setMode('deck');
      renderStack();
      setControlsEnabled(true);
      var r = queue[idx];
      announce('Brought back ' + (r ? r.name : 'the last place') + '.');
      if (topCard) topCard.focus();
    }

    function advance() {
      idx++;
      if (idx >= queue.length) { showEnd(false); return; }
      renderStack();
      setControlsEnabled(true);
      if (topCard) topCard.focus();
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
        actionsEl.appendChild(buildShareAction(r, metaLine, mapsHref));
        var rate = el('button', 'decision-act', 'I ate here → Rate');
        rate.type = 'button';
        rate.addEventListener('click', function () {
          sheet.openForPlace({ name: r.name, placeId: r.placeId || null, loc: r.location || null, address: r.type || '' });
        });
        actionsEl.appendChild(rate);

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
      announce('Tonight: ' + r.name);
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
    function addToShortlist(r) {
      if (!r || shortlist.some(function (s) { return s.id === r.id; })) return;
      shortlist.push(r);
      updateBadge();
      announce(r.name + ' saved to your shortlist. ' + shortlist.length + ' place' + (shortlist.length === 1 ? '' : 's') + ' saved.');
    }

    function removeFromShortlist(id) {
      shortlist = shortlist.filter(function (s) { return s.id !== id; });
      updateBadge();
    }

    function updateBadge() {
      if (!badgeEl) return;
      badgeEl.hidden = !shortlist.length;
      var n = badgeEl.querySelector('.shortlist-count');
      if (n) n.textContent = String(shortlist.length);
    }

    function backFromShortlist() {
      if (idx < queue.length) { setMode('deck'); setControlsEnabled(true); if (topCard) topCard.focus(); }
      else showEnd(false);
    }

    function renderShortlist() {
      var listEl = shortlistEl && shortlistEl.querySelector('.shortlist-list');
      if (!listEl) return;
      clear(listEl);
      if (!shortlist.length) { backFromShortlist(); return; }
      shortlist.forEach(function (r) {
        var row = el('div', 'sl-item');
        var body = el('div', 'sl-body');
        body.appendChild(el('h3', 'sl-name', r.name));
        var bits = [];
        if (r.rating) bits.push('★ ' + fmtScore(r.rating * 20));
        if (r.price) bits.push(priceStr(r.price));
        if (r.type) bits.push(r.type);
        if (r.distance != null) {
          bits.push(fmtDist(r.distance));
          bits.push(fmtTravel(r.distance));
        }
        body.appendChild(el('p', 'sl-meta', bits.join('  ·  ')));
        row.appendChild(body);
        var acts = el('div', 'sl-acts');
        var pick = el('button', 'sl-pick', 'Tonight');
        pick.type = 'button';
        pick.addEventListener('click', function () { onLike(r); });
        acts.appendChild(pick);
        var rm = el('button', 'sl-remove', '×');
        rm.type = 'button';
        rm.setAttribute('aria-label', 'Remove ' + r.name + ' from shortlist');
        rm.addEventListener('click', function () {
          removeFromShortlist(r.id);
          announce(r.name + ' removed from shortlist.');
          renderShortlist();
        });
        acts.appendChild(rm);
        row.appendChild(acts);
        listEl.appendChild(row);
      });
    }

    function showShortlist() {
      if (!shortlist.length) return;
      setMode('shortlist');
      renderShortlist();
      var t = shortlistEl && shortlistEl.querySelector('.shortlist-title');
      if (t) { t.setAttribute('tabindex', '-1'); t.focus(); }
    }

    function showEnd(emptyFromStart) {
      setMode('end');
      var title = $('deck-end-title');
      var sub = $('deck-end-sub');
      if (emptyFromStart) {
        if (title) title.textContent = 'Nothing matched those filters';
        if (sub) sub.textContent = 'Try widening your preferences or searching farther.';
      } else if (shortlist.length) {
        if (title) title.textContent = 'Down to your shortlist';
        if (sub) sub.textContent = 'You’ve seen everything nearby — ' + shortlist.length +
          ' place' + (shortlist.length === 1 ? ' is' : 's are') + ' waiting on your shortlist.';
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
      clear(deckEl);
      queue = []; idx = 0; topCard = null; animating = false;
      history = []; shortlist = [];
      updateUndo(); updateBadge();
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
          if (more && more.length) { setMode('deck'); append(more); }
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

    return { init: init, load: load, append: append, showLoading: showLoading, teardown: teardown, surprise: surprise };
  })();

  /* paint a wc-range fill % (shared) */
  function paintRange(input) {
    if (!input) return;
    var min = parseFloat(input.min), max = parseFloat(input.max), v = parseFloat(input.value);
    var pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', pct.toFixed(1) + '%');
  }

  /* ================================================================== *
   * GMAPS — lazy Google Maps + Places
   *
   * Loaded ONLY when a key exists, via the documented async bootstrap
   * loader (loading=async).
   *
   * NEAREST-FIRST, EXHAUSTIVE OUTWARD SEARCH:
   *   We use the legacy PlacesService.nearbySearch with
   *   rankBy = google.maps.places.RankBy.DISTANCE. Unlike the newer
   *   Place.searchNearby (which caps at 20 results, can't paginate, and
   *   has no true distance ranking), the legacy nearbySearch returns
   *   results ordered NEAREST FIRST and exposes pagination via the
   *   PlaceSearchPagination object (`pagination.hasNextPage` +
   *   `pagination.nextPage()`), yielding up to ~60 places that fan
   *   outward from the origin. That is exactly the "nearest-first,
   *   extend outward exhaustively" behaviour we want, so we prefer it.
   *
   *   Note: with rankBy=DISTANCE you must NOT pass a radius, and you must
   *   pass either `keyword`, `type`, or `name` (we pass type:'restaurant').
   *
   * searchNearby(origin, done) -> done(err, list, more)
   *   `more` is null when there are no further pages, otherwise an object
   *   { fetch: function(cb){...} } that loads the next page and itself
   *   calls cb(err, list, more) — letting find.loadMore() keep going
   *   outward until exhausted.
   *
   * NOTE: live calls cannot be exercised without a key + network; this
   * code is written to the documented API and commented.
   * ================================================================== */
  var gmaps = (function () {
    var readyCbs = [];

    // The async bootstrap loader (adapted from Google's documented snippet).
    // Exposes window.__eatsMapsReady as the loader callback.
    function loadOnce(key) {
      if (state.mapsLoaded || state.mapsLoading) return;
      if (!key) return; // never load without a key (avoids console errors)
      state.mapsLoading = true;

      window.__eatsMapsReady = function () {
        // Maps base is ready; the libraries are imported on demand below.
        state.mapsLoaded = true;
        state.mapsLoading = false;
        var cbs = readyCbs.slice(); readyCbs.length = 0;
        cbs.forEach(function (cb) { cb(); });
      };

      // Catch auth failures (invalid key / referrer / over-quota).
      window.gm_authFailure = function () {
        state.mapsLoading = false;
        settings.showError('Your Google Maps key was rejected (invalid, wrong referrer, or over quota).');
        settings.open();
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
          settings.showError('Could not load Google Maps (network or key issue).');
        };
        document.head.appendChild(s);
      } catch (e) {
        state.mapsLoading = false;
        settings.showError('Could not start the Google Maps loader.');
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

    /* searchNearby — legacy PlacesService.nearbySearch, rankBy DISTANCE.
       Returns nearest-first results + a pagination handle for "load more". */
    function searchNearby(origin, done) {
      whenReady(function () {
        runSearch(origin, done);
      });
      // if loading silently fails, the auth/onerror handlers report it.
    }

    function runSearch(origin, done) {
      try {
        google.maps.importLibrary('places').then(function (places) {
          var service = getService(places);
          var RankBy = places.RankBy;

          var request = {
            location: { lat: origin.lat, lng: origin.lng },
            // rankBy DISTANCE => nearest-first, and NO radius allowed.
            rankBy: RankBy ? RankBy.DISTANCE : undefined,
            // rankBy=DISTANCE requires keyword/name/type; food places.
            type: 'restaurant'
          };

          service.nearbySearch(request, function (results, status, pagination) {
            handlePage(origin, results, status, pagination, done);
          });
        }).catch(function (e) {
          done(humanizeError(e), null);
        });
      } catch (e) {
        done(humanizeError(e), null);
      }
    }

    // Shared handler for the first page and every subsequent page.
    function handlePage(origin, results, status, pagination, done) {
      var P = google.maps.places;
      if (status !== P.PlacesServiceStatus.OK && status !== P.PlacesServiceStatus.ZERO_RESULTS) {
        done(humanizeStatus(status), null);
        return;
      }
      var list = (results || []).map(function (p) { return mapPlace(p, origin); });
      // already nearest-first from the API, but enforce it defensively.
      list.sort(function (a, b) {
        if (a.distance == null) return 1;
        if (b.distance == null) return -1;
        return a.distance - b.distance;
      });

      // Build an outward-expanding "more" handle if another page exists.
      // pagination.nextPage() re-invokes the SAME nearbySearch callback
      // (handlePage) with the next page of farther-out results, so we
      // route that next page to the caller's cb via a one-shot.
      var more = null;
      if (pagination && pagination.hasNextPage) {
        more = {
          fetch: function (cb) {
            pendingMoreCb = cb;
            pagination.nextPage();
          }
        };
      }
      // Deliver this page.
      if (pendingMoreCb) {
        var cb = pendingMoreCb; pendingMoreCb = null;
        cb(null, list, more);
      } else {
        done(null, list, more);
      }
    }
    // One-shot callback used to route paginated pages back to find.loadMore.
    var pendingMoreCb = null;

    // Map a legacy PlaceResult to our internal result shape.
    function mapPlace(p, origin) {
      var loc = null;
      try {
        if (p.geometry && p.geometry.location) {
          loc = { lat: p.geometry.location.lat(), lng: p.geometry.location.lng() };
        }
      } catch (e) {}
      var photoUrl = null;
      try {
        if (p.photos && p.photos.length && typeof p.photos[0].getUrl === 'function') {
          photoUrl = p.photos[0].getUrl({ maxWidth: 640, maxHeight: 360 });
        }
      } catch (e) {}
      var openState = null;
      try {
        // opening_hours.isOpen() is deprecated but still the simplest signal
        // available on a nearbySearch result without an extra Details call.
        if (p.opening_hours && typeof p.opening_hours.isOpen === 'function') {
          openState = p.opening_hours.isOpen();
        } else if (p.opening_hours && typeof p.opening_hours.open_now === 'boolean') {
          openState = p.opening_hours.open_now;
        }
      } catch (e) {}
      return {
        id: p.place_id,
        placeId: p.place_id,
        name: p.name || 'Unnamed place',
        rating: p.rating || 0,
        reviews: p.user_ratings_total || 0,
        price: (typeof p.price_level === 'number' && p.price_level > 0) ? p.price_level : 0,
        type: typeArr(p.types),
        // Map Google `types` to our Preferences cuisine keys so prefs filter live results.
        cuisines: cuisineKeys(p.types),
        diet: [],     // Places doesn't expose dietary flags; left empty (no false filtering)
        dining: [],   // Places doesn't expose dine-in/takeout/delivery reliably on nearbySearch
        open: openState,
        phone: null, // not returned by nearbySearch; the Details call (fetchDetails) adds it
        photoUrl: photoUrl,
        // story segments — populated lazily by fetchDetails (photos + reviews).
        // Until then they collapse to a labeled watercolor panel.
        segments: {
          vibe: { kind: 'vibe', glyph: '✨', caption: '' },
          food: { kind: 'food', glyph: '🍴', caption: '' },
          reviews: { kind: 'reviews', quotes: [] }
        },
        location: loc,
        distance: loc ? haversineMiles(origin, loc) : null,
        mapsUri: p.place_id ? 'https://www.google.com/maps/place/?q=place_id:' + p.place_id : null,
        detailsLoaded: false
      };
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
      var MAP = {
        italian_restaurant: 'italian', japanese_restaurant: 'japanese', sushi_restaurant: 'japanese',
        ramen_restaurant: 'japanese', mexican_restaurant: 'mexican', thai_restaurant: 'thai',
        indian_restaurant: 'indian', chinese_restaurant: 'chinese', american_restaurant: 'american',
        mediterranean_restaurant: 'mediterranean', korean_restaurant: 'korean',
        vietnamese_restaurant: 'vietnamese', pizza_restaurant: 'pizza', hamburger_restaurant: 'burgers',
        seafood_restaurant: 'seafood', cafe: 'cafe', bakery: 'cafe', coffee_shop: 'cafe',
        barbecue_restaurant: 'bbq', vegetarian_restaurant: 'vegetarian'
      };
      var out = [];
      types.forEach(function (t) { if (MAP[t] && out.indexOf(MAP[t]) === -1) out.push(MAP[t]); });
      return out;
    }

    function humanizeStatus(status) {
      var P = google.maps.places;
      if (status === P.PlacesServiceStatus.OVER_QUERY_LIMIT) return 'Google quota reached — try again later.';
      if (status === P.PlacesServiceStatus.REQUEST_DENIED) return 'Your Google key was rejected (check API enablement + referrer restriction).';
      if (status === P.PlacesServiceStatus.INVALID_REQUEST) return 'That search request was invalid.';
      return 'Live search failed (' + status + ').';
    }

    /* geocode — turn a typed address into {lat,lng} (Geocoding library). */
    function geocode(query, done) {
      whenReady(function () {
        try {
          google.maps.importLibrary('geocoding').then(function (geo) {
            var geocoder = new geo.Geocoder();
            geocoder.geocode({ address: query }, function (results, status) {
              if (status === 'OK' && results && results[0]) {
                var l = results[0].geometry.location;
                done(null, { lat: l.lat(), lng: l.lng() });
              } else {
                done('Could not find "' + query + '".', null);
              }
            });
          }).catch(function (e) { done(humanizeError(e), null); });
        } catch (e) { done(humanizeError(e), null); }
      });
    }

    /* Places Autocomplete on the location input (when API is ready). */
    function attachAutocomplete(input) {
      if (!input || state.autocomplete) return;
      whenReady(function () {
        try {
          google.maps.importLibrary('places').then(function (places) {
            // Legacy Autocomplete widget is still the simplest text-field binding.
            if (!places.Autocomplete) return;
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
          }).catch(function () {});
        } catch (e) {}
      });
    }

    function humanizeError(e) {
      var msg = (e && e.message) ? e.message : String(e || 'Unknown error');
      if (/quota|OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED/i.test(msg)) return 'Google quota reached — try again later.';
      if (/denied|PERMISSION|referer|referrer|API key/i.test(msg)) return 'Your Google key was rejected (check API enablement + referrer restriction).';
      return 'Live search failed: ' + msg;
    }

    /* fetchDetails — lazily enrich ONE result's card segments with Place
       Details (photos + reviews + phone + opening hours). Called by the deck
       only for the top card and the next two, so we never fetch data for
       cards the user won't see. Minimal fields are requested. Cached per
       place via the result's `detailsLoaded` flag (set by the caller).

       Google does NOT label photos as "vibe" vs "food" — so we split the
       available Place photos across the two segments (first half -> vibe,
       second half -> food, sharing if only one). Reviews fill the Reviews
       segment; any segment with no data collapses gracefully in the deck.

       NOTE: live-only; cannot be exercised here without a key + network. */
    function fetchDetails(r, done) {
      if (!r || !r.placeId) { done && done(null, null); return; }
      whenReady(function () {
        try {
          google.maps.importLibrary('places').then(function (places) {
            var service = getService(places);
            service.getDetails({
              placeId: r.placeId,
              // Minimal fields: photos, reviews, phone, hours, name.
              fields: ['photos', 'reviews', 'formatted_phone_number', 'international_phone_number', 'opening_hours', 'name']
            }, function (place, status) {
              var P = google.maps.places;
              if (status !== P.PlacesServiceStatus.OK || !place) { done && done(humanizeStatus(status), null); return; }

              // phone
              r.phone = place.international_phone_number || place.formatted_phone_number || r.phone || null;

              // open-now (Details has fresher hours than nearbySearch)
              try {
                if (place.opening_hours && typeof place.opening_hours.isOpen === 'function') {
                  r.open = place.opening_hours.isOpen();
                }
              } catch (e) {}

              // photos split across vibe + food segments
              var urls = [];
              try {
                (place.photos || []).slice(0, 6).forEach(function (ph) {
                  if (typeof ph.getUrl === 'function') urls.push(ph.getUrl({ maxWidth: 800, maxHeight: 1000 }));
                });
              } catch (e) {}
              if (urls.length) {
                var mid = Math.ceil(urls.length / 2);
                r.segments.vibe.photoUrl = urls[0] || null;
                r.segments.food.photoUrl = urls[mid] || urls[0] || null;
                r.segments.vibe.caption = '';
                r.segments.food.caption = '';
              }

              // reviews -> quotes (Google rating is 0-5 -> x20 for our scale)
              try {
                r.segments.reviews.quotes = (place.reviews || []).slice(0, 3).map(function (rv) {
                  return {
                    by: rv.author_name || 'A diner',
                    score: Math.round((rv.rating || 0) * 20),
                    text: (rv.text || '').slice(0, 180)
                  };
                });
              } catch (e) {}

              done && done(null, r);
            });
          }).catch(function (e) { done && done(humanizeError(e), null); });
        } catch (e) { done && done(humanizeError(e), null); }
      });
    }

    return {
      loadOnce: loadOnce,
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
    var titleEl = $('sheet-title');
    var lastFocused = null;

    function syncSlider(input, out) {
      var v = parseFloat(input.value);
      out.textContent = fmtScore(v);
      input.setAttribute('aria-valuetext', fmtScore(v) + ' out of 100');
      paintRange(input);
    }
    function syncOverall() {
      var avg = (parseFloat(sFood.value) + parseFloat(sVibe.value) + parseFloat(sService.value)) / 3;
      overallOut.textContent = fmtScore(avg);
    }
    function syncAll() {
      syncSlider(sFood, nFood); syncSlider(sVibe, nVibe); syncSlider(sService, nService);
      syncOverall();
    }

    function setValues(v) {
      sFood.value = v.food; sVibe.value = v.vibe; sService.value = v.service;
      syncAll();
    }

    function show() {
      backdrop.hidden = false;
      document.body.style.overflow = 'hidden';
      lastFocused = document.activeElement;
      // focus first field
      window.setTimeout(function () { nameInput.focus(); }, 30);
      document.addEventListener('keydown', onKey);
    }
    function hide() {
      backdrop.hidden = true;
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      if (lastFocused && lastFocused.focus) lastFocused.focus();
      state.editingId = null;
      state.pendingPlace = null;
    }
    function onKey(e) {
      if (e.key === 'Escape') { hide(); return; }
      if (e.key === 'Tab') trapFocus(e);
    }
    function trapFocus(e) {
      var f = backdrop.querySelectorAll('button, input, textarea, [href], select');
      var list = Array.prototype.filter.call(f, function (n) { return !n.disabled && n.offsetParent !== null; });
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function todayStr() {
      var d = new Date();
      var mm = ('0' + (d.getMonth() + 1)).slice(-2);
      var dd = ('0' + d.getDate()).slice(-2);
      return d.getFullYear() + '-' + mm + '-' + dd;
    }

    // Open from a Find result.
    function openForPlace(place) {
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
      }
      if (state.editingId) {
        visited.update(state.editingId, data);
        announce('Updated ' + name);
      } else {
        visited.add(data);
        announce('Saved ' + name + ' to your log');
      }
      hide();
      visited.render();
    }

    function init() {
      if (!backdrop) return;
      [ [sFood, nFood], [sVibe, nVibe], [sService, nService] ].forEach(function (pair) {
        pair[0].addEventListener('input', function () { syncSlider(pair[0], pair[1]); syncOverall(); });
      });
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

    function load() {
      var v = store.getVisited();
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
      state.visited.unshift(data);
      persist();
    }

    function update(id, data) {
      for (var i = 0; i < state.visited.length; i++) {
        if (state.visited[i].id === id) {
          data.id = id;
          data.demo = false; // editing a demo entry makes it real
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
        }
      });
      actions.appendChild(editBtn);
      actions.appendChild(rerateBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);
      return card;
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
        // first meal (steam wisps pause under prefers-reduced-motion)
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
        empty.appendChild(el('p', 'empty-sub', 'Rate the first place you eat and it will live here, watercolor bars and all.'));
        var addBtn = el('button', 'add-place-btn', '+ Add a place');
        addBtn.type = 'button';
        addBtn.addEventListener('click', function () { sheet.openBlank(); });
        empty.appendChild(addBtn);
        listEl.appendChild(empty);
        return;
      }

      var avg = state.visited.reduce(function (s, e) { return s + overallOf(e); }, 0) / n;
      renderStats(n, avg);

      arr.forEach(function (e) { listEl.appendChild(buildCard(e)); });
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
      if (sortSel) sortSel.addEventListener('change', function () { state.sort = sortSel.value; render(); });
      if (filterInput) {
        filterInput.addEventListener('input', function () {
          filterQ = filterInput.value || '';
          render();
        });
      }
      var addBtn = $('add-place');
      if (addBtn) addBtn.addEventListener('click', function () { sheet.openBlank(); });
      // initialise tab count
      var n = state.visited.length;
      if (tabCount) tabCount.textContent = n ? '(' + n + ')' : '';
    }

    return { init: init, render: render, add: add, update: update, remove: remove };
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

    return { getFriendsFeed: getFriendsFeed, getPopular: getPopular, listFriends: listFriends };
  })();

  /* ================================================================== *
   * FRIENDS — feed of friends' ratings (consumes social.getFriendsFeed)
   * ================================================================== */
  var friends = (function () {
    var listEl = $('friends-list');
    var statsEl = $('friends-stats');
    var sortSel = $('friends-sort');
    var chipsEl = $('friend-chips');
    var state2 = { sort: 'recent', filter: 'all', token: 0 };

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

    function buildEntry(e) {
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
    }

    function render() {
      if (!listEl) return;
      var token = ++state2.token;
      showLoading();
      social.getFriendsFeed({ sort: state2.sort }).then(function (list) {
        if (token !== state2.token) return; // stale response
        if (state2.filter !== 'all') {
          list = list.filter(function (e) { return e.friend.name === state2.filter; });
        }
        clear(listEl);
        if (statsEl) {
          var nFriends = social.listFriends().length;
          statsEl.textContent = list.length + ' rating' + (list.length === 1 ? '' : 's') + ' from ' + nFriends + ' friends';
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
          var entry = buildEntry(e);
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
    }

    return { init: init, render: render };
  })();

  /* ================================================================== *
   * POPULAR — trending leaderboard (consumes social.getPopular)
   * ================================================================== */
  var popular = (function () {
    var listEl = $('popular-list');
    var toggle = $('range-toggle');
    var btns = toggle ? Array.prototype.slice.call(toggle.querySelectorAll('.range-btn')) : [];
    var state3 = { range: 'today', token: 0 };

    var TREND = {
      up: { glyph: '▲', cls: 'up', label: 'trending up' },
      down: { glyph: '▼', cls: 'down', label: 'trending down' },
      flat: { glyph: '—', cls: 'flat', label: 'holding steady' }
    };

    function buildRow(item) {
      var li = el('li', 'pop-card pop-rank-' + item.rank);
      if (item.rank <= 3) li.classList.add('pop-top', 'pop-top-' + item.rank);

      var rank = el('div', 'pop-rank', String(item.rank));
      rank.setAttribute('aria-hidden', 'true');
      li.appendChild(rank);

      var body = el('div', 'pop-body');
      body.appendChild(el('h3', 'pop-name', item.place));
      var meta = el('p', 'pop-meta');
      if (item.cuisine) meta.appendChild(el('span', 'pop-cuisine', item.cuisine));
      if (item.loc) {
        meta.appendChild(el('span', 'dotsep', '·'));
        meta.appendChild(el('span', 'pop-loc', item.loc));
      }
      body.appendChild(meta);
      body.appendChild(el('span', 'v-demo-tag', 'Sample'));
      li.appendChild(body);

      var stat = el('div', 'pop-stat');
      var score = el('div', 'pop-score');
      score.appendChild(el('span', 'big', fmtScore(item.score)));
      score.appendChild(el('span', 'lbl', 'avg overall'));
      stat.appendChild(score);

      var t = TREND[item.trend] || TREND.flat;
      var line = el('div', 'pop-reviews');
      var tr = el('span', 'pop-trend pop-trend--' + t.cls, t.glyph);
      tr.setAttribute('aria-label', t.label);
      tr.setAttribute('role', 'img');
      line.appendChild(tr);
      line.appendChild(document.createTextNode(item.reviews.toLocaleString() + ' reviews'));
      stat.appendChild(line);

      // 7-point trend sparkline, synthesized deterministically from the
      // row itself (name-seeded wobble shaped by the trend direction)
      var sparkColor = item.rank === 1 ? 'var(--gold)'
        : item.rank === 2 ? 'var(--wisteria)'
        : item.rank === 3 ? 'var(--pond-deep)'
        : 'var(--ink-soft)';
      stat.appendChild(svgSparkline(trendSeries(item), sparkColor));

      li.appendChild(stat);
      return li;
    }

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
      showLoading();
      social.getPopular({ range: state3.range }).then(function (list) {
        if (token !== state3.token) return; // stale response
        clear(listEl);
        list.forEach(function (item, i) {
          var row = buildRow(item);
          enterStagger(row, i);
          // top-3 rank badges bloom softly just after their row lands
          if (!prefersReducedMotion && item.rank <= 3) {
            var badge = row.querySelector('.pop-rank');
            if (badge) {
              badge.classList.add('is-blooming');
              badge.style.animationDelay = (i * 40 + 380) + 'ms';
              badge.addEventListener('animationend', function onBloom(e2) {
                if (e2.animationName !== 'rank-bloom') return;
                badge.classList.remove('is-blooming');
                badge.style.animationDelay = '';
                badge.removeEventListener('animationend', onBloom);
              });
            }
          }
          listEl.appendChild(row);
        });
        var label = state3.range === 'today' ? 'today' : (state3.range === 'month' ? 'this month' : 'this year');
        announce('Top ' + list.length + ' places ' + label);
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
   * SETTINGS — API key panel
   * ================================================================== */
  var settings = (function () {
    var backdrop = $('settings-backdrop');
    var input = $('key-input');
    var msg = $('settings-msg');
    var navBtn = $('settings-open');
    var settingsLabel = document.querySelector('.settings-label');
    var demoHint = $('landing-demo-hint');
    var lastFocused = null;

    function refreshMode() {
      var has = !!store.getKey();
      if (navBtn) navBtn.classList.toggle('is-live', has);
      if (settingsLabel) settingsLabel.textContent = has ? 'Live data on' : 'Use live data';
      // The discreet demo hint sits on the calm landing; hide it when live.
      if (demoHint) demoHint.hidden = has;
    }

    function setMsg(text, kind) {
      if (!msg) return;
      msg.textContent = text || '';
      msg.className = 'settings-msg' + (kind ? ' is-' + kind : '');
    }
    function showError(text) {
      setMsg(text || 'Something went wrong with Google.', 'error');
    }

    function open() {
      if (!backdrop) return;
      backdrop.hidden = false;
      document.body.style.overflow = 'hidden';
      lastFocused = document.activeElement;
      if (input) { input.value = store.getKey() || ''; window.setTimeout(function () { input.focus(); }, 30); }
      setMsg(store.getKey() ? 'A key is saved on this device.' : '', store.getKey() ? 'ok' : '');
      document.addEventListener('keydown', onKey);
    }
    function close() {
      if (!backdrop) return;
      backdrop.hidden = true;
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    function init() {
      if (!backdrop) return;
      if (navBtn) navBtn.addEventListener('click', open);
      var hintBtn = $('hint-add-key');
      if (hintBtn) hintBtn.addEventListener('click', open);
      $('settings-close').addEventListener('click', close);
      backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });

      $('key-save').addEventListener('click', function () {
        var k = (input.value || '').trim();
        if (!k) { setMsg('Paste a key first.', 'error'); return; }
        if (store.setKey(k)) {
          setMsg('Saved. Loading live data…', 'ok');
          refreshMode();
          // begin loading Maps now so the first search is instant
          gmaps.loadOnce(k);
          window.setTimeout(close, 700);
        } else {
          setMsg('Could not save (storage blocked).', 'error');
        }
      });

      $('key-clear').addEventListener('click', function () {
        store.clearKey();
        if (input) input.value = '';
        setMsg('Key cleared — back to sample data.', 'ok');
        refreshMode();
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

    return { init: init, open: open, showError: showError, refreshMode: refreshMode };
  })();

  /* ================================================================== *
   * BOOT
   * ================================================================== */
  function boot() {
    tabs.init();
    sheet.init();
    visited.init();
    friends.init();
    popular.init();
    settings.init();
    find.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
