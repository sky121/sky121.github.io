/* ==========================================================================
   alerts.mjs — what changed, and which of those changes is worth an email.

   Split out of check.mjs so the rules can be tested directly, because the
   rules are the product. Pure: no I/O.

   ALERT INTENTS
   -------------
   Each product in config.json declares `alerts: [...]`, and this module
   honours it strictly:

     restock      only fires for a product that asked for it.
     price_drop   only fires for a product that asked for it.
     parse_broken fires for EVERY product, always. A watcher that can no
                  longer read a page is blind, and a blind watcher is worth
                  reporting whatever you asked it to watch for.

   Why it matters: the Z fc is out of stock everywhere, so its first
   in-stock reading is the whole point. The Z f is normally in stock, so the
   same rule would fire a useless "BACK IN STOCK" alert on the very first
   run and again every time its page blinks. The Z f therefore asks for
   price drops only — its stock is still fetched, still recorded, still
   shown on the page, and simply never pings.
   ========================================================================== */

'use strict';

import { STATUS } from './parse.mjs';

/** Did this product ask to hear about `kind`? */
export function wantsAlert(intents, kind) {
  if (kind === 'parse_broken') return true;      // always, by design
  return Array.isArray(intents) && intents.indexOf(kind) !== -1;
}

/** The raw differences between this reading and the last one. */
export function diffVariant(now, prev) {
  const changes = [];
  if (!prev) {
    changes.push({ kind: 'first-reading', from: null, to: now.status });
    return changes;
  }
  if (prev.status !== now.status) {
    changes.push({ kind: 'status', from: prev.status, to: now.status });
  }
  const prevPrice = typeof prev.price === 'number' ? prev.price : null;
  const nowPrice = typeof now.price === 'number' ? now.price : null;
  if (prevPrice !== nowPrice && (prevPrice != null || nowPrice != null)) {
    changes.push({ kind: 'price', from: prevPrice, to: nowPrice });
  }
  if (prev.signal !== now.signal) {
    changes.push({ kind: 'signal', from: prev.signal, to: now.signal });
  }
  return changes;
}

/**
 * buildAlerts(now, prev, changes, product)
 *   product: { key, name, alerts } — the owning product and its intents.
 * Returns the alerts that should actually be filed.
 */
export function buildAlerts(now, prev, changes, product) {
  const intents = product && Array.isArray(product.alerts) ? product.alerts : [];
  const alerts = [];
  const common = {
    key: now.key, variant: now.name, colour: now.colour, url: now.url,
    product: (product && product.name) || now.productName || null,
    productKey: (product && product.key) || now.productKey || null,
    signal: now.signal, detail: now.detail, price: now.price, currency: now.currency
  };

  const statusChange = changes.find((c) => c.kind === 'status');
  const priceChange = changes.find((c) => c.kind === 'price');
  const firstReading = changes.find((c) => c.kind === 'first-reading');

  /* 0. The very first reading of a variant alerts only if it is already in
        stock — that is news worth an email, but ONLY for a product that
        asked about stock at all. A product watched for price drops only
        (the Z f) must not spray restock alerts across its whole range the
        first time the watcher ever looks at it. A first reading of
        out_of_stock or unknown is just the baseline, and stays quiet. */
  if (firstReading && firstReading.to === STATUS.IN && wantsAlert(intents, 'restock')) {
    alerts.push(Object.assign({}, common, {
      kind: 'restock', from: null, to: STATUS.IN, firstReading: true
    }));
  }

  /* 1. Back in stock — the whole reason this thing exists, for the
        products that are waiting on it. */
  if (statusChange && statusChange.to === STATUS.IN && statusChange.from !== STATUS.IN &&
      wantsAlert(intents, 'restock')) {
    alerts.push(Object.assign({}, common, {
      kind: 'restock',
      from: statusChange.from,
      to: statusChange.to
    }));
  }

  /* 2. Price drop — strictly lower than the last recorded price. */
  if (priceChange && typeof priceChange.from === 'number' && typeof priceChange.to === 'number' &&
      priceChange.to < priceChange.from && wantsAlert(intents, 'price_drop')) {
    alerts.push(Object.assign({}, common, {
      kind: 'price_drop',
      from: priceChange.from,
      to: priceChange.to
    }));
  }

  /* 3. Parse breakage — it used to read cleanly and now it does not.
        Fires for every product regardless of intent: silent breakage is how
        this app fails its one job. A variant that has NEVER parsed cleanly
        (e.g. no URL configured yet) does not alert: that is a setup state,
        not a regression. */
  if (statusChange && statusChange.to === STATUS.UNKNOWN &&
      (statusChange.from === STATUS.IN || statusChange.from === STATUS.OUT)) {
    alerts.push(Object.assign({}, common, {
      kind: 'parse_broken',
      from: statusChange.from,
      to: statusChange.to,
      error: now.error || null
    }));
  }

  return alerts;
}

export default buildAlerts;
