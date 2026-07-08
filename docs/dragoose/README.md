# Dragoose — project handoff & design doc

> A watercolor flying roguelike where **Gary the goose**, granted dragonfire by a
> fallen scale, battles the dragons who rule the skies and earns their respect —
> until a goose is named **Dragoose**, ruler of the skies.
>
> This document is the single source of truth so we can pick up exactly where we
> left off. Last updated: **2026-07-08**.

---

## Status: v1.1 — two-boss gauntlet — SHIPPED & LIVE

- **Play it:** https://sky121.github.io/dragoose.html (best on phone, one-handed)
- **Discoverable from:** the **Lab** page (`lab.html`) — the Dragoose tile is the first *Live* project.
- A run is now a **gauntlet**: Ember, the Cinder Wyrm → (respect earned, +2 feathers healed) → **Tempest, the Storm Wyrm** → final victory. Powers, scales, and health carry across the two duels; scales are banked per-duel (no double counting).
- **Storm fight (2026-07-08):** `RUN_BOSSES`/`DRAGONS` config drives the gauntlet. Tempest: 115 HP, faster roam, lightning kit — **fan** (tight bolt spread), **lance** (3–4 fast bolts down one locked line), **nova** (radial thunderclap shell, double wave in phase 2), and in phase 2 the dash body-check which **discharges a mini-nova on exit**. Telegraphs are electric blue (`#bfe3ff`), nova gets a crackling-disc wind-up; enemy bolts are `kind:"zap"` with an indigo rim for readability. New relics: **Gale Feather** (dodge cooldown 0.3 s vs 0.6 s) and **Tempest's Gift** (start runs with Storm Dodge) — granted on Tempest's defeat (≥12 scales collected in the run ⇒ Tempest's Gift). Ember's relic threshold is now ≥8 scales ⇒ Cinder's Gift.
- Death/pause/retry restart the whole gauntlet (roguelike). The dead-screen taunt names whichever dragon killed you.

### Files (all committed to `master`)
| File | What it is |
|---|---|
| `dragoose.html` | Game page (title/meta, canvas, Google Fonts, links the CSS/JS) |
| `assets/css/dragoose.css` | All game styling (screens, HUD, buttons, watercolor UI) — ~628 lines |
| `assets/js/dragoose.js` | The whole game — vanilla JS, one IIFE, no deps — ~1593 lines |
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

1. ~~**Second fight: the Storm dragon.**~~ **DONE (2026-07-08)** — Tempest ships as the second boss of the gauntlet (see Status above). Adding a third dragon = add an entry to `DRAGONS`, append to `RUN_BOSSES`, give it an `Art.dragonPal` palette and an attack kit branch in `dragonBeginAttack`/`dragonExecute`.
2. **Open sky (open world).** A flyable map of dragon *realms*; entering a realm angers that dragon and starts its fight. Pick your route; progress toward defeating all dragons. (This is the big structural step from "one fight" → "the game.")
3. **More dragons**, each with a unique realm, palette, attack identity, and signature reward.
4. **Equipment that reskins Gary + grants abilities/attacks** (the spec calls for equipment changing the goose's look as well as powers). Could layer cosmetic sprite pieces over `goose.png` or add variant gooses.
5. **Rematches / ceremonial duels.** After earning a dragon's respect, return to challenge it again for rarer drops. **Dragons adapt between rematches** — evolve attacks, gain phases/counters to your build, get more aggressive.
6. **RNG loot tables.** Rarer scales and rarer "gifts from the hoard" on repeat victories; rare drops should change **playstyle/aesthetics, not raw power**. First victory = guaranteed respect/story/signature power; repeats = chance for rare scales, alternate gifts, cosmetic gear, legendary mutations. Consider higher drop rate for faster clears.
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
