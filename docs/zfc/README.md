# The Z Watch — project handoff & design doc

> A stock and price watcher for the **coloured Nikon Z fc and Z f** bodies.
> A scheduled GitHub Actions job does the looking, commits what it finds as
> JSON, opens a GitHub issue when something real happens, and a Lab page
> reports the result honestly — including when it does not know.
>
> This document is the single source of truth for the project. Last
> updated: **2026-10-19**.

---

## A note on the name and the filenames

The project was **"The Z fc Watch"** and is now **"The Z Watch"**, because
it watches the Z f too. **Every filename stayed exactly as it was** —
`zfc.html`, `assets/js/zfc.js`, `assets/css/zfc.css`, `data/zfc-status.json`,
`data/zfc-history.jsonl`, `tools/zfc-watch/`, `.github/workflows/zfc-watch.yml`,
the `zfc-watch` issue label and the `zfc-watch` concurrency group.

That is this repo's standing practice: **when a project is renamed, the
files keep their old names** (Peckish → Tableau did the same) so published
URLs, bookmarks, the committed data history and anything already linking in
never break. A file called `zfc` is not a mistake; it is older than the
title.

---

## Status: v2 — MULTI-PRODUCT, BUILT, TESTED, **NOT YET CONFIGURED**

- **Page:** https://sky121.github.io/zfc.html
- **Watcher:** `.github/workflows/zfc-watch.yml`, every 15 minutes
- **Watching:** Nikon Z fc (restocks + price drops) and Nikon Z f (price
  drops only — see **Alert intents** below)
