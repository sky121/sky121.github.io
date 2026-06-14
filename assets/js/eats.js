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
     - tabs         tablist router (Find / Visited)
     - find         Find-tab rendering, controls, pick-for-me, geolocation
     - gmaps        lazy Google Maps + Places integration (current API)
     - sheet        rating sheet (shared by Find + Visited)
     - visited      Visited store rendering + CRUD
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
      { id: 'demo-v-1', name: 'Tonkotsu Lane', food: 9, vibe: 7.5, service: 8, note: 'Tonkotsu was rich and silky. Tiny room, expect a wait.', date: '2026-05-02', loc: 'Embarcadero, SF', demo: true },
      { id: 'demo-v-2', name: 'Little Wren Bakery', food: 9.5, vibe: 8, service: 7, note: 'The morning bun is unreal. Coffee a touch weak.', date: '2026-04-18', loc: 'Embarcadero, SF', demo: true },
      { id: 'demo-v-3', name: 'Pier 9 Oyster Co.', food: 8, vibe: 9, service: 6.5, note: 'Beautiful patio at sunset. Pricey, slow service.', date: '2026-03-27', loc: 'Pier 9, SF', demo: true }
    ];
  }

  /* ------------------------------------------------------------------ *
   * state
   * ------------------------------------------------------------------ */
  var state = {
    results: [],          // current Find results
    origin: null,         // {lat,lng} search origin
    radiusMiles: 1,
    openNow: false,
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

  /* ================================================================== *
   * TABS — accessible tablist router
   * ================================================================== */
  var tabs = (function () {
    var tabFind = $('tab-find');
    var tabVisited = $('tab-visited');
    var panelFind = $('panel-find');
    var panelVisited = $('panel-visited');
    var tabEls = [tabFind, tabVisited];

    function activate(which, focus) {
      var isFind = which === 'find';
      [tabFind, tabVisited].forEach(function (t) {
        var on = (t === (isFind ? tabFind : tabVisited));
        if (!t) return;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        if (on && focus) t.focus();
      });
      if (panelFind) { panelFind.classList.toggle('is-hidden', !isFind); panelFind.hidden = !isFind; }
      if (panelVisited) { panelVisited.classList.toggle('is-hidden', isFind); panelVisited.hidden = isFind; }
      if (!isFind) visited.render();
    }

    function init() {
      if (tabFind) tabFind.addEventListener('click', function () { activate('find'); });
      if (tabVisited) tabVisited.addEventListener('click', function () { activate('visited'); });
      // keyboard: left/right/home/end on the tablist
      tabEls.forEach(function (t, idx) {
        if (!t) return;
        t.addEventListener('keydown', function (e) {
          var next = null;
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % tabEls.length;
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + tabEls.length) % tabEls.length;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = tabEls.length - 1;
          if (next != null) {
            e.preventDefault();
            activate(next === 0 ? 'find' : 'visited', true);
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
    var resultsEl = $('results');
    var statusEl = $('results-status');
    var ctrls = $('find-controls');

    function stars(rating) {
      var full = Math.floor(rating);
      var half = (rating - full) >= 0.5;
      var s = '';
      for (var i = 0; i < full; i++) s += '★';
      if (half) s += '½';
      return s;
    }
    function priceStr(p) {
      if (!p) return '';
      var s = '';
      for (var i = 0; i < p; i++) s += '$';
      return s;
    }

    function visibleResults() {
      var list = state.results.slice();
      if (state.openNow) list = list.filter(function (r) { return r.open === true; });
      // filter by radius (only when distance known)
      list = list.filter(function (r) {
        return r.distance == null || r.distance <= state.radiusMiles + 0.0001;
      });
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
        var num = el('span', 'num', fmt1(r.rating));
        st.appendChild(num);
        st.appendChild(document.createTextNode(stars(r.rating)));
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
        return;
      }
      if (!list.length) {
        statusEl.textContent = '';
        var empty = el('div', 'empty');
        empty.appendChild(el('div', 'empty-glyph', '🍴'));
        empty.appendChild(el('p', 'empty-title', 'Nothing matches those filters'));
        empty.appendChild(el('p', 'empty-sub', 'Try widening the radius or turning off "Open now".'));
        resultsEl.appendChild(empty);
        return;
      }
      statusEl.textContent = list.length + ' place' + (list.length === 1 ? '' : 's') + ' nearby';
      list.forEach(function (r) { resultsEl.appendChild(buildCard(r)); });
      announce(list.length + ' results shown');
    }

    function setResults(list, origin) {
      state.results = list || [];
      if (origin) state.origin = origin;
      render();
    }

    function setStatus(msg) { statusEl.textContent = msg; }

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
      if (!navigator.geolocation) {
        setStatus('Geolocation is not available — set a location below.');
        return;
      }
      setStatus('Finding your location…');
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          var origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          searchAt(origin);
        },
        function () {
          setStatus('Location blocked — type a city or address below instead.');
          var input = $('loc-input');
          if (input) input.focus();
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      );
    }

    /* --- Run a search at an origin: live if key, else demo --- */
    function searchAt(origin) {
      state.origin = origin;
      if (store.getKey()) {
        setStatus('Searching nearby…');
        gmaps.searchNearby(origin, state.radiusMiles, function (err, list) {
          if (err) {
            // friendly fallback to demo so the app stays usable
            settings.showError(err);
            renderDemo();
            return;
          }
          setResults(list, origin);
        });
      } else {
        // DEMO MODE: re-base demo results around chosen origin for plausible distances
        renderDemo(origin);
      }
    }

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
      setResults(list, origin || DEMO_ORIGIN);
    }

    function init() {
      var btnNear = $('find-near-me');
      if (btnNear) btnNear.addEventListener('click', findNearMe);

      var form = $('loc-form');
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var input = $('loc-input');
          var q = input ? input.value.trim() : '';
          if (!q) { setStatus('Type a city or address first.'); return; }
          if (store.getKey()) {
            setStatus('Looking up "' + q + '"…');
            gmaps.geocode(q, function (err, origin) {
              if (err || !origin) { settings.showError(err || 'Could not find that place.'); return; }
              searchAt(origin);
            });
          } else {
            // Demo mode: no geocoder; just show demo data labeled with the query.
            setStatus('Showing sample places (add a key to search "' + q + '")');
            renderDemo();
          }
        });
      }

      var openNow = $('open-now');
      if (openNow) openNow.addEventListener('change', function () { state.openNow = openNow.checked; render(); });

      var radius = $('radius');
      var radiusVal = $('radius-val');
      if (radius) {
        var updateRadius = function () {
          state.radiusMiles = parseFloat(radius.value);
          var label = fmt1(state.radiusMiles) + ' mi';
          if (radiusVal) radiusVal.textContent = label;
          radius.setAttribute('aria-valuetext', fmt1(state.radiusMiles) + ' miles');
          paintRange(radius);
          render();
        };
        radius.addEventListener('input', updateRadius);
        updateRadius();
      }

      var pick = $('pick-for-me');
      if (pick) pick.addEventListener('click', pickForMe);

      // initial demo render
      renderDemo();
    }

    return { init: init, render: render, setResults: setResults, setStatus: setStatus, renderDemo: renderDemo, searchAt: searchAt };
  })();

  /* paint a wc-range fill % (shared) */
  function paintRange(input) {
    if (!input) return;
    var min = parseFloat(input.min), max = parseFloat(input.max), v = parseFloat(input.value);
    var pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', pct.toFixed(1) + '%');
  }

  /* ================================================================== *
   * GMAPS — lazy Google Maps + Places (current API)
   *
   * Loaded ONLY when a key exists. Uses the documented async bootstrap
   * loader (loading=async). Prefers the new google.maps.places.Place +
   * Place.searchNearby (circle locationRestriction, includedPrimaryTypes,
   * minimal fields). Falls back to friendly errors. NOTE: live calls
   * cannot be exercised without a key + network; this code is written to
   * the documented API and commented.
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

    /* searchNearby — new Places API (google.maps.places.Place). */
    function searchNearby(origin, radiusMiles, done) {
      whenReady(function () {
        runSearch(origin, radiusMiles, done);
      });
      // if loading silently fails, the auth/onerror handlers report it.
    }

    function runSearch(origin, radiusMiles, done) {
      try {
        // Import the Places library (returns the classes for the new API).
        google.maps.importLibrary('places').then(function (places) {
          var Place = places.Place;
          var SearchNearbyRankPreference = places.SearchNearbyRankPreference;
          var radiusMeters = Math.min(radiusMiles * 1609.34, 50000); // API max 50km

          var request = {
            // Request only the fields we render (keeps quota/cost down).
            fields: [
              'id', 'displayName', 'rating', 'userRatingCount', 'priceLevel',
              'primaryTypeDisplayName', 'location', 'googleMapsURI',
              'nationalPhoneNumber', 'photos', 'regularOpeningHours'
            ],
            locationRestriction: {
              center: { lat: origin.lat, lng: origin.lng },
              radius: radiusMeters
            },
            // Restaurants & adjacent food places.
            includedPrimaryTypes: ['restaurant', 'cafe', 'bakery', 'bar', 'meal_takeaway'],
            maxResultCount: 20,
            rankPreference: SearchNearbyRankPreference
              ? SearchNearbyRankPreference.DISTANCE
              : undefined
          };

          Place.searchNearby(request).then(function (res) {
            var places2 = res.places || [];
            var list = places2.map(function (p) { return mapPlace(p, origin); });
            done(null, list);
          }).catch(function (e) {
            done(humanizeError(e), null);
          });
        }).catch(function (e) {
          done(humanizeError(e), null);
        });
      } catch (e) {
        done(humanizeError(e), null);
      }
    }

    // Map a new-API Place to our internal result shape.
    function mapPlace(p, origin) {
      var loc = null;
      try {
        loc = p.location ? { lat: p.location.lat(), lng: p.location.lng() } : null;
      } catch (e) {
        // location may already be a plain {lat,lng}
        if (p.location && typeof p.location.lat === 'number') loc = { lat: p.location.lat, lng: p.location.lng };
      }
      var photoUrl = null;
      try {
        if (p.photos && p.photos.length) {
          photoUrl = p.photos[0].getURI({ maxWidth: 640, maxHeight: 360 });
        }
      } catch (e) {}
      var price = priceFromEnum(p.priceLevel);
      var openState = null;
      try {
        if (p.regularOpeningHours && typeof p.regularOpeningHours.isOpen === 'function') {
          openState = p.regularOpeningHours.isOpen();
        }
      } catch (e) {}
      return {
        id: p.id,
        placeId: p.id,
        name: p.displayName || 'Unnamed place',
        rating: p.rating || 0,
        reviews: p.userRatingCount || 0,
        price: price,
        type: p.primaryTypeDisplayName || '',
        open: openState,
        phone: p.nationalPhoneNumber || null,
        photoUrl: photoUrl,
        location: loc,
        distance: loc ? haversineMiles(origin, loc) : null,
        mapsUri: p.googleMapsURI || null
      };
    }

    function priceFromEnum(level) {
      // New API PriceLevel is a string enum.
      switch (level) {
        case 'PRICE_LEVEL_INEXPENSIVE': return 1;
        case 'PRICE_LEVEL_MODERATE': return 2;
        case 'PRICE_LEVEL_EXPENSIVE': return 3;
        case 'PRICE_LEVEL_VERY_EXPENSIVE': return 4;
        default: return (typeof level === 'number' && level > 0) ? level : 0;
      }
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
      out.textContent = fmt1(v);
      input.setAttribute('aria-valuetext', fmt1(v) + ' out of 10');
      paintRange(input);
    }
    function syncOverall() {
      var avg = (parseFloat(sFood.value) + parseFloat(sVibe.value) + parseFloat(sService.value)) / 3;
      overallOut.textContent = fmt1(avg);
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
      setValues({ food: 5, vibe: 5, service: 5 });
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
      setValues({ food: 5, vibe: 5, service: 5 });
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

    function bar(label, value, mod) {
      var row = el('div', 'v-bar v-bar--' + mod);
      row.appendChild(el('span', 'lbl', label));
      var track = el('div', 'track');
      var fill = el('div', 'fill');
      fill.style.width = (value / 10 * 100) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'val', fmt1(value)));
      return row;
    }

    function buildCard(e) {
      var card = el('article', 'card v-card');
      var top = el('div', 'v-card-top');
      var left = el('div');
      left.appendChild(el('h3', 'v-name', e.name));
      if (e.loc) left.appendChild(el('p', 'v-loc', e.loc));
      if (e.demo) left.appendChild(el('span', 'v-demo-tag', 'Sample'));
      top.appendChild(left);

      var ov = el('div', 'v-overall');
      ov.appendChild(el('span', 'big', fmt1(overallOf(e))));
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
      statsEl.appendChild(el('strong', null, fmt1(avg)));

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
   * SETTINGS — API key panel
   * ================================================================== */
  var settings = (function () {
    var backdrop = $('settings-backdrop');
    var input = $('key-input');
    var msg = $('settings-msg');
    var badge = $('mode-badge');
    var badgeText = $('mode-badge-text');
    var settingsLabel = document.querySelector('.settings-label');
    var lastFocused = null;

    function refreshMode() {
      var has = !!store.getKey();
      if (badge) badge.classList.toggle('is-live', has);
      if (badgeText) {
        badgeText.textContent = has
          ? 'Live results from Google Places.'
          : 'Sample data — add your Google Maps API key for live results.';
      }
      var addBtn = $('badge-add-key');
      if (addBtn) addBtn.textContent = has ? 'Change key' : 'Add key';
      if (settingsLabel) settingsLabel.textContent = has ? 'Live data on' : 'Use live data';
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
      $('settings-open').addEventListener('click', open);
      var addBtn = $('badge-add-key');
      if (addBtn) addBtn.addEventListener('click', open);
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
        find.renderDemo();
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
    settings.init();
    find.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
