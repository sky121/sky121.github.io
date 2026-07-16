# Peckish — project handoff & design doc

> A watercolor "where to eat" web app. Tap a bubble → set quick preferences →
> **swipe a Tinder-style deck** of nearby restaurants (closest first, expanding
> outward) → land on one. Plus a private **Visited** rating log and demo
> **Friends** + **Popular** tabs.
>
> Single source of truth so we can pick up exactly where we left off.
> Last updated: **2026-07-15**.

---

## Status: LIVE (Lab project)

- **Play it:** https://sky121.github.io/eats.html — reached from the **Lab** (`lab.html`), the "Peckish" tile.
- Fully usable in **demo mode** right now (sample data, no setup). Two things turn on the "real" features and need *you* (see "What needs you" below): a **Google Maps API key** (live restaurants) and a **backend** (real Friends + Popular).

### Files (committed to `master`)
| File | What it is |
|---|---|
| `eats.html` | The app page (reuses site chrome: theme script, exhibit-page.css, gallery.js) |
| `assets/css/eats.css` | All Peckish styling (bubble, swipe deck, prefs, cards, bottom tabs, sheets) |
| `assets/js/eats.js` | The whole app — vanilla JS, one `'use strict'` IIFE, no deps |
| `lab.html` | Holds the Live "Peckish" tile linking here |
| `sitemap.xml` | Has the `eats.html` entry |

---

## How to resume / develop

