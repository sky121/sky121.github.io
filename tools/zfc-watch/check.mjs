#!/usr/bin/env node
/* ==========================================================================
   check.mjs — The Z Watch: the Nikon Z fc / Z f stock & sale watcher.

   Runs on a GitHub Actions runner (open internet), not in the browser:
   nikonusa.com sends no CORS headers, so a GitHub Pages page can never
   poll it directly. This script does the fetching, parses each page with
   the signal-based parser, writes data/zfc-status.json + appends to
   data/zfc-history.jsonl, and emits an alert file for notify.mjs.

   Plain Node, zero dependencies.

     node tools/zfc-watch/check.mjs [options]

       --config <path>          default tools/zfc-watch/config.json
       --out-dir <path>         default data
       --alerts-out <path>      default $RUNNER_TEMP/zfc-alerts.json
       --delay-ms <n>           override config.requestDelayMs
       --timeout-ms <n>         override config.timeoutMs
       --heartbeat-hours <n>    override config.heartbeatHours
       --strict                 exit 2 if any variant has no URL configured
       --quiet                  less chatter

   Exit codes: 0 normal (including per-variant fetch failures — one 404
   must never abort the run), 2 strict-mode config error, 1 fatal
   (unreadable config, cannot write output).

   POLITENESS: sequential requests, a delay between them, a 15s timeout,
   exactly one retry on a *network* error (never on an HTTP status), an
   honest User-Agent naming the repo, and robots.txt fetched and obeyed.
   ========================================================================== */

'use strict';

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseProductPage, STATUS } from './parse.mjs';
import { fetchRobots, isAllowed } from './robots.mjs';
import { normaliseConfig, slug } from './config.mjs';
import { diffVariant, buildAlerts } from './alerts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CHECKER_VERSION = '1.1.0';

/* ------------------------------------------------------------------ *
 * Args
 * ------------------------------------------------------------------ */
function parseArgs(argv) {
  const out = { flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'strict' || key === 'quiet') { out.flags[key] = true; continue; }
    out.flags[key] = argv[++i];
  }
  return out.flags;
}
const flags = parseArgs(process.argv.slice(2));
const QUIET = !!flags.quiet;

const log = (...a) => { if (!QUIET) console.log(...a); };
const warn = (...a) => console.warn(...a);

/** A GitHub Actions error annotation — shows up at the top of the run page. */
function ghError(message) {
  if (process.env.GITHUB_ACTIONS) console.log('::error::' + message);
  warn('  !! ' + message);
}
function ghWarning(message) {
  if (process.env.GITHUB_ACTIONS) console.log('::warning::' + message);
  warn('  !  ' + message);
}

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */
const CONFIG_PATH = resolve(flags.config || join(HERE, 'config.json'));
const OUT_DIR = resolve(flags['out-dir'] || join(REPO_ROOT, 'data'));
const STATUS_PATH = join(OUT_DIR, 'zfc-status.json');
const HISTORY_PATH = join(OUT_DIR, 'zfc-history.jsonl');
const ALERTS_PATH = resolve(
  flags['alerts-out'] || join(process.env.RUNNER_TEMP || tmpdir(), 'zfc-alerts.json')
);

let config;
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
} catch (err) {
  ghError('cannot read config at ' + CONFIG_PATH + ' — ' + err.message);
  process.exit(1);
}

const USER_AGENT = config.userAgent ||
  'zfc-watch/1.0 (personal stock checker; +https://github.com/sky121/sky121.github.io)';
const DELAY_MS = Number(flags['delay-ms'] != null ? flags['delay-ms'] : config.requestDelayMs) || 2500;
const TIMEOUT_MS = Number(flags['timeout-ms'] != null ? flags['timeout-ms'] : config.timeoutMs) || 15000;
const HEARTBEAT_HOURS = Number(
  flags['heartbeat-hours'] != null ? flags['heartbeat-hours'] : config.heartbeatHours
) || 6;

/* One shape in, one shape out: the old single-product config (a top-level
   `variants` array) is migrated in memory with a warning, so an existing
   checkout keeps working. See config.mjs. */
const normalised = normaliseConfig(config);
for (const w of normalised.warnings) ghWarning('config: ' + w);
if (normalised.errors.length) {
  for (const e of normalised.errors) ghError(e);
  process.exit(1);
}
const products = normalised.products;
const allVariants = [];
for (const product of products) {
  for (const variant of product.variants) allVariants.push({ product, variant });
}

