/* lab.js — interactive layer for "The Lab".
   Owns: entrance bloom orchestration, the palette filter + FLIP re-layout, and
   the click-bloom page transition for LIVE tiles. Theme toggle, wash parallax,
   cursor paint and the golden-hour egg are all gallery.js's job — not touched here.
   Vanilla, no deps, no globals, no console noise. */
(function () {
  'use strict';

  if (window.__labInit) return;
  window.__labInit = true;

  var root = document.documentElement;

  /* ------------------------------------------------------------------ *
   * Capabilities
   * ------------------------------------------------------------------ */
  var reducedMotion = false;
  try {
    var rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = rmq.matches;
    var onRM = function (e) { reducedMotion = e.matches; };
    if (typeof rmq.addEventListener === 'function') rmq.addEventListener('change', onRM);
    else if (typeof rmq.addListener === 'function') rmq.addListener(onRM);
  } catch (e) { /* matchMedia unavailable; keep calm defaults */ }

  var mosaic = document.getElementById('mosaic');
  if (!mosaic) return;

  var pools = Array.prototype.slice.call(mosaic.querySelectorAll('.pool'));
  if (pools.length === 0) return;

  /* gallery.js auto-reveals every .reveal. Our pools are .reveal too, but we
     drive a richer entrance — neutralize the gallery reveal on pools so the two
     don't double-animate the same element. (Leaves head/palette .reveal alone.) */
  for (var p = 0; p < pools.length; p++) {
    pools[p].classList.remove('reveal');
  }

  /* ------------------------------------------------------------------ *
   * ENTRANCE — staggered wet bleed-in
   * ------------------------------------------------------------------ */
  (function initEntrance() {
    if (reducedMotion) return; // CSS reduced-motion block shows pools instantly

    root.classList.add('lab-staged'); // hides pools until we play
    for (var i = 0; i < pools.length; i++) {
      pools[i].style.setProperty('--i', String(Math.min(i, 12)));
    }

    var play = function () {
      // double-rAF so the hidden initial state is committed before we transition
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          for (var j = 0; j < pools.length; j++) pools[j].classList.add('bloomed');
        });
      });
    };

    if ('IntersectionObserver' in window) {
      // Bloom when the field scrolls into view (or immediately if already in).
      var obs = new IntersectionObserver(function (entries, observer) {
        for (var k = 0; k < entries.length; k++) {
          if (entries[k].isIntersecting) {
            play();
            observer.disconnect();
            return;
          }
        }
      }, { threshold: 0.08 });
      obs.observe(mosaic);
    } else {
      play();
    }
  })();

  /* ------------------------------------------------------------------ *
   * PALETTE FILTER + FLIP re-layout
   * ------------------------------------------------------------------ */
  (function initFilter() {
    var dabs = Array.prototype.slice.call(document.querySelectorAll('.palette .dab'));
    if (dabs.length === 0) return;
    var statusEl = document.querySelector('.filter-status');

    // The intro pool is always present regardless of filter.
    function poolMatches(pool, filter) {
      if (filter === 'all') return true;
      var type = pool.getAttribute('data-type');
      if (type === 'intro') return true;
      return type === filter;
    }

    var currentFilter = 'all';
    var animating = false;

    function announce(filter) {
      if (!statusEl) return;
      var visible = 0;
      for (var i = 0; i < pools.length; i++) {
        if (!pools[i].classList.contains('is-hidden')) visible++;
      }
      var label = filter === 'all' ? 'all projects'
        : filter === 'game' ? 'games'
        : filter === 'tool' ? 'tools'
        : filter === 'experiment' ? 'experiments'
        : filter;
      statusEl.textContent = 'Showing ' + label + ' — ' + visible + ' shown.';
    }

    function setVisibilityInstant(filter) {
      for (var i = 0; i < pools.length; i++) {
        var match = poolMatches(pools[i], filter);
        pools[i].classList.toggle('is-hidden', !match);
        pools[i].classList.remove('bleed-out', 'bleed-in', 'is-flipping', 'flip-play');
      }
    }

    function applyFilter(filter) {
      if (filter === currentFilter || animating) return;

      // --- Reduced motion: flip visibility instantly, no travel/bleed. ---
      if (reducedMotion) {
        currentFilter = filter;
        setVisibilityInstant(filter);
        announce(filter);
        return;
      }

      animating = true;

      // FLIP — FIRST: record current rects of pools that are (and will be) shown.
      var firstRects = {};
      var stayList = [];     // visible before AND after -> travel
      var enterList = [];    // hidden before, shown after -> bleed in
      var leaveList = [];    // visible before, hidden after -> bleed out

      for (var i = 0; i < pools.length; i++) {
        var pool = pools[i];
        var wasVisible = !pool.classList.contains('is-hidden');
        var willShow = poolMatches(pool, filter);
        if (wasVisible) firstRects[i] = pool.getBoundingClientRect();
        if (wasVisible && willShow) stayList.push(i);
        else if (!wasVisible && willShow) enterList.push(i);
        else if (wasVisible && !willShow) leaveList.push(i);
      }

      // Leaving tiles bleed out first; then we re-lay-out.
      var doRelayout = function () {
        // Apply final visibility (this is the layout mutation = "LAST").
        for (var i = 0; i < pools.length; i++) {
          var willShow = poolMatches(pools[i], filter);
          pools[i].classList.toggle('is-hidden', !willShow);
        }

        // LAST: measure new rects for staying tiles, INVERT, then PLAY.
        var inverted = [];
        for (var s = 0; s < stayList.length; s++) {
          var idx = stayList[s];
          var pool2 = pools[idx];
          var first = firstRects[idx];
          if (!first) continue;
          var last = pool2.getBoundingClientRect();
          var dx = first.left - last.left;
          var dy = first.top - last.top;
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
          pool2.classList.add('is-flipping');
          pool2.style.setProperty('--flip-x', dx.toFixed(1) + 'px');
          pool2.style.setProperty('--flip-y', dy.toFixed(1) + 'px');
          inverted.push(pool2);
        }

        // Entering tiles bleed in.
        for (var e = 0; e < enterList.length; e++) {
          pools[enterList[e]].classList.add('bleed-in');
        }

        // PLAY: next frame, release the inverted transforms so they glide back.
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            for (var f = 0; f < inverted.length; f++) {
              inverted[f].classList.add('flip-play');
            }
          });
        });

        // Cleanup once the travel + bleed finish (~0.6s).
        window.setTimeout(function () {
          for (var c = 0; c < pools.length; c++) {
            pools[c].classList.remove('is-flipping', 'flip-play', 'bleed-in', 'bleed-out');
            pools[c].style.removeProperty('--flip-x');
            pools[c].style.removeProperty('--flip-y');
          }
          animating = false;
        }, 700);

        announce(filter);
      };

      if (leaveList.length > 0) {
        for (var l = 0; l < leaveList.length; l++) {
          pools[leaveList[l]].classList.add('bleed-out');
        }
        window.setTimeout(doRelayout, 240); // let the bleed-out begin first
      } else {
        doRelayout();
      }

      currentFilter = filter;
    }

    function selectDab(dab) {
      var filter = dab.getAttribute('data-filter') || 'all';
      for (var i = 0; i < dabs.length; i++) {
        var on = dabs[i] === dab;
        dabs[i].classList.toggle('is-active', on);
        dabs[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      applyFilter(filter);
    }

    for (var d = 0; d < dabs.length; d++) {
      dabs[d].addEventListener('click', function (ev) {
        selectDab(ev.currentTarget);
      });
    }
  })();

  /* ------------------------------------------------------------------ *
   * PAGE TRANSITION — click-bloom for LIVE tiles.
   *
   * When a project goes live, its tile wraps content in <a class="pool-link">.
   * On a plain click we bloom the tile's accent out from the pointer to wash
   * the whole screen, THEN navigate — entering a project feels like spreading
   * paint. Where the cross-document View Transitions API is supported the CSS
   * `@view-transition { navigation: auto }` already gives a native crossfade;
   * this overlay is the progressive-enhancement fallback for the bloom feel.
   *
   * NOTE: all seed tiles are status="idea" (non-links) so nothing fires today,
   * but this is built correctly for when projects ship.
   * ------------------------------------------------------------------ */
  (function initPageTransition() {
    var overlay = document.getElementById('bloom-overlay');

    function shouldIntercept(ev, link) {
      if (ev.defaultPrevented) return false;
      if (ev.button !== 0) return false;              // not a primary click
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return false;
      var href = link.getAttribute('href');
      if (!href || href.charAt(0) === '#') return false;
      if (link.target && link.target !== '_self') return false;
      // Same-origin only (don't bloom away to external sites).
      try {
        var url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return false;
      } catch (e) { return false; }
      return true;
    }

    mosaic.addEventListener('click', function (ev) {
      var target = ev.target;
      var link = target && target.closest ? target.closest('a.pool-link') : null;
      if (!link) return;
      if (!shouldIntercept(ev, link)) return; // let modified/middle clicks pass

      // Reduced motion or no overlay: navigate plainly (CSS already no-ops).
      if (reducedMotion || !overlay) return;

      ev.preventDefault();

      var pool = link.closest('.pool');
      var accent = '';
      if (pool) {
        accent = getComputedStyle(pool).getPropertyValue('--accent-deep').trim() ||
                 getComputedStyle(pool).getPropertyValue('--accent').trim();
      }
      if (accent) overlay.style.setProperty('--bloom-accent', accent);
      overlay.style.setProperty('--bloom-x', ev.clientX + 'px');
      overlay.style.setProperty('--bloom-y', ev.clientY + 'px');

      var href = link.href;
      var navigated = false;
      var go = function () {
        if (navigated) return;
        navigated = true;
        window.location.href = href;
      };

      overlay.addEventListener('transitionend', function te(e) {
        if (e.propertyName !== 'transform') return;
        overlay.removeEventListener('transitionend', te);
        go();
      });

      // Kick the bloom on the next frame so the transition runs.
      window.requestAnimationFrame(function () {
        overlay.classList.add('blooming');
      });

      // Safety net: navigate even if transitionend never fires.
      window.setTimeout(go, 750);
    });
  })();
})();
