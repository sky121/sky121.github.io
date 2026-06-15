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

  /* ------------------------------------------------------------------ *
   * store — localStorage CRUD (graceful when storage is blocked)
   * ------------------------------------------------------------------ */
  var KEY_GMAPS = 'eats-gmaps-key';
  var KEY_VISITED = 'eats-visited';

  var store = {
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

  /* ------------------------------------------------------------------ *
   * demo — sample data (San Francisco)
   * ------------------------------------------------------------------ */
  // Search origin used for demo distance math (Ferry Building area, SF).
  var DEMO_ORIGIN = { lat: 37.7956, lng: -122.3934 };

  var DEMO_RESTAURANTS = [
    { name: 'Marigold & Sage', rating: 4.6, reviews: 812, price: 3, type: 'Californian · Farm-to-table', lat: 37.7929, lng: -122.3971, open: true, phone: '+14155550142' },
    { name: 'Little Wren Bakery', rating: 4.8, reviews: 1340, price: 1, type: 'Bakery · Café', lat: 37.7972, lng: -122.3990, open: true, phone: '+14155550178' },
    { name: 'Pier 9 Oyster Co.', rating: 4.4, reviews: 521, price: 4, type: 'Seafood · Raw bar', lat: 37.7995, lng: -122.3915, open: false, phone: '+14155550199' },
    { name: 'Casa Poblana', rating: 4.5, reviews: 967, price: 2, type: 'Mexican · Taquería', lat: 37.7901, lng: -122.4003, open: true, phone: '+14155550110' },
    { name: 'Tonkotsu Lane', rating: 4.7, reviews: 1582, price: 2, type: 'Ramen · Japanese', lat: 37.7948, lng: -122.3958, open: true, phone: '+14155550133' },
    { name: 'Olive & Thyme', rating: 4.3, reviews: 388, price: 3, type: 'Mediterranean', lat: 37.7918, lng: -122.3949, open: true, phone: '+14155550155' },
    { name: 'The Copper Kettle', rating: 4.2, reviews: 642, price: 2, type: 'Brunch · American', lat: 37.7983, lng: -122.3962, open: false, phone: '+14155550166' },
    { name: 'Saffron House', rating: 4.6, reviews: 729, price: 2, type: 'Indian · Curry house', lat: 37.7937, lng: -122.4012, open: true, phone: '+14155550188' },
    { name: 'Verde Trattoria', rating: 4.5, reviews: 1104, price: 3, type: 'Italian · Pasta', lat: 37.7966, lng: -122.3902, open: true, phone: '+14155550121' },
    { name: 'Foggy Bell Coffee', rating: 4.4, reviews: 455, price: 1, type: 'Coffee · Light bites', lat: 37.7959, lng: -122.3985, open: true, phone: '+14155550144' }
  ];

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
        open: r.open,
        phone: r.phone,
        photoUrl: null, // watercolor placeholder
        location: { lat: r.lat, lng: r.lng },
        distance: haversineMiles(DEMO_ORIGIN, { lat: r.lat, lng: r.lng }),
        mapsUri: null,
        placeId: null
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
    openNow: false,
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

  /* ================================================================== *
   * FIND — rendering, controls, pick-for-me, geolocation
   * ================================================================== */
  var find = (function () {
    var landingEl = $('find-landing');
    var resultsWrap = $('find-results-wrap');
    var resultsEl = $('results');
    var statusEl = $('results-status');
    var originEl = $('results-origin');
    var moreWrap = $('results-more');
    var moreBtn = $('load-more');

    function priceStr(p) {
      if (!p) return '';
      var s = '';
      for (var i = 0; i < p; i++) s += '$';
      return s;
    }

    /* Results are kept nearest-first; "open now" is a soft filter applied
       on top of the already distance-sorted list. No radius cap. */
    function visibleResults() {
      var list = state.results.slice();
      if (state.openNow) list = list.filter(function (r) { return r.open === true; });
      list.sort(function (a, b) {
        if (a.distance == null) return 1;
        if (b.distance == null) return -1;
        return a.distance - b.distance;
      });
      return list;
    }

    function buildCard(r) {
      var card = el('article', 'card');
      card.dataset.id = r.id;

      // photo
      var photo;
      if (r.photoUrl) {
        photo = el('div', 'card-photo');
        photo.style.backgroundImage = 'url("' + r.photoUrl.replace(/"/g, '') + '")';
      } else {
        photo = el('div', 'card-photo card-photo--placeholder');
        var glyph = el('span', 'ph-glyph');
        glyph.textContent = '🍽'; // fork & knife
        photo.appendChild(glyph);
      }
      if (r.open != null) {
        var badge = el('span', 'card-open-badge' + (r.open ? '' : ' is-closed'), r.open ? 'Open now' : 'Closed');
        photo.appendChild(badge);
      }
      card.appendChild(photo);

      var body = el('div', 'card-body');
      body.appendChild(el('h3', 'card-name', r.name));

      var meta = el('div', 'card-meta');
      if (r.rating) {
        var st = el('span', 'stars');
        var num = el('span', 'num', '\u2605 ' + fmtScore(r.rating * 20));
        st.appendChild(num);
        if (r.reviews) st.appendChild(document.createTextNode(' (' + r.reviews.toLocaleString() + ')'));
        meta.appendChild(st);
      }
      if (r.price) {
        meta.appendChild(el('span', 'dotsep', '·'));
        meta.appendChild(el('span', 'price', priceStr(r.price)));
      }
      body.appendChild(meta);

      if (r.type) body.appendChild(el('p', 'card-tags', r.type));
      if (r.distance != null) body.appendChild(el('p', 'card-dist', fmtDist(r.distance) + ' away'));

      // actions
      var actions = el('div', 'card-actions');

      var mapsHref = r.mapsUri ||
        (r.placeId ? 'https://www.google.com/maps/place/?q=place_id:' + encodeURIComponent(r.placeId) : null) ||
        'https://www.google.com/maps/search/' + encodeURIComponent(r.name);
      var mapLink = el('a', 'card-action', 'Open in Maps');
      mapLink.href = mapsHref;
      mapLink.target = '_blank';
      mapLink.rel = 'noopener';
      actions.appendChild(mapLink);

      if (r.phone) {
        var call = el('a', 'card-action', 'Call');
        call.href = 'tel:' + r.phone;
        actions.appendChild(call);
      }

      var rate = el('button', 'card-action card-action--primary', 'I ate here → Rate');
      rate.type = 'button';
      rate.addEventListener('click', function () {
        sheet.openForPlace({
          name: r.name,
          placeId: r.placeId || null,
          loc: r.location || null,
          address: r.type || ''
        });
      });
      actions.appendChild(rate);

      body.appendChild(actions);
      card.appendChild(body);
      return card;
    }

    function render() {
      clear(resultsEl);
      var list = visibleResults();
      if (!state.results.length) {
        statusEl.textContent = '';
        if (moreWrap) moreWrap.hidden = true;
        return;
      }
      if (!list.length) {
        statusEl.textContent = '';
        var empty = el('div', 'empty');
        empty.appendChild(el('div', 'empty-glyph', '🍴'));
        empty.appendChild(el('p', 'empty-title', 'Nothing open right now'));
        empty.appendChild(el('p', 'empty-sub', 'Turn off "Open now" to see every nearby spot.'));
        resultsEl.appendChild(empty);
        if (moreWrap) moreWrap.hidden = true;
        return;
      }
      statusEl.textContent = list.length + ' place' + (list.length === 1 ? '' : 's') +
        ' · nearest first';
      list.forEach(function (r) { resultsEl.appendChild(buildCard(r)); });
      renderMore();
      announce(list.length + ' results shown, nearest first');
    }

    function renderMore() {
      if (!moreWrap) return;
      moreWrap.hidden = !state.hasMore;
      if (moreBtn) {
        moreBtn.disabled = state.loadingMore;
        moreBtn.textContent = state.loadingMore ? 'Searching farther…' : 'Search farther out';
      }
    }

    /* Replace the result set (a fresh search). */
    function setResults(list, origin) {
      state.results = list || [];
      if (origin) state.origin = origin;
      showResultsView();
      render();
    }

    /* Append more results (pagination / outward expansion), de-duped by id. */
    function appendResults(list) {
      var seen = {};
      state.results.forEach(function (r) { seen[r.id] = true; });
      (list || []).forEach(function (r) { if (!seen[r.id]) { seen[r.id] = true; state.results.push(r); } });
      render();
    }

    function setStatus(msg) { statusEl.textContent = msg; }

    /* ---- View switching: calm landing <-> results ---- */
    function showResultsView() {
      if (landingEl) landingEl.hidden = true;
      if (resultsWrap) resultsWrap.hidden = false;
      updateOrigin();
    }
    function showLanding() {
      if (resultsWrap) resultsWrap.hidden = true;
      if (landingEl) landingEl.hidden = false;
      // reset transient search state (keep nothing stale behind the landing)
      state.results = [];
      state.hasMore = false;
      state.nextPage = null;
      clear(resultsEl);
      statusEl.textContent = '';
      var orb = $('find-near-me');
      if (orb) orb.focus();
    }
    function updateOrigin() {
      if (!originEl) return;
      clear(originEl);
      originEl.appendChild(document.createTextNode('Searching from ' + (state.originLabel || 'near you') + ' · '));
      var change = el('button', 'change-link', 'change');
      change.type = 'button';
      change.addEventListener('click', showLanding);
      originEl.appendChild(change);
    }

    /* --- Pick for me: shuffle highlight settling on one --- */
    var pickTimer = null;
    function pickForMe() {
      var cards = resultsEl.querySelectorAll('.card');
      if (!cards.length) { setStatus('Search first, then I can pick for you.'); return; }
      // clear prior
      cards.forEach(function (c) { c.classList.remove('is-picked', 'is-shuffling'); });
      var finalIdx = Math.floor(Math.random() * cards.length);

      if (prefersReducedMotion || cards.length === 1) {
        landOn(cards, finalIdx);
        return;
      }
      var ticks = 12 + Math.floor(Math.random() * 6);
      var i = 0;
      window.clearInterval(pickTimer);
      pickTimer = window.setInterval(function () {
        cards.forEach(function (c) { c.classList.remove('is-shuffling'); });
        var idx = i % cards.length;
        cards[idx].classList.add('is-shuffling');
        i++;
        if (i >= ticks) {
          window.clearInterval(pickTimer);
          cards.forEach(function (c) { c.classList.remove('is-shuffling'); });
          landOn(cards, finalIdx);
        }
      }, 80);
    }
    function landOn(cards, idx) {
      var chosen = cards[idx];
      chosen.classList.add('is-picked');
      chosen.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center' });
      var name = chosen.querySelector('.card-name');
      setStatus('How about — ' + (name ? name.textContent : 'this one') + '?');
      announce('Picked ' + (name ? name.textContent : 'a place'));
    }

    /* --- Geolocation (only on explicit press) --- */
    function findNearMe() {
      showResultsView();
      state.originLabel = 'near you';
      if (!navigator.geolocation) {
        // No geolocation: fall back to demo origin / prompt for a place.
        if (store.getKey()) {
          setStatus('Geolocation is not available — search a specific location instead.');
          showLanding();
          var revealBtn = $('loc-reveal');
          if (revealBtn) revealBtn.click();
        } else {
          searchAt(DEMO_ORIGIN, 'near you');
        }
        return;
      }
      setStatus('Finding your location…');
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          searchAt({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 'near you');
        },
        function () {
          if (store.getKey()) {
            setStatus('Location blocked — search a specific location instead.');
            showLanding();
            var revealBtn = $('loc-reveal');
            if (revealBtn) revealBtn.click();
          } else {
            // Demo mode still works without permission.
            searchAt(DEMO_ORIGIN, 'near you');
          }
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      );
    }

    /* --- Run a fresh search at an origin: live if key, else demo --- */
    function searchAt(origin, label) {
      state.origin = origin;
      if (label) state.originLabel = label;
      state.hasMore = false;
      state.nextPage = null;
      showResultsView();
      if (store.getKey()) {
        setStatus('Searching nearby…');
        gmaps.searchNearby(origin, function (err, list, more) {
          if (err) {
            // friendly fallback to demo so the app stays usable
            settings.showError(err);
            renderDemo(origin);
            return;
          }
          state.nextPage = more || null;
          state.hasMore = !!more;
          setResults(list, origin);
        });
      } else {
        // DEMO MODE: re-base demo results around chosen origin for plausible distances.
        renderDemo(origin);
      }
    }

    /* --- Load more (outward, exhaustive) — live pagination only --- */
    function loadMore() {
      if (!state.hasMore || state.loadingMore) return;
      state.loadingMore = true;
      renderMore();
      if (state.nextPage && typeof state.nextPage.fetch === 'function') {
        state.nextPage.fetch(function (err, list, more) {
          state.loadingMore = false;
          if (err) { settings.showError(err); state.hasMore = false; renderMore(); return; }
          state.nextPage = more || null;
          state.hasMore = !!more;
          appendResults(list);
        });
      } else {
        state.loadingMore = false;
        state.hasMore = false;
        renderMore();
      }
    }

    /* DEMO: all sample restaurants, sorted nearest-first, shown in full. */
    function renderDemo(origin) {
      var list = demoResults();
      if (origin) {
        // shift demo coords so they cluster near the chosen origin
        var dLat = origin.lat - DEMO_ORIGIN.lat;
        var dLng = origin.lng - DEMO_ORIGIN.lng;
        list.forEach(function (r) {
          r.location = { lat: r.location.lat + dLat, lng: r.location.lng + dLng };
          r.distance = haversineMiles(origin, r.location);
        });
      }
      // nearest-first; demo has no pagination so all are shown at once.
      list.sort(function (a, b) { return (a.distance || 0) - (b.distance || 0); });
      state.hasMore = false;
      state.nextPage = null;
      if (!state.originLabel) state.originLabel = 'near you';
      setResults(list, origin || DEMO_ORIGIN);
    }

    function init() {
      var orb = $('find-near-me');
      if (orb) orb.addEventListener('click', findNearMe);

      var back = $('results-back');
      if (back) back.addEventListener('click', showLanding);

      // "or search a specific location" — reveal the input on demand
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
            showResultsView();
            setStatus('Looking up "' + q + '"…');
            gmaps.geocode(q, function (err, origin) {
              if (err || !origin) { settings.showError(err || 'Could not find that place.'); showLanding(); return; }
              searchAt(origin, q);
            });
          } else {
            // Demo mode: no geocoder; show demo data labeled with the query.
            renderDemo();
          }
        });
      }

      var openNow = $('open-now');
      if (openNow) openNow.addEventListener('change', function () { state.openNow = openNow.checked; render(); });

      var pick = $('pick-for-me');
      if (pick) pick.addEventListener('click', pickForMe);

      if (moreBtn) moreBtn.addEventListener('click', loadMore);

      // Start on the calm landing — no results pre-loaded.
    }

    return { init: init, render: render, setResults: setResults, setStatus: setStatus, renderDemo: renderDemo, searchAt: searchAt, showLanding: showLanding };
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
        open: openState,
        phone: null, // not returned by nearbySearch; a Details call would add it
        photoUrl: photoUrl,
        location: loc,
        distance: loc ? haversineMiles(origin, loc) : null,
        mapsUri: p.place_id ? 'https://www.google.com/maps/place/?q=place_id:' + p.place_id : null
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
                find.searchAt({ lat: place.geometry.location.lat(), lng: place.geometry.location.lng() });
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

    return {
      loadOnce: loadOnce,
      searchNearby: searchNearby,
      geocode: geocode,
      attachAutocomplete: attachAutocomplete
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

    function render() {
      if (!listEl) return;
      clear(listEl);
      var arr = sorted();

      // tab count + stats
      var n = state.visited.length;
      if (tabCount) tabCount.textContent = n ? '(' + n + ')' : '';

      if (!arr.length) {
        statsEl.textContent = '';
        var empty = el('div', 'empty');
        empty.appendChild(el('div', 'empty-glyph', '📓'));
        empty.appendChild(el('p', 'empty-title', 'No visits yet'));
        empty.appendChild(el('p', 'empty-sub', 'Rate a place to start your log.'));
        var addBtn = el('button', 'add-place-btn', '+ Add a place');
        addBtn.type = 'button';
        addBtn.addEventListener('click', function () { sheet.openBlank(); });
        empty.appendChild(addBtn);
        listEl.appendChild(empty);
        return;
      }

      var avg = arr.reduce(function (s, e) { return s + overallOf(e); }, 0) / arr.length;
      statsEl.innerHTML = '';
      statsEl.appendChild(document.createTextNode('You’ve logged '));
      statsEl.appendChild(el('strong', null, String(n)));
      statsEl.appendChild(document.createTextNode(' place' + (n === 1 ? '' : 's') + ' · average overall '));
      statsEl.appendChild(el('strong', null, fmtScore(avg)));

      arr.forEach(function (e) { listEl.appendChild(buildCard(e)); });
    }

    function init() {
      load();
      if (sortSel) sortSel.addEventListener('change', function () { state.sort = sortSel.value; render(); });
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
        list.forEach(function (e) { listEl.appendChild(buildEntry(e)); });
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
      li.appendChild(stat);
      return li;
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
        list.forEach(function (item) { listEl.appendChild(buildRow(item)); });
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
