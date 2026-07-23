# Tableau — project handoff & design doc

> **Tableau** (formerly *Peckish*, renamed 2026-07-19) — a watercolor "where to
> eat" web app. Tap the deep-pool **Find** button → set quick preferences →
> **swipe a Tinder-style deck** of nearby restaurants (closest first, expanding
> outward) → land on one. Plus a private **Visited** rating log and demo
> **Friends** + **Popular** tabs.
>
> **Filenames stay legacy on purpose:** `eats.html`, `peckish-sw.js`,
> `peckish.webmanifest`, `peckish-icon-*.png`, `og-peckish.png` keep their names
> so installed PWAs and existing URLs never break — only user-facing strings and
> icon *art* changed.
>
> Single source of truth so we can pick up exactly where we left off.
> Last updated: **2026-07-21**.

---

## Status: LIVE (Lab project)

- **Play it:** https://sky121.github.io/eats.html — reached from the **Lab** (`lab.html`), the "Tableau" tile.
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

### Shortlist "constellation" — a tiny no-deps relative map (2026-07-21)
The compare view (shortlist badge / end-of-deck "Compare shortlist") now opens
with a small **constellation panel** above the compare cards — a watercolor
plot of where the shortlisted places sit relative to *you*, so geography is
part of the decision, not buried in a distance line.
- **The panel** (`buildConstellation` in the deck closure, `.slc-constellation*`
  CSS) — a rounded ~11rem watercolor panel. **YOU** is a small pond feather dot
  dead centre; each shortlisted place is a watercolor dot placed by its **real
  bearing + distance** from the search origin (`state.origin`, the same origin
  the haversine `distance` uses). Bearing comes from the lat/lng offset
  (longitude compressed by `cos(lat)`); the **radius is a strictly increasing
  function of the real distance** (`MINR + dist/maxDist·(MAXR−MINR)`) so the
  farthest spot always sits nearest the edge and the nearest hugs the centre —
  ordering that survives the collision nudge below.
- **Isotropic without measuring layout** — `.slc-const-plot` is an
  `aspect-ratio: 1/1` box sized to the panel height and centred, so a 0..100
  coordinate maps to equal pixels on both axes (no distance distortion). The
  faint **dotted rays** from centre to each dot are one inline `<svg>`
  (viewBox 0 0 100, `preserveAspectRatio="none"`) — no map libraries.
- **Dot styling** — pigment tint pulled from the same `panelArt` palette hash
  as the place's cards (first hex it emits), the name in tiny type beneath
  (CSS-truncated with ellipsis) and distance on a second line via `fmtDist`.
  Coincident dots are nudged apart along their circle (angle only — radius/
  distance held fixed) so two spots never stack.
- **Tap to highlight** — dots are real `<button>`s (`aria-label "Highlight
  <name>"`, ≥44px hit area via transparent padding around the visual pip).
  Tapping scrolls the matching compare card into view and pulses it ~1.2s with
  a gold glow echoing `.slc.is-winner` (`.slc.is-highlight` + `slc-highlight`
  keyframe; `highlightCard` clears any prior highlight and reflows so re-taps
  restart the pulse).
- **Graceful absence** — needs **≥2 places with usable coords** (`location`
  lat/lng + non-null `distance`, and a resolvable origin); below that the panel
  doesn't render (a one-dot map is noise). Demo data carries coords, so it
  works with zero setup.
- **Evening** overrides tuned; **reduced motion** swaps the pulse for an instant
  scroll + a static gold outline that `highlightCard` clears after a beat (no
  animation). Verified at 390px with Playwright: 3-dot plot with distinct
  positions, geometric radius-vs-distance ordering asserted, tap-pulse, the
  1-place bail, and the reduced-motion path.

