#!/usr/bin/env node
/* ==========================================================================
   run-tests.mjs — run every zfc-watch test suite. Used locally and by CI
   (.github/workflows/zfc-watch.yml runs this before the watcher itself, so
   a broken parser turns the run red instead of quietly reporting "unknown"
   forever).

     node tools/zfc-watch/test/run-tests.mjs
   ========================================================================== */

'use strict';

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITES = ['parse.test.mjs', 'robots.test.mjs', 'check.e2e.mjs'];

let failed = 0;
for (const suite of SUITES) {
  const res = spawnSync(process.execPath, [join(HERE, suite)], { stdio: 'inherit' });
  if (res.status !== 0) {
    failed++;
    console.log('\n!! suite FAILED: ' + suite + ' (exit ' + res.status + ')\n');
  }
}

console.log('\n══ zfc-watch test run: ' + (SUITES.length - failed) + '/' +
  SUITES.length + ' suites green ══\n');
process.exit(failed ? 1 : 0);
