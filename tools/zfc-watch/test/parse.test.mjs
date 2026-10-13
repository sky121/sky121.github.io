/* ==========================================================================
   parse.test.mjs — unit tests for the signal-based product-page parser.

   Plain Node, no test framework, no deps. Prints a table of
   fixture / expectation / actual so a human (or a CI log) can read exactly
   what the parser decided and why.

     node tools/zfc-watch/test/parse.test.mjs

   Exit code 0 = all green, 1 = at least one failure.
   ========================================================================== */

'use strict';

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseProductPage, parsePrice, availabilityToStatus,
  normalise, visibleText, decodeEntities, STATUS
} from '../parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');

const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8');

/* ------------------------------------------------------------------ *
 * Expectations. `signal` is asserted too: knowing WHICH signal decided
 * is the whole audit trail, so a silent fallback to a weaker signal is
 * a test failure, not a shrug.
 * ------------------------------------------------------------------ */
const CASES = [
  {
    file: 'instock-jsonld.html',
    why: 'JSON-LD InStock wins over everything else',
    status: STATUS.IN, signal: 'jsonld', price: 1096.95, currency: 'USD'
  },
  {
    file: 'outofstock-jsonld.html',
    why: 'JSON-LD OutOfStock (http:// schema prefix, offers as an array)',
    status: STATUS.OUT, signal: 'jsonld', price: 1096.95, currency: 'USD'
  },
  {
    file: 'price-drop.html',
    why: 'same product cheaper — numeric price, bare "InStock" token',
    status: STATUS.IN, signal: 'jsonld', price: 956.95, currency: 'USD'
  },
  {
    file: 'jsonld-only.html',
    why: 'ONLY JSON-LD: @graph + AggregateOffer + nested offers; any InStock offer wins; cheapest price taken',
    status: STATUS.IN, signal: 'jsonld', price: 1096.95, currency: 'USD'
  },
  {
    file: 'meta-only.html',
    why: 'no JSON-LD: og:availability=outofstock + og:price:amount',
    status: STATUS.OUT, signal: 'meta', price: 1096.95, currency: 'USD'
  },
  {
    file: 'text-only.html',
    why: 'ONLY visible text: the Add-to-Cart control wins; "sold out"/"out of stock" decoys in a review, a nav link and a footer link must NOT flip it',
    status: STATUS.IN, signal: 'text:control', price: 1096.95, currency: 'USD'
  },
  {
    file: 'text-oos-only.html',
    why: 'ONLY visible text: a role="button" notify control beats the "in stock" accessory blurb',
    status: STATUS.OUT, signal: 'text:control', price: 1096.95, currency: 'USD'
  },
  {
    file: 'backorder.html',
    why: 'BackOrder is NOT out_of_stock and NOT in_stock — it resolves to unknown, which alerts',
    status: STATUS.UNKNOWN, signal: 'jsonld', price: 1096.95, currency: 'USD'
  },
  {
    file: 'conflict.html',
    why: 'controls contradict each other with no structured data — honest unknown, never a coin flip',
    status: STATUS.UNKNOWN, signal: 'text:conflict', price: null, currency: null
  },
  {
    file: 'garbage.html',
    why: 'GARBAGE / bot wall / unparseable JSON-LD — MUST be unknown, never out_of_stock',
    status: STATUS.UNKNOWN, signal: 'none', price: null, currency: null
  },
  {
    file: 'empty.html',
    why: 'valid page that says nothing about stock (consent wall) — unknown',
    status: STATUS.UNKNOWN, signal: 'none', price: null, currency: null
  }
];

/* ------------------------------------------------------------------ *
 * Unit tests for the small helpers.
 * ------------------------------------------------------------------ */
