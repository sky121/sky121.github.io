# `tools/zfc-watch` — the watcher

The machinery behind [`zfc.html`](../../zfc.html). Plain Node, **zero
dependencies**, no build step. The narrative version of all this lives in
[`docs/zfc/README.md`](../../docs/zfc/README.md); this file is the operating
manual.

```
tools/zfc-watch/
  config.json      the variant list — YOU MUST FILL IN THE URLs
  parse.mjs        signal-based product-page parser (pure, no I/O)
  robots.mjs       robots.txt client
  check.mjs        the checker: fetch -> parse -> status.json + history + alerts
  notify.mjs       alerts -> GitHub issues
  fixtures/        hand-written HTML the parser is tested against
  test/            run-tests.mjs runs all three suites
```

---

## 1. Finish the setup (required — nothing works until you do this)

Every `url` in `config.json` is `null`. That is deliberate: the tool was
built in a sandbox that could not reach `www.nikonusa.com`, so **no URL in
here could be verified, and none was invented**.

1. Open `tools/zfc-watch/config.json`.
2. For each colour, open its product page on nikonusa.com, copy the address
   bar, and paste it in:
   ```json
   { "name": "Z fc Mint Green", "colour": "Mint Green",
     "url": "https://www.nikonusa.com/…", "sku": null }
   ```
3. Delete any colour Nikon no longer lists. Add any the list is missing —
   copy the shape above; `name`, `colour` and `url` are all that matter.
4. Commit. The next scheduled run picks it up; or run the workflow by hand
   from the Actions tab.

Until a URL is filled in, that colour reports as **`unknown` + "no URL
configured"** — loudly, in the run log as a GitHub error annotation, and on
the page as a "Not watched yet" card. It is *never* reported as out of
stock and never silently skipped.

Check your work locally:

```bash
node tools/zfc-watch/check.mjs --strict
```

`--strict` exits `2` if any variant still lacks a URL. (The workflow runs
*without* `--strict`, so a half-configured list still watches the colours
that are configured, rather than turning every scheduled run red.)

---

## 2. Running it

```bash
node tools/zfc-watch/test/run-tests.mjs        # all suites
node tools/zfc-watch/check.mjs                 # a real check
node tools/zfc-watch/check.mjs --strict        # ...and fail on bad config
node tools/zfc-watch/notify.mjs \
  --alerts /tmp/zfc-alerts.json --dry-run      # print issues instead of filing
```

`check.mjs` options:

| flag | default | what it does |
| --- | --- | --- |
| `--config <path>` | `tools/zfc-watch/config.json` | variant list |
| `--out-dir <path>` | `data` | where `zfc-status.json` / `zfc-history.jsonl` go |
| `--alerts-out <path>` | `$RUNNER_TEMP/zfc-alerts.json` | alert payload for `notify.mjs` |
| `--delay-ms <n>` | `config.requestDelayMs` (2500) | pause between requests |
| `--timeout-ms <n>` | `config.timeoutMs` (15000) | per-request timeout |
| `--heartbeat-hours <n>` | `config.heartbeatHours` (6) | commit even with no change after this long |
| `--strict` | off | exit 2 on unconfigured variants |
| `--quiet` | off | less chatter |

Exit codes: `0` normal (**including** per-variant 404s, timeouts and
robots-blocked URLs — one bad variant must never abort the run), `2` strict
config failure, `1` fatal (unreadable config, cannot write output).

---

## 3. The parser

`parse.mjs` exports `parseProductPage(html)`, which returns:

```js
{ status: 'in_stock' | 'out_of_stock' | 'unknown',
  signal: 'jsonld' | 'meta' | 'text:control' | 'text:link' |
          'text:body' | 'text:conflict' | 'none',
  price, currency, priceSignal, detail, candidates }
```

Signals are tried in order of trust and the first one that yields a status
wins. `detail` is a sentence explaining the verdict; `candidates` holds
everything every signal saw. Both are written into the status file, so any
reading on the page can be audited.

1. **`jsonld`** — `<script type="application/ld+json">`. Handles arrays,
   `@graph`, `AggregateOffer`, nested `offers`, untyped offer-shaped
   objects, `http://` and `https://` schema prefixes and bare tokens. If
   *any* offer says `InStock`, the variant is in stock; price is taken from
   the cheapest offer that has one.
2. **`meta`** — `product:availability`, `og:availability`,
   `product:price:amount`, `og:price:amount`, `product:price:currency`.
3. **`text:control`** — the label of a real buy/notify control: `<button>`,
   `<input type=submit|button>`, `role="button"`, plus their `aria-label`
   and `title`.
4. **`text:link`** — anchor labels. Anchors *navigate* rather than *act*, so
   they are only consulted when no real control spoke. Without this split, a
   footer's "Out of stock & backorder policy" link would outvote the Add to
   Cart button.
5. **`text:body`** — unambiguous banner copy, and only when the page says
   one thing. `"in stock"` is matched with lookbehinds so it is never
   harvested out of `"out of stock"` or `"back in stock"`.
