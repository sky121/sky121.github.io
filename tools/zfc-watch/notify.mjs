#!/usr/bin/env node
/* ==========================================================================
   notify.mjs — turn the checker's alert file into GitHub issues.

   WHY ISSUES, AND WHY ONE PER EVENT
   ---------------------------------
   The brief forbids third-party services, so the notification channel is
   GitHub itself. Of the two shapes available:

     * a NEW ISSUE per event  <- chosen
     * a comment on one long-lived tracking issue

   a new issue wins on the only axis that matters: does the email actually
   arrive, and does its subject line say the thing? A new issue notifies
   every watcher of the repo (you are auto-watching your own repos) and the
   email subject becomes the headline — "Z fc Mint Green is BACK IN STOCK —
   USD 1096.95". A comment buried on a tracking issue arrives with the
   tracking issue's title and is easy to miss.

   Belt and braces: the body also @-mentions the repo owner. Mentions
   notify regardless of watch settings, so the email arrives even if the
   owner has watching turned down to "participating and @mentions" (which
   is GitHub's default notification setting).

   Anti-spam: alerts only fire on TRANSITIONS (see check.mjs), and this
   script additionally de-duplicates — if an open issue with the same alert
   key was filed in the last DEDUPE_HOURS, it comments on that issue
   instead of filing a new one. A flapping parser therefore produces one
   issue plus comments, not a hundred issues.

     node tools/zfc-watch/notify.mjs --alerts <path> [--dry-run]

   Needs GITHUB_TOKEN (the workflow's built-in one) and GITHUB_REPOSITORY.
   Zero dependencies.
   ========================================================================== */

'use strict';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEDUPE_HOURS = 12;
const LABEL = 'zfc-watch';

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'dry-run') { flags[key] = true; continue; }
    flags[key] = argv[++i];
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const DRY = !!flags['dry-run'];
const ALERTS_PATH = resolve(flags.alerts || 'zfc-alerts.json');

const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY || '';
const OWNER = (process.env.GITHUB_REPOSITORY_OWNER || REPO.split('/')[0] || '').trim();
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const RUN_URL = process.env.GITHUB_SERVER_URL && REPO && process.env.GITHUB_RUN_ID
  ? process.env.GITHUB_SERVER_URL + '/' + REPO + '/actions/runs/' + process.env.GITHUB_RUN_ID
  : null;

/* ------------------------------------------------------------------ *
 * Alert -> issue copy
 * ------------------------------------------------------------------ */
function money(alert, value) {
  if (typeof value !== 'number') return 'an unrecorded price';
  return (alert.currency ? alert.currency + ' ' : '$') + value.toFixed(2);
}

function titleFor(a) {
  if (a.kind === 'restock') {
    return a.variant + ' is BACK IN STOCK' +
      (typeof a.price === 'number' ? ' — ' + money(a, a.price) : '');
  }
  if (a.kind === 'price_drop') {
    return a.variant + ' price DROPPED — ' + money(a, a.from) + ' → ' + money(a, a.to);
  }
  return 'Z fc watch: ' + a.variant + ' can no longer be read (parser may be broken)';
}

function bodyFor(a) {
  const lines = [];
  if (OWNER) lines.push('@' + OWNER);
  lines.push('');

  if (a.kind === 'restock') {
    lines.push('**' + a.variant + ' just went from `' + (a.from || 'unknown') +
      '` to `in_stock`.**');
    lines.push('');
    if (typeof a.price === 'number') lines.push('- Price: **' + money(a, a.price) + '**');
  } else if (a.kind === 'price_drop') {
    lines.push('**' + a.variant + ' dropped from ' + money(a, a.from) +
      ' to ' + money(a, a.to) + '.**');
    lines.push('');
    lines.push('- Saving: **' + money(a, Math.round((a.from - a.to) * 100) / 100) + '**');
  } else {
    lines.push('**' + a.variant + ' parsed cleanly as `' + a.from +
      '` on the previous run, and now reads `unknown`.**');
    lines.push('');
    lines.push('This is the failure mode that matters: if the parser is broken, a restock ' +
      'can come and go without a single alert. Treat this as "the watcher is blind", ' +
      'not as "still out of stock".');
    lines.push('');
    if (a.error) lines.push('- Checker said: `' + String(a.error).slice(0, 500) + '`');
    lines.push('- Likely causes: the page was redesigned, a bot wall was added, the URL ' +
      'moved, or the product page simply stopped emitting schema.org data.');
    lines.push('- Fix: open the URL, view source, and add a fixture under ' +
      '`tools/zfc-watch/fixtures/` that reproduces it, then teach `parse.mjs` the new signal.');
  }

  lines.push('- Signal: `' + (a.signal || 'none') + '`');
  if (a.detail) lines.push('- Why the checker believes that: ' + a.detail);
  if (a.url) lines.push('- Product page: ' + a.url);
  lines.push('- Live status board: https://sky121.github.io/zfc.html');
  if (RUN_URL) lines.push('- Workflow run: ' + RUN_URL);
  lines.push('');
  lines.push('<sub>Filed automatically by `tools/zfc-watch`. Close this issue once you have ' +
    'acted on it — the watcher only files again on the next real change.</sub>');
  lines.push('');
  lines.push(marker(a));
  return lines.join('\n');
}