const UNIT = [
  ['parsePrice("$1,096.95")', () => parsePrice('$1,096.95'), 1096.95],
  ['parsePrice("1096.95")', () => parsePrice('1096.95'), 1096.95],
  ['parsePrice(956.95)', () => parsePrice(956.95), 956.95],
  ['parsePrice("USD 1.096,95")', () => parsePrice('USD 1.096,95'), 1096.95],
  ['parsePrice("")', () => parsePrice(''), null],
  ['parsePrice("free")', () => parsePrice('free'), null],
  ['parsePrice(null)', () => parsePrice(null), null],
  ['availability https://schema.org/InStock', () => availabilityToStatus('https://schema.org/InStock'), STATUS.IN],
  ['availability http://schema.org/OutOfStock', () => availabilityToStatus('http://schema.org/OutOfStock'), STATUS.OUT],
  ['availability "InStock"', () => availabilityToStatus('InStock'), STATUS.IN],
  ['availability "PreOrder" -> unknown', () => availabilityToStatus('PreOrder'), STATUS.UNKNOWN],
  ['availability "nonsense" -> null', () => availabilityToStatus('nonsense'), null],
  ['availability undefined -> null', () => availabilityToStatus(undefined), null],
  ['decodeEntities("&amp;&#36;&hellip;")', () => decodeEntities('&amp;&#36;&hellip;'), '&$…'],
  ['normalise collapses space/quotes', () => normalise('  In   “Stock” '), 'in "stock"'],
  ['visibleText drops script bodies', () => visibleText('<p>a</p><script>var out_of_stock=1;</script><p>b</p>'), 'a b'],
  ['parseProductPage("") -> unknown/none', () => parseProductPage('').status, STATUS.UNKNOWN],
  ['parseProductPage(null) -> unknown/none', () => parseProductPage(null).signal, 'none'],
  ['parseProductPage(undefined) does not throw', () => parseProductPage(undefined).status, STATUS.UNKNOWN],
  // The one invariant that matters most, stated as its own test:
  ['no input is EVER reported out_of_stock without evidence',
    () => ['', '   ', '<html></html>', '{}', '<<<>>>', 'ÿÿÿ']
      .map((h) => parseProductPage(h).status)
      .every((s) => s === STATUS.UNKNOWN), true]
];

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */
let pass = 0;
let fail = 0;
const failures = [];

function show(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  return String(v);
}

function check(label, expected, actual) {
  const ok = expected === actual;
  if (ok) pass++; else { fail++; failures.push(label + ': expected ' + show(expected) + ', got ' + show(actual)); }
  return ok;
}

console.log('\n── zfc-watch parser — fixture cases ────────────────────────\n');

for (const c of CASES) {
  let html = '';
  let err = null;
  try { html = fixture(c.file); } catch (e) { err = e; }
  if (err) {
    fail++; failures.push(c.file + ': could not read fixture — ' + err.message);
    console.log('  FAIL  ' + c.file + ' — missing fixture');
    continue;
  }
  const got = parseProductPage(html);
  const rows = [
    ['status', c.status, got.status],
    ['signal', c.signal, got.signal],
    ['price', c.price, got.price],
    ['currency', c.currency, got.currency]
  ];
  const allOk = rows.every(([field, exp, act]) => check(c.file + '.' + field, exp, act));

  console.log((allOk ? '  ✓ PASS  ' : '  ✗ FAIL  ') + c.file);
  console.log('          ' + c.why);
  for (const [field, exp, act] of rows) {
    const mark = exp === act ? ' ' : '!';
    console.log('        ' + mark + ' ' + field.padEnd(9) +
      'expected ' + show(exp).padEnd(14) + 'actual ' + show(act));
  }
  console.log('          why it believes that: ' + got.detail);
  console.log('');
}

console.log('── helper units ─────────────────────────────────────\n');
for (const [label, fn, expected] of UNIT) {
  let actual;
  try { actual = fn(); } catch (e) { actual = 'threw: ' + e.message; }
  const ok = check(label, expected, actual);
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + label.padEnd(56) +
    (ok ? '' : 'expected ' + show(expected) + ', got ' + show(actual)));
}

/* Every fixture on disk must be covered by a case — a fixture nobody
   asserts on is a fixture that silently rots. */
console.log('\n── coverage ────────────────────────────────────────\n');
const onDisk = readdirSync(FIXTURES).filter((f) => f.endsWith('.html')).sort();
const covered = new Set(CASES.map((c) => c.file));
for (const f of onDisk) {
  const ok = covered.has(f);
  if (!ok) { fail++; failures.push('fixture ' + f + ' has no test case'); }
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + f);
}

console.log('\n── result ──────────────────────────────────────────');
console.log('  ' + pass + ' passed, ' + fail + ' failed\n');
if (fail) {
  for (const f of failures) console.log('  ✗ ' + f);
  console.log('');
  process.exit(1);
}
