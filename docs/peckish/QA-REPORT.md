# Tableau QA report

- **Date:** 2026-11-24
- **Tested:** https://sky121.github.io/eats.html, published build = master `85b2b99` (merge of PR #58), service-worker `CACHE = 'peckish-v6'`, `eats-config.js` `beta: true`, `mapsKey: ''`.
- **Method:** Playwright + the pre-installed Chromium at 390x844 and 375x667 (@2x, touch), plus 1280/1744 desktop; all findings below were observed on the **published** site after the final deployment. One QA loop iteration was needed (of 6 allowed).
- Console/page errors: **none** on any run (Google Fonts connection noise ignored).

## Checklist

| # | Item | Result | Evidence (published v6) |
|---|---|---|---|
| 1 | Fresh profile, welcome sheet | PASS | HTTP 200, 0 errors; welcome shows, focus lands on "Got it"; closes by button and by Escape (focus returns to the Find CTA); never reappears after reload |
| 2 | Tabs / Settings / key handling | PASS | tabs = `Find`, `Visited` only; "Settings" pill with gear svg opens the sheet; key box + Privacy note present; `abc` -> "That doesn't look like a Google Maps key..."; `AIza`+35 chars with Maps blocked -> plain reason ("Couldn't reach Google...") in <1 s, deck of SAMPLE places in ~1 s |
| 3 | Find flow | PASS (after PR #58) | headline time-aware ("Where to, for breakfast?"), SAMPLE demo note, bowl art, CTA at ~y 540-600; CTA -> prefs -> Start -> deck. Controls 48/58/48/58 px, bottoms at 753 (tab bar top 771) and 576 (594). Drag-swipe and buttons pass/keep; undo restores; info opens; save-to-shortlist, compare view (3 cards), decision, "Keep looking" (bottom 699 < tab top 771; 522 < 594; hit-tested), end-of-deck screen, Surprise me (roulette -> decision) all work; every preference chip changes the match count (e.g. Italian 3, Japanese 1, $$ 9, Vegan 6, Takeout 12) and the deck honours it |
| 4 | Visited | PASS | empty state; add with ratings (overall 80 = (90+70+80)/3); edit, re-rate, delete behind a confirm; sort by overall/date; export `tableau-visited-2026-11-24.json` with envelope `{app:'tableau',version:1,exportedAt,visited:[...]}`; re-import = "Nothing new (2 already here)", import after delete restores without duplicates; 7 malformed files rejected with messages, no throw; HTML in names/notes rendered as text; tab label `Visited (n)` correct |
| 5 | Persistence | PASS | reload keeps Visited and last prefs; shortlist is session-only by design and is empty after reload; `localStorage.clear()` returns to the welcome sheet and empty Visited |
| 6 | Dark mode + AA | PASS | glyph-blanked, median-background audit of welcome, find, settings, prefs, deck, info, decision, shortlist, end, Visited (empty/list/error), rating sheet in light and `html.evening`: 0 real failures. Remaining flags are measurement artefacts or disabled controls (Save & check key and slider numbers lose their gradient/animated colour when text is blanked and read fine in screenshots; "Export backup" while disabled/empty) |
| 7 | Reduced motion | PASS | 0 running animations on every screen listed above |
| 8 | Offline | PASS | SW controls the page, cache `peckish-v6`; offline reload loads, Find returns 3 demo cards, "You're offline — demo kitchen's still open" note shown |
| 9 | Keyboard | PASS | sane Tab order, visible focus, Escape closes welcome/settings/rating sheets and returns focus, no trap (Tab cycles inside open sheets), ArrowLeft/Right on tabs |
| 10 | Build current | PASS | CACHE `peckish-v6` matches repo; `beta: true`, `mapsKey: ''` |
| 11 | Other pages | PASS | index, lab (only a Tableau tile links to a project), catalogue, 404: 200, 0 errors |
| 12 | Desktop | PASS | 1280 and 1744: content centred (CTA centred, tab bar centred, no horizontal scroll), deck/shortlist/Visited usable |
| — | Live-mode failure handling (stubbed) | PASS | blocked script -> reason in <1.1 s; Maps script that never answers -> watchdog at ~16 s with "didn't load in time" + samples; `gm_authFailure` -> rejection reason with the origin to allow + samples |

## Bugs found and fixed

All in **PR #58** (merge `85b2b99`):

1. **Shortlist badge hidden under the Settings pill** (phones). Root cause: deck-bar right padding was sized for the old 44 px icon gear. The badge, the only way into compare view, could not be tapped. Fix: reserve 7 rem and let the "Near you" origin yield while the badge shows.
2. **AA contrast:** shortlist count 2.0:1, "Choose this one" 3.5:1 (light) and 4.0:1 (evening), star 4.3:1, evening "Opens at" chip 4.4:1, settings "key saved" line 2.1:1. Fixed by darker/lighter tokens; re-measured clean.
3. **Rejection reason lost:** a saved key Google refuses at boot opened Settings with "A key is saved on this device." because `settings.open()` ran after `showCode()` and overwrote it. Reordered.

## Open / not changed (nothing needs a design or billing decision to ship, but noted)

- Settings still says "Live data is on — results come from Google Places" after a key check fails (the key is kept on purpose). Wording is the owner's call.
- "Re-rate" opens a sheet titled "Edit <place>" (same sheet as Edit). Cosmetic.
- The decision screen shows "Call" for sample places that have no phone. Cosmetic; left alone.
- Escape does not leave the decision screen (it is not a sheet); "Keep looking" is keyboard-reachable.

## What could NOT be tested

**Live Google results.** There is no Maps key (by design) and none was added. Real Places (New) search, photos, hours, billing/referrer behaviour and quota are untested. Only the failure paths were exercised, via blocked requests and stubbed Maps scripts. Real-device installed-PWA update behaviour (iOS/Android) and real geolocation prompts were also not covered; geolocation was granted via the emulator.