/* ------------------------------------------------------------------ *
 * Previous state
 *
 * In CI every run starts from a fresh checkout, so the status file on
 * disk is always the LAST COMMITTED one — which is exactly the baseline
 * both change-detection and the heartbeat want. (Running locally twice
 * without committing compares against your own last local run instead;
 * that is noted in the README.)
 * ------------------------------------------------------------------ */
function readPrevious() {
  try {
    const prev = JSON.parse(readFileSync(STATUS_PATH, 'utf8'));
    const byKey = new Map();
    /* schemaVersion 2 groups variants under products; version 1 had one
       flat array. Both are read, so an upgrade keeps its baseline and does
       not re-announce every variant as a first reading. */
    for (const p of (prev.products || [])) {
      for (const v of (p.variants || [])) byKey.set(v.key || slug(v.name), v);
    }
    for (const v of (prev.variants || [])) byKey.set(v.key || slug(v.name), v);
    return { doc: prev, byKey };
  } catch (e) {
    return { doc: null, byKey: new Map() };
  }
}

/* ------------------------------------------------------------------ *
 * Fetching
 * ------------------------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const body = await res.text();
  return { httpStatus: res.status, ok: res.ok, body, finalUrl: res.url || url };
}

/** One retry, and only for a network/timeout error — never for an HTTP status. */
async function fetchWithRetry(url) {
  try {
    return await fetchOnce(url);
  } catch (err) {
    const first = err && err.message ? err.message : String(err);
    await sleep(2000);
    try {
      const res = await fetchOnce(url);
      res.retried = true;
      return res;
    } catch (err2) {
      const e = new Error(first + ' (retry also failed: ' +
        (err2 && err2.message ? err2.message : String(err2)) + ')');
      e.networkError = true;
      throw e;
    }
  }
}

/* ------------------------------------------------------------------ *
 * The check
 * ------------------------------------------------------------------ */
const robotsCache = new Map();

async function robotsVerdict(url) {
  const u = new URL(url);
  const origin = u.origin;
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, await fetchRobots(origin, { userAgent: USER_AGENT, timeoutMs: TIMEOUT_MS }));
  }
  const info = robotsCache.get(origin);
  if (info.state === 'unavailable') {
    return { decision: 'unavailable', reason: info.reason };
  }
  const token = USER_AGENT.split('/')[0];
  const verdict = isAllowed(info.robots, token, u.pathname + u.search);
  return {
    decision: verdict.allowed ? 'allowed' : 'disallowed',
    rule: verdict.rule,
    reason: verdict.allowed ? null : 'robots.txt forbids this path (' + verdict.rule + ')'
  };
}

