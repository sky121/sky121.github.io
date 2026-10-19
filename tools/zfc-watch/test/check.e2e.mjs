#!/usr/bin/env node
/* ==========================================================================
   check.e2e.mjs — end-to-end test of the checker, entirely offline.

   Spins up a throwaway HTTP server on localhost that serves the local
   fixtures (plus a robots.txt and a deliberate 404), points a temporary
   TWO-PRODUCT config at it, and runs tools/zfc-watch/check.mjs for real —
   several times, with the served pages mutated in between.

   The two products mirror the real config:
     Nikon Z fc  alerts: restock + price_drop   (out of stock everywhere)
     Nikon Z f   alerts: price_drop ONLY        (normally in stock)

   What this proves, without touching the live retailer:
     run 1  a real data/zfc-status.json is written from real HTTP responses
     run 1  a Z fc variant already in stock raises one restock alert
     run 1  *** a Z f variant already in stock raises NOTHING ***
     run 1  a 404 does NOT abort the run
     run 1  a robots.txt-disallowed path is SKIPPED, not fetched
     run 1  a variant with url:null is a loud config error, never "out of stock"
     run 2  a Z fc out_of_stock -> in_stock flip is detected and alerts
     run 2  *** the same flip on a Z f variant alerts nothing ***
     run 2  a price drop alerts for BOTH products
     run 2  a page that used to parse and now cannot becomes `unknown`
            and raises a parse-breakage alert (NOT "still out of stock")
     run 3  a quiet run stays quiet and does not commit
     run 4  --strict still fails loudly on an unconfigured variant
     run 5  the OLD single-product config shape still runs, with a warning
     both   every change appends exactly one line to zfc-history.jsonl

     node tools/zfc-watch/test/check.e2e.mjs
   ========================================================================== */

'use strict';

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, '..');
const FIXTURES = join(TOOL, 'fixtures');
const CHECK = join(TOOL, 'check.mjs');

const fixture = (f) => readFileSync(join(FIXTURES, f), 'utf8');

/* ---- what each route serves, mutated between runs ---- */
const serve = {
  '/p/mint': 'outofstock-jsonld.html',   // Z fc, out of stock, 1096.95
  '/p/sand': 'instock-jsonld.html',      // Z fc, in stock, 1096.95
  '/zf/black': 'instock-jsonld.html',    // Z f, in stock from the very first look
  '/zf/indigo': 'outofstock-jsonld.html' // Z f, out of stock, flips in run 2
};

let robotsHits = 0;
let productHits = [];

const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/robots.txt') {
    robotsHits++;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('User-agent: *\nDisallow: /blocked/\nAllow: /\n');
    return;
  }
  productHits.push(path);
  if (serve[path]) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fixture(serve[path]));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.end('<html><body><h1>Not found</h1></body></html>');
});

/* ------------------------------------------------------------------ *
 * Assertions
 * ------------------------------------------------------------------ */
let pass = 0;
let fail = 0;
function t(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + label.padEnd(62) +
    (ok ? '' : '\n        expected ' + JSON.stringify(expected) +
                '\n        actual   ' + JSON.stringify(actual)));
}
function ok(label, condition, note) {
  if (condition) pass++; else fail++;
  console.log('  ' + (condition ? '✓' : '✗') + ' ' + label.padEnd(62) +
    (condition ? '' : '\n        ' + (note || '')));
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */
const workDir = mkdtempSync(join(tmpdir(), 'zfc-e2e-'));
const outDir = join(workDir, 'data');
const configPath = join(workDir, 'config.json');
const alertsPath = join(workDir, 'alerts.json');

/* The fixture server lives in THIS process, so the child must be spawned
   asynchronously — spawnSync would block the event loop and the server
   would never accept a connection. */
function runChecker(extra = [], opts = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [
      CHECK,
      '--config', opts.config || configPath,
      '--out-dir', opts.outDir || outDir,
      '--alerts-out', opts.alerts || alertsPath,
      '--delay-ms', '0', '--timeout-ms', '5000',
      ...extra
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolveRun({ code, out }));
  });
}

