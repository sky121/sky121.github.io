# Dragoose — project handoff & design doc

> A watercolor flying roguelike where **Gary the goose**, granted dragonfire by a
> fallen scale, battles the dragons who rule the skies and earns their respect —
> until a goose is named **Dragoose**, ruler of the skies.
>
> This document is the single source of truth so we can pick up exactly where we
> left off. Last updated: **2026-07-08**.

---

## Status: v2 — OPEN SKY (three realms, pick your route) — SHIPPED & LIVE

- **Play it:** https://sky121.github.io/dragoose.html (best on phone, one-handed)
- **Discoverable from:** the **Lab** page (`lab.html`) — the Dragoose tile is the first *Live* project.
- **OPEN SKY (2026-07-08):** "Take flight" now drops Gary into a flyable **sky hub** with three swirling **realm vortexes** (Ember / Tempest / Sorrel, tinted pigment pools with rotating ragged rings + serif name labels). **Fly into a realm to anger its dragon** — any order, your route. Winning returns you to the sky (+2 feathers healed, realm turns a calm gold ring labeled *respected* and can't be re-entered); bow all three → **"the skies name you Dragoose"** final victory. Death restarts the whole sky, all realms angry again. Implementation: the sky **is** the `PLAYING` state with `Game.mode = "sky" | "duel"` and `Game.dragon = null` — all input/pause/render machinery reused; `initSky/updateSky/enterRealm/returnToSky/drawRealms`, boss bar auto-hides via `updateHUD` when there's no dragon. Powers, scales, and health carry across the run; scales bank per-duel (no double counting).
- **Storm fight (2026-07-08):** `RUN_BOSSES`/`DRAGONS` config drives the gauntlet. Tempest: 115 HP, faster roam, lightning kit — **fan** (tight bolt spread), **lance** (3–4 fast bolts down one locked line), **nova** (radial thunderclap shell, double wave in phase 2), and in phase 2 the dash body-check which **discharges a mini-nova on exit**. Telegraphs are electric blue (`#bfe3ff`), nova gets a crackling-disc wind-up; enemy bolts are `kind:"zap"` with an indigo rim for readability. New relics: **Gale Feather** (dodge cooldown 0.3 s vs 0.6 s) and **Tempest's Gift** (start runs with Storm Dodge) — granted on Tempest's defeat (≥12 scales collected in the run ⇒ Tempest's Gift). Ember's relic threshold is now ≥8 scales ⇒ Cinder's Gift.
- Death/pause/retry restart the whole gauntlet (roguelike). The dead-screen taunt names whichever dragon killed you.
- **Verdant fight (2026-07-08):** Sorrel — 130 HP, moss/gold palette (`Art.dragonPal.verdant`), nature kit: **petal spiral** (rotating arm of petal shots wheels out over ~1.4 s; two counter-arms + faster emission in phase 2), **seed pods** (3–4 slow homing pods that steer toward you and **burst into a 6-petal ring** on fuse or proximity — kite them, then dodge the bloom), and the phase-2 dash. Green radial telegraph for the spiral, sage dash trail, petal-shed enrage ambience. Relics: **Thistle Down** (scale magnet radius 150 → 300) and **Sorrel's Gift** (start runs with Forked Flame; ≥16 scales in the run to earn it). Generic `scale.png` is used for its drops.
- **CEREMONIAL DUELS (2026-07-08):** a *respected* realm can be **re-entered mid-run** ("enter for a ceremonial duel" hint under the gold ring). The dragon returns **adapted** (`makeDragon(type, ceremonial)`): "⟡ "-prefixed name, HP ×(1.2 + 0.12·tier) capped ×2 (tier = lifetime `duels[type]` count in the save), +12% speed, attacks cycle 1.3× faster, enrages at 60% HP, and it **evolves one stolen move** from another dragon's kit (rotates by tier — attack execution is name-keyed so any dragon can cast any move). If your build carries Storm Dodge or Ember Wake it also **punishes dodges** with a snap gold shot ~0.3 s after you dash. Ceremonial wins do **not** grant relics or count toward the crown — they bank **3 + tier bonus scales**, and the first ceremony per dragon grants its **plume**: a cosmetic coat wash for Gary (`PLUMES`: Cinder rose / Tempest blue / Sorrel moss; `Art.goose` takes `opts.tint`). Equipped plume persists (`save.plume`) and cycles via the title-screen **Plume** button (only shows once you own one).
- **WAVE 5 (2026-07-08):** **Harmony sky** — once crowned, each *respected* realm's dragon circles its vortex in peace (tiny per-variant rigs cached once via `Fx.miniDragon`, drawImage-only per frame) and 3-4 white geese chevrons (`HARMONY_GEESE`) drift across the hub. **Lifetime records** — `save.records` {fastestCrown, mostScalesRun, totalDuelsWon}, updated in dragonDefeated/playerDefeated/the crowning, rendered as a quiet gold line under the title hoard. Queued next: SFX pitch jitter, golden crowning wipe.
- **WAVE 3 POLISH (2026-07-08):** **duel-intensity music** — a low root + tremolo-pulse bus inside Audio2 that fades in during duels (harder + faster pulse in phase 2), driven from the existing chord interval, obeys mute; **painterly breath** — ember breath + gilded ray droplets render as ragged watercolor blots (seed-stable offset pools, darker trailing edge, bloom-then-dry alpha ease, ≤6 draws/droplet); **title Gary preview** — `#title-goose` canvas on the title card renders your equipped plume + regalia via `renderTitleGoose()` (refreshes on plume cycling); **Gentle breeze** assist toggle on the title (persisted `save.gentle`): dragons cycle attacks ~25% slower and Gary starts +1 feather.
- **AURELIA + THE CROWNING + TUTORIAL (2026-07-08):** fourth dragon **Aurelia, the Gilded Wyrm** (145 HP, gold palette, greed kit): **lures** — hovering false scales with a dark-rim slow-pulse tell that detonate into radial gold shots on a fuse or proximity; **ray** — a sweeping gold sun-beam (reuses the breath state, `isRay` branch); **coins** — lobbed spinning discs arcing under per-shot gravity (`grav` field on DragonShots). Sky hub is now a **four-realm diamond**. Gilded rewards: relics **Gilded Heart** (charge ignites 25% faster) / **Aurelia's Gift** (start with Tailwind Fury, ≥20 scales), plume **Gilded Plume**, regalia **Gilded Crest** (scales worth double while at full health). **The Crowning**: bowing all four realms fires a golden celebration, the win screen becomes "the crowning / Dragoose, Ruler of the Skies", and `save.crowned` persists — the title screen kicker and hoard wear it forever. **Tutorial hints**: one-time floatText guidance in the first sky (steer/dodge/charge) and first duel (watch the telegraphs), remembered in `save.seenHints`.
- **REGALIA (2026-07-08):** hoard equipment that changes Gary's **silhouette and his fight** (the spec's "equipment reskins the goose + grants abilities"). Earned on the **second ceremonial victory** per dragon (ladder: 1st ceremony = plume, 2nd = regalia, later = deeper scale bonuses). Auto-worn once owned, persisted in `save.regalia`, listed in the title hoard. Pieces (`REGALIA`/`DRAGON_REGALIA`; drawn in `Art.goose` via `opts.gear`): **Ember's Horns** — backswept cinder-bone horns; the dodge dash now **rams** dragons for 7 contact damage, once per dash (`p.ramHit`). **Tempest's Spade** — a storm-blue tail spade; **fully charged** shots also loose a 3-bolt rearward lightning fan. **Sorrel's Mantle** — a leaf collar; regrows a **one-hit leaf ward** every ~8–12 s (green ring shimmer; `p.ward`/`p.wardCd`, consumed in `hurtPlayer` before damage).
- **WAVE 4 (2026-07-08):** **boss-intro flyby** — entering a realm now opens with a ~1.4 s non-interactive entrance (`Game.introT`/`introDur`, set in `enterRealm`): the dragon swoops in from off-screen top (cubic ease-out toward its arena spot, slight lateral sway) and holds its fire (`updateDragon` forces `state:"roam"` and skips the attack-cooldown tick while `introT > 0`; the player can still steer/shoot), while a canvas name card (`drawIntroCard`, drawn outside the shake transform) shows the dragon's name in Cormorant italic over a thin gold rule that draws itself wider, fading in/out with `introT`; ceremonial entries add a "⟡ Ceremonial duel" second line (the old entry floatText announcement was replaced by the card). Under `prefers-reduced-motion` the intro is 0.5 s with no swoop (dragon starts in place), card still shown. **Realm-proximity sky tinting** — in the sky hub `updateSky` finds the nearest realm and a 0..1 closeness factor (1 within `r*1.2`, 0 by `r*3`), stored in `sky.tint` (mutated in place, no per-frame allocation); `paintSky` overlays one radial gradient centered on that realm using its accent at ~0.12·k alpha (sky mode only — duels/title unaffected). **Rare lustrous scales** — `dropScale` rolls a 10% `rare` chance: lustrous pickups draw at 72 px with an iridescent shimmer (glow dots cycle gold→rose→wisteria via time-indexed picks from the module-level `LUSTRE` array) and `collectScale` banks **+3** ("+N lustrous!" in rose); the Gilded Crest doubling applies *after* the rare bonus (3 → 6 at full health). **Crowned circlet** — once `save.crowned`, `Art.goose` draws a tiny three-point gold crown (`gear.crown`; `#cdb878` fill, `#a8863c` stroke, ~10 units wide, resting just above the eyes) on Gary in flight (`drawPlayer`) and on the title preview (`renderTitleGoose`).
- **Polish (2026-07-08):** run stats (`Game.runStats`: time in the sky, damage dealt, dodges) shown as a scoreboard line on the death and victory screens; haptics via `navigator.vibrate` (dodge 12 ms, hurt 35 ms, scale 8 ms, dragon-bow pattern — skipped under `prefers-reduced-motion`); ambient **music** — a four-chord airy sine pad loop (`Audio2.musicStart`, ~7.5 s per chord) that starts on the first user gesture and obeys the mute toggle.

### Files (all committed to `master`)
| File | What it is |
|---|---|
| `dragoose.html` | Game page (title/meta, canvas, Google Fonts, links the CSS/JS) |
| `assets/css/dragoose.css` | All game styling (screens, HUD, buttons, watercolor UI) — ~628 lines |
| `assets/js/dragoose.js` | The whole game — vanilla JS, one IIFE, no deps — ~3870 lines |
| `images/dragoose/*.png` | Watercolor sprites (see Assets below) |
| `docs/dragoose/art-src/*.svg` | **Editable** source SVGs for every sprite + render scripts |
| `lab.html` | Contains the Live "Dragoose" tile linking to the game |
| `sitemap.xml` | Has the `dragoose.html` entry |

---

## How to resume / develop

- **Run locally:** from the repo root, `python3 -m http.server` then open `http://localhost:8000/dragoose.html`. (Must be served over HTTP, not `file://`, so the sprite PNGs load.)
- **Architecture (in `assets/js/dragoose.js`):** single `"use strict"` IIFE, one `<canvas>` at fixed logical resolution **540×960**, letterboxed + DPR-aware (capped 2.5×). Fixed-timestep update (1/60s) with frame clamping + spiral-of-death guard; interpolated render. Modules: **Save** (localStorage), **Audio2** (synthesized Web Audio), **Input** (pointer-primary + keyboard), **Particles** (pool of 260), two **projectile pools** (player 48 / dragon 80), **Pickups**, and a **Game** state machine: `LOADING → TITLE → PLAYING → POWER → PAUSED → DEAD → WIN`. Pauses on tab blur/visibilitychange; honors `prefers-reduced-motion` (tones down shake/flash). Minimal test hook exposed at `window.__dragoose`.
- **Save data:** localStorage key **`dragoose-save`**. Shape e.g. `{"scales":7,"relics":["emberHeart"],"wins":1}`. To reset progress, clear that key in devtools.
- **Editing sprites:** edit the SVGs in `docs/dragoose/art-src/`, then re-render to transparent PNGs with Playwright (`omitBackground:true`, viewport = sprite size, dpr 1) using the included `render.js` / `render-dragons.js` as a starting point, and overwrite the matching file in `images/dragoose/`. Dragons should be quantized (alpha-preserving) to stay ~50–55 KB.
- **Adding a project tile to the Lab** (for future games): copy the `<li class="pool ...">` template documented inside `lab.html` (there's a commented TEMPLATE + "how to add a project" block).

### Controls (implemented)
- **Drag** anywhere = steer (eased toward pointer, momentum + banking tilt).
- **Tap** (<220 ms, no move) = dodge/dash with **0.42 s i-frames** + 0.6 s cooldown (motion streak + shimmer).
- **Hold** (>220 ms) = charge a fireball (arc meter + rising audio + glow); release fires; size/damage scale with charge.
- **Desktop:** mouse drag steers; also WASD/arrows steer, **Space** tap=dodge / hold=charge, **Esc** pause, **M** mute.
- Canvas blocks scroll/zoom/pull-to-refresh (`touch-action: none`).

### Combat / boss — Ember, the Cinder Wyrm
- Boss has a health bar + name; **telegraphed** attacks (tint + dashed aim line wind-up) so dodging is skillful and fair.
- **Phase 1 (>50% HP):** roams; spread volley, aimed multi-shot, sweeping breath cone.
- **Phase 2 (<50% HP, "enraged"):** purple pulsing bar, faster, shorter cooldowns, adds a telegraphed **charge/dash** body-check.
- Drops **scales** at HP milestones (use `scale-ember.png`). Defeat → it bows → "You have earned its respect" → grants a **relic** → victory.

### Powers (the "no-stats" ability system) — 5 implemented
Offered as a **1-of-2 pick** every few scales collected:
1. **Tailwind Fury** — the faster you fly, the harder your fireballs hit.
2. **Ember Wake** — your first shot after a dodge becomes a big searing blast.
3. **Storm Dodge** — dodging fires a radial lightning burst.
4. **Mirror Plume** — reflect a portion of damage when hit.
5. **Forked Flame** — fireballs split into two.

### Roguelike meta / hoard (persists across runs)
- Banks total **scales**, **dragons bowed**, and **relics** in `dragoose-save`.
- Relics give next-run perks: **Heart of Ember** = +1 starting feather (health); **Cinder's Gift** = start already wielding Ember Wake.
- Death **salvages half** your scales. Hoard summary shown on the title screen.

### Screens & polish (done)
Title (logo + Gary's backstory + how-to + hoard), Loading, in-game HUD (player feathers, charge meter, dragon health+name, scale count, power icons), Power pick, Pause, Death, Victory. Watercolor sky wash + 3-depth parallax clouds, particle blooms, hit-stop / screen-shake / hit-flash / knockback, floating feedback, bloom-wipe transitions, synthesized Web Audio SFX + mute toggle, "← Back to the Lab" link.

### Procedural rigged characters (2026-07-08, second pass)
The goose and dragon PNG sprites are **no longer drawn** — both characters are now fully procedural, rigged, and animated in code (`Art` module in `assets/js/dragoose.js`):

- **`Art.goose(ctx, opts)`** — vector goose facing up in a 140-unit box: two-joint wing flap with follow-through (tips lag the stroke, downstroke clamped so the top-down silhouette stays birdlike), banking asymmetry (outer wing extends), teardrop body with feather linework, neck/head/wedge-beak, ember glow in the beak while charging, hurt-tint via color lerp. Flap phase (`p.flapPhase`) accumulates with flight speed and races while charging.
- **`Art.dragon(ctx, opts)`** — vector dragon facing up in a 460-unit box: serpentine 11-segment body drawn as smooth tapered strokes (tail whips with `swayPhase`), swept bat wings with elbow/wrist joints, three membrane fingers and deep scalloped trailing edges that billow in counter-phase, arrow-shaped skull with backswept horns, glowing upswept wedge eyes under hard brow slashes (brighter + veins glow when enraged), spine studs, tail spade. `bow` folds the wings, dips the head and softens the eyes. Palettes for `ember` and `storm` are in `Art.dragonPal` — the storm dragon is a palette swap away.
- Characters render into per-frame **scratch canvases** (`Fx.scratch`) so one `drawImage` alpha fades the whole figure (i-frames, ghosts, bow) without per-path alpha bookkeeping.
- **Perf:** the sky backdrop (gradient, god rays, sun, blooms, haze) paints into a **half-res offscreen layer every other frame** and blits once; the vignette + color grade are one pre-baked layer. Headless-software-rendering benchmark: ~56 fps in phase-2 combat vs ~60 for the pre-revamp build (GPU devices lock at 60). Big previews of the rigs: `window.__dragoose.art` is exposed for test harnesses.
- The old sprite PNGs (`goose.png`, `dragon-*.png`, `fireball.png`, `cloud.png`) remain in the repo but are **no longer preloaded** (2026-07-08) — only the three scale-pickup PNGs load now; everything else is procedural.

### Graphics overhaul (2026-07-08)
The render layer was rebuilt for a professional look while keeping the watercolor identity. All of it lives in `assets/js/dragoose.js`:

- **`Fx` module** — cached soft-glow dot sprites (`Fx.dot(color)`), procedural volumetric cumulus clouds (4 variants, flat-bottomed, sun-kissed tops, shaded undersides), a pre-blurred god-ray fan (`Fx.rays`), pre-rendered vignette / red hurt-vignette / warm-top-cool-bottom color-grade layers, and **sprite lighting bakes** (`Fx.bakeSprites()`: saturation lift + warm key light upper-left + cool bounce lower-right, baked once at load). Hurt/hit flashes use pre-baked *tinted sprite copies* (`gooseHurt`, `dragonEmberFlash`, …) — never `source-atop` on the main canvas (that tints a whole rect of sky).
- **Sky** — layered gradient, sun with layered bloom at (0.78 VW, 0.10 VH), two counter-rotating pre-blurred god-ray fans (additive), drifting pigment blooms, two sine-drifting haze bands, 22 twinkling dust motes.
- **Particles v2** — types: `soft` (glow-sprite blobs), `spark` (additive velocity streaks with gravity), `ring` (expanding shockwaves); helpers `glow/spark/sparkBurst/ring`. Pool of 320.
- **Projectiles** — procedural layered fireballs (smoky base → additive flame body → gold → white-hot core, flicker + trail ring-buffer of recent positions, shed sparks); enemy fire gets a crimson rim, breath is smokier; lightning is a jagged 2-pass polyline with glow. `fireball.png` is no longer drawn (still preloaded).
- **Characters** — altitude shadows, hover bob, wing-beat squash-&-stretch (goose speeds up with flight speed), dash afterimage ghosts, charge = converging sparks + breathing additive aura + glowing arc meter; dragon: painterly telegraphs (breath = soft cone, dash = rushing chevrons + rose ring, aimed = tapered light beam), phase-2 heat aura + rising embers, bow = golden halo + dissolving gold motes.
- **Screen** — cinematic grade (`overlay` at 0.22) + vignette every frame; hurt = red *vignette* pulse (not a flat slab); boss bar has an animated shine sweep (CSS).
- Verified via Playwright screenshots at 420×760: title, combat, charge, fireball, dodge, hurt, bow — 0 console errors (the only failing request locally is Google Fonts, which is sandbox-specific).

### Verified
`node --check` passes; HTML parses; CSS balanced; all 8 sprite paths resolve; loads with **0 console errors**; dragon takes damage, player can be hit, scales drop/collect, a power grants, win/death/retry transition, hoard persists across reloads, mute + pause + keyboard all work, no page overflow. Tested desktop 540×960 and mobile 390×844.

---

## Roadmap — deferred features (what to build next)

Ordered roughly by value / readiness.

1. ~~**Second fight: the Storm dragon.**~~ **DONE (2026-07-08)** — Tempest ships as the second boss; **Sorrel, the Verdant Wyrm** shipped the same day as the third. Adding a fourth dragon = add an entry to `DRAGONS`, append to `RUN_BOSSES`, give it an `Art.dragonPal` palette and an attack kit branch in `dragonBeginAttack`/`dragonExecute` (+ optional per-kind projectile draw in `drawDragonShots`).
2. ~~**Open sky (open world).**~~ **DONE (2026-07-08)** — shipped as the realm-hub sky (see Status). A future pass could grow it into a scrolling world with a camera, but the pick-your-route structure is live.
3. **More dragons**, each with a unique realm, palette, attack identity, and signature reward.
4. ~~**Equipment that reskins Gary + grants abilities/attacks**~~ **DONE (2026-07-08)** — shipped as Regalia (see Status). Future: more pieces per dragon, visible gear on the title screen, set bonuses that change attack shapes.
5. ~~**Rematches / ceremonial duels.**~~ **DONE (2026-07-08)** — shipped (see Status). Future deepening: more counter types keyed to other builds, adaptation that alters phase structure, rarer plume tiers.
6. **RNG loot tables.** *Partially done (2026-07-08):* **lustrous scales** shipped — 10% of drops are iridescent and worth +3. Still open: rarer "gifts from the hoard" on repeat victories, alternate gifts, legendary mutations; consider higher drop rate for faster clears.
7. **Endgame:** earn the respect of *all* dragons → crowned **Dragoose**, ruler of the skies; geese and dragons live in harmony (the win-the-game state). 
8. **Polish passes:** push the breath-cone to fully painterly watercolor; more SFX/music; haptics on mobile; difficulty tuning; maybe a brief tutorial.

### Key design decisions already made
- **No traditional stats** — all progression is *mechanic-changing* abilities from collected scales/equipment, not number buffs.
- **No minions** — the sky holds only large dragons; XP/strength come from fighting them and collecting scales over time.
- **One great fight over two rushed ones** for v1 (hence Storm deferred despite ready assets).
- **Watercolor cohesion** with the host portfolio site (shared palette, fonts, painterly rendering) — keep this for everything new.
- **One-thumb, vertical, mobile-first** (drag steer / tap dodge / hold charge), but it must also play well on desktop.

---

## Assets inventory (`images/dragoose/`, transparent PNGs, top-down facing up)
| File | Size | Use |
|---|---|---|
| `goose.png` (280²) | Gary, the player |
| `dragon-ember.png` (680²) | Ember boss (live) |
| `dragon-storm.png` (680²) | Storm boss (ready, not yet used in a fight) |
| `fireball.png` (140²) | projectile / breath bloom |
| `scale.png`, `scale-ember.png`, `scale-storm.png` (110²) | scale pickups (per-dragon tints) |
| `cloud.png` (300×180) | parallax sky cloud |

Editable sources + render scripts: `docs/dragoose/art-src/`. Style: hand-authored SVG using `feTurbulence` + `feDisplacementMap` ragged wet edges, layered translucent washes, radial pigment pooling, ink linework, gold-rim accents. Palette only: ink `#2e3a48`, pond `#7fa8c9`, pond-deep `#4a7299`, wisteria `#a292c4`, sage `#93b48b`, rose `#d98ba0`, gold `#cdb878`; paper `#f6f1e7` (never as a sprite background — sprites are transparent).

---

## Appendix — original design brief (preserved verbatim from the concept)

### Gameplay
- **No Stats** — equipment, scales, or buffs give an interesting mechanic or ability directly, e.g.:
  - "your next attack burns the enemy"
  - "when hit by an attack reflect damage"
  - "gain movement speed when flying away from enemies"
  - "the higher your movement speed the more your damage"
  - "shoot lightning at enemies when dodging"
- **Open sky (open world).** Dragons each have their own realm you can fly into, which angers that dragon; they then attack you while you're in their realm.
- Equipment changes the goose's sprite look as well as abilities and attacks.
- **No hordes / minions / small basic creatures** to fight — the sky is ruled only by large dragons.
- Since there are no minions, gain experience through **time spent fighting** the dragons. Do enough damage to a dragon and it drops a **scale**, which you collect for more magical powers. The more you fight, the stronger you get until you can defeat all the dragons.
- **One-handed, only thumb, vertical mobile game.** Drag to steer. Tap to dodge/boost. Hold to charge attack.
- **Roguelike** (die → fully restart). But items collected for your **hoard** back at your pond carry to the next goose who takes on the sky.
- Semi-ranged attacks and abilities (fireballs, claw swipe, etc.).
- Defeat a dragon → earn its respect → it gives a **gift from its hoard**. Earn the respect of **all** dragons → you're named **Dragoose**, ruler of the skies; you invite all geese to fly freely; geese and dragons live in harmony.
- **RNG** for rarer gifts from defeating dragons, and rarer scales dropped.
- *Problem:* if you can only defeat a dragon once, what if you want to retry for the rare drops? *Solution:* after earning a dragon's respect, return for a **ceremonial duel**. **Dragons adapt between rematches** — attacks evolve, phases change, gain counters to your build, become more aggressive.
- **Rare drops change playstyle/aesthetics, not power.** First victory guaranteed (respect, story progression, signature power); repeat victories: chance for rare scales, alternate gifts, cosmetic gear, legendary mutations. Possibly higher drop rate for faster time-to-victory.

### Backstory
Dragoose is the story of **Gary**, a goose who dreams of flying among the clouds — but the skies belong to dragons. For generations, geese have lived in fear, hiding on the ground while dragons soar above; to dragons, geese are prey.

One day Gary discovers a fallen dragon scale glowing with strange magical energy. Drawn to it, he reaches out — a torrent of magic erupts, and everything goes dark. When he awakens, he can **breathe fire**. Believing this power may finally earn him a place in the skies, Gary takes flight for the first time — unaware the dragons may never accept a goose among them.

As Gary defeats each dragon, he earns their respect in battle. Rather than dying, the dragons acknowledge his strength and offer a gift from their hoard — relics infused with ancient draconic magic. With every victory he grows stronger, and the dragons begin to see him not as prey but as one of their own.

After earning the respect of every dragon, Gary is given a new title: **Dragoose** — the first goose accepted among dragonkind. He unites the skies and the earth; geese are finally free to fly alongside dragons, and the skies enter a new age of harmony.