### Landing "clean primary CTA" — the orb is gone (2026-07-20)
Third pass on the Find landing. The user rejected both earlier attempts — a
floating watercolor **orb/sphere** as the button ("the giant orb floating in a
void doesn't read as good UI/UX") — and chose a clear direction: a warm heading
+ a one-line subtitle, then a **single obvious rounded primary button** low in
the thumb zone, with watercolor kept only as the background wash.
- **The orb is fully removed** — the circular `.find-orb` button, its
  `.find-orb-pool` water body, the `.orb-ink-bloom` press bloom, and the whole
  CSS block (`.find-orb*`, `@keyframes orb-light-drift / orb-shadow-breathe /
  orb-ink-absorb`) are deleted. The `popAndStart` ink-absorption choreography
  (`is-absorbing` / `is-dissolving`) is gone from `eats.js`. **`dropletBurst`
  and its `.orb-burst` / `.orb-drop` / `orb-drop-fly` CSS are kept** — the
  rating-save celebration still uses them; they were never on the find path.
- **New landing** (`eats.html`): a `.find-hero` (italic Cormorant
  "Where to, tonight?" + muted Karla "A quiet nudge toward dinner.") then a
  `.find-cta` cluster — the primary `#find-near-me` button (**same id**, so the
  click→`showPrefs` wiring is untouched) as a solid pond-tinted **pill** with a
  location-pin glyph + "Find a place near me", plus the unchanged "search a
  specific location" link and its location form beneath. Layout: the CTA is
  pushed low via `margin-top:auto` (button center ≈ 67% down at 390×844 — thumb
  zone, not dead-center, clear of the tab bar).
- **Look**: deep pond fill (`#4c76a0`→`#3f6187`) with paper-white text in light,
  lighter pond fill with dark ink text under `html.evening` (both ≥4.5:1 AA);
  soft shadow, subtle `:active` press (~2% scale + shadow tighten). No glossy
  sphere, no rings, no droplet burst.
- **Transition**: a quiet crossfade — `.find-landing.is-leaving` fades out, then
  `showPrefs(true)` with the existing `.prefs-wrap.is-washing-in` wash-in.
  `prefers-reduced-motion` jumps straight to the wizard.
- Real `<button>` — Enter/Space activate it; `aria-label="Find a place to eat
  near me"`. Verified (Playwright, 390×844): heading+subtitle+one button, orb
  markup absent, `#find-near-me` is a `<button>`, click **and** Enter open the
  wizard (`.pref-group.is-step` = 1), **`.orb-burst` created 0×** in the find
  flow, `:active` has a `scale()` transform, reduced-motion instant, evening
  contrast good, dropletBurst CSS intact, zero page errors (Google Fonts noise
  excepted).

### Renamed to Tableau + new Find button (2026-07-19)
Responding to user critique ("not a huge fan of the name Peckish… I don't like
the look and animation of the find button, especially the circles that come out
when you click find — feels kinda childish").
- **Rename → Tableau** (French for a painted scene; evokes *table*): every
  user-facing string updated — page `<title>`, header/kicker, all toasts /
  `announce()` / share text / offline banner / aria-labels in `eats.js`, and the
  manifest `name`/`short_name`. **Files were NOT renamed** (see header) — a
  manifest comment records the legacy filenames. The app icons and OG card were
  re-rendered (headless-chromium generator) to a paper field + deep-pool disc +
  cream serif **T**, tying them to the new Find button; same filenames/dims.
- **Find button redesign** — the old rainbow-churn orb + droplet-burst press
  (the "childish circles") are gone. Now a **deep still pool**: an
  ink→pond-deep radial wash (moonlit lighter blue under `html.evening`), one
  slow ~barely-there light drift + a breathing shadow, elegant italic Cormorant
  "Find". Press is an **inward ink absorption** — a dark bloom gathers at the
  exact tap point (`.orb-ink-bloom`, `--bx/--by` from the pointer), the orb
  settles ~2%, then the landing dissolves forward into the wizard
  (`is-absorbing` / `is-dissolving` / `is-washing-in`). **No expanding rings,
  no `dropletBurst` in the find path** (dropletBurst stays for the rating-save
  celebration only). `prefers-reduced-motion`: static pool, instant transition.
  Verified: title/manifest "Tableau", zero user-facing "Peckish" across all
  tabs, `orb-burst` created **0** times in the find flow, ink bloom appears,
  wizard opens, reduced-motion instant, zero page errors.

### Find = pool button → preferences → swipe deck
- **Bubble landing:** a luminous watercolor "Find" bubble (only it + a discreet "search a specific location" link). Tapping it **pops** (watercolor droplet burst; reduced-motion skips straight through) → Preferences.
- **Preferences — one-at-a-time wizard** (2026-07-08): one pref group on stage at a time (no long scroll): Back / "Skip →" step nav with a "N of 9" position marker, live match count, and **Start swiping + Surprise me always visible** so you can quit the questions early at any point; "Done →" past the last step starts the search; the wizard resets to step 1 on each visit (`prefs.showStep/nextStep`; `.pref-group.is-step` CSS). All groups optional, default "Any", persisted: Cuisine (16 chips), Price ($–$$$$), Min rating (Any/70+/80+/90+), Min reviews (Any/100+/500+/1000+), Open now, Max distance (Walking ~1mi / Short drive ~5mi / Anywhere — caps outward expansion), Dietary (Veg/Vegan/GF), Dining mode (Dine-in/Takeout/Delivery).
- **Swipe deck:** cards nearest-first, expanding outward. Drag **left = pass / right = like** (rotation + green YES / red NOPE stamps, peeking next card); also ✗/♥ buttons + ArrowLeft/ArrowRight; reduced-motion uses fades. **Tap the card to cycle story segments: Vibe → Food → Reviews.** Card overlay: name, 0–100 rating + review count, price, cuisine, distance, open-now.
- **Decision screen** (on like): "Tonight: <name>" → Open in Maps (Directions), Call (if phone), "I ate here → Rate" (opens the rating sheet), **Save to shortlist · keep swiping**, Keep looking. **End-of-deck** screen → Compare shortlist (if any) / Widen preferences / Search farther (live) / Start over.

### "Coming up" peek strip + softer deal-in (2026-07-16)
A display-only preview beneath the swipe deck (`ensurePeek`/`renderPeek` in
the deck closure, called from `renderStack`): tiny circular watercolor
thumbs of the **next up-to-3 places** in the queue (food photo when one
exists, else `panelArt` pigment) with the distance in tiny type under each,
labeled "coming up" in small caps. Updates as cards are swiped; hides when
nothing's ahead and whenever the deck view isn't active. Strictly
decorative: `aria-hidden` (announce() already reports counts),
`pointer-events: none`, zero handlers. On a fresh deal the thumbs **ripple
in staggered** (~620ms + 90ms·i, `.is-rippling`) after the top card lands —
skipped entirely under reduced motion. The main deal-in overshoot was
tuned down (cubic-bezier 1.26 → 1.16, 0.62s → 0.66s) for a gentler landing.
Layout: the deck trimmed to `min(60vh, 28.5rem)` (the trio centers itself,
so the scatter just re-centers) so the strip clears the fixed tab bar at
390×844 — verified by bounding-box assertion (row bottom ≤ tab-bar top);
the short-screen media query (≤780px tall) hides the strip so controls
always win.

### Visited insights — "Your month in meals" (2026-07-16)
Display-only recap that sits between the Visited head row and the log
(`.v-insights` section, JS-built in the visited closure, rendered on every
`render()`):
- **Recap card** for the current calendar month: distinct **places tried**,
  **average overall**, and a **weeks streak** (consecutive weeks with ≥1
  visit, Monday-start local weeks via `weekIndex`; a quiet
  week-in-progress doesn't break it — last week anchors). **Top cuisine**
  with a hash-tinted pigment dot, then a compact **cuisine bar row** (top
  4 by count, watercolor-tinted CSS bars + counts). If this month is
  empty, last month's recap shows with a "— last month" label; with
  nothing dated this or last month (incl. the fresh demo seeds) the whole
  section stays hidden — the tab's existing empty state handles it.
- **All-time line** beneath: total places · total visits · most-returned-to
  place.
- **Dating**: `computeInsights` reads `entryDate(e)` — the rating sheet's
  `date` field (YYYY-MM-DD) first, else a new `ts` stamp that
  `visited.add()` now writes on every new entry (`data.ts = Date.now()`).
  Legacy entries with neither are treated as "earlier": counted all-time,
  absent from the month and streak. New entries also remember
  `cuisines` from the picked place so the breakdown can group them.
- Semantic headings/labels for screen readers, no new interactions, full
  `html.evening` overrides; verified against hand-computed seed data
  (recap numbers exact, last-month fallback, fresh-demo hidden case).

### Friends: taste match + "you both loved" + share nudge (2026-07-16)
The Friends tab now reads your Visited log against each friend's demo feed
(all in the `friends` closure; works unchanged on any future backend feed
with the same shapes, no new storage keys):
- **Taste match per friend** (`tasteMatch`) — for every place you've BOTH
  rated (feed entry matched to your Visited log by name via `myRatingFor`,
  deduped to one vote per place per friend), per-place closeness is
  `100 - |your overall - theirs|` (floored at 0). The average closeness is
  damped by `n/(n+2)` so a single lucky overlap can't read near-perfect
  (1 shared spot caps at 33%, 2 at 50%…). Shown as a chip-bg pill under the
  friend's name on every feed card ("48% taste match · 2 shared spots",
  `.friend-match`); no overlap renders a quiet italic "no shared spots yet"
  instead of a number. Matches are computed from the FULL feed before the
  per-friend filter, so pills stay right in any view.
- **Friend detail header** (`buildDetailHead`) — filtering to one friend
  (the chips row) now prepends a full-width detail card: bigger avatar,
  name, match caption, and a **watercolor match ring** (`matchRing` —
  SVG track + pigment arc in the friend's palette color swept to the %,
  aria-hidden since the caption carries the meaning). When you both scored
  shared places **≥ 80 overall**, a **"You both loved"** strip lists them
  as rose/gold-washed chips ("Tonkotsu Lane — you 90 · them 87",
  `.loved-chip`); nothing qualifying → the strip is omitted entirely, no
  overlap → no ring either.
- **Share nudge** (`renderCta`) — one quiet line + button under the list
  ("Eaten somewhere great?" / "Share your shortlist"). With a shortlist it
  calls the deck's existing `shareShortlist()` (the deck closure now
  exposes `shortlistCount()` + `shareShortlist` in its return for this);
  without one it hops to Find (`tabs.activate('find')`) with a toast
  nudging you to swipe a few places. Hidden entirely when the shortlist is
  empty AND the Visited log is empty — never nags a fresh app.
- Verified with hand-computed seeds asserted against the rendered text
  exactly (48% / 26% cases, chips, CTA visibility matrix), light +
  `html.evening` at 390px, zero page errors.

### Richer shortlist compare view (2026-07-16)
The compare screen (shortlist badge / end-of-deck "Compare shortlist") is now
a real decision tool instead of a name+meta list:
- **Compare cards** (`buildCompareCard` in the deck closure, `.slc*` CSS) —
  each shortlisted place is a compact card with the food panelArt/photo
  thumbnail (live photo when present, `panelArt(r,'food',0)` otherwise),
  name + open-now/closed pill, and **fixed fact slots in the same order on
  every card** (★ score + review count with a trend sparkline / price ·
  cuisine / distance · travel time / "You rated it NN") so eyes can hop
  straight down the column when weighing A against B at 390 px. The
  sparkline is `svgSparkline` fed by `slTrendSeries` — the same name-seeded
  deterministic recipe as Popular's `trendSeries`, rebuilt in the deck
  closure since that helper is scoped to `popular` (hidden ≤360 px via the
  existing `.pop-spark` rule).
- **✦ Pick for me** (`pickForMe`) — a roulette spotlight hops card-to-card
  with widening gaps (timers ride the existing `rouletteTimers` so deck
  teardown clears them), lands on a random pick, the winner card **lifts
  and glows gold** (`.slc.is-winner`) for a beat, then the standard
  decision screen takes over ("Tonight: <name>" + Open in Maps / Call /
  Share / Rate — the existing `onLike` machinery). While shuffling the
  view's controls go quiet (`.shortlist.is-picking` + JS guards for the
  keyboard path). **Reduced motion (or a one-place list) commits
  instantly — no shuffle.** Button is a static hook in `eats.html`
  (`.shortlist-pickme`, btn-solid).
