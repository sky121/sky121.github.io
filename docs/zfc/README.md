# The Z fc Watch — project handoff & design doc

> A stock and price watcher for the **coloured Nikon Z fc** bodies. A
> scheduled GitHub Actions job does the looking, commits what it finds as
> JSON, opens a GitHub issue when something real happens, and a Lab page
> reports the result honestly — including when it does not know.
>
> This document is the single source of truth for the project. Last
> updated: **2026-10-13**.

---

## Status: v1 — BUILT, TESTED, **NOT YET CONFIGURED**

- **Page:** https://sky121.github.io/zfc.html
- **Watcher:** `.github/workflows/zfc-watch.yml`, every 15 minutes
- **One thing is outstanding before it can watch anything:** every `url` in
  `tools/zfc-watch/config.json` is `null` and must be filled in by hand.
  See [Finishing setup](#finishing-setup). Until then the page shows every
  colour as **"Not watched yet"** — honestly, and never as "out of stock".

### Known limitation, stated plainly

**The parser was built blind.** The sandbox this was developed in denies
`www.nikonusa.com` at the network layer, so **not one line of this was ever
tested against a real Nikon page**. Every fixture under
`tools/zfc-watch/fixtures/` is synthetic — hand-written to the shape that
schema.org, Open Graph and ordinary retail markup take, and labelled as
such at the top of each file.

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
2. For each colour, open its nikonusa.com product page and paste the
   address into `url`.
3. Delete colours Nikon no longer sells; add any that are missing.
4. Commit.

The seeded list — Black, Amber Brown, Coral Pink, Mint Green, Natural Gray,
Sand Beige, Sunset Orange, White — is a best recollection of the Z fc
premium-exterior range and **has not been verified against Nikon**. Treat
it as a starting point, not a fact.

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

| fires | when |
| --- | --- |
| **restock** | `out_of_stock`/`unknown` → `in_stock`, or a very first reading that is already `in_stock` |
| **price drop** | strictly lower than the last recorded price |
| **parse breakage** | a variant that previously read `in_stock`/`out_of_stock` now reads `unknown` |

| does **not** fire | why |
| --- | --- |
| an unchanged state, every run | alerts are transitions, not states |
| a price **rise** | not news you asked for |
| a 404 / timeout / network error | transient; it shows on the page, and becomes a parse-breakage alert only if it turns a clean read into `unknown` |
| a robots-blocked URL | the watcher's own choice, not a change |
| a variant with no URL configured | a setup task, surfaced on the page and in the run log instead |
| a first reading of `out_of_stock` or `unknown` | that is the baseline being established |

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
- **One card per colour**: a painted swatch, the status pill, price (with
  the previous price struck through when it just changed), a price
  sparkline when there are ≥2 recorded prices, when the status last
  changed, and — this is the point — **which signal produced the verdict**,
  in a `<code>` span.
- **Four pill states**, each with a glyph as well as a hue so colour is
  never the only signal: `● In stock` (sage), `○ Out of stock` (plain grey),
  `? Unknown` (gold, **dashed**, with an explanatory paragraph),
  `! Not watched yet` (wisteria, for an unconfigured URL).
- **Change log** from `zfc-history.jsonl`, newest first.
- **Empty state** before the first run.

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
| `zfc.html` | the Lab page |
| `assets/css/zfc.css` | page styles + theme toggle + dark theme + reduced motion |
| `assets/js/zfc.js` | reads the two data files and renders |
| `tools/zfc-watch/config.json` | **the variant list — fill in the URLs** |
| `tools/zfc-watch/parse.mjs` | the signal-based parser (pure) |
| `tools/zfc-watch/robots.mjs` | robots.txt client |
| `tools/zfc-watch/check.mjs` | the checker |
| `tools/zfc-watch/notify.mjs` | alerts → GitHub issues |
| `tools/zfc-watch/fixtures/*.html` | 11 synthetic test pages |
| `tools/zfc-watch/test/*.mjs` | parser units, robots units, offline e2e |
| `.github/workflows/zfc-watch.yml` | the schedule, the tests, the commit, the alerts |
| `data/zfc-status.json` | latest reading (seeded empty) |
| `data/zfc-history.jsonl` | append-only change log (seeded empty) |

Not touched by this project: `lab.html` (the tile is the orchestrator's),
`index.html`, `sitemap.xml`, and anything belonging to Dragoose or Peckish.

---

## Testing

```bash
node tools/zfc-watch/test/run-tests.mjs     # 3 suites, ~120 assertions
python3 -m http.server 8000                 # then open /zfc.html
```

The e2e suite serves the fixtures over real HTTP and runs the real checker
four times — first reading, a mutated page (restock + price drop + parse
breakage), a quiet run, and `--strict` — asserting the status file, the
history lines, the alert payload and the commit decision at each step. It
needs no network.

---

## Roadmap, if it earns it

- Feed the first real page source back in as fixtures and tighten the
  parser against it.
- A `sku` per variant, so a page listing several bodies can be read for the
  right one.
- Pull the history into a proper price chart once there are enough points
  for a chart to say anything.
- Widen beyond Nikon's own store (B&H, Adorama) — the parser is already
  retailer-agnostic; it would only need more config entries and a check
  that each store's `robots.txt` permits it.
