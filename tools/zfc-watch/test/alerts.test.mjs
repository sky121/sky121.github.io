#!/usr/bin/env node
/* ==========================================================================
   alerts.test.mjs — the config shape and the alert-intent rules.

   Two things are proved here, both pure (no network, no files):

     1. config.mjs loads the multi-product shape AND still loads the old
        single-product shape, migrating it in memory with a warning.
     2. alerts.mjs honours each product's `alerts` intents strictly:
          * a product watched for restocks alerts on a first in-stock
            reading and on an out->in flip;
          * a product watched for PRICE DROPS ONLY (the Z f) does neither,
            no matter how in-stock it is — otherwise the very first run
            would spray a restock alert across its whole range;
          * parse breakage alerts for BOTH, because a blind watcher is
            always news.

     node tools/zfc-watch/test/alerts.test.mjs
   ========================================================================== */

'use strict';

import { normaliseConfig, slug, DEFAULT_ALERTS } from '../config.mjs';
import { diffVariant, buildAlerts, wantsAlert } from '../alerts.mjs';
import { STATUS } from '../parse.mjs';

let pass = 0;
let fail = 0;

function t(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + label.padEnd(66) +
    (ok ? '' : '\n        expected ' + JSON.stringify(expected) +
                '\n        actual   ' + JSON.stringify(actual)));
}
function ok(label, condition, note) {
  if (condition) pass++; else fail++;
  console.log('  ' + (condition ? '✓' : '✗') + ' ' + label.padEnd(66) +
    (condition ? '' : '\n        ' + (note || '')));
}

/* Readings are the shape check.mjs produces. */
function reading(over) {
  return Object.assign({
    key: 'v', name: 'A variant', colour: null, url: 'https://example.test/p',
    status: STATUS.OUT, signal: 'jsonld', detail: '', price: null,
    currency: 'USD', error: null
  }, over || {});
}

const Z_FC = { key: 'z-fc', name: 'Nikon Z fc', alerts: ['restock', 'price_drop'] };
const Z_F = { key: 'z-f', name: 'Nikon Z f', alerts: ['price_drop'] };

function alertsFor(product, now, prev) {
  return buildAlerts(now, prev, diffVariant(now, prev), product).map((a) => a.kind);
}

/* ====================================================================== *
 * 1. Config shapes
 * ====================================================================== */
console.log('\n── config.mjs ─────────────────────────────────────────────\n');

const MULTI = {
  userAgent: 'ua', requestDelayMs: 1, timeoutMs: 2, heartbeatHours: 3,
  products: [
    { key: 'z-fc', name: 'Nikon Z fc', alerts: ['restock', 'price_drop'],
      variants: [{ name: 'Z fc Mint Green', colour: 'Mint Green', url: null }] },
    { key: 'z-f', name: 'Nikon Z f', alerts: ['price_drop'],
      variants: [{ name: 'Z f Black', colour: 'Black', url: null },
                 { name: 'Z f Indigo Blue', colour: 'Indigo Blue', url: null }] }
  ]
};

const multi = normaliseConfig(MULTI);
t('multi-product config loads cleanly', [multi.errors.length, multi.warnings.length, multi.migrated],
  [0, 0, false]);
t('both products survive with their intents',
  multi.products.map((p) => p.key + ':' + p.alerts.join('+')),
  ['z-fc:restock+price_drop', 'z-f:price_drop']);
t('variant keys are slugged from the names',
  multi.products[1].variants.map((v) => v.key), ['z-f-black', 'z-f-indigo-blue']);

/* ---- back-compat: the old single-product shape ---- */
const OLD = {
  product: 'Nikon Z fc',
  userAgent: 'ua',
  variants: [
    { name: 'Z fc Mint Green', colour: 'Mint Green', url: null },
    { name: 'Z fc White', colour: 'White', url: null }
  ]
};
const old = normaliseConfig(OLD);
t('old single-product config still loads', old.errors.length, 0);
ok('…and is flagged as migrated', old.migrated === true);
ok('…with a warning that names the old shape and points at the new one',
  old.warnings.some((w) => /OLD single-product shape/.test(w) && /products\[\]/.test(w)),
  old.warnings.join(' | '));
t('…as one product carrying the default intents',
  [old.products.length, old.products[0].name, old.products[0].alerts.join('+')],
  [1, 'Nikon Z fc', DEFAULT_ALERTS.join('+')]);
t('…with every variant preserved',
  old.products[0].variants.map((v) => v.key), ['z-fc-mint-green', 'z-fc-white']);

/* ---- defensive paths ---- */
const noAlerts = normaliseConfig({ products: [{ name: 'Thing', variants: [{ name: 'A' }] }] });
t('a product with no "alerts" falls back to the old behaviour',
  noAlerts.products[0].alerts, DEFAULT_ALERTS);
ok('…and says so', noAlerts.warnings.some((w) => /declares no "alerts"/.test(w)));

const junk = normaliseConfig({ products: [{ name: 'Thing', alerts: ['restock', 'nonsense', 'parse_broken'], variants: [{ name: 'A' }] }] });
t('an unknown alert name is dropped', junk.products[0].alerts, ['restock']);
ok('…with a warning naming it', junk.warnings.some((w) => /unknown alert "nonsense"/.test(w)));
ok('…and listing parse_broken is called out as a no-op',
  junk.warnings.some((w) => /always fires/.test(w)));

