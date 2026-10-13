/* ==========================================================================
   robots.mjs — a small, honest robots.txt client (RFC 9309 shaped).

   The watcher is a personal tool hitting a handful of URLs every 15 minutes.
   That is polite only if we also do the polite thing and read robots.txt
   first. If a product path is disallowed we SKIP it and say so in the
   output rather than fetching anyway — the Lab page then shows
   "blocked by robots.txt" instead of a fake verdict.

   No deps. Pure parsing + one fetch helper.
   ========================================================================== */

'use strict';

/**
 * Parse robots.txt into user-agent groups.
 * Consecutive User-agent lines share one group of rules (RFC 9309 §2.2.1).
 */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastLineWasAgent = false;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }
    lastLineWasAgent = false;
    if (field !== 'allow' && field !== 'disallow') continue;
    if (!current) { current = { agents: ['*'], rules: [] }; groups.push(current); }
    current.rules.push({ type: field, path: value });
  }
  return { groups };
}

/** Pick the group for our token: exact/substring match, else '*', else none. */
export function groupFor(robots, token) {
  const ua = String(token || '').toLowerCase();
  let best = null;
  let bestLen = -1;
  let star = null;
  for (const g of (robots && robots.groups) || []) {
    for (const agent of g.agents) {
      if (agent === '*') { star = star || g; continue; }
      if (ua.indexOf(agent) !== -1 && agent.length > bestLen) { best = g; bestLen = agent.length; }
    }
  }
  return best || star || null;
}

/** robots.txt path pattern -> RegExp. Supports '*' and a trailing '$'. */
export function patternToRegExp(pattern) {
  let p = String(pattern == null ? '' : pattern);
  let anchorEnd = false;
  if (p.endsWith('$')) { anchorEnd = true; p = p.slice(0, -1); }
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + (anchorEnd ? '$' : ''));
}

/**
 * Is `pathAndQuery` allowed for `token`?
 * Longest matching rule wins; on a tie Allow wins (RFC 9309 §2.2.2).
 * An empty Disallow value allows everything.
 */
export function isAllowed(robots, token, pathAndQuery) {
  const group = groupFor(robots, token);
  if (!group || !group.rules.length) return { allowed: true, rule: null };

  let winner = null;
  for (const rule of group.rules) {
    if (rule.type === 'disallow' && rule.path === '') continue; // "allow all"
    let re;
    try { re = patternToRegExp(rule.path); } catch (e) { continue; }
    if (!re.test(pathAndQuery)) continue;
    const len = rule.path.length;
    if (!winner || len > winner.len || (len === winner.len && rule.type === 'allow')) {
      winner = { len, rule };
    }
  }
  if (!winner) return { allowed: true, rule: null };
  return {
    allowed: winner.rule.type === 'allow',
    rule: winner.rule.type.charAt(0).toUpperCase() + winner.rule.type.slice(1) + ': ' + winner.rule.path
  };
}

/**
 * Fetch and parse the robots.txt for an origin.
 * Per RFC 9309 §2.3.1: 4xx => allow all; 2xx => obey; anything else
 * (5xx, network failure) is "unavailable" and we treat it as a refusal to
 * guess — the caller reports `unknown` rather than fetching blind.
 */
export async function fetchRobots(origin, { userAgent, timeoutMs = 10000, fetchImpl = fetch } = {}) {
  const url = origin.replace(/\/+$/, '') + '/robots.txt';
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': userAgent, Accept: 'text/plain,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (res.status >= 400 && res.status < 500) {
      return { state: 'absent', httpStatus: res.status, robots: { groups: [] } };
    }
    if (!res.ok) {
      return { state: 'unavailable', httpStatus: res.status, robots: null,
        reason: 'robots.txt returned HTTP ' + res.status };
    }
    const text = await res.text();
    return { state: 'ok', httpStatus: res.status, robots: parseRobots(text) };
  } catch (err) {
    return { state: 'unavailable', httpStatus: null, robots: null,
      reason: 'robots.txt fetch failed: ' + (err && err.message ? err.message : String(err)) };
  }
}