- **Run locally:** from repo root, `python3 -m http.server`, open `http://localhost:8000/eats.html` (serve over HTTP, not `file://`).
- **No build step** — plain HTML/CSS/JS. `node --check assets/js/eats.js` to lint JS.
- **Architecture (`eats.js`):** single IIFE; closures roughly: `store` (localStorage), `state`, `distance` (haversine), `demo` (sample data), `tabs` (bottom-bar router, roving-tabindex a11y), `find` (bubble → prefs → swipe deck), `gmaps` (lazy Google Maps/Places, current API), `sheet` (rating sheet), `visited` (CRUD), `social` (mock Friends/Popular API), `settings` (key). Watercolor chrome comes from `exhibit-page.css`; `gallery.js` provides the theme + wash drift.
- **localStorage keys:** `eats-gmaps-key` (the API key — never committed), `eats-prefs` (last swipe preferences), `eats-visited` (the rating log), `eats-seen` (recently passed places, 6 h TTL). `sh-theme` (shared site light/dark).
- **Ratings scale:** everything is **0–100 whole numbers** (Food/Vibe/Service → averaged Overall; Google's 0–5 is mapped ×20 for display).

---

## Feature map (what's built)

### Find = bubble → preferences → swipe deck
- **Bubble landing:** a luminous watercolor "Find" bubble (only it + a discreet "search a specific location" link). Tapping it **pops** (watercolor droplet burst; reduced-motion skips straight through) → Preferences.
- **Preferences — one-at-a-time wizard** (2026-07-08): one pref group on stage at a time (no long scroll): Back / "Skip →" step nav with a "N of 9" position marker, live match count, and **Start swiping + Surprise me always visible** so you can quit the questions early at any point; "Done →" past the last step starts the search; the wizard resets to step 1 on each visit (`prefs.showStep/nextStep`; `.pref-group.is-step` CSS). All groups optional, default "Any", persisted: Cuisine (16 chips), Price ($–$$$$), Min rating (Any/70+/80+/90+), Min reviews (Any/100+/500+/1000+), Open now, Max distance (Walking ~1mi / Short drive ~5mi / Anywhere — caps outward expansion), Dietary (Veg/Vegan/GF), Dining mode (Dine-in/Takeout/Delivery).
- **Swipe deck:** cards nearest-first, expanding outward. Drag **left = pass / right = like** (rotation + green YES / red NOPE stamps, peeking next card); also ✗/♥ buttons + ArrowLeft/ArrowRight; reduced-motion uses fades. **Tap the card to cycle story segments: Vibe → Food → Reviews.** Card overlay: name, 0–100 rating + review count, price, cuisine, distance, open-now.
- **Decision screen** (on like): "Tonight: <name>" → Open in Maps (Directions), Call (if phone), "I ate here → Rate" (opens the rating sheet), **Save to shortlist · keep swiping**, Keep looking. **End-of-deck** screen → Compare shortlist (if any) / Widen preferences / Search farther (live) / Start over.

### End-of-deck "adjust one thing" chips (2026-07-15)
The end-of-deck screen now recovers without a full restart. Above the
existing actions (Compare shortlist / Widen preferences / Search farther /
Start over) a JS-built chip row (`renderEndTweaks` in the deck closure,
rebuilt on every `showEnd`) offers **Change cuisine / Change price / Change
rating / Widen distance** plus a gold-washed **✦ Surprise me**:
- **One-question tweaks** — a chip calls `find.showPrefs(false)` then
  `prefs.jumpTo(controlId)`, which opens the wizard in a new **single-step
  mode**: only that fieldset is on stage (found by control id via
  `stepIndexFor`, so reordering steps in the HTML can't break it), the step
  marker reads "just this one", Back is hidden, and the next button reads
  **Done →** — pressing it (or Start swiping) persists and re-runs the
  search for a fresh deal. `prefs.render()` resets the flag, so every
  ordinary visit is the full 9-step wizard again.
- **✦ Surprise me** (`surpriseFromEnd`) — roulettes a place you haven't
  seen this outing (current matches minus `eats-seen` minus the shortlist,
  reusing the existing `deck.surprise` roulette → decision flow). If
  everything's been seen it calls the new `store.clearSeen()`, announces
  it, toasts "Fresh deck!", and re-deals via `find.startSearch()`. Zero
  current matches nudges you to loosen a preference instead of looping.
- A11y/design: every transition announced through `announce()` (single-step
  entry announces "change what you like, then Done to re-deal the deck");
  chips are ≥44px pill buttons in the pref-chip watercolor style
  (`.end-tweaks`/`.end-chip` CSS + evening overrides for the gold chip,
  `.end-chip` added to the reduced-motion freeze list and the ≤400px
  compaction).

### Find orb redesign — "living pool" (2026-07-08)
The landing orb is now continuously alive instead of a mostly-static circle.
All ambient loops are transform/opacity only (no box-shadow or filter
animation): **pigment churn** — three oversized palette washes
(rose+wisteria on `.find-orb-pool::before`, sage+gold on
`.find-orb-pool::after`, pond+rose on the new `.find-orb-churn` span's
`::before`) rotate/drift on offset 27s/34s/21s alternate loops, clipped to
the circle by `overflow:hidden`, so the colors visibly swirl and remix;
**breathing** — the button scales 1→1.035 on a 5.2s loop (`orb-breathe`)
while a `.find-orb::after` glow-shadow spreads and softens in sync via
opacity+scale (`orb-shadow-breathe`); **sheen sweep** — the specular
highlight drifts diagonally across the surface on a 13s loop
(`orb-sheen-sweep`); **ripple** — a concentric ring expands and fades every
4.2s (`orb-ripple` on `.find-orb::before`), quickening to 1.1s on press;
**word-mark glow** — a halo behind "Find" pulses on the breath period
(`orb-text-glow` on `.find-orb-inner::before`). Hover swells the orb via the
independent `translate`/`scale` properties (so they compose with the breathe
animation) and speeds the churn layers up subtly; active is a fast 0.96
squish. Dark mode gets stronger wash opacities + a pond-glow shadow so the
orb glows against the dark paper. The tap **pop-burst → Preferences**
choreography is unchanged (`.is-popping` now also fades the churn span and
stills the new pseudos); reduced motion stills every loop into a static
painted orb and keeps the instant no-pop path. One HTML addition:
`<span class="find-orb-churn">` between pool and sheen in `eats.html`; no JS
changes.

### Wave 3 (2026-07-08)
- **Share a pick** — the decision screen has a Share action: native `navigator.share` sheet where available (title/text/maps URL), clipboard fallback with a paper-pill "Copied!" toast + live-region announcement; fully guarded, never breaks the screen.
- **Friends/Popular motion** — feed entries and leaderboard rows enter with a ~40ms staggered rise (`enterStagger`/`.social-enter`, class stripped on animationend); top-3 Popular rank badges bloom on first render. Reduced-motion: everything instant.
- **Extras preference facet** — outdoor seating / good for groups / serves alcohol / kid-friendly chips on Preferences; every demo restaurant carries `extras` flags; filter requires ALL selected (like dietary). Live Google Places results don't carry these attributes, so the extras check is skipped when `r.extras` is undefined.

### PWA (2026-07-08)
Peckish is installable: `peckish.webmanifest` (standalone, portrait, watercolor icons in `images/peckish-icon-*.png`) + `peckish-sw.js` registered with **scope `/eats`** so it never controls the rest of the portfolio. Strategy: network-first with cache fallback — online visitors always get fresh files, and **demo mode works fully offline** after the first visit (verified: offline reload + full deck flow). Install tip added to the settings sheet. Icons regenerate from `scratchpad` pkicon.html if ever needed.

### Wave 5-6 (2026-07-08)
- **Popular sparklines** — each leaderboard row draws a 7-point trend line (`svgSparkline` + `trendSeries`: deterministic, name-seeded, shaped by the row's trend direction) in the rank accent; aria-hidden, hidden <360px.
- **Rating-save celebration** — saving a rating fires a watercolor droplet burst from the sheet (`dropletBurst(cx,cy,base)`, a reusable body-level helper), a 14 ms haptic, and a toast with the overall score.
- **Friend hearts** — each Friends entry has a like button (♡ → ♥ rose, count seeded per entry id); session-local demo state only, aria-pressed, announced.
- **Share shortlist** — a ghost button on the compare view shares a numbered plain-text list (name — ★ · $ · travel) via navigator.share or clipboard + toast; shortlist rows also show your Visited rating when you've eaten there.

### Wave 4 (2026-07-08)
- **Swipe haptics** — `haptic(ms)` helper (top of `eats.js`, next to `announce`): guarded `navigator.vibrate`, never throws where unsupported, skipped under prefers-reduced-motion. 10 ms on a committed swipe (`fling`, drag or ✗/♥/arrow keys), 18 ms on reaching the decision screen (`onLike`), 6 ms on undo (`undoLast`).
- **Travel-time estimates** — `fmtTravel(mi)` (next to `fmtDist`): ≤1.3 mi → walking minutes at 3.1 mph ("12 min walk"), farther → urban driving minutes at ~16 mph ("9 min drive"); rounded up, min 1 min. Shown as its own dot-separated chip after distance on swipe cards (`.ov-travel`, glued to the distance in a non-wrapping `.ov-distgroup` so the meta line wraps cleanly at 390 px), on the decision screen, in the shortlist compare rows, and in the card a11y summary ("about 2 min walk"). The " away" suffix was dropped where the travel chip follows (kept in the a11y summary).
- **Drifting washes on card art** — CSS-only: a soft paper-light pool (`.card-seg-panel::before`, two faint radial highlights) breathes across the card art on a ~14 s loop (`wash-drift`, transform/opacity only, runs only on the `.is-active` panel; on live photos it reads as a faint sheen). Paused under prefers-reduced-motion.
- **Visited quick filter** — when the log has **more than 5 entries**, a compact search field (`#visited-filter`, reuses the `.loc-input` paper-field look) appears above the list and filters by name/note/location as you type (case-insensitive substring, sort preserved); zero matches shows a "No matches for “x”" note (stats stay describing the whole log). Hidden — and the query cleared — at ≤5 entries.

### TRIO cards (2026-07-08 — replaces the hero+peeks design)
The card face is a **free-floating scatter**: three EQUAL **4:3 blocks** — two up top (tilted like polaroids), one below — showing vibe photo/art, food photo/art, and the review as a **paper note**, plus the paper **info scrap** (name, meta, travel, open, your rating) floating separately. No containing card, no dusk backdrop, and upcoming cards are hidden (no stack peeking behind) — the drag surface is invisible; only the blocks float on the page. Tilts via per-slot `--tilt`; short screens (<780px tall) compact the scatter so it never crowds the controls; set-indicator bars restyled for the paper background. **A single tap advances all three blocks to the next set** (staggered turn animation; indicator bars = set count). Content pooling (`mediaPlaylist(r)`): per-category pools (demo: 2 art variants each for vibe/food via `panelArt(r, seg, variant)` + up to 3 review quotes; live: real photos + quotes) are interleaved round-robin and chunked into sets of 3; **when a category runs dry, remaining categories backfill its slot** so every set holds three real things, and cycling wraps. Implemented in `mediaPlaylist`/`buildCard`/`renderTrio`/`cycleSegment` + `.trio*` CSS. Reduced-motion: no turn animation. The old hero+peek design (and `.card-peeks` CSS) was removed.

### Motion & delight (added 2026-07-08)
- **Deck deal-in** — cards deal onto the table with a staggered rise-and-settle when a deck loads (reduced-motion: fade).
- **Decision celebration** — choosing a place blooms soft watercolor droplets behind the "Tonight" card.
- **Surprise me** — a ghost button on Preferences skips swiping: a brief name-shuffle roulette ("Choosing for you…") lands on a random pick from the filtered results and opens the standard decision screen. Zero-match case falls back gracefully.
- **Segment crossfade** — Vibe/Food/Reviews panels crossfade with a slight scale instead of hard-swapping; segment bars animate.
- **Visited empty state** — deleting every entry shows a painterly "Your table is set" invitation instead of a blank pane.

### Swipe QoL (added 2026-07-08)
- **Undo** — the ↩ button left of Pass (or **Z** / **Backspace**) brings the last card back, from the deck *or* the end screen; undoing a pass also erases its seen-memory record. History resets per deck load.
- **Seen memory** — passed places are remembered in `eats-seen` (`{id: timestamp}`, ~6 h TTL, pruned on read). On a new search they **sink to the back of the deck** (nearest-first within unseen, then seen) instead of being hidden — no dead ends, no repeats up front.
- **Liked shortlist** — "Save to shortlist" on the decision screen banks the place and keeps you swiping. A green ♥ badge in the deck bar counts saves and opens a **compare view** (name + meta + "Tonight" pick + remove). End-of-deck becomes "Down to your shortlist" with a compare button. Session-only (resets when you leave Find) — a shortlist is per outing.
- **Procedural watercolor card art** — when a card has no real photo (all of demo mode, plus live places without photos), `panelArt()` paints a cuisine-keyed composition: Vibe = three pigment washes over dusk paper; Food = a plate with dish-color pooling on a table wash. Palettes per cuisine in `CUISINE_ART`; seeded by place name so every card differs. Replaces the old flat gradient + emoji glyph.

### Visited (private rating log) — fully works offline
Rate any place with **Food / Vibe / Service sliders (0–100)** → live Overall, note, date. Cards show the three sub-bars + Overall, with sort, edit, re-rate, delete; running count + average. Persisted in `eats-visited`.

### Friends + Popular — DEMO UIs (backend-ready)
- **Friends:** sample feed of friends' ratings (sort + per-friend filter), clearly demo-badged.
- **Popular:** trending leaderboard with Today / This Month / This Year toggle, top-3 accents.
- Both read through a **promise-based mock `social` API** (loading/error states) — see the "MOCK SOCIAL API" comment in `eats.js`. Swapping in a real backend is a contained change to those resolvers, not a rewrite.

### Chrome
Fixed **bottom tab bar** (Find / Visited / Friends / Popular, icons + labels, safe-area aware, keyboard-operable). A single **floating corner gear** holds the API-key setup and a discreet "← Back to the Lab" link. No top nav bar, no footer (intentionally minimal). Full light/dark theme, mobile-first, AA contrast, accessible.

---

## What needs YOU (to go from demo → real)

1. **Live restaurants (Find):** create a free **Google Maps API key** — enable *Places API (New)* + *Maps JavaScript API*, restrict it to HTTP referrers `https://sky121.github.io/*`, paste it into the in-app **gear → settings** (stored only in your browser, never in the repo). The corner gear has the step-by-step.
2. **Real Friends + Popular:** these are inherently multi-user, so they need a **shared backend + accounts** (Firebase or Supabase, both have free tiers and work from a static site). When you're ready, the swap is contained to the `social` resolvers. This also unlocks: friend connections, real cross-user trending (true day/month/year), and syncing your Visited log across devices.

### Live-data caveats (already handled in code, good to know)
- Google **doesn't label photos** as "vibe" vs "food" — live mode splits a place's available photos across those segments and fills Reviews from Place reviews (demo shows the fullest 3-way split).
- Photos/reviews/phone need a per-place **Place Details** call — the deck lazily fetches details only for the top card + next two (cached) to save quota.
- `open now` in distance-ranked search uses Google's `isOpen()` (deprecated but the only no-extra-call signal); **phone/Call** isn't in nearby results, so it appears only when details supply it.

---

## Roadmap / ideas (next)
- Wire the **backend** (Firebase/Supabase) → real Friends, real Popular, accounts, cross-device Visited sync.
- ~~A **Liked shortlist**~~ **DONE 2026-07-08** (see Swipe QoL above).
- ~~**Undo last swipe**, and a "seen already" memory~~ **DONE 2026-07-08** (see Swipe QoL above).
- More preference facets (outdoor seating, reservations, good-for-groups, serves alcohol, kid-friendly) — Google attributes exist for some.
- Real **food/vibe photo classification** (e.g., a lightweight model or heuristic) if we ever want the live 3-way split to be truly categorized.
- ~~Surface **your Visited ratings on the swipe cards**~~ **DONE 2026-07-08** — cards, the decision screen, and the a11y summary all show "You rated this NN" (gold pill / meta line), matched by place name against the Visited log. Friends' scores on cards still wait on the backend.
- Optional: richer map view. ~~Walking time~~ **DONE 2026-07-08** (travel-time chips, Wave 4); ~~share a pick with a friend~~ **DONE 2026-07-08** (Wave 3).

---

## Design decisions locked in
- **Static-first, honest about limits:** Yelp can't run client-side; Google Places via the Maps JS SDK can (referrer-restricted key). Multi-user features require a backend — built as demo UIs until then.
- **Speed is the product:** one bubble tap, fast preference chips (remembered), then pure swiping; minimal taps to a decision.
- **0–100 whole-number ratings** everywhere; **nearest-first, no fixed radius** (expands outward, capped by the optional Max distance).
- **Minimal, calm UI:** bubble-only landing, bottom tabs, no footer/top-nav clutter; watercolor aesthetic shared with the rest of the site; full dark mode; mobile-first one-handed use.
