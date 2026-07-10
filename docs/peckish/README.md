# Peckish — project handoff & design doc

> A watercolor "where to eat" web app. Tap a bubble → set quick preferences →
> **swipe a Tinder-style deck** of nearby restaurants (closest first, expanding
> outward) → land on one. Plus a private **Visited** rating log and demo
> **Friends** + **Popular** tabs.
>
> Single source of truth so we can pick up exactly where we left off.
> Last updated: **2026-07-08**.

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
- **Preferences** (all optional, default "Any", persisted; "Skip" fast-path): Cuisine (16 chips), Price ($–$$$$), Min rating (Any/70+/80+/90+), Min reviews (Any/100+/500+/1000+), Open now, Max distance (Walking ~1mi / Short drive ~5mi / Anywhere — caps outward expansion), Dietary (Veg/Vegan/GF), Dining mode (Dine-in/Takeout/Delivery).
- **Swipe deck:** cards nearest-first, expanding outward. Drag **left = pass / right = like** (rotation + green YES / red NOPE stamps, peeking next card); also ✗/♥ buttons + ArrowLeft/ArrowRight; reduced-motion uses fades. **Tap the card to cycle story segments: Vibe → Food → Reviews.** Card overlay: name, 0–100 rating + review count, price, cuisine, distance, open-now.
- **Decision screen** (on like): "Tonight: <name>" → Open in Maps (Directions), Call (if phone), "I ate here → Rate" (opens the rating sheet), **Save to shortlist · keep swiping**, Keep looking. **End-of-deck** screen → Compare shortlist (if any) / Widen preferences / Search farther (live) / Start over.

### Three-at-once cards (2026-07-08)
Swipe cards now show **all three segments at the same time**: the hero panel (full card) plus two **mini peek tiles** (top-right rail) previewing the other two — photos/watercolor art for Vibe/Food, the first review quote for Reviews. **A single tap rotates all three at once** (hero → peek, next peek → hero) with a settle animation; segment bars still track the hero. Implemented in `buildCard`/`updatePeeks`/`peekContent` (eats.js) + `.card-peeks`/`.peek*` (eats.css); peeks are aria-hidden (the announce line names the featured segment), reduced-motion skips the tile animation.

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
- Optional: richer map view / walking time, share a pick with a friend.

---

## Design decisions locked in
- **Static-first, honest about limits:** Yelp can't run client-side; Google Places via the Maps JS SDK can (referrer-restricted key). Multi-user features require a backend — built as demo UIs until then.
- **Speed is the product:** one bubble tap, fast preference chips (remembered), then pure swiping; minimal taps to a decision.
- **0–100 whole-number ratings** everywhere; **nearest-first, no fixed radius** (expands outward, capped by the optional Max distance).
- **Minimal, calm UI:** bubble-only landing, bottom tabs, no footer/top-nav clutter; watercolor aesthetic shared with the rest of the site; full dark mode; mobile-first one-handed use.