- **Per-card actions** — "Choose this one" (same `onLike` decision flow as
  the winner path) and "Remove" with a **5-second Undo toast** that splices
  the place back where it was (`removeWithUndo`; removing the last card
  falls back to the deck/end screen, and Undo from the end screen re-runs
  `showEnd` so the count/copy refresh). Both are ≥44 px pill buttons with
  focus-visible outlines.
- **toast() upgrade + styling** — `toast(msg, {label, onAction, duration})`
  optionally renders one action button (e.g. "Undo") and holds the pill
  longer; plain calls unchanged. Also added the previously **missing
  `.eats-toast` CSS** (the pill had no styles at all): fixed paper pill
  above the tab bar, is-show fade/rise, evening + reduced-motion variants;
  interactive toasts drop `aria-hidden` so the Undo button is reachable.
- A11y/design: `showShortlist` announces "Comparing N shortlisted places",
  the shuffle announces "Choosing from your shortlist…", removals/undos are
  announced; open/star/you-rated colors have evening overrides; Share
  shortlist + Back keep working beneath the new Pick for me button. The old
  `.sl-item` row styles were removed with the code that built them.

### Rating sheet delight pass (2026-07-16)
Scoring in the rating sheet (Rate / add / edit) now reacts to the scores
themselves. No change to what's saved — same entry shape, same keys.
- **Score-tinted sliders** — as a slider moves, JS sets `--score-tint` on
  its `.slider-block` (`scoreTint(v)` in the sheet closure: a linear
  pigment mix, low ~rose → 50 ~gold → high ~sage). The wc-range track fill
  + thumb drink the raw tint (`var(--score-tint, var(--track-fill, …))`,
  both WebKit and Moz pseudo-elements), while the number takes an
  **ink-anchored `color-mix`** (38% tint / 62% ink; evening: 55% tint into
  cream `#f1ead9`) so it stays AA-readable at every score. Browsers
  without `color-mix` fall back to the old per-category colors (invalid
  declaration → earlier rule wins). Sliders stay native inputs — fully
  keyboard-operable, tint follows arrow keys.
