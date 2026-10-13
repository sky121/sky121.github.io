/* ==========================================================================
   parse.mjs — signal-based product-page parser for the Nikon Z fc watcher.

   Pure functions only: HTML string in, verdict out. No network, no fs, no
   deps, no DOM. Everything here is unit-tested against local fixtures
   (tools/zfc-watch/fixtures) because the live site is deliberately not
   consulted from the build sandbox.

   DESIGN RULE #1 — "unknown" is a first-class answer.
   A missed restock is the only failure mode that actually costs the user
   anything, so the parser NEVER guesses "out_of_stock". If no signal it
   understands is present, the verdict is `unknown`, which the checker
   treats as a reportable condition (see check.mjs / notify.mjs).

   DESIGN RULE #2 — every verdict is auditable.
   The result carries `signal` (which signal decided the status),
   `priceSignal` (which decided the price) and `candidates` (everything the
   parser saw, in priority order) so a human can read the status file and
   understand *why* the watcher believes what it believes.

   Signal priority:
     1. jsonld     schema.org Product/Offer (offers.availability + price)
     2. meta       product:availability / og:availability / product:price:*
     3. text       buy-control text, then (weakly) body copy
     4. none       -> unknown
   ========================================================================== */

'use strict';

export const STATUS = {
  IN: 'in_stock',
  OUT: 'out_of_stock',
  UNKNOWN: 'unknown'
};

/* ------------------------------------------------------------------ *
 * Tiny HTML helpers (no DOM available — these are deliberately dumb
 * and forgiving; anything they cannot understand degrades to null).
 * ------------------------------------------------------------------ */

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', rsquo: '’',
  lsquo: '‘', ldquo: '“', rdquo: '”', reg: '®',
  trade: '™', copy: '©', deg: '°', eacute: 'é'
};

