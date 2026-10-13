#!/usr/bin/env node
/* ==========================================================================
   check.mjs — the Nikon Z fc stock & sale watcher.

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

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CHECKER_VERSION = '1.0.0';

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

const variants = Array.isArray(config.variants) ? config.variants : [];
if (!variants.length) {
  ghError('config has no variants — nothing to watch');
  process.exit(1);
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
    for (const v of (prev.variants || [])) byKey.set(v.key || slug(v.name), v);
    return { doc: prev, byKey };
  } catch (e) {
    return { doc: null, byKey: new Map() };
  }
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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

async function checkVariant(variant, previous) {
  const key = slug(variant.name || variant.colour);
  const base = {
    key,
    name: variant.name || variant.colour || key,
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
 * Change detection, history, alerts
 * ------------------------------------------------------------------ */
function diffVariant(now, prev) {
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

function buildAlerts(now, prev, changes) {
  const alerts = [];
  const common = {
    key: now.key, variant: now.name, colour: now.colour, url: now.url,
    signal: now.signal, detail: now.detail, price: now.price, currency: now.currency
  };

  const statusChange = changes.find((c) => c.kind === 'status');
  const priceChange = changes.find((c) => c.kind === 'price');
  const firstReading = changes.find((c) => c.kind === 'first-reading');

  /* 0. The very first reading of a variant alerts only if it is already in
        stock — that is news worth an email. A first reading of out_of_stock
        or unknown is just the baseline being established, and stays quiet. */
  if (firstReading && firstReading.to === STATUS.IN) {
    alerts.push(Object.assign({}, common, {
      kind: 'restock', from: null, to: STATUS.IN, firstReading: true
    }));
  }

  /* 1. Back in stock — the whole reason this thing exists. */
  if (statusChange && statusChange.to === STATUS.IN && statusChange.from !== STATUS.IN) {
    alerts.push(Object.assign({}, common, {
      kind: 'restock',
      from: statusChange.from,
      to: statusChange.to
    }));
  }

  /* 2. Price drop — strictly lower than the last recorded price. */
  if (priceChange && typeof priceChange.from === 'number' && typeof priceChange.to === 'number' &&
      priceChange.to < priceChange.from) {
    alerts.push(Object.assign({}, common, {
      kind: 'price_drop',
      from: priceChange.from,
      to: priceChange.to
    }));
  }

  /* 3. Parse breakage — it used to read cleanly and now it does not.
        Silent breakage is how this app fails its one job, so it alerts.
        A variant that has NEVER parsed cleanly (e.g. no URL configured
        yet) does not alert: that is a setup state, not a regression. */
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

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
async function main() {
  const startedAt = new Date();
  const { doc: prevDoc, byKey: prevByKey } = readPrevious();

  log('zfc-watch ' + CHECKER_VERSION + ' — checking ' + variants.length + ' variant(s)');
  log('  config:  ' + CONFIG_PATH);
  log('  output:  ' + STATUS_PATH);
  log('  agent:   ' + USER_AGENT);
  log('');

  const results = [];
  const historyLines = [];
  const alerts = [];
  let configErrors = 0;
  let anyChange = false;

  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    const prev = prevByKey.get(slug(variant.name || variant.colour)) || null;
    const row = await checkVariant(variant, prev);
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
        kind: c.kind,
        from: c.from,
        to: c.to,
        price: row.price,
        currency: row.currency,
        signal: row.signal
      }));
    }

    for (const a of buildAlerts(row, prev, changes)) alerts.push(a);

    const money = row.price != null ? ' ' + (row.currency || '') + ' ' + row.price.toFixed(2) : '';
    log('  ' + String(i + 1).padStart(2) + '. ' + row.name.padEnd(22) +
      row.status.padEnd(14) + '[' + row.signal + ']' + money +
      (row.error ? '\n      ' + row.error : ''));

    results.push(row);

    const isLast = i === variants.length - 1;
    if (!isLast && variant.url) await sleep(DELAY_MS);
  }

  /* ---- write the status snapshot ---- */
  const doc = {
    schemaVersion: 1,
    checkerVersion: CHECKER_VERSION,
    product: config.product || 'Nikon Z fc',
    checkedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    pollNotes: config.pollNotes || null,
    variants: results
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
  const shouldCommit = anyChange || heartbeatDue;

  const inStock = results.filter((r) => r.status === STATUS.IN);
  const unknown = results.filter((r) => r.status === STATUS.UNKNOWN);
  const summary = inStock.length
    ? inStock.length + ' in stock: ' + inStock.map((r) => r.name).join(', ')
    : 'nothing in stock' + (unknown.length ? ' (' + unknown.length + ' unknown)' : '');

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
    const rows = results.map((r) =>
      '| ' + r.name + ' | ' + r.status + ' | `' + r.signal + '` | ' +
      (r.price != null ? (r.currency || '') + ' ' + r.price.toFixed(2) : '—') + ' | ' +
      (r.httpStatus || '—') + ' | ' + (r.error ? r.error.replace(/\|/g, '\\|') : '') + ' |');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      '### Z fc watch — ' + startedAt.toISOString(),
      '',
      summary,
      '',
      '| variant | status | signal | price | http | note |',
      '| --- | --- | --- | --- | --- | --- |',
      ...rows,
      '',
      (shouldCommit ? '_committing this reading_' : '_no change — not committing_'),
      ''
    ].join('\n'), 'utf8');
  }

  if (configErrors) {
    ghError(configErrors + ' of ' + variants.length + ' variants have no URL configured. ' +
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
