# `tools/zfc-watch` — the watcher

The machinery behind [`zfc.html`](../../zfc.html). Plain Node, **zero
dependencies**, no build step. The narrative version of all this lives in
[`docs/zfc/README.md`](../../docs/zfc/README.md); this file is the operating
manual.

> **The directory, the data files and the page are all still called
> `zfc`.** The project is now "The Z Watch" and covers the Z fc *and* the
> Z f, but this repo keeps legacy filenames when a project is renamed
> (Peckish → Tableau did the same) so URLs, bookmarks and the committed
> history never break.

```
tools/zfc-watch/
  config.json      the PRODUCT list — YOU MUST FILL IN THE URLs
  config.mjs       config loader: multi-product shape + old-shape migration
  parse.mjs        signal-based product-page parser (pure, no I/O)
  alerts.mjs       what changed, and which changes this product asked about
  robots.mjs       robots.txt client
  check.mjs        the checker: fetch -> parse -> status.json + history + alerts
  notify.mjs       alerts -> GitHub issues
  fixtures/        hand-written HTML the parser is tested against
  test/            run-tests.mjs runs all four suites
```

---

## 1. Finish the setup (required — nothing works until you do this)

Every `url` in `config.json` is `null`. That is deliberate: the tool was
built in a sandbox that could not reach `www.nikonusa.com`, so **no URL in
here could be verified, and none was invented**. For the same reason the
**Z f colour list is unverified** — the black body is certain, the premium
exteriors are a best recollection. Check them before you paste anything.

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

### 1a. The config shape

```json
{
  "userAgent": "…", "requestDelayMs": 2500, "timeoutMs": 15000,
  "heartbeatHours": 6, "pollNotes": "…",

  "products": [
    { "key": "z-fc", "name": "Nikon Z fc",
      "alerts": ["restock", "price_drop"],
      "variants": [ { "name": "Z fc Mint Green", "colour": "Mint Green",
                      "url": null, "sku": null } ] },

    { "key": "z-f",  "name": "Nikon Z f",
      "alerts": ["price_drop"],
      "variants": [ { "name": "Z f Black", "colour": "Black",
                      "url": null, "sku": null } ] }
  ]
}
```

Every global setting (`userAgent`, `requestDelayMs`, `timeoutMs`,
`heartbeatHours`, `pollNotes`) stays top-level and applies to all products.

**`alerts` is the product's intent — see §7.** `key` is optional (it is
slugged from `name`), as is a per-product or per-variant `note`.

**To add a product:** append an object to `products` with its own `key`,
`name`, `alerts` and `variants`. **To add a variant:** append to that
product's `variants`. Give variants product-specific names (`"Z f Black"`,
not `"Black"`) — the variant `key` is slugged from the name and is what the
status file and the append-only history are keyed on. If two variants would
collide, the loader renames the second one and says so, but you lose the
tidy history key.

**The old single-product shape still loads.** A config with a top-level
`product` string and a flat `variants` array is migrated in memory to one
product with the default intents (`restock` + `price_drop`), with a warning
on every run. Nothing breaks on an un-migrated checkout; the warning is
there to stop it staying that way.

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
| `--config <path>` | `tools/zfc-watch/config.json` | product + variant list |
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

`data/zfc-status.json` — the latest reading, **schemaVersion 2**, grouped
by product:

```json
{ "schemaVersion": 2, "checkedAt": "…Z",
  "products": [
    { "key": "z-fc", "name": "Nikon Z fc", "alerts": ["restock","price_drop"],
      "variants": [{ "key", "name", "productKey", "productName", "colour",
                     "sku", "url", "status", "signal", "detail", "price",
                     "currency", "priceSignal", "httpStatus", "robots",
                     "error", "errorKind", "lastChangedAt", "previousStatus",
                     "lastPriceChangedAt" }] }
  ] }
```

Version 1 was one flat `variants` array plus a `product` string. Both the
checker (for its previous-run baseline) and `zfc.js` still read that shape,
so an old committed status file upgrades without re-announcing every
variant as a first reading.

`errorKind` is one of `config` (no URL), `robots` (skipped), `network`,
`http`, `parse` — the page uses it to explain each non-clean reading.

`data/zfc-history.jsonl` — append-only, one JSON object per line:

```json
{"at":"…Z","variant":"Z fc Mint Green","key":"z-fc-mint-green","product":"Nikon Z fc","productKey":"z-fc","kind":"status","from":"out_of_stock","to":"in_stock","price":956.95,"currency":"USD","signal":"jsonld"}
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
issues. The rules live in `alerts.mjs` and are unit-tested in
`test/alerts.test.mjs`. Alerts fire **only** on:

| alert | when | opt-in? |
| --- | --- | --- |
| `restock` | a variant goes `out_of_stock`/`unknown` → `in_stock`, or its **very first** reading is already `in_stock` | yes — `"restock"` in the product's `alerts` |
| `price_drop` | the price is strictly **lower** than the last recorded price | yes — `"price_drop"` in `alerts` |
| `parse_broken` | a variant that previously parsed as `in_stock`/`out_of_stock` now reads `unknown` | **no — always, for every product** |

They do **not** fire for: an unchanged state (of any kind), a price *rise*,
a 404 or timeout, a robots-blocked URL, a variant with no URL configured, or
a first reading that is `out_of_stock`/`unknown`.

### Alert intents, per product

```json
"alerts": ["restock", "price_drop"]   // Nikon Z fc
"alerts": ["price_drop"]              // Nikon Z f
```

The Z fc is out of stock everywhere, so its first in-stock reading **is**
the news and `restock` earns its keep. The Z f is normally on the shelf: with
`restock` enabled, the very first run would file a restock issue for every Z f
colour at once, and every page wobble after that. So it asks for price drops
only.

A product watched for price drops only is still **fetched, parsed, recorded
in the status file and the history, and shown on the page** with its real
stock status. The intent gates the *alert*, not the *watching*. Omitting
`alerts` entirely falls back to `restock` + `price_drop` with a warning;
unknown alert names are dropped with a warning; listing `parse_broken` is a
no-op (it is always on) and says so.

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

Four suites, 169 assertions:

- `parse.test.mjs` (64) — every fixture, asserting status **and** which
  signal decided it, plus helper units and the "never out_of_stock without
  evidence" invariant. Prints expected vs actual for every field.
- `robots.test.mjs` (19) — group selection, longest-match, `*`, `$`,
  fail-open.
- `alerts.test.mjs` (32) — the config shapes (including the old
  single-product one) and the alert intents: a first in-stock reading
  alerts for the Z fc and **not** for the Z f, a price drop alerts for
  both, and parse breakage alerts even for a product that asked for
  nothing.
- `check.e2e.mjs` (54) — spins a local HTTP server over the fixtures and
  runs `check.mjs` for real, five times, against a **two-product** config:
  first reading (Z fc restock alert, Z f silent despite being in stock), a
  mutated page (restock + price drop + parse breakage, plus a Z f variant
  coming back in stock that must **not** alert), a quiet run, `--strict`,
  and a run against the legacy single-product config.

CI runs the same command before every watch (see the `test` job in
`.github/workflows/zfc-watch.yml`), so a broken parser turns the run red
instead of quietly reporting `unknown` forever.
