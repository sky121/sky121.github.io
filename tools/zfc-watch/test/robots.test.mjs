/* ==========================================================================
   robots.test.mjs — unit tests for the robots.txt client.

     node tools/zfc-watch/test/robots.test.mjs
   ========================================================================== */

'use strict';

import { parseRobots, isAllowed, groupFor, patternToRegExp } from '../robots.mjs';

const UA = 'zfc-watch';

const SAMPLE = `
# a fairly typical retailer robots.txt
User-agent: *
Disallow: /cart
Disallow: /checkout/
Disallow: /*?sort=
Allow: /p/

User-agent: BadBot
Disallow: /

User-agent: zfc-watch
User-agent: SomeOtherTool
Disallow: /internal/
`;

const robots = parseRobots(SAMPLE);

const CASES = [
  ['product path allowed for us', isAllowed(robots, UA, '/p/z-fc-mint-green').allowed, true],
  ['our own group: /internal/ disallowed', isAllowed(robots, UA, '/internal/x').allowed, false],
  ['our group wins over *, so /cart is allowed for us', isAllowed(robots, UA, '/cart').allowed, true],
  ['generic bot falls back to *: /cart disallowed', isAllowed(robots, 'randombot', '/cart').allowed, false],
  ['generic bot: /checkout/ disallowed', isAllowed(robots, 'randombot', '/checkout/pay').allowed, false],
  ['generic bot: wildcard query rule', isAllowed(robots, 'randombot', '/p/thing?sort=price').allowed, false],
  ['generic bot: /p/ allowed', isAllowed(robots, 'randombot', '/p/thing').allowed, true],
  ['BadBot blocked everywhere', isAllowed(robots, 'BadBot', '/p/thing').allowed, false],
  ['empty robots.txt allows all', isAllowed(parseRobots(''), UA, '/anything').allowed, true],
  ['bare "Disallow:" allows all',
    isAllowed(parseRobots('User-agent: *\nDisallow:'), UA, '/anything').allowed, true],
  ['Disallow: / blocks all',
    isAllowed(parseRobots('User-agent: *\nDisallow: /'), UA, '/anything').allowed, false],
  ['longest match wins (Allow deeper than Disallow)',
    isAllowed(parseRobots('User-agent: *\nDisallow: /p/\nAllow: /p/zfc'), UA, '/p/zfc-mint').allowed, true],
  ['tie goes to Allow',
    isAllowed(parseRobots('User-agent: *\nDisallow: /p\nAllow: /p'), UA, '/p/x').allowed, true],
  ['$ anchors the end',
    isAllowed(parseRobots('User-agent: *\nDisallow: /p$'), UA, '/p/x').allowed, true],
  ['$ anchors the end (exact hit blocked)',
    isAllowed(parseRobots('User-agent: *\nDisallow: /p$'), UA, '/p').allowed, false],
  ['comments and blank lines ignored',
    isAllowed(parseRobots('# hi\n\nUser-agent: *   # us\nDisallow: /x'), UA, '/x').allowed, false],
  ['garbage robots.txt allows all (fail open, we are not the police)',
    isAllowed(parseRobots('≈≈≈ not a robots file ≈≈≈'), UA, '/p/thing').allowed, true],
  ['group lookup falls back to *', !!groupFor(parseRobots('User-agent: *\nDisallow: /'), 'nobody'), true],
  ['pattern escaping is literal for dots', patternToRegExp('/a.b').test('/axb'), false]
];

let pass = 0;
let fail = 0;
console.log('\n── zfc-watch robots.txt client ──────────────────────\n');
for (const [label, actual, expected] of CASES) {
  const ok = actual === expected;
  if (ok) pass++; else fail++;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + label.padEnd(58) +
    (ok ? '' : 'expected ' + expected + ', got ' + actual));
}
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
if (fail) process.exit(1);
