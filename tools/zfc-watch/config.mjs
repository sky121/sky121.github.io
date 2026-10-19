/* ==========================================================================
   config.mjs — read config.json into one shape the checker can trust.

   The watcher started life single-product ("Nikon Z fc" + a flat `variants`
   array) and is now multi-product (`products: [{ key, name, alerts,
   variants }]`). Both shapes load: the old one is migrated IN MEMORY with
   a warning, so an existing checkout keeps working after a pull and nobody
   has to edit a config file to get their watcher back.

   This module is pure — no I/O, no process.exit — so the test suite can
   drive it directly.
   ========================================================================== */

'use strict';

/** Alerts a product may ask for. `parse_broken` is deliberately NOT here:
    it fires for every product regardless of intent, because a watcher that
    has gone blind is always worth reporting. */
export const REQUESTABLE_ALERTS = ['restock', 'price_drop'];

/** What a product gets when it does not say. The Z fc behaviour, i.e. what
    the single-product config meant before `alerts` existed. */
export const DEFAULT_ALERTS = ['restock', 'price_drop'];

export function slug(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function sanitiseAlerts(raw, productName, warnings) {
  if (raw == null) {
    warnings.push(productName + ' declares no "alerts" — defaulting to ' +
      DEFAULT_ALERTS.join(' + ') + '. Add an "alerts" array to say what you ' +
      'actually want to be told about.');
    return DEFAULT_ALERTS.slice();
  }
  if (!Array.isArray(raw)) {
    warnings.push(productName + ' has a non-array "alerts" — ignoring it and ' +
      'defaulting to ' + DEFAULT_ALERTS.join(' + ') + '.');
    return DEFAULT_ALERTS.slice();
  }
  const out = [];
  for (const entry of raw) {
    const kind = String(entry == null ? '' : entry).trim();
    if (kind === 'parse_broken') {
      warnings.push(productName + ' lists "parse_broken" in "alerts" — that one ' +
        'always fires for every product, so listing it changes nothing.');
      continue;
    }
    if (REQUESTABLE_ALERTS.indexOf(kind) === -1) {
      warnings.push(productName + ' asks for an unknown alert "' + kind +
        '" — ignored. Known alerts: ' + REQUESTABLE_ALERTS.join(', ') + '.');
      continue;
    }
    if (out.indexOf(kind) === -1) out.push(kind);
  }
  if (!out.length) {
    warnings.push(productName + ' ends up with no alert intents, so it will be ' +
      'recorded and displayed but will only ever alert on parse breakage.');
  }
  return out;
}

/**
 * normaliseConfig(raw) -> { products, warnings, errors, migrated }
 *
 * `products` is always an array of
 *   { key, name, alerts, note, variants: [{ key, name, colour, sku, url, note }] }
 * with every variant key unique across the whole config (the status file
 * and the history log are keyed on it).
 */
export function normaliseConfig(raw) {
  const warnings = [];
  const errors = [];
  let migrated = false;
  let source = [];

  if (raw && Array.isArray(raw.products)) {
    source = raw.products;
  } else if (raw && Array.isArray(raw.variants)) {
    migrated = true;
    warnings.push('config.json uses the OLD single-product shape (a top-level ' +
      '"variants" array). It was migrated in memory to products[] with the ' +
      'default alert intents (' + DEFAULT_ALERTS.join(' + ') + '). Move it to ' +
      'the products[] shape when convenient — see tools/zfc-watch/README.md §1.');
    source = [{
      key: slug(raw.product) || 'product',
      name: raw.product || 'Nikon Z fc',
      alerts: DEFAULT_ALERTS.slice(),
      variants: raw.variants
    }];
  } else {
    errors.push('config has no "products" array (and no legacy "variants" ' +
      'array either) — there is nothing to watch.');
    return { products: [], warnings, errors, migrated };
  }

  if (!source.length) {
    errors.push('config has an empty "products" array — there is nothing to watch.');
  }

  const takenProductKeys = Object.create(null);
  const takenVariantKeys = Object.create(null);
  const products = [];

  for (let i = 0; i < source.length; i++) {
    const p = source[i] || {};
    const name = p.name || p.product || ('Product ' + (i + 1));
    let key = slug(p.key || name) || ('product-' + (i + 1));
    if (takenProductKeys[key]) {
      key = key + '-' + (i + 1);
      warnings.push('two products resolve to the same key — "' + name +
        '" was renamed to "' + key + '".');
    }
    takenProductKeys[key] = true;

    const alerts = sanitiseAlerts(p.alerts, name, warnings);
    const rawVariants = Array.isArray(p.variants) ? p.variants : [];
    if (!rawVariants.length) {
      warnings.push(name + ' has no variants — it will be watched for nothing.');
    }

    const variants = [];
    for (let j = 0; j < rawVariants.length; j++) {
      const v = rawVariants[j] || {};
      const label = v.name || v.colour || '';
      let vkey = slug(label);
      if (!vkey) vkey = key + '-variant-' + (j + 1);
      if (takenVariantKeys[vkey]) {
        const namespaced = key + '-' + vkey;
        vkey = takenVariantKeys[namespaced] ? namespaced + '-' + (j + 1) : namespaced;
        warnings.push('two variants resolve to the same key; "' + label +
          '" (' + name + ') was given the key "' + vkey + '" instead. Give ' +
          'variants product-specific names to keep history keys stable.');
      }
      takenVariantKeys[vkey] = true;

      variants.push({
        key: vkey,
        name: label || vkey,
        colour: v.colour || null,
        sku: v.sku || null,
        url: v.url || null,
        note: v.note || null
      });
    }

    products.push({
      key: key,
      name: name,
      alerts: alerts,
      note: p.note || null,
      variants: variants
    });
  }

  const total = products.reduce((n, p) => n + p.variants.length, 0);
  if (!total && !errors.length) {
    errors.push('config has products but not one variant between them — ' +
      'there is nothing to watch.');
  }

  return { products, warnings, errors, migrated };
}

export default normaliseConfig;