- **Live overall bloom** — a soft watercolor blot (`.overall-blot`, a
  blurred blob inside the new `.overall-num-wrap` in `eats.html`) sits
  behind the Overall number, tinted by the same `--score-tint` (set on the
  wrap from the live average) and **gently swelling one pulse at a time**
  while any slider moves (`.is-swell` → `blot-swell` keyframes,
  transform/opacity only; `animationend` clears the gate). Input events
  are **coalesced to one sync per frame** via `requestAnimationFrame`
  (`scheduleSync`) so fine-grained drags don't thrash. The Overall number
  gets the same AA color-mix treatment (34% tint into ink; large-text
  sizes give extra contrast headroom over the blot).
- **Save celebration** — the save burst now fires as a tiny `dropletBurst`
  from the **Save button** (rect captured before `hide()` — a hidden sheet
  measures 0×0) instead of the sheet's midpoint, alongside the existing
  toast + haptic.
- **Reduced motion** — numbers + tints still update instantly, but the JS
  never adds `.is-swell`, `dropletBurst` already no-ops, and the CSS
  reduced-motion block zeroes the blot/number transitions (selectors match
  the tint rules' specificity so they actually win).

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

### Service worker v2 — real offline resilience (2026-07-16)
- **`peckish-sw.js` bumped to `CACHE = 'peckish-v2'`** with the full core
  shell precached on install (eats.html, eats.css, exhibit-page.css,
  eats.js, gallery.js, favicon.svg, the manifest, and all three
  `peckish-icon-{180,192,512}.png`); activate deletes any older
  `peckish-*` caches (v1 cleanup verified). Fetch strategy unchanged:
  network-first with cache fallback, so fresh deploys always win online.
- **Offline signal** — a new `offline` closure in `eats.js` (initialized
  in `boot()`) pins a small paper note to the top of the Find panel:
  *"You're offline — demo kitchen's still open"* (`#offline-note`,
  JS-built, `role="note"`, rose-washed `.offline-note` CSS with evening
  override + reduced-motion opt-out). Driven by `navigator.onLine` and
  the `online`/`offline` events (state changes are announced through the
  live region); appears/disappears live, no reload needed.
- **Offline searches land in demo mode silently** — `startSearch()`, the
  location-form geocode path, and `searchFarther()` all consult
  `offline.isOffline()`: with a saved key but no network they skip the
  live Google path (or, if the connection dropped mid-search, skip the
  settings error prompt) and run the demo data instead. The existing
  demo pipeline is untouched — offline is just routed onto it.
- **Update flow** — `boot()` listens for `controllerchange`: when a NEW
  service worker takes over a page that was already controlled, the
  existing `toast()` shows *"Peckish refreshed — new version ready"*
  once per page (guarded flag; first-ever install stays silent, and
  nothing ever auto-reloads, so no reload loops). No push, no
  background sync — deliberately out of scope.
- Verified with Playwright (chromium, 390×844, real HTTP): precache
  contents + v1 deletion asserted via `caches.keys()`/`cache.match`;
  offline reload **with the HTTP server killed** (Playwright's
  `setOffline` doesn't gate SW-originated fetches) boots fully from
  cache; banner light + evening screenshots; offline search deals the
  demo deck; back online hides the banner; a byte-changed SW triggers
  exactly one toast and a second controller change stays quiet. Zero
  page errors (Google Fonts noise excepted).

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
- **Liked shortlist** — "Save to shortlist" on the decision screen banks the place and keeps you swiping. A green ♥ badge in the deck bar counts saves and opens the **compare view** (see "Richer shortlist compare view", 2026-07-16). End-of-deck becomes "Down to your shortlist" with a compare button. Session-only (resets when you leave Find) — a shortlist is per outing.
- **Procedural watercolor card art** — when a card has no real photo (all of demo mode, plus live places without photos), `panelArt()` paints a cuisine-keyed composition: Vibe = three pigment washes over dusk paper; Food = a plate with dish-color pooling on a table wash. Palettes per cuisine in `CUISINE_ART`; seeded by place name so every card differs. Replaces the old flat gradient + emoji glyph.

### Visited (private rating log) — fully works offline
Rate any place with **Food / Vibe / Service sliders (0–100)** → live Overall, note, date. Cards show the three sub-bars + Overall, with sort, edit, re-rate, delete; running count + average. Persisted in `eats-visited`.

### Friends + Popular — DEMO UIs (backend-ready)
- **Friends:** sample feed of friends' ratings (sort + per-friend filter), clearly demo-badged; per-friend **taste match** pills, a filtered **detail header** (watercolor ring + "You both loved" strip), and a **share-your-shortlist nudge** (see the 2026-07-16 section above).
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