export function decodeEntities(input) {
  if (typeof input !== 'string' || input.indexOf('&') === -1) return input || '';
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (whole, body) => {
    if (body.charAt(0) === '#') {
      const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try { return String.fromCodePoint(code); } catch (e) { return whole; }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/** Strip the parts of a document whose text is never user-visible copy. */
export function stripNonContent(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template\s*>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, ' ');
}

/** Visible-ish text: tags removed, entities decoded, whitespace collapsed. */
export function visibleText(html) {
  return decodeEntities(stripNonContent(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalise for phrase matching: lowercase, unify punctuation/whitespace. */
export function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse a price-ish string into a number. "$1,096.95" -> 1096.95 */
export function parsePrice(value) {
  if (typeof value === 'number') return isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^\d.,]/g, '').trim();
  if (!/\d/.test(cleaned)) return null;

  /* Decide which of . and , is the decimal point: whichever comes last AND
     is followed by one or two digits. Otherwise both are grouping marks.
     "$1,096.95" -> 1096.95   "1.096,95" -> 1096.95   "1,096" -> 1096 */
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const sepIndex = Math.max(lastComma, lastDot);
  let normalised;
  if (sepIndex !== -1 && /^\d{1,2}$/.test(cleaned.slice(sepIndex + 1))) {
    normalised = cleaned.slice(0, sepIndex).replace(/[.,]/g, '') + '.' + cleaned.slice(sepIndex + 1);
  } else {
    normalised = cleaned.replace(/[.,]/g, '');
  }

  const n = parseFloat(normalised);
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/* ------------------------------------------------------------------ *
 * Signal 1 — schema.org JSON-LD
 * ------------------------------------------------------------------ */

const AVAILABILITY_IN = ['instock', 'instoreonly', 'onlineonly', 'limitedavailability'];
const AVAILABILITY_OUT = ['outofstock', 'soldout', 'discontinued'];
const AVAILABILITY_PENDING = ['backorder', 'preorder', 'presale'];

/**
 * schema.org availability -> our status.
 * BackOrder / PreOrder are NOT "in stock" and are NOT "out of stock" — they
 * are a thing the user would want to know about, so they map to `unknown`
 * (which alerts) rather than being quietly folded into out_of_stock.
 */
export function availabilityToStatus(value) {
  if (value == null) return null;
  const token = String(value).toLowerCase().replace(/^.*schema\.org\//, '').replace(/[^a-z]/g, '');
  if (!token) return null;
  if (AVAILABILITY_IN.indexOf(token) !== -1) return STATUS.IN;
  if (AVAILABILITY_OUT.indexOf(token) !== -1) return STATUS.OUT;
  if (AVAILABILITY_PENDING.indexOf(token) !== -1) return STATUS.UNKNOWN;
  return null;
}

/** Pull the raw text of every <script type="application/ld+json"> block. */
export function extractJsonLdBlocks(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const attrs = m[1] || '';
    if (!/type\s*=\s*["']?application\/ld\+json/i.test(attrs)) continue;
    const body = m[2].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
    if (body) out.push(body);
  }
  return out;
}

/** Depth-limited walk collecting every plain object in a JSON-LD payload. */
function collectNodes(value, depth, acc) {
  if (depth > 12 || value == null || acc.length > 4000) return acc;
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, depth + 1, acc);
    return acc;
  }
  if (typeof value === 'object') {
    acc.push(value);
    for (const key of Object.keys(value)) collectNodes(value[key], depth + 1, acc);
  }
  return acc;
}

function typesOf(node) {
  const t = node['@type'];
  if (!t) return [];
  return (Array.isArray(t) ? t : [t]).map((x) => String(x).toLowerCase());
}

function isOfferNode(node) {
  const types = typesOf(node);
  if (types.some((t) => t === 'offer' || t === 'aggregateoffer')) return true;
  // Untyped but offer-shaped (plenty of real-world JSON-LD is sloppy).
  return ('availability' in node) || ('price' in node && 'priceCurrency' in node);
}

/**
 * Read status + price out of every JSON-LD block.
 * Multiple offers are merged optimistically for status: if ANY offer on the
 * page says InStock, the variant is in stock (that is the thing the user
 * wants to hear about). Price is taken from the cheapest offer that has one.
 */
export function fromJsonLd(html) {
  const blocks = extractJsonLdBlocks(html);
  if (!blocks.length) return null;

  const offers = [];
  let parsedAny = false;
  let malformed = 0;

  for (const raw of blocks) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      malformed++;
      continue;
    }
    parsedAny = true;
    const nodes = collectNodes(data, 0, []);
    for (const node of nodes) {
      if (!isOfferNode(node)) continue;
      const status = availabilityToStatus(
        node.availability != null ? node.availability
          : (node.itemCondition != null && node.availabilityStarts != null ? null : null)
      );
      const price = parsePrice(
        node.price != null ? node.price
          : (node.lowPrice != null ? node.lowPrice : node.highPrice)
      );
      const currency = typeof node.priceCurrency === 'string' ? node.priceCurrency.toUpperCase() : null;
      if (status || price != null) offers.push({ status, price, currency, raw: node.availability || null });
    }
  }

  if (!offers.length) {
    return {
      signal: 'jsonld',
      status: null,
      price: null,
      currency: null,
      detail: parsedAny
        ? 'ld+json present but no offer with availability/price'
        : 'ld+json present but all ' + malformed + ' block(s) failed to parse'
    };
  }

  let status = null;
  if (offers.some((o) => o.status === STATUS.IN)) status = STATUS.IN;
  else if (offers.some((o) => o.status === STATUS.OUT)) status = STATUS.OUT;
  else if (offers.some((o) => o.status === STATUS.UNKNOWN)) status = STATUS.UNKNOWN;

  const priced = offers.filter((o) => o.price != null).sort((a, b) => a.price - b.price);
  const best = priced.length ? priced[0] : null;

  return {
    signal: 'jsonld',
    status,
    price: best ? best.price : null,
    currency: best ? best.currency : null,
    detail: 'offers=' + offers.length +
      (offers[0] && offers[0].raw ? ' availability=' + offers[0].raw : '') +
      (malformed ? ' (' + malformed + ' malformed block(s) skipped)' : '')
  };
}

/* ------------------------------------------------------------------ *
 * Signal 2 — meta tags
 * ------------------------------------------------------------------ */

function metaMap(html) {
  const map = Object.create(null);
  const re = /<meta\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const attrs = m[1];
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const val = /content\s*=\s*["']([^"']*)["']/i.exec(attrs);
    if (!key || !val) continue;
    const k = key[1].trim().toLowerCase();
    if (!(k in map)) map[k] = decodeEntities(val[1]).trim();
  }
  return map;
}

/** Looser availability vocabulary used by Open Graph / product meta tags. */
function metaAvailabilityToStatus(value) {
  const v = normalise(value).replace(/[^a-z]/g, '');
  if (!v) return null;
  if (['instock', 'available', 'availablefororder', 'instoreonly'].indexOf(v) !== -1) return STATUS.IN;
  if (['outofstock', 'oos', 'soldout', 'discontinued'].indexOf(v) !== -1) return STATUS.OUT;
  if (['backorder', 'preorder', 'pending', 'limitedavailability'].indexOf(v) !== -1) return STATUS.UNKNOWN;
  return availabilityToStatus(value);
}

export function fromMeta(html) {
  const meta = metaMap(html);
  const availKeys = ['product:availability', 'og:availability', 'availability', 'og:product:availability'];
  const priceKeys = ['product:price:amount', 'og:price:amount', 'product:price', 'price'];
  const currencyKeys = ['product:price:currency', 'og:price:currency', 'pricecurrency'];

  let status = null;
  let statusKey = null;
  for (const k of availKeys) {
    if (meta[k] == null) continue;
    const s = metaAvailabilityToStatus(meta[k]);
    if (s) { status = s; statusKey = k + '=' + meta[k]; break; }
  }

  let price = null;
  let priceKey = null;
  for (const k of priceKeys) {
    if (meta[k] == null) continue;
    const p = parsePrice(meta[k]);
    if (p != null) { price = p; priceKey = k; break; }
  }

  let currency = null;
  for (const k of currencyKeys) {
    if (meta[k]) { currency = String(meta[k]).toUpperCase().slice(0, 8); break; }
  }

  if (status == null && price == null) return null;
  return {
    signal: 'meta',
    status,
    price,
    currency,
    detail: [statusKey, priceKey].filter(Boolean).join(' ') || 'meta tags present'
  };
}

/* ------------------------------------------------------------------ *
 * Signal 3 — visible text cues
 *
 * Two passes, strongest first:
 *   text:control — the label of an actual buy/notify CONTROL: <button>,
 *                  <input type=submit|button>, role="button", plus their
 *                  aria-label/title. A stray phrase in a review or a footer
 *                  cannot reach this pass.
 *   text:link    — the label of an <a>. Anchors navigate rather than act, so
 *                  they are only consulted when no real control matched —
 *                  otherwise a footer's "Out of stock & backorder policy"
 *                  link would outvote the Add to Cart button.
 *   text:body    — unambiguous banner copy, used only when nothing above
 *                  matched, and only when the page says ONE thing.
 * Conflicting cues resolve to `unknown` (signal text:conflict), never to a
 * coin-flip — an honest "I don't know" is alertable, a wrong guess is not.
 * ------------------------------------------------------------------ */

const OUT_PHRASES = [
  'out of stock',
  'sold out',
  'currently unavailable',
  'temporarily unavailable',
  'temporarily out of stock',
  'notify me when available',
  'notify me when back in stock',
  'email me when available',
  'email when available',
  'back in stock notification',
  'no longer available',
  'discontinued'
];

const IN_CONTROL_PHRASES = [
  'add to cart',
  'add to bag',
  'add to basket',
  'buy now',
  'buy it now',
  'add to order',
  'checkout now',
  'in stock'
];

/* "in stock" must not be harvested out of "out of stock" / "back in stock". */
const IN_BODY_RE = /(?:^|[^a-z])(?<!out of )(?<!back )in stock(?:$|[^a-z])/;

function tidy(list) {
  return Array.from(new Set(
    list.map(normalise).filter((s) => s && s.length <= 120)
  ));
}

/**
 * @returns {{strong:string[], weak:string[]}} strong = real controls
 *          (button / submit / role=button), weak = anchors.
 */
export function controlLabels(html) {
  const src = stripNonContent(html);
  const strong = [];
  const weak = [];
  let m;

  // <button> and <summary> element text + aria-label/title
  const btnRe = /<(button|summary)\b([^>]*)>([\s\S]{0,600}?)<\/\1\s*>/gi;
  while ((m = btnRe.exec(src)) !== null) {
    const inner = decodeEntities(m[3].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (inner) strong.push(inner);
    const aria = /aria-label\s*=\s*["']([^"']+)["']/i.exec(m[2] || '');
    if (aria) strong.push(decodeEntities(aria[1]));
    const title = /\btitle\s*=\s*["']([^"']+)["']/i.exec(m[2] || '');
    if (title) strong.push(decodeEntities(title[1]));
  }

  // <input type=submit|button value="...">
  const inputRe = /<input\b([^>]*)>/gi;
  while ((m = inputRe.exec(src)) !== null) {
    const attrs = m[1] || '';
    if (!/type\s*=\s*["']?(submit|button)/i.test(attrs)) continue;
    const val = /value\s*=\s*["']([^"']*)["']/i.exec(attrs);
    if (val) strong.push(decodeEntities(val[1]));
    const aria = /aria-label\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (aria) strong.push(decodeEntities(aria[1]));
  }

  // Buttons by ARIA only (divs/spans in SPA markup)
  const roleRe = /<([a-z][a-z0-9]*)\b([^>]*\brole\s*=\s*["']button["'][^>]*)>([\s\S]{0,400}?)<\/\1\s*>/gi;
  while ((m = roleRe.exec(src)) !== null) {
    const inner = decodeEntities(m[3].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (inner) strong.push(inner);
    const aria = /aria-label\s*=\s*["']([^"']+)["']/i.exec(m[2]);
    if (aria) strong.push(decodeEntities(aria[1]));
  }

  // Anchors — weak. Footer policy links and help-centre questions live here.
  const aRe = /<a\b([^>]*)>([\s\S]{0,400}?)<\/a\s*>/gi;
  while ((m = aRe.exec(src)) !== null) {
    const inner = decodeEntities(m[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (inner) weak.push(inner);
    const aria = /aria-label\s*=\s*["']([^"']+)["']/i.exec(m[1] || '');
    if (aria) weak.push(decodeEntities(aria[1]));
  }

  return { strong: tidy(strong), weak: tidy(weak) };
}

function matchPhrases(haystacks, phrases) {
  const hits = [];
  for (const h of haystacks) {
    for (const p of phrases) {
      if (h.indexOf(p) !== -1) hits.push(p);
    }
  }
  return Array.from(new Set(hits));
}

/** A price in the visible copy, as a last resort. "$1,096.95" */
function priceFromText(text) {
  const m = /(?:^|[^a-z0-9])\$\s?([0-9][0-9,]{1,9}(?:\.[0-9]{2})?)/i.exec(text);
  if (!m) return null;
  return parsePrice(m[1]);
}

export function fromText(html) {
  const labels = controlLabels(html);
  const body = normalise(visibleText(html));

  const price = priceFromText(body);
  const currency = price != null && /\$/.test(body) ? 'USD' : null;

  /* Pass A: real controls. Pass B: anchors, only if no control spoke. */
  const passes = [
    { signal: 'text:control', where: 'control label', labels: labels.strong },
    { signal: 'text:link', where: 'link label', labels: labels.weak }
  ];

  for (const pass of passes) {
    const hitsOut = matchPhrases(pass.labels, OUT_PHRASES);
    const hitsIn = matchPhrases(pass.labels, IN_CONTROL_PHRASES);
    if (hitsOut.length && hitsIn.length) {
      return {
        signal: 'text:conflict',
        status: STATUS.UNKNOWN,
        price,
        currency,
        detail: pass.where + 's say both: out[' + hitsOut.join(', ') + '] in[' + hitsIn.join(', ') + ']'
      };
    }
    if (hitsOut.length) {
      return {
        signal: pass.signal,
        status: STATUS.OUT,
        price,
        currency,
        detail: pass.where + ': "' + hitsOut.join('", "') + '"'
      };
    }
    if (hitsIn.length) {
      return {
        signal: pass.signal,
        status: STATUS.IN,
        price,
        currency,
        detail: pass.where + ': "' + hitsIn.join('", "') + '"'
      };
    }
  }

  // Weak pass: unambiguous banner copy only, and only in one direction.
  const bodyOut = OUT_PHRASES.filter((p) => body.indexOf(p) !== -1);
  const bodyIn = IN_BODY_RE.test(body);
  if (bodyOut.length && !bodyIn) {
    return {
      signal: 'text:body',
      status: STATUS.OUT,
      price,
      currency,
      detail: 'page copy: "' + bodyOut.join('", "') + '"'
    };
  }
  if (bodyIn && !bodyOut.length) {
    return {
      signal: 'text:body',
      status: STATUS.IN,
      price,
      currency,
      detail: 'page copy: "in stock"'
    };
  }
  if (bodyOut.length && bodyIn) {
    return {
      signal: 'text:conflict',
      status: STATUS.UNKNOWN,
      price,
      currency,
      detail: 'page copy says both "in stock" and "' + bodyOut.join('", "') + '"'
    };
  }

  if (price != null) {
    return { signal: 'text', status: null, price, currency, detail: 'price only, no stock cue' };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The parser proper
 * ------------------------------------------------------------------ */

/**
 * @param {string} html
 * @returns {{status:string, signal:string, price:(number|null),
 *            currency:(string|null), priceSignal:(string|null),
 *            detail:string, candidates:Array}}
 */
export function parseProductPage(html) {
  const candidates = [];
  const push = (c) => { if (c) candidates.push(c); };

  let safe = typeof html === 'string' ? html : '';
  if (safe.length > 6e6) safe = safe.slice(0, 6e6); // runaway-page guard

  try { push(fromJsonLd(safe)); } catch (e) { push({ signal: 'jsonld', status: null, price: null, currency: null, detail: 'threw: ' + e.message }); }
  try { push(fromMeta(safe)); } catch (e) { push({ signal: 'meta', status: null, price: null, currency: null, detail: 'threw: ' + e.message }); }
  try { push(fromText(safe)); } catch (e) { push({ signal: 'text', status: null, price: null, currency: null, detail: 'threw: ' + e.message }); }

  const statusHit = candidates.find((c) => c.status != null) || null;
  const priceHit = candidates.find((c) => c.price != null) || null;

  return {
    status: statusHit ? statusHit.status : STATUS.UNKNOWN,
    signal: statusHit ? statusHit.signal : 'none',
    detail: statusHit ? statusHit.detail : (candidates.length
      ? 'no signal yielded a status — ' +
        candidates.map((c) => c.signal + ': ' + c.detail).join('; ')
      : 'no recognisable stock signal on the page'),
    price: priceHit ? priceHit.price : null,
    currency: priceHit ? priceHit.currency : null,
    priceSignal: priceHit ? priceHit.signal : null,
    candidates
  };
}

export default parseProductPage;