const empty = normaliseConfig({ userAgent: 'ua' });
ok('a config with neither products nor variants is a hard error',
  empty.errors.length === 1 && /nothing to watch/.test(empty.errors[0]),
  JSON.stringify(empty.errors));

const clash = normaliseConfig({
  products: [
    { key: 'a', name: 'A', alerts: [], variants: [{ name: 'Black' }] },
    { key: 'b', name: 'B', alerts: [], variants: [{ name: 'Black' }] }
  ]
});
t('two variants with the same name get distinct keys',
  [clash.products[0].variants[0].key, clash.products[1].variants[0].key],
  ['black', 'b-black']);
t('slug()', [slug('Z fc Mint Green'), slug('  —Z f!! '), slug(null)],
  ['z-fc-mint-green', 'z-f', '']);

/* ====================================================================== *
 * 2. Alert intents — the point of this suite
 * ====================================================================== */
console.log('\n── alert intents ──────────────────────────────────────────\n');

t('wantsAlert respects the list', [
  wantsAlert(Z_FC.alerts, 'restock'), wantsAlert(Z_F.alerts, 'restock'),
  wantsAlert(Z_F.alerts, 'price_drop'), wantsAlert([], 'parse_broken')
], [true, false, true, true]);

/* ---- THE KEY TEST: a first in-stock reading ---- */
const firstInStock = (key) => reading({ key, status: STATUS.IN, price: 1996.95 });

t('Z fc: first reading already in stock -> restock alert (this is the news)',
  alertsFor(Z_FC, firstInStock('z-fc-sand-beige'), null), ['restock']);
t('Z f:  first reading already in stock -> NO alert at all',
  alertsFor(Z_F, firstInStock('z-f-black'), null), []);

/* ---- and the same on a real transition ---- */
const wasOut = (key, price) => reading({ key, status: STATUS.OUT, price: price });
const nowIn = (key, price) => reading({ key, status: STATUS.IN, price: price });

t('Z fc: out_of_stock -> in_stock fires restock',
  alertsFor(Z_FC, nowIn('z-fc-mint-green', 1096.95), wasOut('z-fc-mint-green', 1096.95)),
  ['restock']);
t('Z f:  out_of_stock -> in_stock fires nothing',
  alertsFor(Z_F, nowIn('z-f-black', 1996.95), wasOut('z-f-black', 1996.95)), []);

/* ---- price drops reach both ---- */
t('Z f:  a price drop DOES fire (it is the only thing it asked for)',
  alertsFor(Z_F, nowIn('z-f-black', 1796.95), nowIn('z-f-black', 1996.95)), ['price_drop']);
t('Z fc: a restock that is also a price drop fires both',
  alertsFor(Z_FC, nowIn('z-fc-mint-green', 956.95), wasOut('z-fc-mint-green', 1096.95)),
  ['restock', 'price_drop']);
t('Z f:  in-stock + price drop fires ONLY the price drop',
  alertsFor(Z_F, nowIn('z-f-black', 1796.95), wasOut('z-f-black', 1996.95)), ['price_drop']);
t('a price RISE never fires, for either product',
  [alertsFor(Z_FC, nowIn('a', 1200), nowIn('a', 1100)),
   alertsFor(Z_F, nowIn('b', 1200), nowIn('b', 1100))], [[], []]);

/* ---- parse breakage ignores intents entirely ---- */
const broke = (key) => reading({ key, status: STATUS.UNKNOWN, signal: 'none',
  error: 'no signal matched' });
t('Z fc: a clean read turning unknown fires parse_broken',
  alertsFor(Z_FC, broke('z-fc-mint-green'), wasOut('z-fc-mint-green', 1096.95)),
  ['parse_broken']);
t('Z f:  parse breakage fires too, despite price_drop-only intent',
  alertsFor(Z_F, broke('z-f-black'), nowIn('z-f-black', 1996.95)), ['parse_broken']);
t('a product that asked for NOTHING still reports parse breakage',
  alertsFor({ key: 'x', name: 'X', alerts: [] }, broke('x-1'), wasOut('x-1', 10)),
  ['parse_broken']);
t('a variant that never parsed cleanly does not cry breakage',
  alertsFor(Z_FC, broke('z-fc-white'), null), []);

/* ---- quiet cases ---- */
t('Z fc: a first reading of out_of_stock is the baseline, not news',
  alertsFor(Z_FC, wasOut('z-fc-black', 1096.95), null), []);
t('nothing changed -> nothing fires',
  alertsFor(Z_FC, nowIn('z-fc-sand-beige', 1096.95), nowIn('z-fc-sand-beige', 1096.95)), []);

/* ---- the alert payload carries the product, for the issue body ---- */
const payload = buildAlerts(firstInStock('z-fc-sand-beige'), null,
  diffVariant(firstInStock('z-fc-sand-beige'), null), Z_FC)[0];
t('alerts name their product', [payload.product, payload.productKey],
  ['Nikon Z fc', 'z-fc']);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
