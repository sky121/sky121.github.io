#!/usr/bin/env node
/* ==========================================================================
   check.e2e.mjs — end-to-end test of the checker, entirely offline.

   Spins up a throwaway HTTP server on localhost that serves the local
   fixtures (plus a robots.txt and a deliberate 404), points a temporary
   config at it, and runs tools/zfc-watch/check.mjs for real — twice, with
   the served pages mutated in between.

   What this proves, without touching the live retailer:
     run 1  a real data/zfc-status.json is written from real HTTP responses
     run 1  a variant that is already in stock raises one alert
     run 1  a 404 does NOT abort the run
     run 1  a robots.txt-disallowed path is SKIPPED, not fetched
     run 1  a variant with url:null is a loud config error, never "out of stock"
     run 2  an out_of_stock -> in_stock flip is detected and alerts
     run 2  a price drop is detected and alerts
     run 2  a page that used to parse and now cannot becomes `unknown`
            and raises a parse-breakage alert (NOT "still out of stock")
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
  '/p/mint': 'outofstock-jsonld.html',
  '/p/sand': 'instock-jsonld.html'
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
function runChecker(extra = []) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [
      CHECK, '--config', configPath, '--out-dir', outDir,
      '--alerts-out', alertsPath, '--delay-ms', '0', '--timeout-ms', '5000',
      ...extra
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolveRun({ code, out }));
  });
}

const status = () => JSON.parse(readFileSync(join(outDir, 'zfc-status.json'), 'utf8'));
const alerts = () => JSON.parse(readFileSync(alertsPath, 'utf8')).alerts;
const history = () => readFileSync(join(outDir, 'zfc-history.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byKey = (doc, key) => doc.variants.find((v) => v.key === key);

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

writeFileSync(configPath, JSON.stringify({
  product: 'Nikon Z fc (e2e fixture rig)',
  pollNotes: 'offline end-to-end test',
  userAgent: 'zfc-watch/1.0 (e2e test)',
  requestDelayMs: 0,
  timeoutMs: 5000,
  heartbeatHours: 6,
  variants: [
    { name: 'Z fc Mint Green', colour: 'Mint Green', url: base + '/p/mint' },
    { name: 'Z fc Sand Beige', colour: 'Sand Beige', url: base + '/p/sand' },
    { name: 'Z fc White', colour: 'White', url: base + '/blocked/p/white' },
    { name: 'Z fc Coral Pink', colour: 'Coral Pink', url: base + '/p/gone' },
    { name: 'Z fc Amber Brown', colour: 'Amber Brown', url: null }
  ]
}, null, 2));

console.log('\n── zfc-watch end-to-end (local fixture server) ────────────');
console.log('   serving fixtures at ' + base + '\n');

/* ===================== RUN 1 ===================== */
console.log('  RUN 1 — first ever reading\n');
const r1 = await runChecker();
ok('checker exits 0 even with a 404 and an unconfigured variant', r1.code === 0,
  'exit code was ' + r1.code);
ok('wrote data/zfc-status.json', existsSync(join(outDir, 'zfc-status.json')));

const s1 = status();
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

const a1 = alerts();
t('run 1 alerts: only the already-in-stock variant', a1.map((a) => a.kind + ':' + a.key),
  ['restock:z-fc-sand-beige']);
t('run 1 history: one first-reading line per variant', history().length, 5);

/* ===================== RUN 2 ===================== */
console.log('\n  RUN 2 — mint restocks and drops in price; sand\'s page turns to garbage\n');
serve['/p/mint'] = 'price-drop.html';   // out_of_stock -> in_stock, 1096.95 -> 956.95
serve['/p/sand'] = 'garbage.html';      // used to parse cleanly, now unreadable
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

const a2 = alerts().map((a) => a.kind + ':' + a.key);
ok('restock alert fired for mint', a2.indexOf('restock:z-fc-mint-green') !== -1, a2.join(', '));
ok('price-drop alert fired for mint', a2.indexOf('price_drop:z-fc-mint-green') !== -1, a2.join(', '));
ok('parse-breakage alert fired for sand', a2.indexOf('parse_broken:z-fc-sand-beige') !== -1, a2.join(', '));
t('no other alerts fired', a2.length, 3);
ok('the price-drop alert carries both prices',
  (() => { const d = alerts().find((a) => a.kind === 'price_drop'); return d && d.from === 1096.95 && d.to === 956.95; })());

const h2 = history();
ok('history grew (append-only)', h2.length > 5, 'history has ' + h2.length + ' lines');
ok('history records the mint status transition',
  h2.some((l) => l.key === 'z-fc-mint-green' && l.kind === 'status' &&
    l.from === 'out_of_stock' && l.to === 'in_stock'));
ok('history records the mint price transition',
  h2.some((l) => l.key === 'z-fc-mint-green' && l.kind === 'price' &&
    l.from === 1096.95 && l.to === 956.95));
ok('history records the sand parse breakage',
  h2.some((l) => l.key === 'z-fc-sand-beige' && l.kind === 'status' &&
    l.from === 'in_stock' && l.to === 'unknown'));
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

/* ===================== RUN 4 — strict mode ===================== */
console.log('\n  RUN 4 — --strict must fail loudly on the unconfigured variant\n');
const r4 = await runChecker(['--strict']);
t('strict mode exit code', r4.code, 2);
ok('strict mode explains itself', /strict mode: exiting 2/.test(r4.out));
ok('strict mode still wrote the status file first', existsSync(join(outDir, 'zfc-status.json')));

server.close();

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log('  work dir: ' + workDir + '\n');
process.exit(fail ? 1 : 0);