- **One thing is outstanding before it can watch anything:** every `url` in
  `tools/zfc-watch/config.json` is `null` and must be filled in by hand.
  See [Finishing setup](#finishing-setup). Until then the page shows every
  colour as **"Not watched yet"** — honestly, and never as "out of stock".
- **And the Z f colour list is unverified** — see below.

### Known limitation, stated plainly

**The parser was built blind.** The sandbox this was developed in denies
`www.nikonusa.com` at the network layer, so **not one line of this was ever
tested against a real Nikon page**. Every fixture under
`tools/zfc-watch/fixtures/` is synthetic — hand-written to the shape that
schema.org, Open Graph and ordinary retail markup take, and labelled as
such at the top of each file.

**The Z f colour list was also written blind.** The plain black body is
safe. The premium-exterior colours in `config.json` — Indigo Blue, Sepia
Brown, Stone Gray, Moss Green, Bordeaux Red, Sunset Orange — are a best
recollection that **has not been checked against Nikon**. Verify them (and
delete or add as needed) before pasting URLs. The config file says the same
thing in a comment, at the top, where someone editing it will see it.

That constraint is why the design is what it is:

- it reads **signals**, in order of trust, not CSS selectors;
- it returns **`unknown`** rather than guessing;
- `unknown` is an **alert**, not a shrug;
- every verdict records **which signal produced it**, so the first real run
  can be audited by eye.

The first live run is therefore the real test. Expect to add one or two
fixtures from the actual page source; `tools/zfc-watch/README.md` §3
explains how.

---

## Alert intents — the core rule

Each product in `config.json` declares what it wants to hear about:

```json
{ "key": "z-fc", "name": "Nikon Z fc", "alerts": ["restock", "price_drop"], … }
{ "key": "z-f",  "name": "Nikon Z f",  "alerts": ["price_drop"],            … }
```

| product | intents | why |
| --- | --- | --- |
| **Z fc** | `restock` + `price_drop` | It is out of stock everywhere. The first in-stock reading *is* the news. |
| **Z f** | `price_drop` only | It is normally on the shelf. With `restock` on, the very first run would file a "BACK IN STOCK" issue for every Z f colour at once, and another every time its page wobbled. That is not an alert, that is spam. |

`parse_broken` is **not** an intent and cannot be switched off: it fires for
every product, always. A watcher that can no longer read a page is blind,
and a blind watcher is worth reporting no matter what you asked it to look
for.

**Watching is not alerting.** A product watched for price drops only is
still fetched, parsed, recorded in `zfc-status.json`, logged in
`zfc-history.jsonl` and shown on the page with its real stock status. The
intent gates the issue, nothing else. The page says so out loud: the Z f
section is headed with a **"Sales only"** badge and a sentence explaining
that its stock is read but never pings.

The rules live in `tools/zfc-watch/alerts.mjs` (pure, no I/O) and are
unit-tested in `test/alerts.test.mjs`; the end-to-end suite proves the same
thing against a real HTTP run.

---

## Why it is shaped like this

A page on GitHub Pages **cannot** poll a retailer. Nikon's product pages
send no `Access-Control-Allow-Origin` header, so a `fetch()` from
`sky121.github.io` is blocked by the browser before a byte moves. There is
no clever client-side workaround that is not a third-party proxy.

So the work is split:

```
   ┌─────────────────────────────────────────────┐
   │ GitHub Actions runner (open internet)       │
   │                                             │
   │  robots.txt ──► check.mjs ──► parse.mjs     │
   │                    │                        │
   │          ┌─────────┴──────────┐             │
   │          ▼                    ▼             │
   │  data/zfc-status.json   alerts payload      │
   │  data/zfc-history.jsonl       │             │
   │          │                    ▼             │
   │          │              notify.mjs ──► GitHub issue ──► email
   │          ▼                                  │
   │    git commit (only on change / heartbeat)  │
   └──────────┬──────────────────────────────────┘
              ▼
      GitHub Pages serves the repo
              ▼
      zfc.html ──fetch(same origin)──► data/zfc-status.json
```

Three properties fall out of this and are worth keeping:

1. **No secrets.** The only credential is the workflow's built-in
   `GITHUB_TOKEN`. Nothing to rotate, nothing to leak, no third-party
   account.
2. **The data is auditable.** Every reading is a commit. The history file
   is append-only. You can `git log data/zfc-status.json` and see exactly
   what the watcher believed and when.
3. **The page cannot lie about freshness**, because it only ever renders a
   timestamp that a real run wrote.

---

## The parsing strategy

Full detail in [`tools/zfc-watch/README.md`](../../tools/zfc-watch/README.md)
§3. In short, in order of trust:

| # | signal | what it reads |
| --- | --- | --- |
| 1 | `jsonld` | schema.org `offers.availability` + `price`/`priceCurrency`. Arrays, `@graph`, `AggregateOffer`, nested offers, untyped offer-shaped objects. |
| 2 | `meta` | `product:availability`, `og:availability`, `product:price:amount`, `og:price:amount`. |
| 3 | `text:control` | the label of a real buy/notify control — `<button>`, `<input type=submit>`, `role="button"`, `aria-label`, `title`. |
| 4 | `text:link` | anchor labels, consulted only if no real control spoke. |
| 5 | `text:body` | unambiguous banner copy, only when the page says one thing. |
| — | `none` | → **`unknown`** |

The first signal that yields a status wins; price may come from a different
(lower-priority) signal and records its own `priceSignal`.

### The two rules that matter

**`unknown` is never rendered or reported as out-of-stock.** A missed
restock is the entire failure mode of this app. Quietly claiming "still out
of stock" when the parser broke is the worst bug it could have, so the
parser refuses to produce `out_of_stock` without positive evidence, and the
page gives `unknown` a visual identity of its own (gold, dashed,
question-marked, with a paragraph of plain English) that cannot be confused
with the calm grey out-of-stock pill.

**Contradictions are `unknown`, not a coin flip.** If the controls say both
"Add to Cart" and "Out of stock" and there is no structured data to break
the tie, the signal is `text:conflict` and the status is `unknown`. So are
`BackOrder` and `PreOrder` — they are neither state, and they are news.

### Specificity

"A stray phrase elsewhere on the page must not flip the verdict" is
enforced structurally rather than by keyword tuning: the strong text pass
only ever looks at the labels of *controls*, and anchors are demoted to a
weak second pass. `fixtures/text-only.html` exists to prove it — the page
is an in-stock product page seeded with "sold out" in a review, "out of
stock" in a nav link and "currently unavailable" in a cross-sell blurb, and
it must still read `in_stock`.

---

## Finishing setup

One required step, one optional.

### Required — the URLs

1. Open `tools/zfc-watch/config.json`.
2. For each colour, under the right product, open its nikonusa.com product
   page and paste the address into `url`.
3. Delete colours Nikon no longer sells; add any that are missing.
4. Commit.

The seeded Z fc list — Black, Amber Brown, Coral Pink, Mint Green, Natural
Gray, Sand Beige, Sunset Orange, White — is a best recollection of the Z fc
premium-exterior range and **has not been verified against Nikon**. The
seeded Z f list — Black plus Indigo Blue, Sepia Brown, Stone Gray, Moss
Green, Bordeaux Red and Sunset Orange — is **less certain still**. Treat
both as starting points, not facts.

### Adding a product or a variant

To add a **product**, append to `products`:

```json
{ "key": "z8", "name": "Nikon Z8", "alerts": ["price_drop"],
  "variants": [ { "name": "Z8 Black", "colour": "Black", "url": null } ] }
```

To add a **variant**, append to that product's `variants`. Name variants
with their camera in the name (`"Z f Black"`, not `"Black"`) — the variant
key is slugged from the name and is what the status file and the
append-only history are keyed on, and the page's headline reads those
names. The page picks up a new product automatically: it renders one
section per product, from the data file.

The **old single-product config shape** (a top-level `product` string and a
flat `variants` array) still loads. It is migrated in memory to one product
with the default `restock` + `price_drop` intents, with a warning on every
run, so an un-migrated checkout keeps watching instead of falling over.

Verify locally with:

```bash
node tools/zfc-watch/check.mjs --strict   # exits 2 while any url is null
```

### Optional — notifications

Issues notify repo watchers, and you are watching your own repo by default;
the issue body also `@`-mentions the repo owner, which notifies regardless
of your watch setting. If you want them on your phone, the GitHub mobile
app honours the same notifications. Nothing else to configure.

One thing worth knowing: **GitHub disables scheduled workflows after 60
days of repository inactivity.** If the watch goes quiet, check the Actions
tab — any commit or a manual run re-enables it. The page's stale banner is
your early warning.

---

## Alerts — what fires and what does not

| fires | when | for which products |
| --- | --- | --- |
| **restock** | `out_of_stock`/`unknown` → `in_stock`, or a very first reading that is already `in_stock` | only those with `"restock"` in `alerts` (today: Z fc) |
| **price drop** | strictly lower than the last recorded price | only those with `"price_drop"` in `alerts` (today: both) |
| **parse breakage** | a variant that previously read `in_stock`/`out_of_stock` now reads `unknown` | **all of them, always** |

| does **not** fire | why |
| --- | --- |
| an unchanged state, every run | alerts are transitions, not states |
| a price **rise** | not news you asked for |
| a 404 / timeout / network error | transient; it shows on the page, and becomes a parse-breakage alert only if it turns a clean read into `unknown` |
| a robots-blocked URL | the watcher's own choice, not a change |
| a variant with no URL configured | a setup task, surfaced on the page and in the run log instead |
| a first reading of `out_of_stock` or `unknown` | that is the baseline being established |
| **a restock of any kind on the Z f** | it did not ask; it is in stock most of the time and the alert would be noise |

**One new issue per event**, labelled `zfc-watch`, deduplicated against
open issues with the same alert key from the last 12 hours (those get a
comment instead). The reasoning is in the header comment of
`tools/zfc-watch/notify.mjs`: a new issue reliably notifies watchers and
puts the headline in the email subject line, which a comment on a tracking
issue does not.

---

## The page

`zfc.html` + `assets/css/zfc.css` + `assets/js/zfc.js`, built on the shared
`exhibit-page.css` chrome and `gallery.js` exactly as `ClassChecker.html`
does — same nav, wash field, pre-paint theme script, footer, and the
gallery.js-injected `.theme-toggle` (styled in `zfc.css`, since
`exhibit-page.css` never styles it).

- **Freshness pulse** at the top, in one of four states: *live*, *stale*
  (gold, past 2 hours, with a sentence saying the job may be delayed,
  disabled or failing), *never run*, or *could not load*. When the data is
  stale the warning leads and the headline follows — "1 in stock" is
  worthless news if the reading is five hours old.
- **One section per camera**, in document order from the status file: an
  `h2` with the product name, a badge stating the watch intent
  ("Restocks + sales" / "Sales only"), a sentence spelling the same thing
  out in words, then that camera's grid of cards. Sections are separated by
  a rule, so the grouping survives without colour.
- **One card per colour**: a painted swatch, the status pill, price (with
  the previous price struck through when it just changed), a price
  sparkline when there are ≥2 recorded prices, when the status last
  changed, and — this is the point — **which signal produced the verdict**,
  in a `<code>` span.
- **Four pill states**, each with a glyph as well as a hue so colour is
  never the only signal: `● In stock` (sage), `○ Out of stock` (plain grey),
  `? Unknown` (gold, **dashed**, with an explanatory paragraph),
  `! Not watched yet` (wisteria, for an unconfigured URL).
- **Change log** from `zfc-history.jsonl`, newest first, across all
  products.
- **Empty state** before the first run — it replaces the product sections
  *and* the paragraph introducing them.
- **Back-compatible** with a schemaVersion 1 status file: a flat `variants`
  array renders as one product with the intents that shape implied.

### Accessibility

Audited at 390×844 in both themes with the rest of the site's standard:

- AA or better on every text element in **both** themes (measured against
  the real composited background: the weakest is 4.55:1 in day, 4.61:1 in
  evening; most are 5–11:1).
- Every control ≥44 px: the theme toggle (44×44), the back link, and each
  card's "View the product page" link. Inline prose links are exempt under
  WCAG 2.5.8.
- `prefers-reduced-motion` honoured — verified with Playwright's reduced
  motion emulation: `document.getAnimations()` returns **0**.
- `role="status" aria-live="polite"` on the freshness pulse; each pill
  carries a visually-hidden variant name so it reads as "Z fc Mint Green:
  In stock" out of context.
- Headings run `h1` → `h2` (section) → `h3` (card) with no skips.
- No horizontal overflow at 390 px.

### A trap worth remembering

`gallery.js` collects `.reveal` elements **once, at load**. Anything
rendered in afterwards with that class would sit at `opacity: 0` forever.
`zfc.css` therefore gives the cards and log items their own `zfc-bloom`
keyframe (disabled under reduced motion) and never uses `.reveal` on
generated nodes.

---

## Files

| file | role |
| --- | --- |
| `zfc.html` | the Lab page (legacy filename, kept deliberately) |
| `assets/css/zfc.css` | page styles + product groups + theme toggle + dark theme + reduced motion |
| `assets/js/zfc.js` | reads the two data files and renders one section per product |
| `tools/zfc-watch/config.json` | **the product + variant list — fill in the URLs** |
| `tools/zfc-watch/config.mjs` | config loader: multi-product shape, old-shape migration |
| `tools/zfc-watch/parse.mjs` | the signal-based parser (pure) |
| `tools/zfc-watch/alerts.mjs` | diffing + **the per-product alert intents** (pure) |
| `tools/zfc-watch/robots.mjs` | robots.txt client |
| `tools/zfc-watch/check.mjs` | the checker |
| `tools/zfc-watch/notify.mjs` | alerts → GitHub issues |
| `tools/zfc-watch/fixtures/*.html` | 11 synthetic test pages |
| `tools/zfc-watch/test/*.mjs` | parser units, robots units, alert-intent units, offline e2e |
| `.github/workflows/zfc-watch.yml` | the schedule, the tests, the commit, the alerts |
| `data/zfc-status.json` | latest reading (seeded empty) |
| `data/zfc-history.jsonl` | append-only change log (seeded empty) |

Not touched by this project: `lab.html` (the tile is the orchestrator's),
`index.html`, `sitemap.xml`, and anything belonging to Dragoose or Peckish.

---

## Testing

```bash
node tools/zfc-watch/test/run-tests.mjs     # 4 suites, 169 assertions
python3 -m http.server 8000                 # then open /zfc.html
```

| suite | assertions | what it covers |
| --- | --- | --- |
| `parse.test.mjs` | 64 | every fixture: status, signal, price, and the "never out_of_stock without evidence" invariant |
| `robots.test.mjs` | 19 | group selection, longest-match, `*`, `$`, fail-open |
| `alerts.test.mjs` | 32 | config shapes (new **and** legacy) and the alert intents |
| `check.e2e.mjs` | 54 | the real checker over a local fixture server, two products, five runs |

The e2e suite serves the fixtures over real HTTP and runs the real checker
five times against a two-product config — first reading (a Z fc variant
already in stock alerts; a Z f variant already in stock does **not**), a
mutated page (Z fc restock + price drop + parse breakage, a Z f price drop,
and a Z f variant coming back in stock that must stay silent), a quiet run,
`--strict`, and a run against the legacy single-product config — asserting
the status file, the history lines, the alert payload and the commit
decision at each step. It needs no network.

---

## Roadmap, if it earns it

- Feed the first real page source back in as fixtures and tighten the
  parser against it, and **verify the Z f colour list**.
- A `sku` per variant, so a page listing several bodies can be read for the
  right one.
- Pull the history into a proper price chart once there are enough points
  for a chart to say anything.
- Widen beyond Nikon's own store (B&H, Adorama) — the parser is already
  retailer-agnostic; it would only need more config entries and a check
  that each store's `robots.txt` permits it.
- A `target price` per product, so the Z f could alert only below a number
  rather than on any drop. The intent machinery in `alerts.mjs` is the
  place for it.