const status = (dir) => JSON.parse(readFileSync(join(dir || outDir, 'zfc-status.json'), 'utf8'));
const alerts = (file) => JSON.parse(readFileSync(file || alertsPath, 'utf8')).alerts;
const history = (dir) => readFileSync(join(dir || outDir, 'zfc-history.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** Every variant row in the status file, whichever product it belongs to. */
function allRows(doc) {
  const out = [];
  for (const p of (doc.products || [])) {
    for (const v of (p.variants || [])) out.push(v);
  }
  for (const v of (doc.variants || [])) out.push(v);
  return out;
}
const byKey = (doc, key) => allRows(doc).find((v) => v.key === key);
const kinds = (list) => list.map((a) => a.kind + ':' + a.key).sort();

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

writeFileSync(configPath, JSON.stringify({
  pollNotes: 'offline end-to-end test',
  userAgent: 'zfc-watch/1.0 (e2e test)',
  requestDelayMs: 0,
  timeoutMs: 5000,
  heartbeatHours: 6,
  products: [
    {
      key: 'z-fc',
      name: 'Nikon Z fc (e2e fixture rig)',
      alerts: ['restock', 'price_drop'],
      variants: [
        { name: 'Z fc Mint Green', colour: 'Mint Green', url: base + '/p/mint' },
        { name: 'Z fc Sand Beige', colour: 'Sand Beige', url: base + '/p/sand' },
        { name: 'Z fc White', colour: 'White', url: base + '/blocked/p/white' },
        { name: 'Z fc Coral Pink', colour: 'Coral Pink', url: base + '/p/gone' },
        { name: 'Z fc Amber Brown', colour: 'Amber Brown', url: null }
      ]
    },
    {
      key: 'z-f',
      name: 'Nikon Z f (e2e fixture rig)',
      alerts: ['price_drop'],
      variants: [
        { name: 'Z f Black', colour: 'Black', url: base + '/zf/black' },
        { name: 'Z f Indigo Blue', colour: 'Indigo Blue', url: base + '/zf/indigo' }
      ]
    }
  ]
}, null, 2));

console.log('\n── zfc-watch end-to-end (local fixture server) ────────────');
console.log('   serving fixtures at ' + base + '\n');

/* ===================== RUN 1 ===================== */
console.log('  RUN 1 — first ever reading, two products\n');
const r1 = await runChecker();
ok('checker exits 0 even with a 404 and an unconfigured variant', r1.code === 0,
  'exit code was ' + r1.code);
ok('wrote data/zfc-status.json', existsSync(join(outDir, 'zfc-status.json')));

const s1 = status();
t('status file is schemaVersion 2 with both products', [s1.schemaVersion,
  (s1.products || []).map((p) => p.key)], [2, ['z-fc', 'z-f']]);
t('each product records its alert intents', (s1.products || []).map((p) => p.alerts.join('+')),
  ['restock+price_drop', 'price_drop']);
t('mint (JSON-LD OutOfStock)', [byKey(s1, 'z-fc-mint-green').status, byKey(s1, 'z-fc-mint-green').signal,
  byKey(s1, 'z-fc-mint-green').price], ['out_of_stock', 'jsonld', 1096.95]);
t('sand (JSON-LD InStock)', [byKey(s1, 'z-fc-sand-beige').status, byKey(s1, 'z-fc-sand-beige').signal,
  byKey(s1, 'z-fc-sand-beige').price], ['in_stock', 'jsonld', 1096.95]);
t('white: robots.txt disallows /blocked/ -> unknown, not out_of_stock',
  [byKey(s1, 'z-fc-white').status, byKey(s1, 'z-fc-white').robots], ['unknown', 'disallowed']);
ok('white was never fetched', productHits.indexOf('/blocked/p/white') === -1,
  'the checker requested a path robots.txt forbids');
t('coral: 404 -> unknown + httpStatus recorded, run continues',
  [byKey(s1, 'z-fc-coral-pink').status, byKey(s1, 'z-fc-coral-pink').httpStatus], ['unknown', 404]);
t('amber: url:null -> unknown + config error, never out_of_stock',
  byKey(s1, 'z-fc-amber-brown').status, 'unknown');
ok('amber error names the variant and the file',
  /no URL configured for Z fc Amber Brown/.test(byKey(s1, 'z-fc-amber-brown').error || '') &&
  /config\.json/.test(byKey(s1, 'z-fc-amber-brown').error || ''),
  'error was: ' + byKey(s1, 'z-fc-amber-brown').error);
ok('the null-URL failure is loud on stdout too', /no URL configured for Z fc Amber Brown/.test(r1.out));
ok('robots.txt fetched once and reused for every variant', robotsHits === 1,
  'robots.txt was fetched ' + robotsHits + ' times');

/* ---- the Z f is still WATCHED, it just does not shout ---- */
t('Z f Black is recorded as in stock even though it never alerts',
  [byKey(s1, 'z-f-black').status, byKey(s1, 'z-f-black').price], ['in_stock', 1096.95]);
t('Z f Indigo Blue is recorded as out of stock',
  byKey(s1, 'z-f-indigo-blue').status, 'out_of_stock');
t('every variant row knows which product it belongs to',
  [byKey(s1, 'z-f-black').productKey, byKey(s1, 'z-fc-sand-beige').productKey],
  ['z-f', 'z-fc']);

/* ====================== THE KEY ASSERTION ====================== */
const a1 = alerts();
t('*** run 1 alerts: the Z fc in-stock variant ONLY — the Z f stays silent ***',
  kinds(a1), ['restock:z-fc-sand-beige']);
ok('no alert of any kind mentions a Z f variant',
  a1.every((a) => a.productKey !== 'z-f'),
  'Z f alerts leaked: ' + JSON.stringify(a1.map((a) => a.kind + ':' + a.key)));
ok('…even though a Z f variant WAS read as in stock on its first reading',
  byKey(s1, 'z-f-black').status === 'in_stock');
/* ================================================================ */

t('run 1 history: one first-reading line per variant', history().length, 7);
ok('history lines carry the product', history().every((l) => !!l.productKey));

/* ===================== RUN 2 ===================== */
console.log('\n  RUN 2 — Z fc mint restocks + drops; Z fc sand turns to garbage;');
console.log('          Z f black drops in price; Z f indigo comes back in stock\n');
serve['/p/mint'] = 'price-drop.html';    // out_of_stock -> in_stock, 1096.95 -> 956.95
serve['/p/sand'] = 'garbage.html';       // used to parse cleanly, now unreadable
serve['/zf/black'] = 'price-drop.html';  // in stock, 1096.95 -> 956.95
serve['/zf/indigo'] = 'instock-jsonld.html'; // out_of_stock -> in_stock
robotsHits = 0;
productHits = [];

const r2 = await runChecker();
ok('checker exits 0', r2.code === 0, 'exit code was ' + r2.code);
const s2 = status();

t('mint is now in stock at the lower price',
  [byKey(s2, 'z-fc-mint-green').status, byKey(s2, 'z-fc-mint-green').price], ['in_stock', 956.95]);
t('sand became unknown — NOT out_of_stock', byKey(s2, 'z-fc-sand-beige').status, 'unknown');
t('sand records that no signal matched', byKey(s2, 'z-fc-sand-beige').signal, 'none');
ok('sand carries a human-readable reason',
  /no signal/.test(byKey(s2, 'z-fc-sand-beige').detail || ''),
  'detail was: ' + byKey(s2, 'z-fc-sand-beige').detail);
t('Z f indigo flipped to in stock in the status file',
  byKey(s2, 'z-f-indigo-blue').status, 'in_stock');

const a2 = alerts();
const k2 = kinds(a2);
ok('restock alert fired for Z fc mint', k2.indexOf('restock:z-fc-mint-green') !== -1, k2.join(', '));
ok('price-drop alert fired for Z fc mint', k2.indexOf('price_drop:z-fc-mint-green') !== -1, k2.join(', '));
ok('parse-breakage alert fired for Z fc sand', k2.indexOf('parse_broken:z-fc-sand-beige') !== -1, k2.join(', '));
ok('price-drop alert fired for Z f black — price drops are what it asked for',
  k2.indexOf('price_drop:z-f-black') !== -1, k2.join(', '));
t('*** no restock alert for the Z f variant that just came back in stock ***',
  a2.filter((a) => a.kind === 'restock' && a.productKey === 'z-f'), []);
t('exactly four alerts, no more', k2,
  ['parse_broken:z-fc-sand-beige', 'price_drop:z-f-black',
   'price_drop:z-fc-mint-green', 'restock:z-fc-mint-green']);
ok('the price-drop alert carries both prices',
  (() => { const d = a2.find((a) => a.kind === 'price_drop'); return d && d.from === 1096.95 && d.to === 956.95; })());
ok('alerts name their product for the issue body',
  a2.every((a) => typeof a.product === 'string' && a.product.length > 0));

const h2 = history();
ok('history grew (append-only)', h2.length > 7, 'history has ' + h2.length + ' lines');
ok('history records the mint status transition',
  h2.some((l) => l.key === 'z-fc-mint-green' && l.kind === 'status' &&
    l.from === 'out_of_stock' && l.to === 'in_stock'));
ok('history records the mint price transition',
  h2.some((l) => l.key === 'z-fc-mint-green' && l.kind === 'price' &&
    l.from === 1096.95 && l.to === 956.95));
ok('history records the sand parse breakage',
  h2.some((l) => l.key === 'z-fc-sand-beige' && l.kind === 'status' &&
    l.from === 'in_stock' && l.to === 'unknown'));
ok('history records the UNALERTED Z f restock anyway — recorded, just not shouted',
  h2.some((l) => l.key === 'z-f-indigo-blue' && l.kind === 'status' &&
    l.from === 'out_of_stock' && l.to === 'in_stock'));
ok('every history line is valid JSON on its own line',
  h2.every((l) => typeof l.at === 'string' && typeof l.variant === 'string'));

/* ===================== RUN 3 — quiet run ===================== */
console.log('\n  RUN 3 — nothing changes; the watcher must stay quiet\n');
const r3 = await runChecker();
ok('exits 0', r3.code === 0);
t('no new alerts', alerts().length, 0);
t('history did not grow', history().length, h2.length);
ok('commit policy says do NOT commit', /commit:\s+no/.test(r3.out),
  'checker said:\n' + r3.out.split('\n').filter((l) => /commit|heartbeat|change:/.test(l)).join('\n'));
ok('the summary names both products', /Z fc.*·.*Z f/.test(r3.out),
  r3.out.split('\n').filter((l) => /summary/.test(l)).join('\n'));

/* ===================== RUN 4 — strict mode ===================== */
console.log('\n  RUN 4 — --strict must fail loudly on the unconfigured variant\n');
const r4 = await runChecker(['--strict']);
t('strict mode exit code', r4.code, 2);
ok('strict mode explains itself', /strict mode: exiting 2/.test(r4.out));
ok('strict mode still wrote the status file first', existsSync(join(outDir, 'zfc-status.json')));

/* ============ RUN 5 — the OLD single-product config shape ============ */
console.log('\n  RUN 5 — an un-migrated checkout: the old single-product config\n');
const legacyDir = mkdtempSync(join(tmpdir(), 'zfc-e2e-legacy-'));
const legacyConfig = join(legacyDir, 'config.json');
const legacyOut = join(legacyDir, 'data');
const legacyAlerts = join(legacyDir, 'alerts.json');
writeFileSync(legacyConfig, JSON.stringify({
  product: 'Nikon Z fc',
  pollNotes: 'legacy shape',
  userAgent: 'zfc-watch/1.0 (e2e test)',
  requestDelayMs: 0,
  timeoutMs: 5000,
  heartbeatHours: 6,
  variants: [
    { name: 'Z fc Mint Green', colour: 'Mint Green', url: base + '/p/mint' },
    { name: 'Z fc Amber Brown', colour: 'Amber Brown', url: null }
  ]
}, null, 2));

const r5 = await runChecker([], { config: legacyConfig, outDir: legacyOut, alerts: legacyAlerts });
ok('the old shape still runs', r5.code === 0, 'exit code was ' + r5.code);
ok('…and says loudly that it migrated it',
  /OLD single-product shape/.test(r5.out) && /products\[\]/.test(r5.out),
  r5.out.split('\n').filter((l) => /config:/.test(l)).join('\n'));
const s5 = status(legacyOut);
t('…producing one product with the old default intents',
  [(s5.products || []).length, s5.products[0].name, s5.products[0].alerts.join('+')],
  [1, 'Nikon Z fc', 'restock+price_drop']);
t('…and reading its variants for real',
  [byKey(s5, 'z-fc-mint-green').status, byKey(s5, 'z-fc-mint-green').price],
  ['in_stock', 956.95]);
t('…and the migrated product still alerts on a first in-stock reading',
  kinds(alerts(legacyAlerts)), ['restock:z-fc-mint-green']);

server.close();

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log('  work dir: ' + workDir + '\n');
process.exit(fail ? 1 : 0);