async function checkVariant(variant, product) {
  const key = variant.key || slug(variant.name || variant.colour);
  const base = {
    key,
    name: variant.name || variant.colour || key,
    productKey: product.key,
    productName: product.name,
    colour: variant.colour || null,
    sku: variant.sku || null,
    url: variant.url || null,
    status: STATUS.UNKNOWN,
    signal: 'none',
    detail: '',
    price: null,
    currency: null,
    priceSignal: null,
    httpStatus: null,
    robots: null,
    error: null
  };

  /* ---- No URL: a configuration error, loudly, never a silent skip ---- */
  if (!variant.url || typeof variant.url !== 'string' || !/^https?:\/\//i.test(String(variant.url))) {
    base.error = 'no URL configured for ' + base.name + ' — add it to ' +
      'tools/zfc-watch/config.json (see docs/zfc/README.md)';
    base.detail = 'not checked: no URL configured';
    base.errorKind = 'config';
    ghError(base.error);
    return base;
  }

  /* ---- robots.txt first ---- */
  let robots;
  try {
    robots = await robotsVerdict(variant.url);
  } catch (err) {
    robots = { decision: 'unavailable', reason: 'robots check threw: ' + err.message };
  }
  base.robots = robots.decision;

  if (robots.decision === 'disallowed') {
    base.error = 'skipped — ' + robots.reason;
    base.detail = 'not fetched: robots.txt disallows this path';
    base.errorKind = 'robots';
    ghWarning(base.name + ': ' + base.error);
    return base;
  }
  if (robots.decision === 'unavailable') {
    base.error = 'skipped — could not read robots.txt, so we did not fetch (' + robots.reason + ')';
    base.detail = 'not fetched: robots.txt unavailable';
    base.errorKind = 'robots';
    ghWarning(base.name + ': ' + base.error);
    return base;
  }

  /* ---- fetch ---- */
  let res;
  try {
    res = await fetchWithRetry(variant.url);
  } catch (err) {
    base.error = 'fetch failed: ' + err.message;
    base.detail = 'not parsed: the page could not be fetched';
    base.errorKind = 'network';
    ghWarning(base.name + ': ' + base.error);
    return base;
  }

  base.httpStatus = res.httpStatus;
  if (!res.ok) {
    base.error = 'HTTP ' + res.httpStatus + ' from the product page';
    base.detail = 'not parsed: non-OK HTTP status';
    base.errorKind = 'http';
    ghWarning(base.name + ': ' + base.error);
    return base;
  }

  /* ---- parse ---- */
  const parsed = parseProductPage(res.body);
  base.status = parsed.status;
  base.signal = parsed.signal;
  base.detail = parsed.detail;
  base.price = parsed.price;
  base.currency = parsed.currency;
  base.priceSignal = parsed.priceSignal;
  if (parsed.status === STATUS.UNKNOWN) {
    base.errorKind = 'parse';
    base.error = 'the page was fetched but no signal the parser understands said ' +
      'whether it is in stock (' + parsed.detail + ')';
  }
  return base;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
async function main() {
  const startedAt = new Date();
  const { doc: prevDoc, byKey: prevByKey } = readPrevious();

  log('zfc-watch ' + CHECKER_VERSION + ' — checking ' + allVariants.length +
    ' variant(s) across ' + products.length + ' product(s)');
  log('  config:  ' + CONFIG_PATH);
  log('  output:  ' + STATUS_PATH);
  log('  agent:   ' + USER_AGENT);
  log('');

  const rowsByProduct = new Map();
  for (const product of products) rowsByProduct.set(product.key, []);
  const results = [];
  const historyLines = [];
  const alerts = [];
  let configErrors = 0;
  let anyChange = false;
  let currentProductKey = null;

  for (let i = 0; i < allVariants.length; i++) {
    const product = allVariants[i].product;
    const variant = allVariants[i].variant;

    if (product.key !== currentProductKey) {
      currentProductKey = product.key;
      log('  ' + product.name + '  — watching for: ' +
        (product.alerts.length ? product.alerts.join(' + ') : 'nothing but parse breakage') +
        ' (parse breakage always)');
    }

    const prev = prevByKey.get(variant.key) || null;
    const row = await checkVariant(variant, product);
    if (row.errorKind === 'config') configErrors++;

    const changes = diffVariant(row, prev);
    const realChange = changes.some((c) => c.kind !== 'first-reading') ||
      (changes.length > 0 && !prev);

    row.lastChangedAt = prev && prev.lastChangedAt ? prev.lastChangedAt : null;
    row.previousStatus = prev ? prev.status : null;
    if (changes.some((c) => c.kind === 'status') || !prev) {
      row.lastChangedAt = startedAt.toISOString();
    }
    row.lastPriceChangedAt = prev && prev.lastPriceChangedAt ? prev.lastPriceChangedAt : null;
    if (changes.some((c) => c.kind === 'price')) {
      row.lastPriceChangedAt = startedAt.toISOString();
    }

    if (realChange) anyChange = true;

    for (const c of changes) {
      if (c.kind === 'first-reading' && prev) continue;
      historyLines.push(JSON.stringify({
        at: startedAt.toISOString(),
        variant: row.name,
        key: row.key,
        product: product.name,
        productKey: product.key,
        kind: c.kind,
        from: c.from,
        to: c.to,
        price: row.price,
        currency: row.currency,
        signal: row.signal
      }));
    }

    /* The alert intent gate lives in alerts.mjs — a product only hears
       about what it asked for, except parse breakage, which is always
       reported. */
    for (const a of buildAlerts(row, prev, changes, product)) alerts.push(a);

    const money = row.price != null ? ' ' + (row.currency || '') + ' ' + row.price.toFixed(2) : '';
    log('    ' + String(i + 1).padStart(2) + '. ' + row.name.padEnd(22) +
      row.status.padEnd(14) + '[' + row.signal + ']' + money +
      (row.error ? '\n        ' + row.error : ''));

    results.push(row);
    rowsByProduct.get(product.key).push(row);

    const isLast = i === allVariants.length - 1;
    if (!isLast && variant.url) await sleep(DELAY_MS);
  }

  /* ---- write the status snapshot ---- */
  const doc = {
    schemaVersion: 2,
    checkerVersion: CHECKER_VERSION,
    checkedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    pollNotes: config.pollNotes || null,
    products: products.map((p) => ({
      key: p.key,
      name: p.name,
      alerts: p.alerts,
      note: p.note || null,
      variants: rowsByProduct.get(p.key) || []
    }))
  };

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(STATUS_PATH, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  if (historyLines.length) {
    appendFileSync(HISTORY_PATH, historyLines.join('\n') + '\n', 'utf8');
  } else if (!existsSync(HISTORY_PATH)) {
    writeFileSync(HISTORY_PATH, '', 'utf8');
  }
  writeFileSync(ALERTS_PATH, JSON.stringify({
    generatedAt: startedAt.toISOString(),
    alerts
  }, null, 2) + '\n', 'utf8');

  /* ---- commit policy ----
     Commit only on a real change, or when the last committed reading is
     older than the heartbeat window (so the page can honestly show it is
     still being checked). Otherwise ~96 empty commits a day. */
  let heartbeatDue = true;
  let prevAgeHours = null;
  if (prevDoc && prevDoc.checkedAt) {
    const prevAt = Date.parse(prevDoc.checkedAt);
    if (isFinite(prevAt)) {
      prevAgeHours = (startedAt.getTime() - prevAt) / 3600000;
      heartbeatDue = prevAgeHours >= HEARTBEAT_HOURS;
    }
  }
  /* The heartbeat exists so the page can honestly show it is still being
     checked. But while NOTHING is configured there is nothing to be checked:
     a heartbeat then just rewrites "8 unknown" every few hours and litters
     history with commits that carry no information. Suppress it until at
     least one URL exists; a real change still always commits. */
  const anyConfigured = products.some((p) =>
    (p.variants || []).some((v) => typeof v.url === 'string' && v.url));
  const shouldCommit = anyChange || (heartbeatDue && anyConfigured);

  const summary = products.map((p) => {
    const rows = rowsByProduct.get(p.key) || [];
    const pin = rows.filter((r) => r.status === STATUS.IN);
    const punk = rows.filter((r) => r.status === STATUS.UNKNOWN);
    return p.name + ': ' + (pin.length
      ? pin.length + ' in stock: ' + pin.map((r) => r.name).join(', ')
      : 'nothing in stock' + (punk.length ? ' (' + punk.length + ' unknown)' : ''));
  }).join(' · ');

  log('');
  log('  change:      ' + (anyChange ? 'yes' : 'no'));
  log('  heartbeat:   ' + (heartbeatDue ? 'due' : 'not due') +
    (prevAgeHours != null ? ' (last reading ' + prevAgeHours.toFixed(1) + 'h ago)' : ' (no previous reading)'));
  log('  commit:      ' + (shouldCommit ? 'YES' : 'no'));
  log('  alerts:      ' + alerts.length + (alerts.length ? ' — ' + alerts.map((a) => a.kind + '/' + a.variant).join(', ') : ''));
  log('  summary:     ' + summary);
  log('  alerts file: ' + ALERTS_PATH);

  /* ---- GitHub Actions plumbing ---- */
  if (process.env.GITHUB_OUTPUT) {
    const lines = [
      'changed=' + (anyChange ? 'true' : 'false'),
      'should_commit=' + (shouldCommit ? 'true' : 'false'),
      'alert_count=' + alerts.length,
      'alerts_path=' + ALERTS_PATH,
      'config_errors=' + configErrors,
      'summary=' + summary.replace(/[\r\n]+/g, ' ')
    ];
    appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n', 'utf8');
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const blocks = [];
    for (const p of products) {
      const rows = (rowsByProduct.get(p.key) || []).map((r) =>
        '| ' + r.name + ' | ' + r.status + ' | `' + r.signal + '` | ' +
        (r.price != null ? (r.currency || '') + ' ' + r.price.toFixed(2) : '—') + ' | ' +
        (r.httpStatus || '—') + ' | ' + (r.error ? r.error.replace(/\|/g, '\\|') : '') + ' |');
      blocks.push('#### ' + p.name + ' — alerts on: ' +
        (p.alerts.length ? p.alerts.join(', ') : 'parse breakage only') +
        (p.alerts.indexOf('parse_broken') === -1 ? ' (+ parse breakage, always)' : ''));
      blocks.push('');
      blocks.push('| variant | status | signal | price | http | note |');
      blocks.push('| --- | --- | --- | --- | --- | --- |');
      for (const row of rows) blocks.push(row);
      blocks.push('');
    }
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      '### The Z Watch — ' + startedAt.toISOString(),
      '',
      summary,
      '',
      ...blocks,
      (shouldCommit ? '_committing this reading_' : '_no change — not committing_'),
      ''
    ].join('\n'), 'utf8');
  }

  if (configErrors) {
    ghError(configErrors + ' of ' + allVariants.length + ' variants have no URL configured. ' +
      'The watcher cannot see those colours at all until you paste their product URLs ' +
      'into tools/zfc-watch/config.json.');
    if (flags.strict) {
      warn('\n  strict mode: exiting 2 because of unconfigured variants\n');
      process.exit(2);
    }
  }
}

main().catch((err) => {
  ghError('zfc-watch crashed: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
