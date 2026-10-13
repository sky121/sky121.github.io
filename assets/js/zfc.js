/* ==========================================================================
   zfc.js — "The Z fc Watch" status board.

   Reads two files committed by the scheduled watcher:
     data/zfc-status.json    the latest reading per colour variant
     data/zfc-history.jsonl  append-only log, one JSON object per line

   Both are same-origin, so a plain fetch works. This page NEVER contacts
   the retailer: it cannot (no CORS), and pretending otherwise is exactly
   the kind of lie this project is built to avoid.

   House style: one 'use strict' IIFE, vanilla, no dependencies, no leaked
   globals, var/function to match eats.js.

   THE RULES THIS FILE EXISTS TO ENFORCE
     1. `unknown` is rendered as its own thing, never as out-of-stock.
     2. The freshness of the data is always stated, and stale data is
        flagged rather than dressed up as live.
     3. Nothing is invented. Missing price, missing URL and missing
        readings each say so in plain words.
   ========================================================================== */
(function () {
  'use strict';

  var STATUS_URL = 'data/zfc-status.json';
  var HISTORY_URL = 'data/zfc-history.jsonl';
  var STALE_MS = 2 * 60 * 60 * 1000;   /* 2 hours — louder than the 15-min cadence */
  var MAX_LOG = 40;

  /* Swatches for the known Z fc finishes. A colour the config adds later
     and this map has not heard of falls back to the paper tone — never a
     wrong colour presented as fact. */
  var SWATCHES = {
    'black': '#3a3a3c',
    'amber brown': '#9a6b43',
    'coral pink': '#e4a0a0',
    'mint green': '#a8ccb6',
    'natural gray': '#b9b4a9',
    'natural grey': '#b9b4a9',
    'sand beige': '#d9c7a5',
    'sunset orange': '#d98a4e',
    'white': '#ece7dc',
    'midnight grey': '#55595f',
    'stone gray': '#9aa0a2'
  };

  /* Display states. `unconfigured` is split out of `unknown` so a variant
     nobody has pasted a URL for reads as a setup task, not a parser fault. */
  var PILLS = {
    in_stock:     { glyph: '●', label: 'In stock' },
    out_of_stock: { glyph: '○', label: 'Out of stock' },
    unknown:      { glyph: '?',      label: 'Unknown' },
    unconfigured: { glyph: '!',      label: 'Not watched yet' }
  };

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function parseTime(value) {
    if (!value) return null;
    var t = Date.parse(value);
    return isFinite(t) ? t : null;
  }

  /** "4 minutes ago", "3 hours ago", "2 days ago" — never a fake precision. */
  function ago(ms) {
    var s = Math.round(ms / 1000);
    if (s < 45) return 'moments ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    var h = Math.round(m / 60);
    if (h < 36) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.round(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  function fullTime(ts) {
    try {
      return new Date(ts).toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
    } catch (e) {
      return new Date(ts).toISOString();
    }
  }

  function money(amount, currency) {
    if (typeof amount !== 'number' || !isFinite(amount)) return null;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 2
      }).format(amount);
    } catch (e) {
      return (currency ? currency + ' ' : '$') + amount.toFixed(2);
    }
  }

  function displayStatus(variant) {
    if (variant.errorKind === 'config') return 'unconfigured';
    if (variant.status === 'in_stock' || variant.status === 'out_of_stock') return variant.status;
    return 'unknown';
  }

  /** Why a non-clean reading happened, in words a human can act on. */
  function caveatFor(variant) {
    switch (variant.errorKind) {
      case 'config':
        return 'No product URL has been added for this colour yet, so it is not ' +
          'being checked at all. Paste its nikonusa.com address into ' +
          'tools/zfc-watch/config.json and the watcher will pick it up.';
      case 'robots':
        return 'The watcher did not fetch this page, because robots.txt either ' +
          'forbids it or could not be read. It would rather stay polite and ' +
          'say nothing than fetch where it is not welcome.';
      case 'network':
        return 'The page could not be reached on this run. If this keeps up, ' +
          'the URL has probably moved.';
      case 'http':
        return 'The page answered with an error' +
          (variant.httpStatus ? ' (HTTP ' + variant.httpStatus + ')' : '') +
          ', so there was nothing to read. The URL may have moved.';
      case 'parse':
        return 'The page loaded, but none of the signals the watcher understands ' +
          'said whether it is in stock. This is NOT the same as out of stock ' +
          '— it means the watcher has gone blind here and needs fixing.';
      default:
        return 'The watcher could not establish this one either way. Treat it as ' +
          '"not known", not as "out of stock".';
    }
  }

  /* ------------------------------------------------------------------ *
   * The freshness pulse
   * ------------------------------------------------------------------ */
  function renderPulse(doc, historyCount) {
    var pulse = $('pulse');
    var main = $('pulse-main');
    var sub = $('pulse-sub');
    if (!pulse || !main || !sub) return;

    if (!doc) {
      pulse.setAttribute('data-freshness', 'error');
      main.textContent = 'The readings could not be loaded.';
      sub.textContent = 'data/zfc-status.json did not come back. Nothing below is current.';
      return;
    }

    var checkedAt = parseTime(doc.checkedAt);
    if (!checkedAt) {
      pulse.setAttribute('data-freshness', 'never');
      main.textContent = 'The watcher has not run yet.';
      sub.textContent = 'No reading has ever been taken, so there is nothing to report ' +
        'and nothing is being guessed.';
      return;
    }

    var age = Date.now() - checkedAt;
    var stale = age > STALE_MS;
    pulse.setAttribute('data-freshness', stale ? 'stale' : 'live');
    main.textContent = stale
      ? 'Stale — last checked ' + ago(age) + '.'
      : 'Last checked ' + ago(age) + '.';
    sub.textContent = (stale
      ? 'That is longer than it should ever be. The scheduled job may be delayed, ' +
        'disabled, or failing — treat everything below as possibly out of date. '
      : '') +
      fullTime(checkedAt) +
      (historyCount ? ' · ' + historyCount + ' change' + (historyCount === 1 ? '' : 's') + ' on record' : '');
  }

  /* ------------------------------------------------------------------ *
   * Price sparkline — drawn only when the history actually supports it.
   * ------------------------------------------------------------------ */
  function sparkline(points) {
    if (!points || points.length < 2) return null;
    var w = 160;
    var h = 34;
    var pad = 3;
    var min = Infinity;
    var max = -Infinity;
    var i;
    for (i = 0; i < points.length; i++) {
      if (points[i] < min) min = points[i];
      if (points[i] > max) max = points[i];
    }
    var span = (max - min) || 1;
    var step = (w - pad * 2) / (points.length - 1);
    var d = '';
    for (i = 0; i < points.length; i++) {
      var x = pad + step * i;
      var y = pad + (h - pad * 2) * (1 - (points[i] - min) / span);
      d += (i ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    var lastX = pad + step * (points.length - 1);
    var lastY = pad + (h - pad * 2) * (1 - (points[points.length - 1] - min) / span);

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'zfc-spark');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'zfc-spark-line');
    path.setAttribute('d', d);
    svg.appendChild(path);

    var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class', 'zfc-spark-dot');
    dot.setAttribute('cx', lastX.toFixed(1));
    dot.setAttribute('cy', lastY.toFixed(1));
    dot.setAttribute('r', '2.6');
    svg.appendChild(dot);

    return svg;
  }

  /* ------------------------------------------------------------------ *
   * Cards
   * ------------------------------------------------------------------ */
  function renderCard(variant, priceHistory) {
    var state = displayStatus(variant);
    var pill = PILLS[state];

    var li = el('li', 'zfc-card');
    li.setAttribute('data-status', state);

    var head = el('div', 'zfc-card-head');
    var swatch = el('span', 'zfc-swatch');
    var key = String(variant.colour || '').toLowerCase();
    swatch.style.setProperty('--swatch', SWATCHES[key] || 'var(--paper-deep)');
    swatch.setAttribute('aria-hidden', 'true');
    head.appendChild(swatch);
    head.appendChild(el('h3', 'zfc-name', variant.colour || variant.name || 'Unnamed variant'));
    li.appendChild(head);

    /* The pill. The visible glyph is decorative; the word carries the
       meaning, and a visually-hidden prefix names the product for anyone
       hearing the cards out of context. */
    var p = el('p', 'zfc-pill');
    var glyph = el('span', 'zfc-pill-glyph', pill.glyph);
    glyph.setAttribute('aria-hidden', 'true');
    p.appendChild(glyph);
    var sr = el('span', 'visually-hidden', (variant.name || variant.colour || 'This variant') + ': ');
    p.appendChild(sr);
    p.appendChild(el('span', null, pill.label));
    li.appendChild(p);

    /* Price */
    var priceText = money(variant.price, variant.currency);
    if (priceText) {
      var price = el('p', 'zfc-price', priceText);
      var previous = priceHistory && priceHistory.length > 1
        ? priceHistory[priceHistory.length - 2] : null;
      if (typeof previous === 'number' && previous !== variant.price) {
        var was = el('span', 'zfc-was', money(previous, variant.currency));
        was.setAttribute('aria-label', 'previously ' + money(previous, variant.currency));
        price.appendChild(was);
      }
      li.appendChild(price);
    } else {
      li.appendChild(el('p', 'zfc-price zfc-price-none', 'no price read'));
    }

    var spark = sparkline(priceHistory);
    if (spark) {
      li.appendChild(spark);
      li.appendChild(el('p', 'zfc-meta',
        'Price history: ' + priceHistory.map(function (v) {
          return money(v, variant.currency);
        }).join(' → ')));
    }

    /* When this last changed */
    var changedAt = parseTime(variant.lastChangedAt);
    li.appendChild(el('p', 'zfc-meta', changedAt
      ? 'Status last changed ' + ago(Date.now() - changedAt) + ' (' + fullTime(changedAt) + ').'
      : 'No change recorded yet.'));

    /* The audit line — which signal decided this */
    if (state === 'in_stock' || state === 'out_of_stock') {
      var why = el('p', 'zfc-why');
      why.appendChild(document.createTextNode('Read from '));
      why.appendChild(el('code', null, variant.signal || 'unknown signal'));
      if (variant.detail) why.appendChild(document.createTextNode(' — ' + variant.detail));
      li.appendChild(why);
    } else {
      li.appendChild(el('p', 'zfc-caveat', caveatFor(variant)));
      if (variant.error) {
        var errLine = el('p', 'zfc-why');
        errLine.appendChild(document.createTextNode('Checker said: '));
        errLine.appendChild(el('code', null, variant.error));
        li.appendChild(errLine);
      }
    }

    /* The way out */
    if (variant.url) {
      var a = el('a', 'zfc-link', 'View the product page');
      a.href = variant.url;
      a.rel = 'noopener';
      a.target = '_blank';
      a.setAttribute('aria-label', 'View the ' + (variant.name || variant.colour) +
        ' product page (opens in a new tab)');
      li.appendChild(a);
    }

    return li;
  }

  /* ------------------------------------------------------------------ *
   * Change log
   * ------------------------------------------------------------------ */
  function logKind(entry) {
    if (entry.kind === 'price') return 'price';
    if (entry.to === 'in_stock') return 'in_stock';
    if (entry.to === 'unknown') return 'unknown';
    return 'status';
  }

  function logSentence(entry) {
    var label = function (s) {
      if (s === 'in_stock') return 'in stock';
      if (s === 'out_of_stock') return 'out of stock';
      if (s === 'unknown') return 'unknown';
      if (s == null) return 'nothing';
      return String(s);
    };
    if (entry.kind === 'price') {
      var from = money(entry.from, entry.currency);
      var to = money(entry.to, entry.currency);
      if (from && to) {
        /* Compare the NUMBERS, not the formatted strings — "$956.95" sorts
           above "$1,096.95" as text, which would call a drop a rise. */
        var dropped = entry.to < entry.from;
        return (dropped ? 'dropped from ' : 'rose from ') + from + ' to ' + to;
      }
      return to ? 'price read as ' + to : 'price could no longer be read';
    }
    if (entry.kind === 'signal') {
      return 'the watcher switched signal: ' + label(entry.from) + ' → ' + label(entry.to);
    }
    if (entry.kind === 'first-reading') {
      return 'first reading: ' + label(entry.to);
    }
    return label(entry.from) + ' → ' + label(entry.to);
  }

  function renderLog(entries) {
    var list = $('log');
    var note = $('log-note');
    if (!list) return;
    clear(list);

    if (!entries.length) {
      note.textContent = 'Nothing has changed yet — there is no history to show. ' +
        'The first reading will appear here.';
      return;
    }

    note.textContent = 'Every status, price and parsing change the watcher has recorded, ' +
      'newest first' + (entries.length > MAX_LOG ? ' (latest ' + MAX_LOG + ' of ' + entries.length + ')' : '') + '.';

    /* The file is append-only and therefore already chronological, but a
       hand-edited or merged history should still read correctly, so sort
       on the timestamps rather than trusting line order. */
    var sorted = entries.slice().sort(function (a, b) {
      return (parseTime(a.at) || 0) - (parseTime(b.at) || 0);
    });
    var recent = sorted.slice(-MAX_LOG).reverse();
    for (var i = 0; i < recent.length; i++) {
      var entry = recent[i];
      var li = el('li', 'zfc-log-item');
      li.setAttribute('data-kind', logKind(entry));
      var at = parseTime(entry.at);
      li.appendChild(el('span', 'zfc-log-when', at ? fullTime(at) + ' · ' + ago(Date.now() - at) : 'undated'));
      var what = el('span', 'zfc-log-what');
      what.appendChild(el('strong', null, entry.variant || entry.key || 'A variant'));
      what.appendChild(document.createTextNode(' ' + logSentence(entry)));
      li.appendChild(what);
      list.appendChild(li);
    }
  }

  /* ------------------------------------------------------------------ *
   * Data loading
   * ------------------------------------------------------------------ */
  function loadJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error(url + ' responded ' + res.status);
      return res.json();
    });
  }

  function loadHistory() {
    return fetch(HISTORY_URL, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) return [];
      return res.text();
    }).then(function (text) {
      if (typeof text !== 'string' || !text.trim()) return [];
      var out = [];
      var lines = text.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        try { out.push(JSON.parse(line)); } catch (e) { /* a torn line is not worth failing over */ }
      }
      return out;
    })['catch'](function () { return []; });
  }

  /** Ordered price readings per variant key, for the sparklines. */
  function pricesByKey(entries) {
    var map = {};
    var ordered = entries.slice().sort(function (a, b) {
      return (parseTime(a.at) || 0) - (parseTime(b.at) || 0);
    });
    for (var i = 0; i < ordered.length; i++) {
      var e = ordered[i];
      if (typeof e.price !== 'number') continue;
      var key = e.key || e.variant;
      if (!key) continue;
      if (!map[key]) map[key] = [];
      var list = map[key];
      if (list[list.length - 1] !== e.price) list.push(e.price);
    }
    return map;
  }

  function showNote(title, body) {
    var note = $('note');
    if (!note) return;
    $('note-title').textContent = title;
    $('note-body').textContent = body;
    note.hidden = false;
  }

  function hideNote() {
    var note = $('note');
    if (note) note.hidden = true;
  }

  function render(doc, entries) {
    var grid = $('grid');
    renderPulse(doc, entries.length);
    renderLog(entries);

    clear(grid);
    grid.setAttribute('aria-busy', 'false');

    var variants = (doc && Array.isArray(doc.variants)) ? doc.variants : [];
    if (!variants.length) {
      showNote(
        doc ? 'No readings yet' : 'The readings could not be loaded',
        doc
          ? 'The watcher runs about every 15 minutes and has not recorded a ' +
            'single colour yet. Nothing is being guessed in the meantime — ' +
            'as soon as it has looked once, every colour appears here.'
          : 'data/zfc-status.json could not be fetched, so this page has nothing ' +
            'honest to show. If you are running the site locally, serve it over ' +
            'HTTP rather than opening the file directly.'
      );
      return;
    }

    hideNote();
    var prices = pricesByKey(entries);
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      grid.appendChild(renderCard(v, prices[v.key || v.name]));
    }

    /* Announce the headline once, for anyone not reading the cards.
       When the data is stale the WARNING leads and the headline follows:
       "1 in stock" is worthless news if the reading is five hours old. */
    var inStock = variants.filter(function (v) { return v.status === 'in_stock'; });
    var unknown = variants.filter(function (v) { return displayStatus(v) === 'unknown'; });
    var fresh = $('pulse').getAttribute('data-freshness') === 'live';
    var pulseMain = $('pulse-main');
    if (pulseMain) {
      var head = inStock.length
        ? inStock.length + ' in stock: ' + inStock.map(function (v) { return v.colour || v.name; }).join(', ')
        : 'Nothing in stock';
      pulseMain.textContent = fresh
        ? head + '. ' + pulseMain.textContent
        : pulseMain.textContent + ' It said ' + head.charAt(0).toLowerCase() + head.slice(1) +
          ' — but that was then, not now.';
    }
    if (unknown.length) {
      var sub = $('pulse-sub');
      if (sub) {
        sub.textContent = sub.textContent + ' · ' + unknown.length + ' colour' +
          (unknown.length === 1 ? '' : 's') + ' could not be read — see the cards.';
      }
    }
  }

  function start() {
    Promise.all([
      loadJson(STATUS_URL)['catch'](function () { return null; }),
      loadHistory()
    ]).then(function (results) {
      render(results[0], results[1] || []);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