function marker(a) {
  return '<!-- zfc-watch:alert-key=' + a.kind + ':' + a.key + ' -->';
}

/* ------------------------------------------------------------------ *
 * GitHub REST
 * ------------------------------------------------------------------ */
async function api(path, options = {}) {
  const res = await fetch(API + path, Object.assign({}, options, {
    headers: Object.assign({
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'zfc-watch-notifier',
      'Content-Type': 'application/json'
    }, options.headers || {})
  }));
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON error body */ }
  if (!res.ok) {
    const err = new Error('GitHub API ' + res.status + ' on ' + path + ' — ' +
      (json && json.message ? json.message : text.slice(0, 300)));
    err.status = res.status;
    throw err;
  }
  return json;
}

async function ensureLabel() {
  try {
    await api('/repos/' + REPO + '/labels/' + encodeURIComponent(LABEL));
  } catch (err) {
    if (err.status !== 404) return; // not fatal either way
    try {
      await api('/repos/' + REPO + '/labels', {
        method: 'POST',
        body: JSON.stringify({
          name: LABEL,
          color: '7fa8c9',
          description: 'Automated Nikon Z fc stock & price alerts'
        })
      });
    } catch (e) { /* label is a nicety, never a reason to drop an alert */ }
  }
}

async function findRecentOpenIssue(a) {
  let issues;
  try {
    issues = await api('/repos/' + REPO + '/issues?state=open&labels=' +
      encodeURIComponent(LABEL) + '&per_page=100');
  } catch (e) {
    return null; // on doubt, file a new issue — never swallow an alert
  }
  const key = marker(a);
  const cutoff = Date.now() - DEDUPE_HOURS * 3600000;
  for (const issue of issues || []) {
    if (issue.pull_request) continue;
    if (!issue.body || issue.body.indexOf(key) === -1) continue;
    const created = Date.parse(issue.created_at);
    if (isFinite(created) && created >= cutoff) return issue;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
async function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(ALERTS_PATH, 'utf8'));
  } catch (err) {
    console.log('notify: no readable alert file at ' + ALERTS_PATH + ' — nothing to do');
    return;
  }
  const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
  if (!alerts.length) {
    console.log('notify: 0 alerts — staying quiet (this is the normal case)');
    return;
  }

  console.log('notify: ' + alerts.length + ' alert(s)');

  if (DRY || !TOKEN || !REPO) {
    if (!DRY) console.log('notify: no GITHUB_TOKEN/GITHUB_REPOSITORY — printing instead of filing');
    for (const a of alerts) {
      console.log('\n' + '-'.repeat(68));
      console.log('TITLE: ' + titleFor(a));
      console.log('-'.repeat(68));
      console.log(bodyFor(a));
    }
    console.log('\n' + '-'.repeat(68));
    return;
  }

  await ensureLabel();

  let filed = 0;
  let commented = 0;
  for (const a of alerts) {
    try {
      const existing = await findRecentOpenIssue(a);
      if (existing) {
        await api('/repos/' + REPO + '/issues/' + existing.number + '/comments', {
          method: 'POST',
          body: JSON.stringify({ body: '**' + titleFor(a) + '**\n\n' + bodyFor(a) })
        });
        commented++;
        console.log('  commented on #' + existing.number + ' (' + a.kind + '/' + a.key + ')');
      } else {
        const issue = await api('/repos/' + REPO + '/issues', {
          method: 'POST',
          body: JSON.stringify({ title: titleFor(a), body: bodyFor(a), labels: [LABEL] })
        });
        filed++;
        console.log('  opened #' + issue.number + ': ' + issue.title);
      }
    } catch (err) {
      // One failed alert must not take the others down with it.
      console.log('::error::zfc-watch could not file the "' + a.kind + '" alert for ' +
        a.variant + ' — ' + err.message);
    }
  }
  console.log('notify: ' + filed + ' issue(s) opened, ' + commented + ' comment(s) added');
}

main().catch((err) => {
  console.log('::error::notify.mjs crashed: ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