6. Nothing matched → **`unknown`**, signal `none`.

**Two rules the tests enforce:**

- **`unknown` is never reported as out of stock.** A missed restock is the
  only failure that costs the user anything, so the parser refuses to guess.
  Garbage in, `unknown` out.
- **Contradictions resolve to `unknown`** (`text:conflict`), never to a coin
  flip. `BackOrder` and `PreOrder` also resolve to `unknown` — they are
  neither, and they are worth being told about.

### Teaching it a new signal

When a real page defeats it:

1. Save the page source as `fixtures/<something>.html` with a comment at the
   top saying what it is.
2. Add a case to `CASES` in `test/parse.test.mjs` (status, signal, price,
   currency, and a `why` line). Every fixture must have a case — the suite
   fails on an uncovered fixture.
3. Make it pass without breaking the others.

---

## 4. Output files

`data/zfc-status.json` — the latest reading:

```json
{ "schemaVersion": 1, "checkedAt": "…Z", "product": "Nikon Z fc",
  "variants": [{ "key", "name", "colour", "sku", "url", "status", "signal",
                 "detail", "price", "currency", "priceSignal", "httpStatus",
                 "robots", "error", "errorKind", "lastChangedAt",
                 "previousStatus", "lastPriceChangedAt" }] }
```

`errorKind` is one of `config` (no URL), `robots` (skipped), `network`,
`http`, `parse` — the page uses it to explain each non-clean reading.

`data/zfc-history.jsonl` — append-only, one JSON object per line:

```json
{"at":"…Z","variant":"Z fc Mint Green","key":"z-fc-mint-green","kind":"status","from":"out_of_stock","to":"in_stock","price":956.95,"currency":"USD","signal":"jsonld"}
```

`kind` is `first-reading`, `status`, `price` or `signal`.

---

## 5. Commit policy

The workflow commits **only** when:

- a status, price or parse-signal changed, **or**
- the last committed reading is more than `heartbeatHours` (6) old.

Without that, a 15-minute cron would add ~96 empty commits a day. The
heartbeat exists so `zfc.html` can honestly show the watcher is still alive.

> In CI each run starts from a fresh checkout, so the status file on disk is
> always the **last committed** reading — exactly the baseline the diff and
> the heartbeat want. Running `check.mjs` twice locally without committing
> compares against your own previous local run instead.

---

## 6. Politeness

- One request at a time, `requestDelayMs` apart (2.5 s), 15 s timeout.
- Exactly **one** retry, and only on a network/timeout error — never on an
  HTTP status.
- An honest `User-Agent` naming the tool, its purpose and the repo.
- `robots.txt` is fetched once per origin and obeyed. A disallowed path is
  **skipped and reported**, never fetched. Per RFC 9309 a 4xx robots.txt
  means "allow all"; a 5xx or an unreachable one means the checker does not
  fetch at all and reports `unknown`.

If this ever stops feeling proportionate, raise the cron interval. Do not
add parallelism.

---

## 7. Alerts

`check.mjs` writes an alert payload; `notify.mjs` turns it into GitHub
issues. Alerts fire **only** on:

| alert | when |
| --- | --- |
| `restock` | a variant goes `out_of_stock`/`unknown` → `in_stock`, or its **very first** reading is already `in_stock` |
| `price_drop` | the price is strictly **lower** than the last recorded price |
| `parse_broken` | a variant that previously parsed as `in_stock`/`out_of_stock` now reads `unknown` |

They do **not** fire for: an unchanged state (of any kind), a price *rise*,
a 404 or timeout, a robots-blocked URL, a variant with no URL configured, or
a first reading that is `out_of_stock`/`unknown`.

**One new issue per event**, not comments on a tracker — a new issue
notifies every watcher of the repo and the email subject line becomes the
headline ("Z fc Mint Green is BACK IN STOCK — USD 956.95"). The body also
`@`-mentions the repo owner, because mentions notify regardless of watch
settings. If an open issue with the same alert key was filed in the last 12
hours, `notify.mjs` comments on it instead, so a flapping parser produces
one issue plus comments rather than a hundred issues.

---

## 8. Tests

```bash
node tools/zfc-watch/test/run-tests.mjs
```

- `parse.test.mjs` — every fixture, asserting status **and** which signal
  decided it, plus helper units and the "never out_of_stock without
  evidence" invariant. Prints expected vs actual for every field.
- `robots.test.mjs` — group selection, longest-match, `*`, `$`, fail-open.
- `check.e2e.mjs` — spins a local HTTP server over the fixtures and runs
  `check.mjs` for real, four times: first reading, a mutated page (restock +
  price drop + parse breakage), a quiet run, and `--strict`.

CI runs the same command before every watch (see the `test` job in
`.github/workflows/zfc-watch.yml`), so a broken parser turns the run red
instead of quietly reporting `unknown` forever.
