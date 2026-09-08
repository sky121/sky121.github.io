# Tableau — project handoff & design doc

> **Tableau** (formerly *Peckish*, renamed 2026-07-19) — a watercolor "where to
> eat" web app. Tap the deep-pool **Find** button → set quick preferences →
> **swipe a Tinder-style deck** of nearby restaurants (closest first, expanding
> outward) → land on one. Or open the app on its front door, the **Feed** — a
> full-bleed vertical snap feed of watercolor food posts, every one anchored to
> a real place. Plus a private **Visited** rating log and demo **Friends** +
> **Popular** tabs.
>
> **Filenames stay legacy on purpose:** `eats.html`, `peckish-sw.js`,
> `peckish.webmanifest`, `peckish-icon-*.png`, `og-peckish.png` keep their names
> so installed PWAs and existing URLs never break — only user-facing strings and
> icon *art* changed.
>
> Single source of truth so we can pick up exactly where we left off.
> Last updated: **2026-09-08**.

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
- **Architecture (`eats.js`):** single IIFE; closures roughly: `store` (localStorage) + `feedStore` (the Feed's two lists), `state`, `distance` (haversine), `demo` (sample data), `foodArt` (the Feed's canvas painter), `feed` (the snap feed), `tabs` (bottom-bar router, roving-tabindex a11y), `find` (bubble → prefs → swipe deck), `gmaps` (lazy Google Maps/Places, current API), `sheet` (rating sheet), `visited` (CRUD), `social` (mock Friends/Popular API), `settings` (key). Watercolor chrome comes from `exhibit-page.css`; `gallery.js` provides the theme + wash drift.
- **localStorage keys:** `eats-gmaps-key` (the API key — never committed), `eats-prefs` (last swipe preferences), `eats-visited` (the rating log), `eats-seen` (recently passed places, 6 h TTL), `eats-feed` (the Feed's follows + hearted places — see the Feed section). `sh-theme` (shared site light/dark).
- **Ratings scale:** everything is **0–100 whole numbers** (Food/Vibe/Service → averaged Overall; Google's 0–5 is mapped ×20 for display).

---

## Feature map (what's built)

### Accessibility pass 1 of 2 — focus, inerting, live regions (2026-09-08)
A partial audit. **Focus and live-region layering are done and verified;
contrast is deliberately NOT audited yet** — see the harness warning below.

**Fixed**
- **Focus is now returned.** Opening a sheet moves focus into it, the rest of
  the page goes `inert` while it is open, `Escape` closes it, and focus lands
  back on the control that opened it (verified on the settings sheet:
  moves-in → in-sheet → returns-to-opener, and `inert` is set and then cleared).
- **Announcements happen once, not twice, not never.** Five surfaces carried
  their own `aria-live="polite"` *and* were narrated by the central `announce()`
  region, so a screen reader heard them twice. The redundant regions on the
  wizard step counter, Visited stats, Friends stats + list, and the Popular list
  were removed; the scoped ones that genuinely need their own channel
  (`prefs-count`, `settings-mode`, `settings-msg`) were kept. Verified that the
  central region still speaks exactly once per change — a feed post move, a
  heart, and a tab switch each produced one clear utterance.

**A warning about the contrast harness — read before re-running this**
Two separate audit attempts produced alarming contrast numbers (**228** unique
failures the first time, **510** failing nodes / 156 unique class+theme pairs
the second). **Both numbers are void.** The harness samples the worst pixel
inside each glyph's bounding box, which lands on **anti-aliased glyph edges and
the background gaps between letters** rather than the stroke itself. Hand-checked
against the real colours:

| flagged | harness said | actually is | verdict |
|---|---|---|---|
| `.bottab-label` (flagged 90×) | 2.73 / 3.79 | **5.17** | passes AA |
| `.lbl` | 1.27 | **10.19** | passes easily |
| `.val` | 1.13 | **10.19** | passes easily |

A ratio of 1.13 for ink `#2e3a48` on paper `#f5f0e6` is impossible; that is the
harness reading paper as if it were the glyph. **No colour was changed on the
strength of these numbers** — the fixes above are all structural. A future
contrast pass must sample the *modal* stroke colour (or composite the glyph
coverage), validate against a hand-checked sample, and report its false-positive
rate before anyone acts on a count.

**Still to do:** a valid contrast sweep, the ≥44px target sweep, the
reduced-motion sweep on the newest surfaces, and the consistency/dead-CSS pass.


### Feed — the app's front door (2026-09-07)
*"TikTok for foodies", built honestly on a static site.* A fifth tab, first in
the bar, opens on a **full-bleed vertical snap feed** of watercolor food posts.
Every post is anchored to a real place in the current pool; hearting one saves
that place to the **real shortlist**; "Go here" opens the **existing decision
screen**; and the order is genuinely personalised. The creators are sample data
and say so on every surface that shows them.

**The line we did not cross.** This site has no backend and cannot host video,
so the feed does not pretend to have any. There is no `<video>` anywhere in it,
and nothing in the UI or the code calls a post a video. What a post has instead
is a **living still**: a procedurally painted canvas with a very slow ken-burns
push, one drifting warm wash, and — on the bowl and table compositions — three
faint plumes of steam. Under `prefers-reduced-motion` all three are gone and the
image is completely static (verified: zero running animations inside
`#panel-feed`).

**What is real vs sample, and where it says so**

| Real | Sample (labelled) |
|---|---|
| the scroll, the snap, the virtualisation | the creators, handles, avatars |
| the art (painted from the place's cuisine + name seed) | follower counts |
| the place behind every post (demo pool or live results) | the captions |
| heart → the shortlist the deck fills (persisted) | |
| "Go here" → the deck's own decision screen | |
| the ranking (Visited log + prefs + follows + distance + hours) | |

The honesty labels: a `.social-banner` pinned to the top of the feed (the same
component the Friends and Popular panels use) reads *"**Demo** — creators and
follower counts are `Sample`. The places are real."*, and **every post** carries
a `Sample` pill next to the handle. In live mode, a place that came from the
demo fallback also gets the shared `sampleTagFor()` pill in its meta row, exactly
as the deck and the decision screen do.

**1. The art: `foodArt` (a canvas painter, not a gradient stack)**
`panelArt()` is a CSS gradient stack — good enough for a 120px thumb, an abstract
blob at 390×844. The feed paints to an offscreen `<canvas>` instead, with real
watercolor moves: pigment laid in overlapping translucent passes with
`globalCompositeOperation: 'multiply'`, irregular wet edges (`blobPath`), a
darker rim where the wash dried, catch-lights via `screen`, blurred cast shadows
(`ctx.filter`), and a procedurally generated paper-grain tile stamped over the
finished paint. Five **composition archetypes**:

- **`plate`** — a plated dish from above: cream plate nearly filling the frame,
  a sauce pool, a mound, components fanned around it, herbs, seeds, a warm
  drizzle, a second dish half out of frame top-left for depth.
- **`bowl`** — a bowl of something brothy, three-quarter view: glazed body lit
  from the left, broth surface, combed noodles, two protein rounds, a halved egg
  with its yolk, nori, greens, chilli oil, chopsticks over the far rim, and
  painted steam that the CSS layer then animates.
- **`stack`** — a side-on build: plate, bottom bun, patty with char, a melted
  layer and a lettuce frill (both drawn with wavy undersides), tomato, a domed
  sesame top bun, fries on the side.
- **`crop`** — a very close crop of a dish edge: a field of layered pigment,
  flat toppings with dark rims and a crescent of light, herb flecks, and a
  scalloped, blistered **crust sweeping across the lower third** — that edge is
  what makes the frame read as a crop of a dish rather than a swatch of colour.
- **`table`** — a restaurant table at night: table plane edge to edge, a hero
  plate low and close, a second plate half in shadow, a wine glass lit from
  behind, a candle, warm bokeh in the room.

Each place picks its archetypes from a **cuisine → archetype** table
(`CUISINE_ARCH`) so brothy cuisines get the bowl, stacked ones the stack, and so
on; every list holds three so a place's three posts never repeat a composition.
Colour comes from `FOOD_PAL`, a per-cuisine food palette (`main` / `deep` /
`fresh` / `cream` / `table` / `accent`), and anything that goes **on** the food
is passed through `warmOf()` — some cuisine accents are pond blue or rose, and
blue ceramic is fine but a blue drizzle is not.

Subjects are composed for the **top ~60% of the frame**, because the bottom is
where the scrim and the text live. `crop` was pulled from the cuisines whose
field reads muddy (café, japanese, vietnamese, mediterranean, vegetarian,
burgers, bbq) after looking at the screenshots — it stayed only where it reads
as a topped flatbread.

**1b. Cuisine kits — the subject, not just the tint (2026-09-08)**
The five painters used to take `(ctx, rnd, f)` where `f` was *only* the palette,
so every cuisine got the identical composition in a different colour: `drawPlate`
laid down the same sauce pool, mound and fanned discs whether the place sold
pasta or oysters. **Pier 9 Oyster Co. painted what read as a tomato-sauce pasta
dish.** The fix is not more colours, it is different *food*.

*How the cuisine is threaded.* No painter signature changed. `palFor()` now
returns the palette **plus** the cuisine key and its kit — `f.cuisine`, `f.kit` —
so every helper that already takes `f` can reach the kit, and a painter simply
asks the kit for its subject:

```
(f.kit.plate || plateGeneric)(ctx, rnd, f, cx, cy, r)   // what is on the plate
(f.kit.bowl  || bowlGeneric )(ctx, rnd, f, cx, cy, r)   // what is in the bowl
(f.kit.stack || stackGeneric)(ctx, rnd, f, cx, base, w, slab, dome)
(K.field / K.crust / K.over) for crop
```

A kit is a bag of *optional* painters (`plate`, `bowl`, `stack`, `crop`,
`utensil`); anything a cuisine does not define falls back to the generic
composition, which is the old code moved intact into `plateGeneric` /
`bowlGeneric` / `stackGeneric` / `cropOver`. The painters keep everything they
already owned — framing, ground, ceramic, cast shadows, catch-lights, vignette,
the subject in the top ~60%, the seeded RNG, the LRU cache, the `warmOf()` guard.

*One kit, two viewpoints.* `stagePlate()` runs a plate kit inside a scaled
context (`sq` squashes the vertical axis), so the same kit paints flat from above
for `plate` (sq 1) and in perspective on the table for `table` (sq 0.45). The
bowl does the same, clipped to the broth ellipse. Kits are therefore written once,
flat, and never duplicated per archetype.

*The vocabulary.* ~22 small components built from the **existing** primitives
(`pool` / `blobPath` / `shadowEllipse` / `sheen` / `stroke` / `leaf` / `dots`), so
a shell is lit exactly like the plate under it: `piece`, `mound`, `grainBed`,
`citrusHalf`, `wedge`, `shellFan`, `oyster`, `prawn`, `fillet`, `nigiri`,
`flatbread`, `fold`, `meatSlice`, `pickle`, `olive`, `cube`, `friedEgg`,
`noodles`, `herbs`, `smear`, `drizzleArc`, `chillis`, `dipDish`, `sticks`,
`riceRoll`.

*What each cuisine now paints* (counts and positions still come from the seed, so
two places of one cuisine never line up):

| Cuisine | Subject |
|---|---|
| seafood | oysters on the half shell, a flaked fillet, a prawn, a scallop shell, half a lemon — **no red mound anywhere** |
| japanese | a composed set: nigiri, two maki, a soy dish, wasabi, pink ginger |
| italian | a nest of pasta under a spooned sauce, meatballs, basil, parmesan |
| mexican | folded tortillas with the filling showing along the open edge, lime, crema, a bean smear |
| indian | a curry pool with rice beside it, a folded flatbread, a cream swirl, coriander |
| mediterranean | a couscous bed, olives, feta, roasted pieces, a lemon wedge, herb oil |
| bbq | sliced meat with a bark edge and smoke ring, slaw, pickle chips, a sauce smear |
| korean | a rice mound, five banchan piles, a fried egg, chilli, sesame |
| vietnamese | translucent rice-paper rolls, a herb pile, nuoc cham, lime, crushed peanut |
| thai | rice and a coconut curry with peppers, chilli, basil, lime |
| burgers | the burger from above: sesame bun, lettuce frill, patty edge, fries, ketchup |
| cafe | toast, a fried egg, an avocado fan, berries (plate); a pancake stack with butter and syrup (stack) |
| pizza | the whole pie: crust ring, sauce, cheese patches, pepperoni, basil |
| vegetarian | a grain bed, roasted veg, avocado, feta, tahini |
| american | a seared slab with bark, mash with gravy, green beans (plate); the diner burger (stack) |

*Archetypes narrowed again.* `crop` (a field of pigment with a bread edge sweeping
the lower third) only reads as food when the cuisine's dish genuinely is "topping
on bread": it survives for **pizza, italian, indian** and was pulled from
**korean, thai and mexican** — a Mexican crop painted a muddy red field with
white loops of crema, which reads as anything but Mexican. Korean and thai moved
to `['bowl','plate','table']`; mexican to `['plate','table','bowl']` with a new
rice-and-beans bowl kit, which is a reading the crop could never carry.

*Utensil follows the kit*: chopsticks over the far rim for japanese, korean and
vietnamese; a spoon resting in the bowl for indian, thai, seafood, mediterranean,
vegetarian and mexican.

*Verified 2026-09-08* (Playwright, chromium, 390×844): one screenshot read per
cuisine; determinism — the same place paints a **byte-identical** canvas across a
fresh reload (20/20 sha1 matches); variation — **54/54 unique canvases** across
the 18 demo places × 3 variants; contrast floor **11.4:1 day / 12.5:1 evening**
(worst-pixel-under-the-text sampling, versus 11.9 / 12.7 before the change — no
meaningful regression, far above the 8:1 bar); paint cost **unchanged within
noise** — the rAF frame that paints one canvas averages 74 ms with the kits vs
73 ms before (3 runs each, 13 cold paints per run; an idle frame is 16.7 ms and
the measurement is quantised to it, so read it as "a paint costs ~4 frames,
either way"). Art is still painted exactly once per place+variant and cached, so
this cost is paid once per post and never per frame.

Canvases are painted **exactly once** and held in a small LRU (`CAP = 12`, and a
canvas that is currently on screen is never evicted); a mounted post takes the
cached canvas node itself rather than copying it. Nothing repaints per frame.

**2. Snap scroll + virtualisation**
The scroller is `scroll-snap-type: y mandatory` with `scroll-snap-stop: always`
(one swipe = one post). Posts are absolutely positioned at `index × --post-h`
inside a rail whose height is `posts.length × --post-h`, and only the visible
post ±2 is mounted — **measured: 5 post nodes in the DOM after scrolling
through 24 posts**, from a pool of 54. Nodes are recycled through a free list
capped at 7.

One trap worth remembering: *mandatory snapping and virtualisation fight each
other on long programmatic jumps.* There are no snap areas where nothing is
mounted, so re-enabling snapping after a jump drags the scroll back to the
nearest node that still exists. `hardScroll()` turns snapping off, sets
`scrollTop`, **mounts the window around the landing position**, then turns
snapping back on. Every deliberate jump (Home/End, a re-rank, a resize) goes
through it. Ordinary scrolling is safe because `scroll-snap-stop: always` means
a fling can only travel one post, which the ±2 window always covers.

**3. The ranking model**
`score = follow + taste + proximity + quality + open-now + a seeded jitter`:

| term | range | source |
|---|---|---|
| following the creator | +34 | `eats-feed.follows` |
| taste | −18 … +30 | your Visited rating for the place; else cuisine affinity from the Visited log (damped `n/(n+1)`); else +16 if a friend rated it 80+ |
| proximity | 0 … +18 | `max(0, 18 − miles × 16)` |
| quality | ~−10 … +16 | `(rating − 3.8) × 13` |
| open now | +6 | the shared `openState()` |
| jitter | 0 … +6 | `hashStr(post.key)` — stable, so the order never reshuffles between renders |

Ranking alone stacks every post from your three favourite places at the top, so
`spread()` then walks the ranked list and takes the best post at least 4 away
from the last post of that place and 2 from that creator (falling back to the
best remaining rather than stalling). The ORDER inside those constraints is
still entirely the score's.

The winning term becomes the small **"why you're seeing this"** pill at the top
of the post ("You follow Leo", "You rated it 82", "0.2 mi from you", "Open right
now"), and that pill's group is passed to `matchReasons()` as `skip` so the
reason chips underneath never echo it.

Following someone re-ranks the whole feed immediately and **the reader travels
with the post they were looking at** — nothing jumps, and the ranking stays
exactly what the model says it should be. Measured: following `@leoclate` took
their posts in the first 12 from **1 → 4** (4 is the ceiling `GAP_CREATOR = 2`
allows), and the order after a reload is byte-identical to the order right after
the follow — the model is deterministic.

**Empty / thin state.** With no follows and an empty Visited log the first two
terms are simply zero and the feed falls back to proximity + rating, which is a
sensible order rather than an arbitrary one — verified: 54 posts, nearest first
(0.1 mi → 0.2 mi → 446 ft → …), why-pills reading "0.1 mi from you" / "Open
right now". There is no blank screen; `#feed-empty` only appears if the pool
itself is empty, which the demo fallback prevents.

**4. Heart → the real shortlist**
The heart writes the place NAME to `eats-feed.hearts` **and** calls
`deck.addToShortlist(place, quiet)`, so the place appears on the deck's own
shortlist surface, in its badge count, in the compare cards and in the
constellation. On boot `deck.hydrateHearts()` puts hearted places back on the
shortlist (matching by name against the current pool), and `deck.teardown()`
re-hydrates too, so "start over" keeps your saves. Un-hearting, and removing a
place from the shortlist compare screen, both clear the heart; the shortlist's
Undo puts it back. Verified: heart → `eats-feed` = `{"hearts":["Smoke & Ember
BBQ"]}`, badge `1`, the place listed on the shortlist surface, and all three
still true after a reload.

**5. Accessibility**
The scroller is `role="feed"` with the rail as `role="none"`; each post is an
`<article>` with `aria-posinset` / `aria-setsize` and an accessible name
("Tonkotsu Lane, Ramen · Japanese, Open now. Posted by @saltandpaper, a sample
creator."). `announce()` fires 260 ms after the visible post settles ("Pier 9
Oyster Co., Open now. Post 3 of 54. You rated it 78."). Keyboard: the scroller
takes focus, Arrow Up/Down and Page Up/Down move exactly one post, Home/End jump
to the ends. **Only the current post's actions are in the tab order** — Tab must
not walk into the actions of a post that is off screen — and all three actions
are ≥56 px with a visible `--pond-deep` focus ring. Every action carries an
explicit `aria-label` and the heart/follow buttons carry `aria-pressed`.

Contrast, measured off the rendered pixels (worst pixel in each text box against
the ground actually painted beneath it, both themes):

| element | light | evening |
|---|---|---|
| place name | 16.8 : 1 | 17.0 : 1 |
| caption | 15.8 : 1 | 16.1 : 1 |
| handle | 15.2 : 1 | 15.5 : 1 |
| meta line | 15.1 : 1 | 15.5 : 1 |
| follower count | 12.0 : 1 | 12.3 : 1 |
| "why" pill | 15.2 : 1 | 14.8 : 1 |
| reason chip | 14.2 : 1 | 14.0 : 1 |
| action label | 12.5 : 1 | 12.0 : 1 |
| `Sample` pill | 9.3 : 1 | 8.4 : 1 |
| banner | 16.9 : 1 | 15.5 : 1 |

The floor is **8.4 : 1** — well past AA. The pills that sit high in the frame
(the banner, the "why" pill) carry their own `rgba(10,13,18,.86)` ground because
the top scrim is deliberately light there and the art underneath can be a white
plate.

**New localStorage key:** `eats-feed` — `{follows: [handle…], hearts: [place
name…]}`. Follows are the sample creators you follow (they genuinely reweight
the feed); hearts are the places you hearted, kept **by name** because that is
the join key every other surface here already uses (`myRatingFor`, Popular's
`placeByName`) and the only id that survives a reload in both demo and live mode.

**Files touched:** `eats.html` (feed panel + a fifth tab, first in the bar),
`assets/js/eats.js` (`feedStore`, `foodArt`, `feed`, plus `deck` gaining
`addToShortlist(r, quiet)` / `removeFromShortlist` / `inShortlist` /
`hydrateHearts`), `assets/css/eats.css` (the feed, and the tab bar going from 4
to 5 columns).

### Live mode made first-class — real hours, real photos, honest labels (2026-09-02)
Demo mode had grown time-awareness, reason chips, a three-section Popular and a
constellation map; a real Google result fed almost none of it. Live mode now
feeds the same surfaces the same shapes.

**1. Real opening hours → the shared `openState()`**
`opening_hours.periods` from a **Place Details** call is folded into the very
same two numbers a demo place carries — `openH` / `closeH`, hours 0–24 local —
so the deck chip, the decision screen, Popular's "Near you right now", the
compare cards and the *Closing soon — go now* reason chip all read real hours
through the one clock function. No hours maths was duplicated: `applyHours()`
(in the `gmaps` closure) writes the shape, `openState()` still does all the
reasoning. Fields read: `opening_hours.periods` (both spellings —
`open.hours/minutes`, the newer `open.hour/minute`, and the `"1130"` `time`
string), `opening_hours.open_now` / `isOpen()`, and **`utc_offset_minutes`**.

**The rule** (deliberate, and the honest half matters most):
1. the window **containing this minute** wins — including one that opened
   yesterday evening and runs past midnight, expressed exactly the way the demo
   data already does it (`closeH < openH`, e.g. 17 → 2);
2. otherwise the **next window starting later today** wins — a lunch-and-dinner
   place whose lunch is over says *Opens at 5pm*, never pointing at a service
   that already ended;
3. otherwise — nothing left today, or shut today — **no times are written at
   all** and the binary flag speaks: *Closed*, never an invented hour;
4. **open 24 hours** (a period with an `open` and no `close`) also drops to the
   binary flag: *Open now*, with no closing time to fabricate;
5. if Google's own `open_now` **disagrees** with the derived window (holiday
   hours `periods` doesn't carry), the times are dropped and Google wins;
6. if `utc_offset_minutes` says the place **doesn't share this browser's
   clock**, the times are dropped too — `openState()` reasons in the browser's
   timezone, so another zone's hours would print a confidently wrong time.

`fmtHour()` now prints minutes when an hour is fractional (*9:30pm*, *8:15pm*):
real kitchens close at :30 and :45, and rounding those to the hour is a lie
about when to leave. Whole hours render exactly as before.

**2. Real photos, watercolor fallback**
`paintThumb(node, url, artCss)` is the one path every picture takes: it paints
the watercolor panel **first** (so the art is also the placeholder), then swaps
the photo in **only after it has decoded**. A 404, a blocked host or a slow
photo simply leaves the watercolor — no broken tile, no error, no layout shift.
Used by the trio card faces, the "coming up" peek strip, the Popular rows and
the shortlist compare cards. Requests stay modest: search thumbs at 400×400,
detail photos capped at **four** at 640×800, and `getUrl()` only *builds* a
string — no image is fetched until a surface actually paints it, so places that
never render never cost a photo request.

**3. Key onboarding, and one sentence per failure**
The settings sheet opens as **one screen**: what mode you're in, what a key
buys, a privacy note (the key is written to *this browser's localStorage* and
nowhere else — never sent to the site's author, never logged), the field, and a
plainly-labelled **"Use sample data"** way back. The step-by-step folds away in
a `<details>`.

Saving now makes a **real validation attempt**, and every outcome has its own
calm sentence (`LIVE_ERRORS` / `LIVE_SHORT` + `classifyLive()`):

| Failure | What Google gives us | What we say |
|---|---|---|
| malformed key | *nothing — caught pre-flight, no request at all* | "That doesn't look like a Google Maps key…" |
| invalid key | `API key not valid` in the rejection | "Google says that key isn't valid…" |
| referer / API restriction | `PERMISSION_DENIED`, `SERVICE_DISABLED`, referer text | "Google won't accept that key from this address…" |
| over quota | `RESOURCE_EXHAUSTED` / `OVER_QUERY_LIMIT` | "That key is over its Google quota just now…" |
| network down | script `onerror`, offline, timeout | "Couldn't reach Google — the connection dropped…" |
| flat refusal | `gm_authFailure`, legacy `REQUEST_DENIED` | "Google turned that key away" — naming *both* causes, because the legacy surface genuinely cannot tell them apart |

The probe prefers **`Place.searchNearby`** (`fields:['id']`, `maxResultCount:1`
— the cheapest request the API sells, once per key save) because its rejection
carries Google's own error text, the only surface that separates invalid from
referer-blocked from quota. Where that class is absent it falls back to the
legacy status codes and says so honestly rather than guessing. A key that
**cannot** work as saved (invalid / restricted / refused) is removed again so
the app is never left half-live; transient failures (quota, network, "reload to
re-key") keep it.

**Mid-session failure never shows an empty screen:** the deck fills with the
sample places behind a gold paper slip — *"Google's quota for that key is used
up. Sample places instead."* — announced to screen readers after the deck
loads, and every card it deals carries a SAMPLE tag.

**4. Labelling honesty**
One shared answer: `isSampleResult(r)` (id `demo-*` or `demo:true`) and
`liveMode()` (a key is stored). The **SAMPLE** tag is drawn only when the app is
**live** and the thing in front of you is sample — in demo mode the landing, the
settings sheet and the panel banners already say so and stamping every card
would be noise. Covered surfaces: deck card meta, the decision screen, the
shortlist compare cards, the constellation panel, and the a11y card summary.
Popular's section tags now fire if **any** row in the section is sample (they
previously required *every* row), and the Popular banner names *Trending*
specifically — in live mode "Near you right now" is genuinely live while
Trending and "Loved by people with your taste" are still mock, and the tags now
say exactly that. Friends stays labelled in every mode.

**Verified** (no key and no outbound Google in the sandbox — everything below
was driven against a **stubbed** `google.maps`, served by Playwright route
interception, with a mocked page clock):
- 15 hours cases at two clocks, asserting rendered chip text: open-with-late-
  close, closing-within-the-hour (*Closes at 8pm*), a :15 close (*Closes at
  8:15pm*), closed-but-opens-later (*Opens at 9pm*), **no hours at all** (binary
  only, zero digits), two-period day active / next-service / all-over,
  past-midnight close read at 19:30 **and** at 01:15 the next morning
  (*Closes at 2am*), open-24-hours, `open_now` contradicting `periods`, and a
  place in another timezone — all 15 pass.
- Photo that loads → photo thumb; photo that 404s → watercolor, zero broken
  images, zero page errors.
- Four failure modes → four different sentences; malformed key makes **zero**
  network calls; accepted key stores and switches to live; the key appears in
  **no** console output and in no DOM text (the field is `type=password`).
- Live results carry no SAMPLE tag; the fallback deck, its decision screen, its
  compare cards and its constellation all do; demo mode is unchanged.
- Demo mode end-to-end (landing → wizard → deck → decision → shortlist →
  constellation → Popular → Friends → Visited): zero page errors, reason chips
  and whole-hour labels identical to before.

**Not verifiable here:** every Google response was a fixture. The exact wording
of real rejections (which `classifyLive()` regexes against) and the real shape
of `Place.searchNearby` responses should be sanity-checked once against a live
key.

### Popular, deepened — three sections, no invented data (2026-08-03)
Popular was still the thin demo leaderboard while the rest of the app grew. It
is now three answers to *"where is everyone eating?"*, all built from signals
the app already had. Everything lives in the rewritten `popular` closure
(`eats.js`), plus one shared row builder and ~180 lines of CSS.

**1. Trending now** (the existing `social.getPopular` feed, rows upgraded)
- Ordered by **`reviews`** — the one genuine popularity signal the feed
  carries ("how many people reviewed it in this range"). The mock's own `rank`
  already agrees; recomputing the order keeps the rows honest if a real
  backend ever returns an unsorted list.
- Each row: watercolor **thumb** (`panelArt`, or the place's photo in live
  mode) with a rank badge, name, **score + review count**, **price · cuisine**,
  **distance + walk time**, the **open-state chip** (`openChipEl` — the same
  Open now / Closes at 8pm / Opens at 4pm states the deck shows), and its
  **trend sparkline** (`svgSparkline`).
- A **movement indicator** (Rising / Holding steady / Cooling) renders **only
  from the feed's own `trend` field** — a row without one shows nothing. It is
  never inferred from the sparkline, because the sparkline is drawn *from* it.

**2. Near you right now** — the "I want to leave in five minutes" list
- Places that are **open this minute or closing soon** within **0.6 mi**
  (≈ a 12-minute walk), **ranked by closeness**, five max.
- Open/closed comes from the shared **`openState()`** — the hours math is never
  re-derived here. A **closing-soon** row is flagged urgent (warm gold border)
  and keeps the chip's own words ("Closes at 2pm").
- The right-hand stat is the ranking signal itself: `0.3 mi / 6 MIN WALK`.
- Nothing open nearby (3am, say) → **the section is not rendered at all**.

**3. Loved by people with your taste** — reuses the taste-match model
- `friends.matchByFriend()` (the same `tasteMatch` the Friends tab prints) now
  ranks your friends; for the best-matched ones we surface the places they
  rated **80+ overall** that your **Visited log has never seen**. First
  (best-matched) friend to name a place wins it; four rows max.
- Each row names the source — **"Maya, 32% taste match"** — with their score in
  the aside and their note as a quiet one-line quote.
- **No Visited data or no overlap → no section.** A taste match nobody can
  compute is not a recommendation, so there is no weak fallback.

**Shared row anatomy + tap-through**
- One `buildRow()` renders all three sections, so the tab reads as one thing.
  The meta line is built from **non-breaking groups** (score+reviews /
  price+cuisine / distance+walk) separated by space — dots live only *inside* a
  group, so a wrapping row never starts or ends on a stranded separator.
- Up to **2 reason chips** per row via the shared `matchReasons(place, { max,
  shown, skip })`, mirroring the deck card: `shown` is everything the row
  literally prints, and `skip` drops the group the row already states loudest —
  Trending skips `reviews` + `near`, Near-you skips `near` + `time`, Loved-by
  skips `friend` + `near`. Chips reuse the `ov-reason` pigment family.
- The whole card is **one tap target**: a transparent `.pop-row-hit` button
  stretched over it (≥44px, `:focus-visible` ring) opens the **existing**
  decision screen — `find.showPick(place, siblings)` → `deck.pickFrom()` →
  the deck's own `onLike()`. Same screen, same actions, same announcement; the
  rest of the section becomes the deck queue so **"Keep looking"** walks it
  instead of dead-ending. Rows with no place record behind them are simply not
  tappable.
- Sample data is labelled **once per section** (the trending list sits directly
  under the panel's demo banner) instead of once per row.
- `announce()` summarises the tab after render ("Popular: 6 trending today,
  5 open near you right now, 2 loved by people with your taste").

**Only additive hooks were added to other modules** — `friends` exports
`tasteMatch`/`matchByFriend`, `deck` exports `pickFrom`, `find` exports
`showPick`. The deck, landing, wizard, constellation, Friends tab and the
time-awareness / reason engines are untouched and reused as-is.

*Verified* (Playwright chromium, 390×844, mocked page clock): all three
sections render with a seeded Visited log; "Near you right now" contains only
open/closing-soon places, ordered `[0.084, 0.142, 0.241, 0.275, 0.300]` mi with
closer-but-closed places (Verde Trattoria 0.188 mi, Pier 9 0.289 mi) correctly
excluded at 13:30; the taste section excludes every visited place and names a
friend with a match %, and **disappears** with an empty Visited log; tapping a
row opens the decision screen for that place (name asserted) and "Keep looking"
lands on the next card; ≤2 reason chips with no echo of the row's own text;
`scrollWidth === clientWidth` at 390px; no entrance animation under
`prefers-reduced-motion`; light + evening; zero page errors.

### "Why this pick" — match-reason chips (2026-07-23)
The app had rich signals it never surfaced: your saved preferences, the real
distance, the time-awareness state, your own Visited scores, your friends'
ratings. A card stated **facts**; it never said why the place was in front of
you. Small watercolor **reason chips** now carry that judgement.

- **`matchReasons(place, { max, shown })`** (module level, between the `prefs`
  and `deck` closures) returns a ranked, capped, de-duplicated list. Every
  candidate is built by `reasonCandidates()` from signals that already exist —
  nothing is invented, and a place that answers nothing gets **no chips at
  all** (no filler). Candidates carry `group` (one chip per group), `weight`
  (usefulness) and `texts` (phrasings, most concrete first).
- **The reason set + weights** (higher wins the slot):

  | # | group | weight | chip | condition |
  |---|---|---|---|---|
  | 1 | `mine` | 100 / 96 | "You loved it last time" / "You liked it before" | `myRatingFor()` overall ≥ 78 / ≥ 62 |
  | 2 | `friend` | 90 / 86 | "Maya loved it" / "Maya rated it well" | best `social.ratingsFor()` overall ≥ 85 / ≥ 72 |
  | 3 | `cuisine` | 84 | "Japanese — your pick" | you picked that cuisine |
  | 4 | `diet` | 82 | "Vegan, as you asked" | every dietary need you set is met |
  | 5 | `near` | 80 / 78 / 70 | "Close enough to walk" / "Practically next door" / "A short stroll away" | Walking pref + ≤ 1.3 mi / ≤ 0.25 mi / ≤ 0.5 mi |
  | 6 | `rating` | 76 / 74 / 68 | "Above your 90 bar" / "One of the best nearby" / "Very well loved" | clears your min-rating / top-3 of what we actually found / ≥ 90 with ≥ 200 reviews |
  | 7 | `time` | 72 / 58 | "Closing soon — go now" / "Open till 10pm" | `openState` is `soon` / is `open` and still open in 2 h |
  | 8 | `price` | 66 | "Right in your price range" | price level you chose |
  | 9 | `dining` | 62 | "Takeout, as you asked" | a dining mode you chose |
  | 10 | `extras` | 60 | "Outdoor seating, as you asked" | every extra you ticked (skipped for live places, which carry none) |
  | 11 | `reviews` | 54 | "Plenty of reviews behind it" | clears your min-reviews |

  Personal history and explicit preference matches outrank pure facts, so a
  generic chip only appears when nothing more concrete is available.
- **Dedupe** — the chips must never parrot the line above them. Each surface
  passes the text it is *already showing* as `shown`; `normReason()` lowercases,
  strips punctuation and drops filler words (`this`/`it`/`the`…) so
  *"You rated **this** 82"* and *"You rated **it** 82"* compare equal. A
  candidate walks its `texts` list and takes the first phrasing not already on
  screen — so "3 min walk" next to the card's travel hint becomes "Practically
  next door", and the "You rated this 82" pill pushes the reason to "You loved
  it last time". If every phrasing would echo the UI, the reason is dropped.
- **Group suppression (orchestrator refinement)** — text dedupe can't catch a
  *semantic* echo: the card prints a prominent "You rated this 82" pill, and a
  `mine` verdict chip beside it spent one of only **two** card slots restating
  it. `matchReasons` now takes a `skip` map of groups, and the card passes
  `{ mine: true }` whenever that pill is present, so a fresher reason takes the
  room (verified: *Tonkotsu Lane*, pill "You rated this 88" → chips
  `["Maya loved it", "Practically next door"]`). The **pick screen keeps
  `mine`** — there the score is buried mid-way through a long meta line rather
  than standing alone as a pill, and there are three slots to spend.
- **Where they show** — **2 chips max on the deck card** (`.ov-reasons` in the
  `.trio-info` scrap): the scrap is ~88% of a 390px card, and a third chip
  wraps to a second row and crowds the name. The **Tonight decision screen**
  shows the fuller **3** (`.decision-reasons`, sitting between the meta line
  and the open-state chip, where there is room).
- **Reads `openState`, never re-derives it.** "Still open in 2 h?" is answered
  by probing the *shared* `openState(r, futureDate)` — no second copy of the
  hours math. New: `social.ratingsFor(place)` (synchronous read of the same
  feed `getFriendsFeed()` serves — a card render cannot await a promise) and
  `prefs.labelFor(key)` (so chips speak your own words back to you).
- **Pigment carries the kind**: sage = answers a preference you set, gold =
  quality, pond = logistics (how close / how long it's open), rose ♡ = your own
  verdict, wisteria ✧ = a friend's. Evening overrides + AA on all ten states.
- **A11y**: the row is a `role="list"` labelled "Why this one", each chip a
  non-interactive `role="listitem"` span with an `aria-hidden` glyph, so AT
  reads them as discrete items in rank order. The **top reason is folded into
  the card's `aria-label`** ("…, why this one: You loved it last time") and the
  decision screen's `announce()` carries the full set. A place with no reasons
  adds nothing to either.
- **Motion**: card chips never animate (they rebuild on every swipe); only the
  decision set breathes in, inside `@media (prefers-reduced-motion:
  no-preference)` — reduced motion gets nothing at all.
- Verified with Playwright at 390×844 (21 assertions, zero page errors — the
  Google Fonts connection reset is sandbox noise). Through the wizard with
  *Cuisine = Japanese + Thai* and *Min rating = 90+*: **Bangkok Orchid** →
  `["Thai — your pick", "Above your 90 bar"]`; **Tonkotsu Lane** (visited 82,
  Maya 87) → `["You loved it last time", "Maya loved it"]`, its decision screen
  → those two plus `"Japanese — your pick"`. No chip echoed visible card text,
  the ≤2 / ≤3 caps held, no chip exceeded the info scrap and the page never
  scrolled horizontally. Empty case (all prefs "Any", clock at 02:30 local):
  **The Stacked Patty** — 0.6 mi, 86/100, never visited, no friend rating,
  closed — renders **no row at all**. Urgency case (15:40 local): Foggy Bell
  Coffee shows the gold "Closes at 4pm" badge *and* a "Closing soon — go now"
  chip. Reduced-motion run: chips render with `animation-name: none`.

### Deck time-awareness + Add to calendar (2026-07-23)
The old binary "Open now" badge becomes a real, time-aware state, and the
"Tonight" decision screen gains a calendar hand-off.
- **Open-state chip** (`openState(r, now)` + `openChipEl`): demo places now
  carry lightweight `openH`/`closeH` hours (varied across the ~18-place demo
  set; midnight-wrap handled). From the current local time the state resolves
  to **Open now**, **Closes at H** (open and within `CLOSES_SOON_MIN` = 60 min
  of closing — a warm gold/rose tint), **Opens at H** (closed now, opens later
  today), or **Closed**, shown as a small watercolor chip on the deck card
  (the old open-now slot) and again on the decision screen so "should we go
  now?" is answered in context. Live (Google) places with no hours fall back
  to the existing binary flag — never a fake precise time.
- **Add to calendar** (`buildCalendarAction`/`icsStamp`/`icsEscape`): a new
  decision-screen action builds a tiny valid **.ics** (Blob download) for a
  dinner tonight — `SUMMARY:Dinner at <name>`, location = address if present,
  ~90 min from the next round hour, floating local time. No backend, demo-safe.
- Evening overrides + AA on every chip state; ≥44px calendar target; the
  decision actions (Maps / Call / Share / Rate / calendar) read as a tidy
  consistent stack. Verified with Playwright (mocked page clock): all four
  states render with correct labels at 21:30 and 09:00, the decision chip
  matches, and the .ics contains `BEGIN:VCALENDAR` + `SUMMARY:Dinner at …` +
  `DTSTART`; zero page errors.

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
- **Popular:** three sections — **Trending now** (leaderboard, Today / This Month / This Year toggle, top-3 accents), **Near you right now** (open + closest, from the shared `openState`), **Loved by people with your taste** (taste-matched friends' unvisited favourites). Rows are tappable and open the deck's decision screen. See the 2026-08-03 section above.
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
- `open now` in distance-ranked search is only a **binary** flag (that is all `nearbySearch` carries) — the real `periods` arrive with the per-place Details call, and until they do a live card shows *Open now* / *Closed* with **no invented time**. **phone/Call** isn't in nearby results either, so it appears only when details supply it.
- Hours are reasoned in the **browser's** timezone; a place whose `utc_offset_minutes` differs falls back to the binary state rather than printing another zone's clock.
- Saving a key spends **one** cheapest-tier Places request to validate it, so a bad key fails in the sheet instead of silently on the deck.

---

## Roadmap / ideas (next)
- Wire the **backend** (Firebase/Supabase) → real Friends, real Popular, accounts, cross-device Visited sync. (Popular's three sections already consume the promise API + the local place pool, so a real feed drops in at the resolvers.)
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
