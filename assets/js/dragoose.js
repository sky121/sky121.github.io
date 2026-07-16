/* ============================================================
   Dragoose — watercolor flying roguelike
   Vanilla JS, one canvas, fixed-timestep update + clamped render.
   States: LOADING / TITLE / PLAYING / POWER / PAUSED / DEAD / WIN
   ============================================================ */
"use strict";
(function () {
  // ---------------------------------------------------------
  // CONSTANTS / CONFIG
  // ---------------------------------------------------------
  var VW = 540, VH = 960;            // logical portrait resolution
  var DT = 1 / 60;                    // fixed timestep
  var MAX_FRAME = 0.05;              // clamp big frames (spiral guard)
  var PAL = {
    paper: "#f6f1e7", ink: "#2e3a48", pond: "#7fa8c9", pondDeep: "#4a7299",
    wisteria: "#a292c4", sage: "#93b48b", rose: "#d98ba0", gold: "#cdb878",
    ember: "#e08a5a", emberDeep: "#c25a3a"
  };
  var SAVE_KEY = "dragoose-save";
  // lustrous-scale shimmer cycle (picked by time index — no string building)
  var LUSTRE = [PAL.gold, PAL.rose, PAL.wisteria];
  // daily-route dashed path pattern (one shared array — no per-frame allocation)
  var DAILY_DASH = [5, 11];
  // harmony-sky geese: fixed sinusoidal drift paths across the crowned hub
  // (y0 is a VH fraction; spd in px/s; everything else phase/shape)
  var HARMONY_GEESE = [
    { y0: 0.20, amp: 26, spd: 34, freq: 0.50, phase: 0.0, size: 9 },
    { y0: 0.44, amp: 34, spd: 26, freq: 0.34, phase: 2.2, size: 7 },
    { y0: 0.66, amp: 22, spd: 42, freq: 0.60, phase: 4.1, size: 8 },
    { y0: 0.80, amp: 30, spd: 30, freq: 0.42, phase: 1.3, size: 6 }
  ];

  // characters/projectiles/clouds are fully procedural now — only the
  // scale pickups still ship as PNG sprites
  var IMG_SRC = {
    scale: "images/dragoose/scale.png",
    scaleEmber: "images/dragoose/scale-ember.png",
    scaleStorm: "images/dragoose/scale-storm.png"
  };
  var images = {};

  // ---------------------------------------------------------
  // DOM
  // ---------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var root = $("game-root");
  var canvas = $("game-canvas");
  var ctx = canvas.getContext("2d");

  var screens = {
    loading: $("screen-loading"),
    title: $("screen-title"),
    power: $("screen-power"),
    pause: $("screen-pause"),
    dead: $("screen-dead"),
    win: $("screen-win")
  };
  var hud = $("hud");
  var bloomWipe = $("bloom-wipe");

  var reduceMotion = false;
  try { reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  // haptic tap (phones only; silently a no-op elsewhere)
  function buzz(pattern) {
    if (reduceMotion) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  // ---------------------------------------------------------
  // SAVE MODULE (localStorage hoard)
  // ---------------------------------------------------------
  var Save = {
    data: { scales: 0, relics: [], wins: 0, duels: {}, plumes: [], plume: "", regalia: [], trinkets: [], crowned: false, seenHints: {}, gentle: false,
      records: { fastestCrown: null, mostScalesRun: 0, totalDuelsWon: 0 },
      daily: null },
    load: function () {
      try {
        var raw = localStorage.getItem(SAVE_KEY);
        if (raw) {
          var p = JSON.parse(raw);
          if (p && typeof p === "object") {
            this.data.scales = p.scales | 0;
            this.data.relics = Array.isArray(p.relics) ? p.relics : [];
            this.data.wins = p.wins | 0;
            this.data.duels = (p.duels && typeof p.duels === "object") ? p.duels : {};
            this.data.plumes = Array.isArray(p.plumes) ? p.plumes : [];
            this.data.plume = typeof p.plume === "string" ? p.plume : "";
            this.data.regalia = Array.isArray(p.regalia) ? p.regalia : [];
            this.data.trinkets = Array.isArray(p.trinkets) ? p.trinkets : [];
            this.data.crowned = !!p.crowned;
            this.data.seenHints = (p.seenHints && typeof p.seenHints === "object") ? p.seenHints : {};
            this.data.gentle = !!p.gentle;
            var rec = (p.records && typeof p.records === "object") ? p.records : {};
            this.data.records = {
              fastestCrown: (typeof rec.fastestCrown === "number") ? rec.fastestCrown : null,
              mostScalesRun: rec.mostScalesRun | 0,
              totalDuelsWon: rec.totalDuelsWon | 0
            };
            // daily flight result: one entry, today only (older saves lack it)
            this.data.daily = null;
            if (p.daily && typeof p.daily === "object" && typeof p.daily.date === "string") {
              this.data.daily = {
                date: p.daily.date,
                done: !!p.daily.done,
                time: (typeof p.daily.time === "number") ? p.daily.time : null,
                realmsCleared: p.daily.realmsCleared | 0
              };
            }
          }
        }
      } catch (e) {}
    },
    save: function () {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) {}
    },
    addScales: function (n) { this.data.scales += n; this.save(); },
    addRelic: function (id) {
      if (this.data.relics.indexOf(id) === -1) this.data.relics.push(id);
      this.data.wins++; this.save();
    },
    hasRelic: function (id) { return this.data.relics.indexOf(id) !== -1; },
    duelCount: function (type) { return this.data.duels[type] | 0; },
    addDuel: function (type) { this.data.duels[type] = this.duelCount(type) + 1; this.save(); },
    addPlume: function (id) {
      var isNew = this.data.plumes.indexOf(id) === -1;
      if (isNew) { this.data.plumes.push(id); this.data.plume = id; }
      this.save();
      return isNew;
    },
    hasRegalia: function (id) { return this.data.regalia.indexOf(id) !== -1; },
    addRegalia: function (id) {
      var isNew = this.data.regalia.indexOf(id) === -1;
      if (isNew) { this.data.regalia.push(id); this.save(); }
      return isNew;
    },
    hasTrinket: function (id) { return this.data.trinkets.indexOf(id) !== -1; },
    addTrinket: function (id) {
      var isNew = this.data.trinkets.indexOf(id) === -1;
      if (isNew) { this.data.trinkets.push(id); this.save(); }
      return isNew;
    }
  };

  // ---------------------------------------------------------
  // DAILY FLIGHT (date-seeded deterministic challenge)
  // ---------------------------------------------------------
  // small, fair modifiers — one per day, drawn from the seed
  var DAILY_MODS = [
    { id: "thinAir", name: "Thin Air", hud: "dodge rests +0.15s", desc: "The air is thin up here — your dodge takes 0.15s longer to recover." },
    { id: "tailwind", name: "Tailwind", hud: "flight speed +12%", desc: "A tailwind at your back — Gary flies 12% faster." },
    { id: "brittle", name: "Brittle Scales", hud: "frailer dragons, scales x2", desc: "Dragons are 10% frailer today, and every scale is worth double." },
    { id: "longNight", name: "Long Night", hud: "shorter telegraphs", desc: "The light fades fast — every telegraph winds up 15% shorter." }
  ];
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  var Daily = {
    // UTC date key, e.g. "2026-07-15" — everyone flies the same sky
    utcKey: function () {
      var d = new Date();
      var mo = d.getUTCMonth() + 1, dy = d.getUTCDate();
      return d.getUTCFullYear() + "-" + (mo < 10 ? "0" + mo : mo) + "-" + (dy < 10 ? "0" + dy : dy);
    },
    // "2026-07-15" -> "15 July"
    prettyDate: function (key) {
      var parts = key.split("-");
      return (parts[2] | 0) + " " + (MONTH_NAMES[(parts[1] | 0) - 1] || "");
    },
    // FNV-1a string hash -> 32-bit seed
    hash: function (str) {
      var h = 2166136261;
      for (var i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    },
    // mulberry32 seeded PRNG (returns a 0..1 generator)
    rng: function (seed) {
      var a = seed >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    // the whole day's flight, derived from the date alone:
    // a shuffled realm route + one modifier
    plan: function (key) {
      var rnd = this.rng(this.hash(key));
      var route = RUN_BOSSES.slice();
      for (var i = route.length - 1; i > 0; i--) {
        var j = (rnd() * (i + 1)) | 0;
        var tmp = route[i]; route[i] = route[j]; route[j] = tmp;
      }
      return { date: key, route: route, mod: DAILY_MODS[(rnd() * DAILY_MODS.length) | 0] };
    }
  };

  // ---------------------------------------------------------
  // AUDIO MODULE (Web Audio, synthesized)
  // ---------------------------------------------------------
  var Audio2 = {
    ctx: null, master: null, duelBus: null, muted: false, ready: false, chargeOsc: null, chargeGain: null,
    init: function () {
      if (this.ready) return;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
        // duel bus: an intensity layer that swells in during duels and
        // fades to silence in the open sky / title (routes through master,
        // so it honors the mute toggle for free)
        this.duelBus = this.ctx.createGain();
        this.duelBus.gain.value = 0;
        this.duelBus.connect(this.master);
        this.ready = true;
      } catch (e) {}
    },
    resume: function () { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
    setMuted: function (m) {
      this.muted = m;
      if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
    },
    tone: function (freq, dur, type, vol, slideTo) {
      if (!this.ready || this.muted) return;
      var t = this.ctx.currentTime;
      var o = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    },
    noise: function (dur, vol, lp) {
      if (!this.ready || this.muted) return;
      var t = this.ctx.currentTime;
      var n = Math.floor(this.ctx.sampleRate * dur);
      var buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var src = this.ctx.createBufferSource(); src.buffer = buf;
      var f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp || 1200;
      var g = this.ctx.createGain(); g.gain.value = vol || 0.2;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t);
    },
    dodge: function () { this.noise(0.22, 0.18, 2200); this.tone(this.jit(520), 0.18, "sine", 0.08, this.jit(900)); },
    thunder: function (big) {
      this.noise(0.3 + big * 0.25, 0.16 + big * 0.12, 700);
      this.tone(90, 0.4 + big * 0.2, "sawtooth", 0.12 + big * 0.06, 50);
    },

    /* ---- ambient music: slow airy chords drifting like the clouds ---- */
    musicTimer: null,
    musicStep: 0,
    musicStart: function () {
      if (!this.ready || this.musicTimer) return;
      var self = this;
      var CHORD_LEN = 7.5;
      // gentle pentatonic-ish pads in the site's dreamy register
      var CHORDS = [
        [196.0, 246.9, 293.7, 392.0],   // G  B  D  G
        [174.6, 220.0, 261.6, 349.2],   // F  A  C  F
        [146.8, 196.0, 246.9, 293.7],   // D  G  B  D
        [164.8, 207.7, 261.6, 329.6]    // E  Ab C  E  (soft color)
      ];
      var playChord = function () {
        if (!self.ready || self.muted) return;
        var t = self.ctx.currentTime;
        var notes = CHORDS[self.musicStep % CHORDS.length];
        self.musicStep++;
        for (var i = 0; i < notes.length; i++) {
          var o = self.ctx.createOscillator();
          var g = self.ctx.createGain();
          o.type = "sine";
          o.frequency.value = notes[i] * (1 + (Math.random() - 0.5) * 0.002); // faint drift
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.028 - i * 0.004, t + CHORD_LEN * 0.4);
          g.gain.linearRampToValueAtTime(0.0001, t + CHORD_LEN * 1.05);
          o.connect(g); g.connect(self.master);
          o.start(t); o.stop(t + CHORD_LEN * 1.1);
        }
        // ---- duel intensity layer (fed into the duel bus) ----
        // the bus itself glides toward its target so entering/leaving a
        // duel mid-chord fades smoothly (~1.5s) with no clicks
        if (self.duelBus) {
          var inDuel = Game.state === "PLAYING" && Game.mode === "duel";
          var phase2 = inDuel && Game.dragon && Game.dragon.phase === 2;
          self.duelBus.gain.setTargetAtTime(inDuel ? (phase2 ? 0.7 : 0.5) : 0, t, 0.5);
          if (inDuel) {
            // a deep sine root an octave under the chord
            var lo = self.ctx.createOscillator();
            var lg = self.ctx.createGain();
            lo.type = "sine";
            lo.frequency.value = notes[0] / 2;
            lg.gain.setValueAtTime(0.0001, t);
            lg.gain.linearRampToValueAtTime(0.055, t + CHORD_LEN * 0.35);
            lg.gain.linearRampToValueAtTime(0.0001, t + CHORD_LEN * 1.05);
            lo.connect(lg); lg.connect(self.duelBus);
            lo.start(t); lo.stop(t + CHORD_LEN * 1.1);
            // a very quiet triangle at the root, pulsing like a heartbeat
            // (tremolo: a slow LFO wobbles the note's gain — faster in phase 2)
            var pu = self.ctx.createOscillator();
            var trem = self.ctx.createGain();
            var pg = self.ctx.createGain();
            pu.type = "triangle";
            pu.frequency.value = notes[0];
            trem.gain.value = 0.6;
            pg.gain.setValueAtTime(0.0001, t);
            pg.gain.linearRampToValueAtTime(0.02, t + CHORD_LEN * 0.4);
            pg.gain.linearRampToValueAtTime(0.0001, t + CHORD_LEN * 1.05);
            var lfo = self.ctx.createOscillator();
            var lfoG = self.ctx.createGain();
            lfo.type = "sine";
            lfo.frequency.value = phase2 ? 3.2 : 2.2;
            lfoG.gain.value = 0.4;
            lfo.connect(lfoG); lfoG.connect(trem.gain);
            pu.connect(trem); trem.connect(pg); pg.connect(self.duelBus);
            pu.start(t); pu.stop(t + CHORD_LEN * 1.1);
            lfo.start(t); lfo.stop(t + CHORD_LEN * 1.1);
          }
        }
      };
      playChord();
      this.musicTimer = window.setInterval(playChord, CHORD_LEN * 1000);
    },
    fireball: function (charge) {
      var base = 150 + charge * 120;
      this.tone(base, 0.28, "sawtooth", 0.18, base * 0.4);
      this.noise(0.18, 0.12, 1400);
    },
    chargeStart: function () {
      if (!this.ready || this.muted || this.chargeOsc) return;
      var t = this.ctx.currentTime;
      this.chargeOsc = this.ctx.createOscillator();
      this.chargeGain = this.ctx.createGain();
      this.chargeOsc.type = "triangle";
      this.chargeOsc.frequency.setValueAtTime(180, t);
      this.chargeGain.gain.setValueAtTime(0.0001, t);
      this.chargeGain.gain.exponentialRampToValueAtTime(0.1, t + 0.1);
      this.chargeOsc.connect(this.chargeGain); this.chargeGain.connect(this.master);
      this.chargeOsc.start(t);
    },
    chargeUpdate: function (charge) {
      if (this.chargeOsc) this.chargeOsc.frequency.setTargetAtTime(180 + charge * 360, this.ctx.currentTime, 0.04);
    },
    chargeStop: function () {
      if (this.chargeOsc) {
        var t = this.ctx.currentTime;
        try { this.chargeGain.gain.setTargetAtTime(0.0001, t, 0.03); this.chargeOsc.stop(t + 0.15); } catch (e) {}
        this.chargeOsc = null; this.chargeGain = null;
      }
    },
    // slight pitch drift so rapid-fire SFX don't fatigue the ear
    jit: function (f) { return f * (1 + (Math.random() - 0.5) * 0.08); },
    hitDragon: function () { this.tone(this.jit(330), 0.1, "square", 0.1, this.jit(220)); this.noise(0.08, 0.08, 2600); },
    hurt: function () { this.tone(this.jit(140), 0.3, "sawtooth", 0.22, 70); this.noise(0.2, 0.15, 700); },
    scale: function () { this.tone(this.jit(880), 0.16, "sine", 0.12, this.jit(1320)); this.tone(this.jit(1320), 0.18, "sine", 0.08); },
    power: function () { this.tone(523, 0.2, "sine", 0.14); setTimeout(function(){Audio2.tone(784,0.3,"sine",0.14);}.bind(this), 110); },
    victory: function () {
      var notes = [523, 659, 784, 1047];
      for (var i = 0; i < notes.length; i++) {
        (function (f, d) { setTimeout(function () { Audio2.tone(f, 0.4, "triangle", 0.16); }, d); })(notes[i], i * 130);
      }
    },
    death: function () { this.tone(220, 0.8, "sine", 0.2, 90); this.tone(165, 0.9, "sine", 0.14, 70); }
  };

  // ---------------------------------------------------------
  // INPUT MODULE (pointer + keyboard)
  // ---------------------------------------------------------
  var Input = {
    pointerDown: false,
    px: VW / 2, py: VH * 0.7,        // pointer in logical coords
    startX: 0, startY: 0,
    downTime: 0,
    moved: false,
    keys: {},
    // events queued for the update loop
    tapQueued: false,
    releaseQueued: false,
    holding: false,                  // true while pointer/space held past tap threshold
    holdStart: 0,

    init: function () {
      canvas.addEventListener("pointerdown", this.onDown.bind(this));
      window.addEventListener("pointermove", this.onMove.bind(this));
      window.addEventListener("pointerup", this.onUp.bind(this));
      window.addEventListener("pointercancel", this.onUp.bind(this));
      window.addEventListener("keydown", this.onKey.bind(this, true));
      window.addEventListener("keyup", this.onKey.bind(this, false));
      // prevent scroll/zoom on canvas
      canvas.addEventListener("touchstart", function (e) { e.preventDefault(); }, { passive: false });
      canvas.addEventListener("touchmove", function (e) { e.preventDefault(); }, { passive: false });
      canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    },
    toLogical: function (clientX, clientY) {
      var r = canvas.getBoundingClientRect();
      var x = (clientX - r.left) / r.width * VW;
      var y = (clientY - r.top) / r.height * VH;
      return { x: x, y: y };
    },
    onDown: function (e) {
      if (Game.state !== "PLAYING") return;
      Audio2.init(); Audio2.resume(); Audio2.musicStart();
      this.pointerDown = true;
      this.moved = false;
      this.downTime = performance.now();
      var p = this.toLogical(e.clientX, e.clientY);
      this.px = p.x; this.py = p.y;
      this.startX = p.x; this.startY = p.y;
      this.holding = false;
      try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
    },
    onMove: function (e) {
      if (!this.pointerDown) return;
      var p = this.toLogical(e.clientX, e.clientY);
      this.px = p.x; this.py = p.y;
      var dx = p.x - this.startX, dy = p.y - this.startY;
      if (dx * dx + dy * dy > 26 * 26) this.moved = true;
    },
    onUp: function (e) {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      var held = performance.now() - this.downTime;
      if (this.holding) {
        this.releaseQueued = true;     // was charging -> fire
      } else if (held < 220 && !this.moved) {
        this.tapQueued = true;         // quick tap -> dodge
      } else if (held >= 220) {
        // held but never crossed into charge (edge): treat as release
        this.releaseQueued = true;
      }
      this.holding = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (er) {}
    },
    onKey: function (down, e) {
      var k = e.key.toLowerCase();
      if (k === " " || k === "spacebar") {
        e.preventDefault();
        if (down && !this.keys.space) { // press
          this.keys.space = true;
          this.downTime = performance.now();
          this.holding = false;
          Audio2.init(); Audio2.resume(); Audio2.musicStart();
        } else if (!down && this.keys.space) { // release
          this.keys.space = false;
          var held = performance.now() - this.downTime;
          if (this.holding) this.releaseQueued = true;
          else if (held < 220) this.tapQueued = true;
          else this.releaseQueued = true;
          this.holding = false;
        }
        return;
      }
      if (k === "escape" && down) { Game.togglePause(); return; }
      if (k === "m" && down) { Game.toggleMute(); return; }
      this.keys[k] = down;
    },
    // call each frame: returns steer target if dragging, else null
    update: function (dt) {
      // promote to "holding" (charge) once held long enough
      var heldNow = this.pointerDown || this.keys.space;
      if (heldNow && !this.holding) {
        var since = performance.now() - this.downTime;
        if (since >= 220) { this.holding = true; this.holdStart = performance.now(); }
      }
    },
    // keyboard steering vector
    keyVec: function () {
      var vx = 0, vy = 0;
      if (this.keys.a || this.keys.arrowleft) vx -= 1;
      if (this.keys.d || this.keys.arrowright) vx += 1;
      if (this.keys.w || this.keys.arrowup) vy -= 1;
      if (this.keys.s || this.keys.arrowdown) vy += 1;
      return { x: vx, y: vy };
    }
  };

  // ---------------------------------------------------------
  // FX — cached glow sprites, procedural clouds, lighting bakes
  // ---------------------------------------------------------
  var TAU = Math.PI * 2;
  var Fx = {
    dots: {},          // color -> soft radial glow sprite
    baked: {},         // sprite key -> lighting-baked canvas
    cloudSprites: [],  // procedural volumetric clouds
    vignette: null,
    redVignette: null,
    grade: null,

    rgba: function (color, a) {
      var r, g, b;
      if (color.charAt(0) === "#") {
        var h = color.slice(1);
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        r = parseInt(h.substr(0, 2), 16); g = parseInt(h.substr(2, 2), 16); b = parseInt(h.substr(4, 2), 16);
      } else {
        var m = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (!m) return color;
        r = +m[1]; g = +m[2]; b = +m[3];
      }
      return "rgba(" + r + "," + g + "," + b + "," + a + ")";
    },

    // soft radial glow sprite, cached per color
    dot: function (color) {
      var c = this.dots[color];
      if (c) return c;
      c = document.createElement("canvas");
      c.width = c.height = 64;
      var x = c.getContext("2d");
      var g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, this.rgba(color, 1));
      g.addColorStop(0.38, this.rgba(color, 0.62));
      g.addColorStop(0.72, this.rgba(color, 0.2));
      g.addColorStop(1, this.rgba(color, 0));
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
      this.dots[color] = c;
      return c;
    },

    drawDot: function (g, x, y, r, color, alpha, additive) {
      if (r <= 0 || alpha <= 0) return;
      var prevOp = g.globalCompositeOperation, prevA = g.globalAlpha;
      if (additive) g.globalCompositeOperation = "lighter";
      g.globalAlpha = Math.min(1, alpha);
      g.drawImage(this.dot(color), x - r, y - r, r * 2, r * 2);
      g.globalCompositeOperation = prevOp;
      g.globalAlpha = prevA;
    },

    // volumetric puffy cumulus rendered once to an offscreen canvas:
    // a flat-bottomed base row with a cauliflower top, shaded underneath.
    makeCloudSprite: function (w, h) {
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      var x = c.getContext("2d");
      var puff = function (px, py, pr, core) {
        var grad = x.createRadialGradient(px, py - pr * 0.32, pr * 0.06, px, py, pr);
        grad.addColorStop(0, "rgba(255,255,255," + core + ")");
        grad.addColorStop(0.62, "rgba(250,252,255," + core * 0.72 + ")");
        grad.addColorStop(1, "rgba(242,247,253,0)");
        x.fillStyle = grad;
        x.beginPath(); x.arc(px, py, pr, 0, TAU); x.fill();
      };
      var baseY = h * 0.66;
      // base row
      var bases = 4;
      for (var i = 0; i < bases; i++) {
        var t = i / (bases - 1);
        var px = w * (0.2 + 0.6 * t) + (Math.random() - 0.5) * w * 0.05;
        var pr = h * (0.26 + Math.random() * 0.08) * (1 - Math.abs(t - 0.5) * 0.5);
        puff(px, baseY - pr * 0.18, pr, 0.98);
      }
      // cauliflower top
      var tops = 6 + ((Math.random() * 4) | 0);
      for (var j = 0; j < tops; j++) {
        var tt = j / (tops - 1);
        var lens = Math.sin(tt * Math.PI);
        var tx = w * (0.22 + 0.56 * tt) + (Math.random() - 0.5) * w * 0.06;
        var tr = h * (0.12 + lens * 0.17 * (0.7 + Math.random() * 0.6));
        var ty = baseY - h * (0.12 + lens * (0.2 + Math.random() * 0.1)) - tr * 0.4;
        puff(tx, ty, tr, 0.95);
      }
      // softly trim to a flatter cloud base (fade fully out before the
      // sprite edge so no hard line shows)
      x.globalCompositeOperation = "destination-out";
      var cut = x.createLinearGradient(0, h * 0.68, 0, h * 0.9);
      cut.addColorStop(0, "rgba(0,0,0,0)");
      cut.addColorStop(0.7, "rgba(0,0,0,0.75)");
      cut.addColorStop(1, "rgba(0,0,0,1)");
      x.fillStyle = cut; x.fillRect(0, 0, w, h);
      // and feather the sprite's side edges too
      var cutL = x.createLinearGradient(0, 0, w * 0.1, 0);
      cutL.addColorStop(0, "rgba(0,0,0,1)"); cutL.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = cutL; x.fillRect(0, 0, w * 0.1, h);
      var cutR = x.createLinearGradient(w, 0, w * 0.9, 0);
      cutR.addColorStop(0, "rgba(0,0,0,1)"); cutR.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = cutR; x.fillRect(w * 0.9, 0, w * 0.1, h);
      // shade the underside (cool ambient bounce)
      x.globalCompositeOperation = "source-atop";
      var sg = x.createLinearGradient(0, h * 0.4, 0, h * 0.9);
      sg.addColorStop(0, "rgba(148,174,206,0)");
      sg.addColorStop(1, "rgba(132,160,196,0.5)");
      x.fillStyle = sg; x.fillRect(0, 0, w, h);
      // kiss the top with warm sunlight
      var tg = x.createLinearGradient(0, 0, 0, h * 0.5);
      tg.addColorStop(0, "rgba(255,244,219,0.6)");
      tg.addColorStop(1, "rgba(255,244,219,0)");
      x.fillStyle = tg; x.fillRect(0, 0, w, h);
      x.globalCompositeOperation = "source-over";
      return c;
    },

    // pre-blurred god-ray fan, rotated slowly at runtime (soft edges, cheap)
    makeRaysSprite: function () {
      var size = 900;
      var c = document.createElement("canvas");
      c.width = size; c.height = size;
      var x = c.getContext("2d");
      x.translate(size / 2, size / 2);
      try { x.filter = "blur(14px)"; } catch (e) {}
      var n = 7, len = size * 0.5 - 20;
      for (var i = 0; i < n; i++) {
        var a = i * (TAU / n) + (i % 2) * 0.22;
        var halfW = 0.1 + (i % 3) * 0.035;
        x.save();
        x.rotate(a);
        var rg = x.createLinearGradient(0, 0, len, 0);
        rg.addColorStop(0, "rgba(255,241,205,0.16)");
        rg.addColorStop(0.5, "rgba(255,241,205,0.07)");
        rg.addColorStop(1, "rgba(255,241,205,0)");
        x.fillStyle = rg;
        x.beginPath();
        x.moveTo(0, 0);
        x.lineTo(len, -len * halfW);
        x.lineTo(len, len * halfW);
        x.closePath();
        x.fill();
        x.restore();
      }
      return c;
    },

    buildClouds: function () {
      this.cloudSprites.length = 0;
      for (var i = 0; i < 4; i++) this.cloudSprites.push(this.makeCloudSprite(360, 200));
      this.rays = this.makeRaysSprite();
    },

    // full-screen layers rendered once
    buildScreenLayers: function () {
      // vignette
      var v = document.createElement("canvas"); v.width = VW; v.height = VH;
      var x = v.getContext("2d");
      var g = x.createRadialGradient(VW / 2, VH * 0.46, VH * 0.3, VW / 2, VH * 0.52, VH * 0.8);
      g.addColorStop(0, "rgba(15,30,54,0)");
      g.addColorStop(0.72, "rgba(15,30,54,0.08)");
      g.addColorStop(1, "rgba(15,30,54,0.3)");
      x.fillStyle = g; x.fillRect(0, 0, VW, VH);
      this.vignette = v;

      // red hurt vignette (pain closes in from the edges)
      var rv = document.createElement("canvas"); rv.width = VW; rv.height = VH;
      x = rv.getContext("2d");
      g = x.createRadialGradient(VW / 2, VH / 2, VH * 0.22, VW / 2, VH / 2, VH * 0.72);
      g.addColorStop(0, "rgba(194,60,45,0)");
      g.addColorStop(0.65, "rgba(194,60,45,0.28)");
      g.addColorStop(1, "rgba(150,32,30,0.78)");
      x.fillStyle = g; x.fillRect(0, 0, VW, VH);
      this.redVignette = rv;

      // color grade baked INTO the vignette layer (warm light above, cool
      // depth below) so the whole screen treatment is one drawImage
      x = v.getContext("2d");
      g = x.createLinearGradient(0, 0, 0, VH);
      g.addColorStop(0, "rgba(255,214,160,0.16)");
      g.addColorStop(0.4, "rgba(255,236,214,0.03)");
      g.addColorStop(1, "rgba(46,84,138,0.16)");
      x.fillStyle = g; x.fillRect(0, 0, VW, VH);
      this.grade = null;
    },

    // bake directional lighting into character sprites:
    // warm key light from upper-left, cool bounce from lower-right,
    // plus a soft saturation/contrast lift.
    bakeSprite: function (img) {
      if (!img || !img.naturalWidth) return img;
      var w = img.naturalWidth, h = img.naturalHeight;
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      var x = c.getContext("2d");
      try { x.filter = "saturate(1.16) contrast(1.06) brightness(1.02)"; } catch (e) {}
      x.drawImage(img, 0, 0, w, h);
      try { x.filter = "none"; } catch (e) {}
      x.globalCompositeOperation = "source-atop";
      var lg = x.createLinearGradient(0, 0, w * 0.55, h);
      lg.addColorStop(0, "rgba(255,238,204,0.30)");
      lg.addColorStop(0.6, "rgba(255,238,204,0)");
      x.fillStyle = lg; x.fillRect(0, 0, w, h);
      var sg = x.createLinearGradient(w, h, w * 0.45, h * 0.25);
      sg.addColorStop(0, "rgba(66,86,122,0.26)");
      sg.addColorStop(1, "rgba(66,86,122,0)");
      x.fillStyle = sg; x.fillRect(0, 0, w, h);
      return c;
    },

    // flat-color tinted copy of a sprite (for hurt / hit flashes)
    tintSprite: function (src, color, amt) {
      var w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      var x = c.getContext("2d");
      x.drawImage(src, 0, 0, w, h);
      x.globalCompositeOperation = "source-atop";
      x.fillStyle = this.rgba(color, amt);
      x.fillRect(0, 0, w, h);
      return c;
    },

    bakeSprites: function () {
      // goose + dragons are now procedural (Art module); only the scale
      // pickups still use PNG sprites worth lighting
      var keys = ["scale", "scaleEmber", "scaleStorm"];
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (images[k]) this.baked[k] = this.bakeSprite(images[k]);
      }
    },

    // harmony-sky mini dragons: one tiny peaceful rig per variant,
    // rendered ONCE into a cached canvas (~90px box from the 460-unit
    // rig) and then only ever drawImage'd — never re-rigged per frame
    miniDragons: {},
    miniDragon: function (variant) {
      var c = this.miniDragons[variant];
      if (c) return c;
      var k = 90 / 460;
      c = document.createElement("canvas");
      c.width = 90; c.height = Math.ceil(370 * k);
      var x = c.getContext("2d");
      x.save();
      x.scale(k, k);
      x.translate(230, 150);
      Art.dragon(x, { t: 0, swayPhase: 0.6, flapPhase: 0.9, bow: 0, simple: true, variant: variant });
      x.restore();
      this.miniDragons[variant] = c;
      return c;
    },

    // per-frame scratch canvases (characters render here first so a
    // single drawImage alpha can fade the whole figure cleanly)
    scratch: function (key, w, h) {
      var c = this["_sc_" + key];
      if (!c) {
        c = this["_sc_" + key] = document.createElement("canvas");
        c.width = w; c.height = h;
        c._ctx = c.getContext("2d");
      }
      c._ctx.clearRect(0, 0, c.width, c.height);
      return c;
    },

    init: function () {
      this.buildClouds();
      this.buildScreenLayers();
    }
  };

  // ---------------------------------------------------------
  // PARTICLE POOL v2 (soft glows, sparks, shockwave rings)
  // ---------------------------------------------------------
  var Particles = {
    pool: [], max: 320, idx: 0,
    init: function () {
      for (var i = 0; i < this.max; i++) {
        this.pool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, r: 0, gr: 0, life: 0, maxLife: 1, color: "#fff", alpha: 0.4, drag: 0.9, type: "soft", add: false, w: 3, grav: 0 });
      }
    },
    alloc: function () {
      var p = null;
      for (var i = 0; i < this.max; i++) {
        var j = (this.idx + i) % this.max;
        if (!this.pool[j].active) { p = this.pool[j]; this.idx = (j + 1) % this.max; break; }
      }
      if (!p) { p = this.pool[this.idx]; this.idx = (this.idx + 1) % this.max; }
      p.type = "soft"; p.add = false; p.w = 3; p.grav = 0;
      return p;
    },
    spawn: function (x, y, vx, vy, r, grow, life, color, alpha, drag, additive) {
      var p = this.alloc();
      p.active = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
      p.r = r; p.gr = grow == null ? 1 : grow; p.life = life; p.maxLife = life;
      p.color = color; p.alpha = alpha == null ? 0.4 : alpha; p.drag = drag == null ? 0.92 : drag;
      p.add = !!additive;
      return p;
    },
    // additive glow mote
    glow: function (x, y, vx, vy, r, grow, life, color, alpha, drag) {
      return this.spawn(x, y, vx, vy, r, grow, life, color, alpha, drag, true);
    },
    // hot streak that stretches along its velocity
    spark: function (x, y, ang, spd, color, life, width) {
      var p = this.alloc();
      p.active = true; p.type = "spark"; p.add = true;
      p.x = x; p.y = y;
      p.vx = Math.cos(ang) * spd; p.vy = Math.sin(ang) * spd;
      p.r = width == null ? 2.6 : width; p.gr = 1;
      p.life = life == null ? 0.42 : life; p.maxLife = p.life;
      p.color = color; p.alpha = 0.9; p.drag = 0.9; p.grav = 240;
      return p;
    },
    sparkBurst: function (x, y, n, color, spd, life) {
      for (var i = 0; i < n; i++) {
        var a = Math.random() * TAU;
        this.spark(x, y, a, spd * (0.4 + Math.random() * 0.9), color, (life || 0.42) * (0.6 + Math.random() * 0.7));
      }
    },
    // expanding shockwave ring
    ring: function (x, y, color, r0, speed, life, width, additive) {
      var p = this.alloc();
      p.active = true; p.type = "ring"; p.add = additive !== false;
      p.x = x; p.y = y; p.vx = 0; p.vy = 0;
      p.r = r0; p.gr = speed;               // gr = expansion px/s for rings
      p.life = life; p.maxLife = life;
      p.color = color; p.alpha = 0.85; p.drag = 1;
      p.w = width == null ? 5 : width;
      return p;
    },
    burst: function (x, y, n, color, spread, baseR, alpha) {
      n = Math.min(n, 22);
      for (var i = 0; i < n; i++) {
        var a = Math.random() * TAU;
        var s = (0.3 + Math.random()) * spread;
        this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s,
          baseR * (0.6 + Math.random() * 0.8), 1.25, 0.4 + Math.random() * 0.4,
          color, alpha == null ? 0.34 : alpha, 0.9);
      }
    },
    update: function (dt) {
      for (var i = 0; i < this.max; i++) {
        var p = this.pool[i];
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) { p.active = false; continue; }
        if (p.type === "ring") {
          p.r += p.gr * dt;
          continue;
        }
        p.x += p.vx * dt * (p.type === "spark" ? 1 : 60);
        p.y += p.vy * dt * (p.type === "spark" ? 1 : 60);
        if (p.type === "spark") { p.vy += p.grav * dt; }
        p.vx *= p.drag; p.vy *= p.drag;
        if (p.type !== "spark") p.r *= (1 + (p.gr - 1) * dt * 4);
      }
    },
    draw: function (g) {
      g.save();
      for (var i = 0; i < this.max; i++) {
        var p = this.pool[i];
        if (!p.active) continue;
        var t = p.life / p.maxLife;
        if (p.type === "ring") {
          g.globalCompositeOperation = p.add ? "lighter" : "source-over";
          g.globalAlpha = p.alpha * t;
          g.strokeStyle = p.color;
          g.lineWidth = Math.max(1, p.w * t);
          g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.stroke();
        } else if (p.type === "spark") {
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = Math.min(1, p.alpha * t * 1.4);
          g.strokeStyle = p.color;
          g.lineWidth = Math.max(0.8, p.r * t);
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
          g.stroke();
        } else {
          g.globalCompositeOperation = p.add ? "lighter" : "source-over";
          g.globalAlpha = p.alpha * t;
          var img = Fx.dot(p.color);
          g.drawImage(img, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
        }
      }
      g.restore();
    },
    clear: function () { for (var i = 0; i < this.max; i++) this.pool[i].active = false; }
  };

  // ---------------------------------------------------------
  // ART — procedural rigged characters (vector-drawn, animated)
  // Both are drawn facing UP around (0,0). Goose fits a 140-unit
  // box, dragon a 460-unit box; callers scale to gameplay size.
  // ---------------------------------------------------------
  var Art = {
    mixCache: {},
    mix: function (a, b, t) {
      t = Math.max(0, Math.min(1, t));
      var q = (t * 20) | 0;
      var key = a + "|" + b + "|" + q;
      var c = this.mixCache[key];
      if (!c) { c = this.mixCache[key] = Game.mix(a, b, q / 20); }
      return c;
    },

    // ----- GARY THE GOOSE -----
    // o: { flap, bank, hurt, charge, simple }
    goose: function (g, o) {
      var ink = "#2e3a48";
      var hurt = Math.max(0, Math.min(1, o.hurt || 0));
      var CB = hurt ? this.mix("#fdfbf4", "#c25a3a", hurt * 0.6) : "#fdfbf4";   // body
      var CS = hurt ? this.mix("#e8dfc9", "#a84a34", hurt * 0.55) : "#e8dfc9";  // shade
      var CW = hurt ? this.mix("#f6f0dd", "#c05a40", hurt * 0.55) : "#f6f0dd";  // wing
      // plume: a subtle ceremonial wash over the coat (cosmetic only)
      if (o.tint && !hurt) {
        CB = this.mix(CB, o.tint, 0.14);
        CS = this.mix(CS, o.tint, 0.22);
        CW = this.mix(CW, o.tint, 0.18);
      }
      var fl = o.flap || 0;
      var bank = o.bank || 0;

      g.save();
      g.lineJoin = "round"; g.lineCap = "round";

      // ---- wings (under the body), two-joint flap with follow-through ----
      for (var side = -1; side <= 1; side += 2) {
        // clamp the downstroke so the top-down silhouette stays birdlike
        var a = Math.max(-0.45, Math.sin(fl)) - side * bank * 0.5;   // main stroke
        var b = Math.max(-0.5, Math.sin(fl - 0.8)) - side * bank * 0.4; // tip lags
        g.save();
        g.scale(side, 1);
        var tipX = 52 + a * 7, tipY = -16 - a * 24;
        var trX = 38, trY = 14 - b * 12;
        g.beginPath();
        g.moveTo(8, -12);
        g.bezierCurveTo(24, -26 - a * 12, 42, tipY - 4, tipX, tipY);
        g.bezierCurveTo(tipX - 3, tipY + 12, trX + 12, trY - 6, trX, trY);
        g.bezierCurveTo(26, 24 - b * 6, 14, 20, 6, 12);
        g.closePath();
        var wg = g.createLinearGradient(8, -4, tipX, tipY + 8);
        wg.addColorStop(0, CW);
        wg.addColorStop(1, CS);
        g.fillStyle = wg;
        g.fill();
        g.strokeStyle = ink; g.globalAlpha = 0.7; g.lineWidth = 2; g.stroke();
        // primary feather chords running back toward the shoulder
        if (!o.simple) {
          g.globalAlpha = 0.26; g.lineWidth = 1.3;
          g.beginPath();
          g.moveTo(tipX - 4, tipY + 7);
          g.quadraticCurveTo((tipX + 16) / 2, (tipY + 12) / 2 + 4, 16, 2);
          g.moveTo(tipX - 8, tipY + 14);
          g.quadraticCurveTo((tipX + 18) / 2, (tipY + 22) / 2 + 6, 15, 7);
          g.stroke();
        }
        g.globalAlpha = 1;
        g.restore();
      }

      // ---- tail fan ----
      g.beginPath();
      g.moveTo(-9, 22);
      g.quadraticCurveTo(-8, 40, 0, 46);
      g.quadraticCurveTo(8, 40, 9, 22);
      g.closePath();
      g.fillStyle = CS; g.fill();
      g.strokeStyle = ink; g.globalAlpha = 0.65; g.lineWidth = 2; g.stroke();
      g.globalAlpha = 1;

      // REGALIA: Tempest's Spade — a storm-blue dragon spade past the tail fan
      if (o.gear && o.gear.spade) {
        g.strokeStyle = ink; g.globalAlpha = 0.7; g.lineWidth = 2.4;
        g.beginPath(); g.moveTo(0, 44); g.lineTo(0, 52); g.stroke();
        g.globalAlpha = 1;
        g.beginPath();
        g.moveTo(0, 50);
        g.quadraticCurveTo(6.5, 55, 0, 64);
        g.quadraticCurveTo(-6.5, 55, 0, 50);
        g.closePath();
        g.fillStyle = "#4f6d94"; g.fill();
        g.strokeStyle = ink; g.globalAlpha = 0.7; g.lineWidth = 1.8; g.stroke();
        g.globalAlpha = 0.5; g.strokeStyle = "#bfe3ff"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, 52); g.lineTo(0, 61); g.stroke();
        g.globalAlpha = 1;
      }

      // ---- body: teardrop with soft keel shading ----
      g.beginPath();
      g.moveTo(0, -26);
      g.bezierCurveTo(15, -24, 22, -6, 20, 10);
      g.bezierCurveTo(18, 27, 8, 33, 0, 33);
      g.bezierCurveTo(-8, 33, -18, 27, -20, 10);
      g.bezierCurveTo(-22, -6, -15, -24, 0, -26);
      g.closePath();
      var bgd = g.createLinearGradient(-18, -14, 16, 28);
      bgd.addColorStop(0, CB); bgd.addColorStop(1, CS);
      g.fillStyle = bgd; g.fill();
      g.strokeStyle = ink; g.globalAlpha = 0.78; g.lineWidth = 2.2; g.stroke();
      g.globalAlpha = 1;
      // folded-feather linework along the back
      if (!o.simple) {
        g.globalAlpha = 0.22; g.strokeStyle = ink; g.lineWidth = 1.3;
        g.beginPath(); g.moveTo(0, -16); g.quadraticCurveTo(2, 6, 0, 26); g.stroke();
        g.beginPath(); g.moveTo(-8, -12); g.quadraticCurveTo(-10, 6, -6, 24); g.stroke();
        g.beginPath(); g.moveTo(8, -12); g.quadraticCurveTo(10, 6, 6, 24); g.stroke();
        g.globalAlpha = 1;
      }

      // REGALIA: Sorrel's Mantle — a leaf-woven collar over the shoulders
      if (o.gear && o.gear.mantle) {
        for (var ls = -1; ls <= 1; ls += 2) {
          for (var li = 0; li < 2; li++) {
            g.save();
            g.translate(ls * (7 + li * 6), -16 + li * 5);
            g.rotate(ls * (0.5 + li * 0.35));
            g.beginPath();
            g.moveTo(0, -7);
            g.quadraticCurveTo(5.5, -2, 0, 8);
            g.quadraticCurveTo(-5.5, -2, 0, -7);
            g.closePath();
            g.fillStyle = li === 0 ? "#93b48b" : "#7a9a6f";
            g.globalAlpha = 0.92; g.fill();
            g.strokeStyle = ink; g.globalAlpha = 0.45; g.lineWidth = 1.2; g.stroke();
            g.globalAlpha = 0.4; g.strokeStyle = "#42603d"; g.lineWidth = 0.9;
            g.beginPath(); g.moveTo(0, -5); g.lineTo(0, 6); g.stroke();
            g.globalAlpha = 1;
            g.restore();
          }
        }
      }

      // ---- neck (ink under-stroke = outline) + head ----
      g.strokeStyle = ink; g.lineWidth = 11.5; g.globalAlpha = 0.8;
      g.beginPath(); g.moveTo(0, -18); g.lineTo(0, -38); g.stroke();
      g.globalAlpha = 1;
      g.strokeStyle = CB; g.lineWidth = 8;
      g.beginPath(); g.moveTo(0, -17); g.lineTo(0, -38); g.stroke();

      g.save();
      g.translate(0, -43);
      // REGALIA: Ember's Horns — backswept cinder-bone horns behind the skull
      if (o.gear && o.gear.horns) {
        for (var hs = -1; hs <= 1; hs += 2) {
          g.beginPath();
          g.moveTo(hs * 5.5, -3);
          g.quadraticCurveTo(hs * 14, 0, hs * 17, 9);
          g.quadraticCurveTo(hs * 11.5, 6.5, hs * 7.5, 3.5);
          g.closePath();
          g.fillStyle = "#ead9a4"; g.fill();
          g.strokeStyle = "#b6a06a"; g.globalAlpha = 0.9; g.lineWidth = 1.4; g.stroke();
          g.globalAlpha = 1;
        }
      }
      g.scale(0.92, 1);
      g.beginPath(); g.arc(0, 0, 9.5, 0, TAU);
      g.fillStyle = CB; g.fill();
      g.strokeStyle = ink; g.globalAlpha = 0.8; g.lineWidth = 2; g.stroke();
      g.globalAlpha = 1;
      g.restore();
      // REGALIA: Dusk Cowl — a twilight hood draped over the back of the head
      if (o.gear && o.gear.cowl) {
        g.save();
        g.translate(0, -43);
        g.beginPath();
        g.arc(0, 0, 11.2, -0.12 * Math.PI, 1.12 * Math.PI);       // outer drape
        g.arc(0, -1.6, 7.6, 1.04 * Math.PI, -0.04 * Math.PI, true); // hood opening
        g.closePath();
        g.fillStyle = "#5d4f86"; g.globalAlpha = 0.92; g.fill();
        g.strokeStyle = ink; g.globalAlpha = 0.55; g.lineWidth = 1.4; g.stroke();
        // a soft violet sheen along the rim of the hood
        g.globalAlpha = 0.5; g.strokeStyle = "#cbb8e8"; g.lineWidth = 1;
        g.beginPath(); g.arc(0, 0, 9.4, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();
        g.globalAlpha = 1;
        g.restore();
      }
      // REGALIA: Gilded Crest — a small gold circlet seen from above
      if (o.gear && o.gear.crest) {
        g.save();
        g.translate(0, -43);
        g.strokeStyle = "#cdb878"; g.lineWidth = 2.2; g.globalAlpha = 0.95;
        g.beginPath(); g.arc(0, 0, 6.4, 0, TAU); g.stroke();
        g.fillStyle = "#f6ecd0";
        for (var cp = 0; cp < 5; cp++) {
          var ca3 = -Math.PI / 2 + cp * (TAU / 5);
          g.beginPath(); g.arc(Math.cos(ca3) * 6.4, Math.sin(ca3) * 6.4, 1.5, 0, TAU); g.fill();
        }
        g.strokeStyle = "#8a6c30"; g.globalAlpha = 0.55; g.lineWidth = 0.9;
        g.beginPath(); g.arc(0, 0, 6.4, 0, TAU); g.stroke();
        g.globalAlpha = 1;
        g.restore();
      }
      // beak: broad wedge with a nail line
      g.beginPath();
      g.moveTo(-5, -49.5);
      g.quadraticCurveTo(-3.5, -57, 0, -58.5);
      g.quadraticCurveTo(3.5, -57, 5, -49.5);
      g.quadraticCurveTo(0, -46.5, -5, -49.5);
      g.closePath();
      g.fillStyle = "#e8a13c"; g.fill();
      g.strokeStyle = "#a86a20"; g.lineWidth = 1.3; g.globalAlpha = 0.85; g.stroke();
      g.globalAlpha = 1;
      if (!o.simple) {
        g.strokeStyle = "#a86a20"; g.globalAlpha = 0.6; g.lineWidth = 1;
        g.beginPath(); g.moveTo(-2.4, -55.4); g.quadraticCurveTo(0, -56.6, 2.4, -55.4); g.stroke();
        g.globalAlpha = 1;
        // eyes set to the sides of the skull
        g.fillStyle = ink;
        g.beginPath(); g.arc(-5.4, -44.5, 1.7, 0, TAU); g.fill();
        g.beginPath(); g.arc(5.4, -44.5, 1.7, 0, TAU); g.fill();
      }
      // CROWNED: a tiny three-point gold circlet resting just above the eyes
      // (drawn last so it sits atop the head — the highest point from above)
      if (o.gear && o.gear.crown) {
        g.save();
        g.translate(0, -46.5);
        g.beginPath();
        g.moveTo(-5, 1.6);
        g.bezierCurveTo(-2.6, 0.4, 2.6, 0.4, 5, 1.6);  // rim curves with the skull
        g.lineTo(4.5, -0.7);
        g.lineTo(3.2, -3.3);   // right point
        g.lineTo(1.9, -0.9);
        g.lineTo(0, -4.4);     // center point
        g.lineTo(-1.9, -0.9);
        g.lineTo(-3.2, -3.3);  // left point
        g.lineTo(-4.5, -0.7);
        g.closePath();
        g.fillStyle = "#cdb878"; g.globalAlpha = 0.95; g.fill();
        g.strokeStyle = "#a8863c"; g.globalAlpha = 0.8; g.lineWidth = 1; g.stroke();
        // a single soft gleam on the band
        g.globalAlpha = 0.85; g.fillStyle = "#f6ecd0";
        g.beginPath(); g.arc(0, 0.4, 0.8, 0, TAU); g.fill();
        g.globalAlpha = 1;
        g.restore();
      }
      // dragonfire smolders in his beak while charging
      if (o.charge > 0.01) {
        Fx.drawDot(g, 0, -56, 9 + o.charge * 10, PAL.ember, 0.3 + o.charge * 0.45, true);
      }
      g.restore();
    },

    // ----- THE DRAGONS -----
    dragonPal: {
      ember: { hi: "#e89058", lo: "#b04830", belly: "#f2c68c", memHi: "#d96a45", memLo: "#8e2f24", bone: "#ead9a4", boneTip: "#b6a06a", eye: "#ffd97a", spade: "#a83a54", vein: "#d98ba0" },
      storm: { hi: "#7fa8c9", lo: "#3d6288", belly: "#d3e2ef", memHi: "#5f86ab", memLo: "#2e4d6e", bone: "#dbe6f0", boneTip: "#8fa6bd", eye: "#bfe3ff", spade: "#4f6d94", vein: "#a292c4" },
      verdant: { hi: "#93b48b", lo: "#597a52", belly: "#e9efdb", memHi: "#7a9a6f", memLo: "#42603d", bone: "#e3e8cf", boneTip: "#9aa87f", eye: "#e5f0a8", spade: "#6e8a4f", vein: "#cdb878" },
      gilded: { hi: "#d9b96a", lo: "#a8863c", belly: "#f6ecd0", memHi: "#c2a052", memLo: "#7c6128", bone: "#f2e6c4", boneTip: "#b3903f", eye: "#fff3c4", spade: "#b3903f", vein: "#cdb878" },
      umbra: { hi: "#8a7bb0", lo: "#4a3f6e", belly: "#d8d2e8", memHi: "#6d5f96", memLo: "#362d54", bone: "#d5cde6", boneTip: "#8d80ab", eye: "#e6d8ff", spade: "#5d4f86", vein: "#a292c4" }
    },
    // o: { t, swayPhase, flapPhase, phase2, flash, bow, variant, simple }
    dragon: function (g, o) {
      var ink = "#26313f";
      var P0 = this.dragonPal[o.variant] || this.dragonPal.ember;
      var flash = Math.max(0, Math.min(1, o.flash || 0));
      var self = this;
      var col = function (c) { return flash > 0 ? self.mix(c, "#fbf7ee", flash) : c; };
      var sway = o.swayPhase || 0;
      var fl = o.flapPhase || 0;
      var bow = Math.max(0, Math.min(1, o.bow || 0));
      var wingK = Math.sin(fl) * (1 - bow * 0.85);
      var billow = Math.sin(fl - 0.9) * (1 - bow * 0.85);
      var i, side;

      // serpentine body chain: head end steady, tail whips
      // (denser segments = smooth taper, no michelin bumps)
      var n = 11, segs = [];
      for (i = 0; i < n; i++) {
        var ti = i / (n - 1);
        segs.push({
          x: Math.sin(sway + ti * 5.1) * (1.5 + ti * ti * 30) * 0.55,
          y: -64 + i * 24,
          r: 34 - ti * 23
        });
      }

      g.save();
      g.lineJoin = "round"; g.lineCap = "round";

      // ---- wings (under the body): swept bat wings, scalloped membrane ----
      for (side = -1; side <= 1; side += 2) {
        g.save();
        g.scale(side, 1);
        if (bow > 0) { g.translate(24, -42); g.scale(1 - bow * 0.32, 1); g.translate(-24, 42); }
        var S = { x: 24, y: -42 };                                 // shoulder
        var E = { x: 108, y: -96 + wingK * 30 };                   // elbow
        var W = { x: 172, y: -70 + wingK * 48 };                   // wrist
        var F1 = { x: 230 - Math.abs(wingK) * 10, y: -28 + wingK * 62 }; // leading finger tip
        var F2 = { x: 202 - Math.abs(wingK) * 8, y: 42 + wingK * 34 };
        var F3 = { x: 134, y: 86 + wingK * 16 };
        var Tb = { x: 12, y: 74 };                                 // hip root
        // deep concave scallops between finger tips (pulled toward wrist)
        var sc1 = { x: (F1.x + F2.x) / 2 - 34, y: (F1.y + F2.y) / 2 - 10 + billow * 16 };
        var sc2 = { x: (F2.x + F3.x) / 2 - 38, y: (F2.y + F3.y) / 2 - 12 + billow * 12 };
        var sc3 = { x: (F3.x + Tb.x) / 2 - 18, y: (F3.y + Tb.y) / 2 - 16 + billow * 8 };
        // membrane
        g.beginPath();
        g.moveTo(S.x, S.y);
        g.quadraticCurveTo((S.x + E.x) / 2 + 6, S.y - 34 + wingK * 9, E.x, E.y);
        g.quadraticCurveTo((E.x + W.x) / 2 + 8, (E.y + W.y) / 2 - 14, W.x, W.y);
        g.lineTo(F1.x, F1.y);
        g.quadraticCurveTo(sc1.x, sc1.y, F2.x, F2.y);
        g.quadraticCurveTo(sc2.x, sc2.y, F3.x, F3.y);
        g.quadraticCurveTo(sc3.x, sc3.y, Tb.x, Tb.y);
        g.closePath();
        var mg = g.createLinearGradient(S.x, S.y - 20, F1.x, F2.y);
        mg.addColorStop(0, col(P0.memHi));
        mg.addColorStop(1, col(P0.memLo));
        g.fillStyle = mg;
        g.globalAlpha = 0.96;
        g.fill();
        g.strokeStyle = ink; g.lineWidth = 3; g.globalAlpha = 0.75; g.stroke();
        g.globalAlpha = 1;

        // wing bones: arm, then three membrane fingers
        g.strokeStyle = col(P0.lo);
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(S.x, S.y);
        g.quadraticCurveTo((S.x + E.x) / 2 + 6, S.y - 28 + wingK * 9, E.x, E.y);
        g.quadraticCurveTo((E.x + W.x) / 2 + 8, (E.y + W.y) / 2 - 14, W.x, W.y);
        g.stroke();
        g.lineWidth = 4;
        g.beginPath(); g.moveTo(W.x, W.y); g.lineTo(F1.x, F1.y); g.stroke();
        g.lineWidth = 3.2;
        g.beginPath(); g.moveTo(W.x, W.y); g.quadraticCurveTo((W.x + F2.x) / 2 + 10, (W.y + F2.y) / 2, F2.x, F2.y); g.stroke();
        g.beginPath(); g.moveTo(W.x, W.y); g.quadraticCurveTo((W.x + F3.x) / 2 + 2, (W.y + F3.y) / 2, F3.x, F3.y); g.stroke();
        // wrist talon
        g.fillStyle = col(P0.bone);
        g.beginPath();
        g.moveTo(W.x - 3, W.y - 6);
        g.lineTo(W.x + 13, W.y - 20);
        g.lineTo(W.x + 6, W.y - 1);
        g.closePath();
        g.fill();

        // enraged: membrane veins glow
        if (o.phase2 && flash <= 0) {
          g.save();
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = 0.3 + 0.2 * Math.sin((o.t || 0) * 6);
          g.strokeStyle = P0.vein;
          g.lineWidth = 2.4;
          g.beginPath(); g.moveTo(W.x, W.y); g.lineTo(F1.x, F1.y); g.stroke();
          g.beginPath(); g.moveTo(W.x, W.y); g.quadraticCurveTo((W.x + F2.x) / 2 + 10, (W.y + F2.y) / 2, F2.x, F2.y); g.stroke();
          g.beginPath(); g.moveTo(W.x, W.y); g.quadraticCurveTo((W.x + F3.x) / 2 + 2, (W.y + F3.y) / 2, F3.x, F3.y); g.stroke();
          g.restore();
        }
        g.restore();
      }

      // ---- tail spade ----
      var tEnd = segs[n - 1], tPrev = segs[n - 2];
      var ta = Math.atan2(tEnd.y - tPrev.y, tEnd.x - tPrev.x);
      g.save();
      g.translate(tEnd.x, tEnd.y);
      g.rotate(ta - Math.PI / 2);
      g.beginPath();
      g.moveTo(0, 2);
      g.quadraticCurveTo(-17, 14, 0, 38);
      g.quadraticCurveTo(17, 14, 0, 2);
      g.closePath();
      g.fillStyle = col(P0.spade); g.fill();
      g.strokeStyle = ink; g.lineWidth = 2.6; g.globalAlpha = 0.75; g.stroke();
      g.globalAlpha = 1;
      g.restore();

      // ---- body: smooth tapered strokes (ink silhouette underneath) ----
      var strokeChain = function (pad) {
        for (var j = 0; j < n - 1; j++) {
          g.lineWidth = (segs[j].r + segs[j + 1].r) + pad * 2;
          g.beginPath();
          g.moveTo(segs[j].x, segs[j].y);
          g.lineTo(segs[j + 1].x, segs[j + 1].y);
          g.stroke();
        }
      };
      g.globalAlpha = 0.8; g.strokeStyle = ink;
      strokeChain(2.4);
      g.globalAlpha = 1;
      var bodyGrad = g.createLinearGradient(0, -100, 0, 190);
      bodyGrad.addColorStop(0, col(P0.hi));
      bodyGrad.addColorStop(1, col(P0.lo));
      g.strokeStyle = bodyGrad;
      strokeChain(0);
      // subtle belly keel (narrow, close in tone, fades toward the tail)
      g.strokeStyle = col(P0.belly);
      g.globalAlpha = 0.55;
      for (i = 0; i < n - 2; i++) {
        g.lineWidth = segs[i].r * 0.55;
        g.beginPath(); g.moveTo(segs[i].x, segs[i].y); g.lineTo(segs[i + 1].x, segs[i + 1].y); g.stroke();
      }
      g.globalAlpha = 1;
      // scale seams across the back
      if (!o.simple) {
        g.strokeStyle = ink; g.globalAlpha = 0.18; g.lineWidth = 2;
        for (i = 1; i < n - 1; i += 2) {
          var mx = (segs[i - 1].x + segs[i].x) / 2, my = (segs[i - 1].y + segs[i].y) / 2;
          var pw = segs[i].r * 0.55;
          g.beginPath(); g.moveTo(mx - pw, my); g.quadraticCurveTo(mx, my + 6, mx + pw, my); g.stroke();
        }
        g.globalAlpha = 1;
      }
      // spine studs marching down the tail, shrinking as they go
      g.fillStyle = col(P0.bone);
      for (i = 1; i < n - 1; i += 1) {
        var rx = segs[i].x, ry = segs[i].y + segs[i].r * 0.05;
        var rs = segs[i].r * 0.24;
        g.beginPath();
        g.moveTo(rx - rs, ry);
        g.lineTo(rx, ry - rs * 1.1);
        g.lineTo(rx + rs, ry);
        g.lineTo(rx, ry + rs * 1.6);
        g.closePath();
        g.fill();
      }

      // ---- head: arrow-shaped skull, backswept horns ----
      g.save();
      g.translate(segs[0].x * 0.6, -102 + bow * 20);
      g.scale(1.22, 1.22);
      if (bow > 0) g.rotate(bow * 0.1);
      // horns sweep back past the shoulders (behind the skull)
      for (side = -1; side <= 1; side += 2) {
        g.beginPath();
        g.moveTo(side * 9, -17);
        g.quadraticCurveTo(side * 36, -12, side * 50, 26);
        g.quadraticCurveTo(side * 28, 4, side * 14, -1);
        g.closePath();
        var hg = g.createLinearGradient(side * 10, -14, side * 48, 24);
        hg.addColorStop(0, col(P0.bone)); hg.addColorStop(1, col(P0.boneTip));
        g.fillStyle = hg; g.fill();
        g.strokeStyle = ink; g.lineWidth = 2; g.globalAlpha = 0.7; g.stroke();
        g.globalAlpha = 1;
        // short secondary spike
        g.beginPath();
        g.moveTo(side * 16, -6);
        g.quadraticCurveTo(side * 30, -8, side * 34, 8);
        g.quadraticCurveTo(side * 24, 0, side * 15, 2);
        g.closePath();
        g.fillStyle = col(P0.boneTip); g.fill();
      }
      // skull: tapered arrow — wide cheekbones, narrow snout
      g.beginPath();
      g.moveTo(0, -32);
      g.bezierCurveTo(7, -31, 13, -24, 18, -12);
      g.bezierCurveTo(22, -3, 21, 6, 14, 11);
      g.quadraticCurveTo(7, 15, 0, 15.5);
      g.quadraticCurveTo(-7, 15, -14, 11);
      g.bezierCurveTo(-21, 6, -22, -3, -18, -12);
      g.bezierCurveTo(-13, -24, -7, -31, 0, -32);
      g.closePath();
      var sg2 = g.createLinearGradient(0, -32, 0, 16);
      sg2.addColorStop(0, col(P0.hi)); sg2.addColorStop(1, col(P0.lo));
      g.fillStyle = sg2; g.fill();
      g.strokeStyle = ink; g.lineWidth = 2.4; g.globalAlpha = 0.8; g.stroke();
      g.globalAlpha = 1;
      // cheek spikes flaring from the jaw
      for (side = -1; side <= 1; side += 2) {
        g.beginPath();
        g.moveTo(side * 15, 3);
        g.lineTo(side * 28, 12);
        g.lineTo(side * 13, 12);
        g.closePath();
        g.fillStyle = col(P0.boneTip); g.fill();
        g.strokeStyle = ink; g.lineWidth = 1.4; g.globalAlpha = 0.5; g.stroke();
        g.globalAlpha = 1;
      }
      // snout ridge
      g.fillStyle = col(P0.boneTip);
      g.beginPath();
      g.moveTo(-3, -24); g.lineTo(0, -31); g.lineTo(3, -24); g.lineTo(0, -18);
      g.closePath(); g.fill();
      // eyes: sharp upswept molten wedges under a hard brow slash
      var eyeGlow = bow > 0 ? 0.3 : (o.phase2 ? 0.9 : 0.55);
      var eyeR = o.phase2 ? 15 : 11;
      for (side = -1; side <= 1; side += 2) {
        var ex = side * 10, ey = -11;
        Fx.drawDot(g, ex, ey - 1, eyeR, P0.eye, eyeGlow, true);
        g.save();
        g.translate(ex, ey);
        g.scale(side, 1);
        g.beginPath();
        g.moveTo(-6.5, 2.2);
        g.quadraticCurveTo(-1, -2, 7.5, -5);   // upswept to a point
        g.quadraticCurveTo(0.5, 3.6, -6.5, 2.2);
        g.closePath();
        g.fillStyle = bow > 0 ? this.mix(P0.eye, "#ffffff", 0.35) : P0.eye;
        g.fill();
        g.strokeStyle = ink; g.lineWidth = 1.4; g.globalAlpha = 0.9; g.stroke();
        g.globalAlpha = 1;
        // hot core of the eye
        Fx.drawDot(g, 0, -0.6, 3.4, "#fff6d8", 0.85, true);
        // brow: straight angry slash, inner end low
        g.strokeStyle = ink; g.globalAlpha = 0.85; g.lineWidth = 3; g.lineCap = "round";
        g.beginPath();
        g.moveTo(-8, -1.5);
        g.lineTo(7, -8.5);
        g.stroke();
        g.globalAlpha = 1;
        g.restore();
      }
      // nostrils: slanted slashes venting heat
      g.strokeStyle = ink; g.globalAlpha = 0.7; g.lineWidth = 1.6; g.lineCap = "round";
      g.beginPath();
      g.moveTo(-3.6, -23.5); g.lineTo(-2, -26.5);
      g.moveTo(3.6, -23.5); g.lineTo(2, -26.5);
      g.stroke();
      g.globalAlpha = 1;
      g.restore();

      g.restore();
    }
  };

  // ---------------------------------------------------------
  // PROJECTILE POOL
  // ---------------------------------------------------------
  function makeProjPool(max) {
    var pool = [];
    for (var i = 0; i < max; i++) pool.push({ active: false });
    return {
      pool: pool, max: max,
      spawn: function (cfg) {
        for (var i = 0; i < this.max; i++) {
          var p = this.pool[i];
          if (!p.active) {
            p.active = true; p.x = cfg.x; p.y = cfg.y; p.vx = cfg.vx; p.vy = cfg.vy;
            p.r = cfg.r; p.dmg = cfg.dmg; p.life = cfg.life; p.color = cfg.color;
            p.rot = cfg.rot || 0; p.spin = cfg.spin || 0; p.kind = cfg.kind || "fire";
            p.grav = cfg.grav || 0;
            p.curve = cfg.curve || 0;
            p.power = cfg.power || null;
            p.seed = Math.random() * TAU;
            if (p.trail) p.trail.length = 0; else p.trail = [];
            return p;
          }
        }
        return null;
      },
      forEach: function (fn) { for (var i = 0; i < this.max; i++) if (this.pool[i].active) fn(this.pool[i]); },
      clear: function () { for (var i = 0; i < this.max; i++) this.pool[i].active = false; }
    };
  }
  var PlayerShots = makeProjPool(48);
  var DragonShots = makeProjPool(80);

  // ---------------------------------------------------------
  // PICKUPS (scales)
  // ---------------------------------------------------------
  var Pickups = { list: [], clear: function () { this.list.length = 0; } };

  // ---------------------------------------------------------
  // POWERS (the no-stats ability system)
  // ---------------------------------------------------------
  var POWERS = {
    stormDodge: { name: "Storm Dodge", glyph: "⚡", desc: "Dodging unleashes a burst of lightning bolts." },
    emberWake: { name: "Ember Wake", glyph: "🔥", desc: "Your first shot after a dodge becomes a searing big blast." },
    velocity: { name: "Tailwind Fury", glyph: "💨", desc: "The faster you fly, the harder your fireballs hit." },
    reflect: { name: "Mirror Plume", glyph: "✨", desc: "Reflect a shard of damage back when you are struck." },
    split: { name: "Forked Flame", glyph: "🔱", desc: "Fireballs split into two on release." }
  };
  var RELICS = {
    emberHeart: { name: "Heart of Ember", glyph: "❤️‍🔥", desc: "Begin each run with one extra feather of health." },
    cinderGift: { name: "Cinder's Gift", glyph: "🔥", desc: "Begin each run already wielding Ember Wake." },
    galeFeather: { name: "Gale Feather", glyph: "🪶", desc: "Your dodge recovers in half the time." },
    stormGift: { name: "Tempest's Gift", glyph: "⚡", desc: "Begin each run already wielding Storm Dodge." },
    thistleDown: { name: "Thistle Down", glyph: "🌾", desc: "Fallen scales drift to you from much farther away." },
    verdantGift: { name: "Sorrel's Gift", glyph: "🌿", desc: "Begin each run already wielding Forked Flame." },
    gildedHeart: { name: "Gilded Heart", glyph: "🥇", desc: "Begin each run with your charge igniting 25% faster." },
    gildedGift: { name: "Aurelia's Gift", glyph: "🪙", desc: "Begin each run already wielding Tailwind Fury." },
    duskHeart: { name: "Dusk Heart", glyph: "🌙", desc: "Begin each run with your dodge granting 0.15s longer i-frames." },
    umbraGift: { name: "Umbra's Gift", glyph: "🌌", desc: "Begin each run already wielding Mirror Plume." }
  };
  // each dragon's two relics: the common heart + the ≥N-scales gift —
  // once BOTH are yours, repeat victories reach deeper into the hoard
  var DRAGON_RELICS = {
    ember: ["emberHeart", "cinderGift"],
    storm: ["galeFeather", "stormGift"],
    verdant: ["thistleDown", "verdantGift"],
    gilded: ["gildedHeart", "gildedGift"],
    umbra: ["duskHeart", "umbraGift"]
  };

  // gifts from the hoard: rarer trinkets offered on repeat victories once a
  // dragon's relics are already yours — tiny keepsakes (cosmetic or a
  // whisper of a perk), never a new system; granted in order, then the
  // dragon shares scales instead
  var TRINKETS = {
    cinderBell: { name: "Cinder Bell", glyph: "🔔", dragon: "ember", desc: "A tiny bell of cinder-glass — realms at peace chime softly as you pass their calm rings." },
    warmDownfeather: { name: "Warm Downfeather", glyph: "🕊️", dragon: "ember", desc: "A downfeather still warm from Ember's hearth — begin each run with one extra feather." },
    chargedQuill: { name: "Charged Quill", glyph: "✒️", dragon: "storm", desc: "A quill that never quite stopped storming — your dragonfire leaves a faint trail of sparks." },
    weathervane: { name: "Weathervane", glyph: "🧭", dragon: "storm", desc: "A weathervane no bigger than a thumbnail — an unbowed realm's ring glints when you face it." },
    pressedMeadowsweet: { name: "Pressed Meadowsweet", glyph: "🌸", dragon: "verdant", desc: "A sprig of meadowsweet pressed flat under one wing — petals drift loose in the open sky." },
    dewdropPhial: { name: "Dewdrop Phial", glyph: "💧", dragon: "verdant", desc: "A dewdrop kept cool in glass — preening between duels restores one extra feather." },
    luckyCoin: { name: "Aurelia's Lucky Coin", glyph: "🌟", dragon: "gilded", desc: "A small coin tucked beneath one wing — now and then it catches the sun in the open sky." },
    burnishedPinfeather: { name: "Burnished Pinfeather", glyph: "🏵️", dragon: "gilded", desc: "A pinfeather burnished to a mirror shine — lustrous scales gleam one scale brighter." },
    duskMoth: { name: "Dusk Moth", glyph: "🦋", dragon: "umbra", desc: "A pale moth that mistook you for the moon — it keeps you company in the open sky." },
    hushBead: { name: "Hush Bead", glyph: "📿", dragon: "umbra", desc: "A bead of bottled dusk — your dodge holds its hush a breath longer." }
  };
  // grant order per dragon: first repeat victory → first trinket, second →
  // second, later wins bank +2 bonus scales instead
  var DRAGON_TRINKETS = {
    ember: ["cinderBell", "warmDownfeather"],
    storm: ["chargedQuill", "weathervane"],
    verdant: ["pressedMeadowsweet", "dewdropPhial"],
    gilded: ["luckyCoin", "burnishedPinfeather"],
    umbra: ["duskMoth", "hushBead"]
  };

  // ceremonial-duel trophies: cosmetic washes for Gary's coat (no power)
  var PLUMES = {
    cinderPlume: { name: "Cinder Plume", glyph: "🌹", color: "#d98ba0", desc: "Gary wears a rose-washed coat, a gift of Ember's ceremony." },
    tempestPlume: { name: "Tempest Plume", glyph: "🌀", color: "#7fa8c9", desc: "Gary wears a storm-blue coat, a gift of Tempest's ceremony." },
    sorrelPlume: { name: "Sorrel Plume", glyph: "🍃", color: "#93b48b", desc: "Gary wears a moss-green coat, a gift of Sorrel's ceremony." },
    gildedPlume: { name: "Gilded Plume", glyph: "✨", color: "#cdb878", desc: "Gary wears a gold-washed coat, a gift of Aurelia's ceremony." },
    duskPlume: { name: "Dusk Plume", glyph: "🌆", color: "#8a7bb0", desc: "Gary wears a twilight-violet coat, a gift of Umbra's ceremony." }
  };
  var DRAGON_PLUME = { ember: "cinderPlume", storm: "tempestPlume", verdant: "sorrelPlume", gilded: "gildedPlume", umbra: "duskPlume" };

  // regalia: hoard equipment that changes Gary's silhouette AND his fight
  // (earned at the second ceremonial victory against each dragon)
  var REGALIA = {
    emberHorns: { name: "Ember's Horns", glyph: "🐏", dragon: "ember", desc: "Backswept horns of cinder-bone — your dodge dash now rams dragons for damage." },
    tempestSpade: { name: "Tempest's Spade", glyph: "🌩️", dragon: "storm", desc: "A storm-forged tail spade — fully charged shots loose a rearward fan of lightning." },
    sorrelMantle: { name: "Sorrel's Mantle", glyph: "🍂", dragon: "verdant", desc: "A leaf-woven mantle — it slowly grows a ward that blocks one hit." },
    gildedCrest: { name: "Gilded Crest", glyph: "👑", dragon: "gilded", desc: "A gilded crest — scales are worth double while your health is full." },
    duskCowl: { name: "Dusk Cowl", glyph: "🦇", dragon: "umbra", desc: "A cowl of dusk — dodging leaves a shadow decoy that draws the next aimed attack." }
  };
  var DRAGON_REGALIA = { ember: "emberHorns", storm: "tempestSpade", verdant: "sorrelMantle", gilded: "gildedCrest", umbra: "duskCowl" };
  // every attack in the game, for ceremonial cross-kit stealing
  var ALL_ATTACKS = ["volley", "aimed", "breath", "fan", "lance", "nova", "spiral", "seeds", "lures", "ray", "coins", "veil", "echoes", "crescent"];
  var BASE_KIT = {
    ember: ["volley", "aimed", "breath"],
    storm: ["fan", "lance", "nova"],
    verdant: ["spiral", "seeds"],
    gilded: ["lures", "ray", "coins"],
    umbra: ["veil", "echoes", "crescent"]
  };

  // the gauntlet: dragons faced in order within a single run
  var RUN_BOSSES = ["ember", "storm", "verdant", "gilded", "umbra"];
  var DRAGONS = {
    ember: { name: "Ember, the Cinder Wyrm", health: 100, roamSpeed: 105, enragedSpeed: 150 },
    storm: { name: "Tempest, the Storm Wyrm", health: 115, roamSpeed: 120, enragedSpeed: 170 },
    verdant: { name: "Sorrel, the Verdant Wyrm", health: 130, roamSpeed: 112, enragedSpeed: 160 },
    gilded: { name: "Aurelia, the Gilded Wyrm", health: 145, roamSpeed: 110, enragedSpeed: 165 },
    umbra: { name: "Umbra, the Dusk Wyrm", health: 160, roamSpeed: 118, enragedSpeed: 172 }
  };

  // ---------------------------------------------------------
  // GAME OBJECT
  // ---------------------------------------------------------
  var Game = {
    state: "LOADING",
    time: 0,
    shake: 0,
    hitStop: 0,
    muted: false,
    bg: { clouds: [], washPhase: 0 },
    player: null,
    dragon: null,
    daily: null,              // Daily Flight state {date, route, idx, mod} or null
    tk: null,                 // cached owned-trinket flags (refreshTrinkets)
    scaleProgress: 0,         // scales collected this run
    nextPowerAt: 3,           // scales needed for next power
    powers: {},               // active power flags
    floatLayer: null,
    flashRed: 0,
    flashWhite: 0,

    // ----- INIT -----
    init: function () {
      this.floatLayer = document.createElement("div");
      this.floatLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:13;overflow:hidden;";
      root.appendChild(this.floatLayer);

      Save.load();
      Fx.init();
      Particles.init();
      Input.init();
      this.muted = false;
      this.initClouds();
      this.bindUI();
      this.resize();
      window.addEventListener("resize", this.resize.bind(this));
      window.addEventListener("orientationchange", this.resize.bind(this));
      document.addEventListener("visibilitychange", function () {
        if (document.hidden && Game.state === "PLAYING") Game.togglePause(true);
      });
    },

    initClouds: function () {
      this.bg.clouds.length = 0;
      var layers = [
        { depth: 0.25, count: 4, scale: 1.7, alpha: 0.26 },
        { depth: 0.5, count: 3, scale: 1.15, alpha: 0.38 },
        { depth: 0.85, count: 3, scale: 0.8, alpha: 0.52 }
      ];
      for (var L = 0; L < layers.length; L++) {
        var ly = layers[L];
        for (var i = 0; i < ly.count; i++) {
          this.bg.clouds.push({
            x: Math.random() * VW,
            y: Math.random() * (VH + 300) - 150,
            depth: ly.depth, scale: ly.scale * (0.7 + Math.random() * 0.6),
            alpha: ly.alpha, speed: 8 + ly.depth * 26,
            variant: (Math.random() * 4) | 0,
            driftPhase: Math.random() * TAU,
            flip: Math.random() < 0.5
          });
        }
      }
      // drifting light motes (dust caught in the sun)
      this.bg.motes = [];
      for (var m = 0; m < 22; m++) {
        this.bg.motes.push({
          x: Math.random() * VW, y: Math.random() * VH,
          r: 1.2 + Math.random() * 2.6,
          spd: 6 + Math.random() * 16,
          phase: Math.random() * TAU,
          tw: 0.6 + Math.random() * 1.6
        });
      }
    },

    bindUI: function () {
      $("btn-start").addEventListener("click", function () { Game.startRun(false); });
      $("btn-daily").addEventListener("click", function () { Game.startRun(true); });
      $("btn-copy-daily").addEventListener("click", function () { Game.copyDailyShare(); });
      $("btn-pause").addEventListener("click", function () { Game.togglePause(); });
      $("btn-resume").addEventListener("click", function () { Game.togglePause(); });
      // retries keep the mode you were flying (a daily retry is still the daily)
      $("btn-restart-pause").addEventListener("click", function () { Game.startRun(!!Game.daily); });
      $("btn-retry").addEventListener("click", function () { Game.startRun(!!Game.daily); });
      $("btn-continue").addEventListener("click", function () { Game.continueFromWin(); });
      $("plume-btn").addEventListener("click", function () { Game.cyclePlume(); });
      $("gentle-btn").addEventListener("click", function () { Game.toggleGentle(); });
      $("btn-mute").addEventListener("click", function () { Game.toggleMute(); });
    },

    toggleMute: function () {
      this.muted = !this.muted;
      Audio2.setMuted(this.muted);
      var btn = $("btn-mute");
      btn.setAttribute("aria-pressed", this.muted ? "true" : "false");
      $("mute-glyph").innerHTML = this.muted ? "&#128263;" : "&#9834;";
    },

    // ----- RESIZE / LETTERBOX -----
    resize: function () {
      var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      var vw = window.innerWidth, vh = window.innerHeight;
      var targetAR = VW / VH;
      var w, h;
      if (vw / vh > targetAR) { h = vh; w = h * targetAR; }
      else { w = vw; h = w / targetAR; }
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      canvas.width = Math.round(VW * dpr);
      canvas.height = Math.round(VH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    // ----- SCREEN MGMT -----
    showScreen: function (name) {
      for (var k in screens) screens[k].hidden = true;
      if (name && screens[name]) screens[name].hidden = false;
    },

    toTitle: function () {
      this.state = "TITLE";
      this.showScreen("title");
      hud.hidden = true;
      // once crowned, the title screen wears it forever
      var tk = screens.title.querySelector(".title-kicker");
      if (tk) tk.textContent = Save.data.crowned
        ? "Ruler of the skies · a watercolor flying roguelike"
        : "A watercolor flying roguelike";
      this.renderHoard();
      this.renderTitleGoose();
      this.renderGentle();
      this.renderDailyButton();
    },

    // Daily Flight button: only once the player has won at least once, so
    // newcomers aren't confused. Shows today's date + a check when flown.
    renderDailyButton: function () {
      var b = $("btn-daily");
      if (!b) return;
      if ((Save.data.wins | 0) < 1) { b.hidden = true; return; }
      var key = Daily.utcKey();
      var plan = Daily.plan(key);
      var rec = Save.data.daily;
      var doneToday = !!(rec && rec.date === key && rec.done);
      b.hidden = false;
      $("daily-btn-label").textContent = doneToday ? "✓ Daily Flight (again)" : "Daily Flight";
      $("daily-btn-date").textContent = "the sky of " + Daily.prettyDate(key);
      b.title = "Today's wind: " + plan.mod.name + " — " + plan.mod.desc +
        (doneToday ? " Already flown today — a rerun won't overwrite a better result." : "");
    },

    // 'Gentle breeze' assist: slower dragon attack cycling + 1 extra feather
    renderGentle: function () {
      var b = $("gentle-btn");
      if (b) b.setAttribute("aria-pressed", Save.data.gentle ? "true" : "false");
    },

    toggleGentle: function () {
      Save.data.gentle = !Save.data.gentle;
      Save.save();
      this.renderGentle();
      Audio2.init(); Audio2.resume();
      Audio2.tone(Save.data.gentle ? 440 : 330, 0.12, "sine", 0.07, Save.data.gentle ? 620 : 250);
    },

    // Gary on the title card, wearing the equipped plume + owned regalia
    // (plain Gary when the hoard is empty). Redrawn on plume cycling so
    // the button gives instant feedback.
    renderTitleGoose: function () {
      var c = $("title-goose");
      if (!c) return;
      var g = c.getContext("2d");
      g.clearRect(0, 0, c.width, c.height);
      g.save();
      // the rig fits a 140-unit box around the origin (~y -60..+64)
      g.translate(90, 80);
      g.scale(1.15, 1.15);
      var plume = PLUMES[Save.data.plume];
      Art.goose(g, {
        flap: 2.1,
        bank: 0.08,
        hurt: 0,
        charge: 0,
        tint: plume ? plume.color : null,
        gear: {
          horns: Save.hasRegalia("emberHorns"),
          spade: Save.hasRegalia("tempestSpade"),
          mantle: Save.hasRegalia("sorrelMantle"),
          crest: Save.hasRegalia("gildedCrest"),
          cowl: Save.hasRegalia("duskCowl"),
          crown: Save.data.crowned
        }
      });
      g.restore();
    },

    renderHoard: function () {
      var box = $("hoard-summary");
      var d = Save.data;
      if (d.scales > 0 || d.relics.length > 0 || d.wins > 0) {
        box.hidden = false;
        var parts = [];
        parts.push(d.scales + " scale" + (d.scales === 1 ? "" : "s") + " banked");
        if (d.wins > 0) parts.push(d.wins + " dragon" + (d.wins === 1 ? "" : "s") + " bowed");
        if (d.relics.length > 0) {
          var rn = d.relics.map(function (id) { return RELICS[id] ? RELICS[id].glyph + " " + RELICS[id].name : id; });
          parts.push("Relics: " + rn.join(", "));
        }
        if (d.regalia && d.regalia.length > 0) {
          var gn = d.regalia.map(function (id) { return REGALIA[id] ? REGALIA[id].glyph + " " + REGALIA[id].name : id; });
          parts.push("Regalia: " + gn.join(", "));
        }
        if (d.trinkets && d.trinkets.length > 0) {
          parts.push(d.trinkets.length + " trinket" + (d.trinkets.length === 1 ? "" : "s") + " treasured");
        }
        if (d.crowned) parts.push("👑 Crowned — Dragoose, Ruler of the Skies");
        // quiet lifetime records line beneath the hoard
        var recEl = $("hoard-records");
        if (recEl) {
          var rc = d.records || {};
          var rp = [];
          if (rc.fastestCrown != null) {
            var rm2 = Math.floor(rc.fastestCrown / 60), rs2 = rc.fastestCrown % 60;
            rp.push("fastest crowning " + (rm2 > 0 ? rm2 + "m " : "") + rs2 + "s");
          }
          if (rc.mostScalesRun > 0) rp.push("best run " + rc.mostScalesRun + " scales");
          if (rc.totalDuelsWon > 0) rp.push(rc.totalDuelsWon + " duel" + (rc.totalDuelsWon === 1 ? "" : "s") + " won");
          recEl.hidden = rp.length === 0;
          recEl.textContent = rp.length ? "Records: " + rp.join(" · ") : "";
        }
        $("hoard-stats").textContent = parts.join(" · ");
      } else {
        box.hidden = true;
      }
      // plume selector: cycle through ceremonial coats you've earned
      var pb = $("plume-btn");
      if (d.plumes && d.plumes.length > 0) {
        box.hidden = false;
        pb.hidden = false;
        var cur = PLUMES[d.plume];
        pb.textContent = "Plume: " + (cur ? cur.glyph + " " + cur.name : "None") + " ▸";
      } else {
        pb.hidden = true;
      }
    },

    cyclePlume: function () {
      var owned = Save.data.plumes;
      if (!owned.length) return;
      var order = [""].concat(owned);
      var i = order.indexOf(Save.data.plume);
      Save.data.plume = order[(i + 1) % order.length];
      Save.save();
      this.renderHoard();
      this.renderTitleGoose();
      Audio2.init(); Audio2.resume();
      Audio2.tone(520, 0.12, "sine", 0.07, 700);
    },

    // ----- START A RUN -----
    startRun: function (isDaily) {
      Audio2.init(); Audio2.resume(); Audio2.musicStart();
      // Daily Flight: the date alone decides the realm route + one modifier
      this.daily = null;
      if (isDaily) {
        var dplan = Daily.plan(Daily.utcKey());
        this.daily = { date: dplan.date, route: dplan.route, idx: 0, mod: dplan.mod };
      }
      var dm = $("daily-mod");
      if (dm) {
        dm.hidden = !this.daily;
        if (this.daily) {
          dm.textContent = "Daily Flight · " + this.daily.mod.name + " — " + this.daily.mod.hud;
          dm.title = this.daily.mod.desc;
        }
      }
      this.showScreen(null);
      hud.hidden = false;
      this.runStats = { time: 0, dmg: 0, dodges: 0 };
      Particles.clear();
      PlayerShots.clear(); DragonShots.clear(); Pickups.clear();
      this.floatLayer.innerHTML = "";
      this.scaleProgress = 0;
      this.scalesBanked = 0;
      this.winIsFinal = false;
      this.introT = 0; this.introDur = 0;
      this.nextPowerAt = 3;
      this.powers = {};
      this.shake = 0; this.hitStop = 0; this.flashRed = 0; this.flashWhite = 0;

      var startHealth = 4;
      if (Save.hasRelic("emberHeart")) startHealth = 5;
      // TRINKET: warm downfeather — one extra feather, kept warm since Ember's hearth
      if (Save.hasTrinket("warmDownfeather")) startHealth += 1;
      if (Save.data.gentle) startHealth += 1; // gentle breeze assist

      this.player = {
        x: VW / 2, y: VH * 0.72, vx: 0, vy: 0,
        facing: -Math.PI / 2, bank: 0,
        r: 30, health: startHealth, maxHealth: startHealth,
        iframes: 0, dodgeCd: 0, dashTime: 0,
        charge: 0, charging: false, justDodged: 0,
        invulnFlash: 0, hurtFlash: 0, hitScale: 1,
        ward: false, wardCd: 8, ramHit: false,
        ghosts: []
      };

      // relic perks: start with a power
      if (Save.hasRelic("cinderGift")) { this.powers.emberWake = true; }
      if (Save.hasRelic("stormGift")) { this.powers.stormDodge = true; }
      if (Save.hasRelic("verdantGift")) { this.powers.split = true; }
      if (Save.hasRelic("gildedGift")) { this.powers.velocity = true; }
      if (Save.hasRelic("umbraGift")) { this.powers.reflect = true; }
      this.refreshTrinkets(); // cache trinket flags for the hot loops
      this.renderPowers();
      this.decoy = null; // Dusk Cowl shadow decoy (fresh run, no ghosts)

      // the open sky: no dragon yet — fly into a realm to anger its ruler
      this.dragon = null;
      this.mode = "sky";
      this.initSky();
      this.player.y = VH * 0.82;
      this.updateHUD();
      this.state = "PLAYING";
      if (this.daily) {
        this.floatText(VW / 2, VH * 0.73, "Daily Flight — follow the numbered route", PAL.gold);
        setTimeout(function () {
          if (Game.state === "PLAYING" && Game.mode === "sky" && Game.daily) {
            Game.floatText(VW / 2, VH * 0.78, "today's wind: " + Game.daily.mod.name, PAL.wisteria);
          }
        }, 1400);
      } else {
        this.floatText(VW / 2, VH * 0.73, "Fly into a realm to challenge its dragon", PAL.gold);
      }

      // first-flight tutorial hints (one-time, then remembered in the save)
      if (!Save.data.seenHints.sky) {
        Save.data.seenHints.sky = true;
        Save.save();
        var skyHint = function (delay, msg) {
          setTimeout(function () {
            if (Game.state === "PLAYING" && Game.mode === "sky") {
              Game.floatText(VW / 2, VH * 0.78, msg, PAL.wisteria);
            }
          }, delay);
        };
        skyHint(1000, "drag to steer");
        skyHint(3000, "tap to dodge");
        skyHint(5000, "hold to charge dragonfire");
      }
      this.wipe();
    },

    // ----- THE OPEN SKY (realm hub) -----
    initSky: function () {
      var pals = {
        ember: { a: PAL.ember, b: PAL.emberDeep },
        storm: { a: "#7fa8c9", b: "#3d6288" },
        verdant: { a: PAL.sage, b: "#597a52" },
        gilded: { a: "#d9b96a", b: "#a8863c" },
        umbra: { a: "#8a7bb0", b: "#4a3f6e" }
      };
      // five realms in a ring around the sky's heart — the player flies in
      // from the bottom, so the lower pair sits widest to leave a clear lane
      var spots = [
        { x: VW * 0.5, y: VH * 0.13 },    // top center
        { x: VW * 0.2, y: VH * 0.335 },   // upper left
        { x: VW * 0.8, y: VH * 0.335 },   // upper right
        { x: VW * 0.265, y: VH * 0.575 }, // lower left
        { x: VW * 0.735, y: VH * 0.575 }  // lower right (the dusk gate)
      ];
      this.sky = { grace: 1.0, realms: [], tint: { color: "", k: 0, x: 0, y: 0 } };
      for (var i = 0; i < RUN_BOSSES.length; i++) {
        var t = RUN_BOSSES[i];
        this.sky.realms.push({
          type: t,
          name: DRAGONS[t].name.split(",")[0],
          x: spots[i].x, y: spots[i].y, r: 80,
          pal: pals[t] || pals.ember,
          defeated: false,
          bellRung: false, // Cinder Bell: has this calm ring chimed this pass?
          routeIdx: -1, routeLabel: "",
          phase: Math.random() * TAU
        });
      }
      // daily route: stamp each realm with its place in today's route and
      // keep a route-ordered list for the dashed path (labels pre-built —
      // drawRealms runs every frame and must not build strings)
      if (this.daily) {
        this.sky.routeOrder = [];
        for (var ri = 0; ri < this.sky.realms.length; ri++) {
          var rrm = this.sky.realms[ri];
          rrm.routeIdx = this.daily.route.indexOf(rrm.type);
          rrm.routeLabel = "" + (rrm.routeIdx + 1);
        }
        for (var oi = 0; oi < this.daily.route.length; oi++) {
          for (var oj = 0; oj < this.sky.realms.length; oj++) {
            if (this.sky.realms[oj].routeIdx === oi) this.sky.routeOrder.push(this.sky.realms[oj]);
          }
        }
      }
    },

    updateSky: function (dt) {
      var sky = this.sky;
      if (!sky) return;
      var p = this.player;
      // realm-proximity tinting: the sky warms toward the nearest realm's
      // pigment (full within r*1.2, faded out by r*3); paintSky reads this
      var tint = sky.tint;
      tint.k = 0;
      for (var ti = 0; ti < sky.realms.length; ti++) {
        var trm = sky.realms[ti];
        var tdx = p.x - trm.x, tdy = p.y - trm.y;
        var tk = 1 - (Math.sqrt(tdx * tdx + tdy * tdy) - trm.r * 1.2) / (trm.r * 1.8);
        if (tk > 1) tk = 1;
        if (tk > tint.k) {
          tint.k = tk; tint.color = trm.pal.a;
          tint.x = trm.x; tint.y = trm.y;
        }
      }
      // TRINKET: cinder bell — realms at peace chime softly as you pass
      // their calm rings (re-armed once you drift away again)
      if (this.tk && this.tk.bell) {
        for (var bi = 0; bi < sky.realms.length; bi++) {
          var brm = sky.realms[bi];
          if (!brm.defeated) continue;
          var bdx = p.x - brm.x, bdy = p.y - brm.y;
          var bd2 = bdx * bdx + bdy * bdy;
          if (bd2 < (brm.r * 1.3) * (brm.r * 1.3)) {
            if (!brm.bellRung) {
              brm.bellRung = true;
              Audio2.tone(1046.5, 0.7, "sine", 0.055, 980);
              Audio2.tone(1568, 0.4, "sine", 0.022, 1500);
              Particles.ring(brm.x, brm.y, PAL.gold, brm.r * 0.8, 90, 0.7, 2);
            }
          } else if (bd2 > (brm.r * 1.7) * (brm.r * 1.7)) {
            brm.bellRung = false;
          }
        }
      }
      // TRINKETS: quiet keepsakes that show only in the open sky
      if (this.tk && !reduceMotion) {
        if (this.tk.petal && Math.random() < dt * 2.2) {
          Particles.spawn(p.x + (Math.random() - 0.5) * 46, p.y + (Math.random() - 0.5) * 30,
            (Math.random() - 0.5) * 30, 26 + Math.random() * 20, 3.5, 0.75, 1.4, PAL.sage, 0.42, 0.985);
        }
        if (this.tk.coin && Math.random() < dt * 0.8) {
          Particles.glow(p.x + (Math.random() - 0.5) * 30, p.y + (Math.random() - 0.5) * 24,
            0, -8, 7, 1.4, 0.5, PAL.gold, 0.75, 0.94);
        }
        if (this.tk.moth && Math.random() < dt * 8) {
          var ma2 = this.time * 2.6;
          Particles.glow(p.x + Math.cos(ma2) * 44, p.y - 20 + Math.sin(ma2 * 1.7) * 18,
            0, 0, 4, 0.9, 0.3, PAL.wisteria, 0.6, 0.9);
        }
      }
      if (sky.grace > 0) { sky.grace -= dt; return; }
      for (var i = 0; i < sky.realms.length; i++) {
        var rm = sky.realms[i];
        var dx = p.x - rm.x, dy = p.y - rm.y;
        if (dx * dx + dy * dy < (rm.r * 0.72) * (rm.r * 0.72)) {
          // a respected realm can be re-entered for a ceremonial duel
          this.enterRealm(rm, rm.defeated);
          return;
        }
      }
    },

    enterRealm: function (realm, ceremonial) {
      var p = this.player;
      // Daily Flight: only the next realm on the route opens its gates —
      // the others gently refuse (a nudge back out + a hint, throttled by
      // the sky's grace timer so it can't spam)
      if (this.daily) {
        if (realm.routeIdx !== this.daily.idx) {
          if (p) {
            var rdx = p.x - realm.x, rdy = p.y - realm.y;
            var rdl = Math.hypot(rdx, rdy);
            if (rdl < 2) { rdx = 0; rdy = 1; rdl = 1; }
            p.vx = (rdx / rdl) * 420;
            p.vy = (rdy / rdl) * 420;
          }
          if (this.sky) this.sky.grace = 0.9;
          var nxt = this.daily.route[this.daily.idx];
          var msg = realm.defeated
            ? "this realm is already at peace"
            : "the route flies to " + DRAGONS[nxt].name.split(",")[0] + " first";
          this.floatText(realm.x, Math.min(VH - 80, realm.y + realm.r * 0.5), msg, PAL.wisteria);
          Audio2.tone(300, 0.14, "sine", 0.06, 220);
          return;
        }
        ceremonial = false; // the daily gauntlet is always the true fight
      }
      this.mode = "duel";
      PlayerShots.clear(); DragonShots.clear();
      this.decoy = null;
      p.x = VW / 2; p.y = VH * 0.72; p.vx = 0; p.vy = 0;
      p.iframes = 1.2;
      p.charge = 0; p.charging = false;
      Audio2.chargeStop();
      this.dragon = this.makeDragon(realm.type, ceremonial);
      // boss-intro flyby: a short non-interactive entrance — the dragon
      // swoops in from off-screen and holds its fire under a name card
      var d = this.dragon;
      this.introDur = reduceMotion ? 0.5 : 1.4;
      this.introT = this.introDur;
      d.introToX = d.x; d.introToY = d.y;
      if (!reduceMotion) d.y = -d.r; // starts above the sky, swoops down
      this.updateHUD();
      // first-duel tutorial hint (one-time)
      if (!ceremonial && !Save.data.seenHints.duel) {
        Save.data.seenHints.duel = true;
        Save.save();
        setTimeout(function () {
          if (Game.state === "PLAYING" && Game.mode === "duel") {
            Game.floatText(VW / 2, VH * 0.56, "watch for the glow — dodge the telegraphed attacks", PAL.wisteria);
          }
        }, 1500);
      }
      this.wipe();
    },

    returnToSky: function () {
      var p = this.player;
      this.mode = "sky";
      this.dragon = null;
      PlayerShots.clear(); DragonShots.clear(); Pickups.clear();
      // a breather between duels: preen two feathers back
      // (TRINKET: dewdrop phial — one extra feather with the preen)
      p.health = Math.min(p.maxHealth, p.health + (Save.hasTrinket("dewdropPhial") ? 3 : 2));
      p.x = VW / 2; p.y = VH * 0.82; p.vx = 0; p.vy = 0;
      p.iframes = 1.0;
      if (this.sky) this.sky.grace = 0.9;
      this.updateHUD();
      this.showScreen(null);
      hud.hidden = false;
      this.state = "PLAYING";
      this.floatText(VW / 2, VH * 0.73,
        this.daily ? "the route carries on — follow the numbers" : "Choose your next realm", PAL.wisteria);
      this.wipe();
    },

    makeDragon: function (type, ceremonial) {
      var spec = DRAGONS[type] || DRAGONS.ember;
      var hp = spec.health;
      var roam = spec.roamSpeed, enraged = spec.enragedSpeed;
      var tier = 0, stolen = null, punishDodge = false;
      if (ceremonial) {
        // the dragon has been studying you since it bowed
        tier = Save.duelCount(type);
        hp = Math.round(hp * Math.min(2, 1.2 + tier * 0.12));
        roam *= 1.12; enraged *= 1.12;
        // it evolves: borrow one move from another dragon's kit
        var own = BASE_KIT[type] || [];
        var pool = ALL_ATTACKS.filter(function (a) { return own.indexOf(a) === -1; });
        stolen = pool[tier % pool.length];
        // and it counters a dodge-centric build
        punishDodge = !!(this.powers.stormDodge || this.powers.emberWake);
      }
      // DAILY: Brittle Scales — dragons are 10% frailer today
      if (this.dailyMod("brittle")) hp = Math.round(hp * 0.9);
      var d = {
        type: type,
        ceremonial: !!ceremonial,
        tier: tier,
        stolen: stolen,
        punishDodge: punishDodge,
        name: (ceremonial ? "⟡ " : "") + spec.name,
        x: VW / 2, y: VH * 0.24,
        vx: 0, vy: 0, r: 110,
        health: hp, maxHealth: hp,
        roamSpeed: roam, enragedSpeed: enraged,
        facing: Math.PI / 2,
        phase: 1,
        state: "roam", stateT: 0, attackCd: 2.2,
        telegraph: 0, telegraphType: null, telegraphMax: 0,
        targetX: VW / 2, targetY: VH * 0.24,
        hitFlash: 0, bowT: 0,
        // health thresholds that drop scales
        dropMilestones: [0.8, 0.6, 0.45, 0.3, 0.18, 0.08].map(function (f) { return hp * f; }),
        dashVx: 0, dashVy: 0,
        // dusk veil (umbra kit; stealable): untargetable while veiled
        veiled: false, veilMoved: false, veilX: 0, veilY: 0, echoFired: false
      };
      return d;
    },

    continueFromWin: function () {
      if (this.winIsFinal) this.toTitle();
      else this.returnToSky();
    },

    // cache owned-trinket flags so the per-frame paths (shots, sky ambience,
    // realm draw) never call indexOf — refreshed at run start and when a
    // hoard gift is granted mid-run
    refreshTrinkets: function () {
      this.tk = {
        bell: Save.hasTrinket("cinderBell"),
        quill: Save.hasTrinket("chargedQuill"),
        vane: Save.hasTrinket("weathervane"),
        petal: Save.hasTrinket("pressedMeadowsweet"),
        coin: Save.hasTrinket("luckyCoin"),
        moth: Save.hasTrinket("duskMoth")
      };
    },

    // swap the win screen's kicker/title (crowning vs an ordinary bow)
    setWinHeader: function (kicker, title) {
      var k = screens.win.querySelector(".overlay-kicker");
      var t = screens.win.querySelector(".overlay-title");
      if (k) k.textContent = kicker;
      if (t) t.textContent = title;
    },

    fmtRunStats: function () {
      var st = this.runStats || { time: 0, dmg: 0, dodges: 0 };
      var m = Math.floor(st.time / 60), s = Math.round(st.time % 60);
      return (m > 0 ? m + "m " : "") + s + "s in the sky · " +
        Math.round(st.dmg) + " damage dealt · " +
        st.dodges + " dodge" + (st.dodges === 1 ? "" : "s");
    },

    // ----- DAILY FLIGHT helpers -----
    // is today's modifier <id> active this run? (cheap boolean — safe in hot loops)
    dailyMod: function (id) {
      return !!(this.daily && this.daily.mod.id === id);
    },
    // player steering speed (the Tailwind daily lifts it 12%)
    flySpeed: function () {
      return this.dailyMod("tailwind") ? 515.2 : 460;
    },
    // record today's result in the save — one entry, today only.
    // Never downgrade: a completed daily is only replaced by a faster
    // completion, and a failed attempt only by a deeper one.
    recordDaily: function (done) {
      if (!this.daily) return;
      var t = this.runStats ? Math.round(this.runStats.time) : 0;
      var entry = {
        date: this.daily.date,
        done: !!done,
        time: done ? t : null,
        realmsCleared: this.daily.idx
      };
      var cur = Save.data.daily;
      if (cur && cur.date === entry.date) {
        if (cur.done) {
          if (!done) return;
          if (typeof cur.time === "number" && cur.time <= t) return;
        } else if (!done && (cur.realmsCleared | 0) >= entry.realmsCleared) {
          return;
        }
      }
      Save.data.daily = entry;
      Save.save();
    },
    // "Daily Flight — 15 July — crowned in 4:32 — Tailwind"
    dailyShareLine: function () {
      var t = this.runStats ? Math.round(this.runStats.time) : 0;
      var mm = Math.floor(t / 60), ss = t % 60;
      return "Daily Flight — " + Daily.prettyDate(this.daily.date) +
        " — crowned in " + mm + ":" + (ss < 10 ? "0" + ss : ss) +
        " — " + this.daily.mod.name;
    },
    copyDailyShare: function () {
      var el = $("daily-share-text");
      var txt = el ? el.textContent : "";
      if (!txt) return;
      var fellBack = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(function () {
            var b = $("btn-copy-daily");
            if (b) {
              b.textContent = "copied!";
              setTimeout(function () { b.textContent = "copy"; }, 1400);
            }
          }, function () { Game.selectDailyShare(); });
        } else {
          fellBack = true;
        }
      } catch (e) { fellBack = true; }
      // fallback: select the line so it can be copied by hand
      if (fellBack) this.selectDailyShare();
    },
    selectDailyShare: function () {
      var el = $("daily-share-text");
      if (!el) return;
      try {
        var range = document.createRange();
        range.selectNodeContents(el);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) {}
    },

    // ----- PAUSE -----
    togglePause: function (force) {
      if (this.state === "PLAYING") {
        this.state = "PAUSED";
        this.showScreen("pause");
        Audio2.chargeStop();
      } else if (this.state === "PAUSED" && !force) {
        this.state = "PLAYING";
        this.showScreen(null);
      }
    },

    // ----- WIPE TRANSITION -----
    wipe: function (golden) {
      bloomWipe.classList.remove("is-wiping");
      bloomWipe.classList.toggle("is-golden", !!golden);
      void bloomWipe.offsetWidth;
      bloomWipe.classList.add("is-wiping");
      if (golden) setTimeout(function () { bloomWipe.classList.remove("is-golden"); }, 900);
    },

    // ----- FLOATING TEXT -----
    floatText: function (logicalX, logicalY, text, color) {
      var r = canvas.getBoundingClientRect();
      var rootR = root.getBoundingClientRect();
      var x = r.left - rootR.left + (logicalX / VW) * r.width;
      var y = r.top - rootR.top + (logicalY / VH) * r.height;
      var el = document.createElement("div");
      el.className = "float-text";
      el.textContent = text;
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.style.color = color || PAL.gold;
      this.floatLayer.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1000);
    },

    addShake: function (amt) { if (!reduceMotion) this.shake = Math.min(this.shake + amt, 22); else this.shake = Math.min(this.shake + amt * 0.3, 6); },

    // =========================================================
    // UPDATE
    // =========================================================
    update: function (dt) {
      this.time += dt;
      // background always animates (for title too)
      this.updateBg(dt);
      if (this.state !== "PLAYING") return;

      Input.update(dt);

      // hit-stop freezes gameplay briefly
      if (this.hitStop > 0) { this.hitStop -= dt; if (this.hitStop > 0) return; }

      if (this.runStats) this.runStats.time += dt;

      // boss-intro flyby countdown (dragon holds fire while it runs)
      if (this.introT > 0) this.introT -= dt;

      this.updatePlayer(dt);
      // Dusk Cowl shadow decoy fades on its own if nothing takes the bait
      if (this.decoy) { this.decoy.t -= dt; if (this.decoy.t <= 0) this.decoy = null; }
      if (this.mode === "sky") this.updateSky(dt);
      this.updateDragon(dt);
      this.updateShots(dt);
      this.updatePickups(dt);
      Particles.update(dt);

      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 40);
      if (this.flashRed > 0) this.flashRed = Math.max(0, this.flashRed - dt * 3);
      if (this.flashWhite > 0) this.flashWhite = Math.max(0, this.flashWhite - dt * 5);

      this.updateHUD();
    },

    updateBg: function (dt) {
      this.bg.washPhase += dt * 0.15;
      var c = this.bg.clouds;
      for (var i = 0; i < c.length; i++) {
        c[i].y += c[i].speed * dt;
        c[i].x += Math.sin(this.time * 0.14 + c[i].driftPhase) * 3.2 * dt;
        if (c[i].y - 140 > VH) {
          c[i].y = -170 - Math.random() * 120;
          c[i].x = Math.random() * VW;
          c[i].variant = (Math.random() * 4) | 0;
          c[i].flip = Math.random() < 0.5;
        }
      }
      var mo = this.bg.motes || [];
      for (var m = 0; m < mo.length; m++) {
        var mt = mo[m];
        mt.y += mt.spd * dt;
        mt.x += Math.sin(this.time * mt.tw + mt.phase) * 8 * dt;
        if (mt.y - 6 > VH) { mt.y = -6; mt.x = Math.random() * VW; }
      }
    },

    // ----- PLAYER -----
    updatePlayer: function (dt) {
      var p = this.player;

      // cooldowns / timers
      if (p.dodgeCd > 0) p.dodgeCd -= dt;
      if (p.iframes > 0) p.iframes -= dt;
      if (p.dashTime > 0) p.dashTime -= dt;
      if (p.justDodged > 0) p.justDodged -= dt;
      if (p.hurtFlash > 0) p.hurtFlash -= dt;
      if (p.hitScale < 1) p.hitScale = Math.min(1, p.hitScale + dt * 4);

      // ----- handle queued tap (dodge) -----
      if (Input.tapQueued) {
        Input.tapQueued = false;
        this.doDodge();
      }
      // ----- handle charge release -----
      if (Input.releaseQueued) {
        Input.releaseQueued = false;
        this.fire(p.charge);
        p.charge = 0; p.charging = false;
        Audio2.chargeStop();
      }
      // ----- build charge while holding -----
      if (Input.holding) {
        if (!p.charging) { p.charging = true; Audio2.chargeStart(); }
        // RELIC: gilded heart — the charge ignites 25% faster
        p.charge = Math.min(1, p.charge + dt * (Save.hasRelic("gildedHeart") ? 1.31 : 1.05));
        Audio2.chargeUpdate(p.charge);
      } else if (p.charging) {
        // holding ended without release event (safety)
        p.charging = false;
      }

      // ----- steering -----
      var accel = 1500;
      var flyV = this.flySpeed(); // DAILY: Tailwind lifts this 12%
      var targetVX = 0, targetVY = 0, steering = false;
      if (Input.pointerDown) {
        var dx = Input.px - p.x, dy = Input.py - p.y;
        var dist = Math.hypot(dx, dy);
        if (dist > 6) {
          var pull = Math.min(1, dist / 160);
          targetVX = (dx / dist) * flyV * pull;
          targetVY = (dy / dist) * flyV * pull;
          steering = true;
        }
      }
      var kv = Input.keyVec();
      if (kv.x || kv.y) {
        var kl = Math.hypot(kv.x, kv.y) || 1;
        targetVX = (kv.x / kl) * flyV;
        targetVY = (kv.y / kl) * flyV;
        steering = true;
      }

      if (p.dashTime > 0) {
        // dash overrides steering
      } else {
        var ease = 1 - Math.pow(0.0016, dt); // smooth approach
        p.vx += (targetVX - p.vx) * ease;
        p.vy += (targetVY - p.vy) * ease;
        if (!steering) { p.vx *= Math.pow(0.06, dt); p.vy *= Math.pow(0.06, dt); }
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // bounds (soft)
      var m = 26;
      if (p.x < m) { p.x = m; p.vx *= -0.3; }
      if (p.x > VW - m) { p.x = VW - m; p.vx *= -0.3; }
      if (p.y < m + 70) { p.y = m + 70; p.vy *= -0.3; }
      if (p.y > VH - m) { p.y = VH - m; p.vy *= -0.3; }

      // facing & banking
      var speed = Math.hypot(p.vx, p.vy);
      // wing-beat: quickens when flying hard, races while charging
      p.flapPhase = (p.flapPhase || 0) + dt * TAU * (2.0 + Math.min(2.4, speed * 0.005) + (p.charging ? 1.1 : 0));
      if (speed > 30) {
        var target = Math.atan2(p.vy, p.vx);
        p.facing = this.angleLerp(p.facing, target, 1 - Math.pow(0.0001, dt));
      }
      var targetBank = Math.max(-0.5, Math.min(0.5, p.vx / 700));
      p.bank += (targetBank - p.bank) * (1 - Math.pow(0.001, dt));

      // REGALIA: Sorrel's Mantle slowly regrows a one-hit leaf ward
      if (Save.hasRegalia("sorrelMantle") && !p.ward) {
        p.wardCd = (p.wardCd == null ? 8 : p.wardCd) - dt;
        if (p.wardCd <= 0) {
          p.ward = true;
          this.floatText(p.x, p.y - 40, "leaf ward", PAL.sage);
          Particles.ring(p.x, p.y, PAL.sage, 16, 380, 0.35, 4);
        }
      }

      // REGALIA: Ember's Horns — the dodge dash rams dragons
      if (p.dashTime > 0 && !p.ramHit && Save.hasRegalia("emberHorns")) {
        var rd = this.dragon;
        if (rd && rd.state !== "bow" && !rd.veiled) {
          var rdx = p.x - rd.x, rdy = p.y - rd.y;
          var rrr = rd.r * 0.55 + p.r * 0.8;
          if (rdx * rdx + rdy * rdy < rrr * rrr) {
            p.ramHit = true;
            this.damageDragon(7, p.x, p.y);
            this.addShake(6);
            this.hitStop = 0.04;
            Particles.sparkBurst(p.x, p.y, 10, PAL.ember, 460, 0.35);
            this.floatText(p.x, p.y - 30, "ram!", PAL.ember);
          }
        }
      }

      // dash trail: afterimages + cool mist + streaks
      if (p.dashTime > 0) {
        p.ghosts.push({ x: p.x, y: p.y, facing: p.facing, bank: p.bank, life: 0.3, maxLife: 0.3 });
        if (p.ghosts.length > 9) p.ghosts.shift();
        Particles.spawn(p.x, p.y, 0, 0, 20, 1.5, 0.35, "#cfe3f1", 0.26, 0.9);
        if (Math.random() < 0.6) {
          Particles.spark(p.x, p.y, p.facing + Math.PI + (Math.random() - 0.5) * 0.6, 260 + Math.random() * 200, "#eaf4fc", 0.25, 2);
        }
      }
      // fade afterimages
      for (var gi = p.ghosts.length - 1; gi >= 0; gi--) {
        p.ghosts[gi].life -= dt;
        if (p.ghosts[gi].life <= 0) p.ghosts.splice(gi, 1);
      }

      // charging: pull in sparks + shed heat
      if (p.charging && p.charge > 0.05) {
        if (Math.random() < dt * (18 + p.charge * 30)) {
          var ca = Math.random() * TAU, cd = 52 + Math.random() * 46;
          var gp = Particles.glow(
            p.x + Math.cos(ca) * cd, p.y + Math.sin(ca) * cd,
            -Math.cos(ca) * (2.2 + p.charge * 1.6), -Math.sin(ca) * (2.2 + p.charge * 1.6),
            4 + Math.random() * 5, 0.85, 0.32, Math.random() < 0.5 ? PAL.gold : PAL.ember, 0.75, 0.98
          );
          if (gp) gp.grav = 0;
        }
        if (p.charge >= 0.98 && Math.random() < dt * 8) {
          Particles.ring(p.x, p.y, PAL.gold, 20, 240, 0.34, 3);
        }
      }
    },

    angleLerp: function (a, b, t) {
      var diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
      return a + diff * t;
    },

    doDodge: function () {
      var p = this.player;
      if (p.dodgeCd > 0) return;
      // dash in current heading (or pointer direction if held)
      var ang = p.facing;
      if (Input.pointerDown) {
        var dx = Input.px - p.x, dy = Input.py - p.y;
        if (Math.hypot(dx, dy) > 12) ang = Math.atan2(dy, dx);
      } else {
        var kv = Input.keyVec();
        if (kv.x || kv.y) ang = Math.atan2(kv.y, kv.x);
      }
      // REGALIA: Dusk Cowl — the dodge sheds a shadow decoy where Gary was
      if (Save.hasRegalia("duskCowl")) {
        this.decoy = { x: p.x, y: p.y, facing: p.facing, t: 2, maxT: 2 };
      }
      var dash = 760;
      p.vx = Math.cos(ang) * dash;
      p.vy = Math.sin(ang) * dash;
      p.facing = ang;
      p.dashTime = 0.18;
      // RELIC: dusk heart — the dodge grants 0.15s longer i-frames
      p.iframes = Save.hasRelic("duskHeart") ? 0.57 : 0.42;
      // TRINKET: hush bead — the hush lasts a breath longer
      if (Save.hasTrinket("hushBead")) p.iframes += 0.05;
      // RELIC: gale feather — dodge recovers in half the time
      p.dodgeCd = Save.hasRelic("galeFeather") ? 0.3 : 0.6;
      // DAILY: Thin Air — the dodge rests a touch longer
      if (this.dailyMod("thinAir")) p.dodgeCd += 0.15;
      p.justDodged = 1.2;
      p.ramHit = false; // Ember's Horns may connect once per dash
      if (this.runStats) this.runStats.dodges++;
      buzz(12);
      Audio2.dodge();
      Particles.burst(p.x, p.y, 8, "#cfe3f1", 3, 12, 0.3);
      Particles.ring(p.x, p.y, "#eaf4fc", 14, 460, 0.32, 4);
      Particles.sparkBurst(p.x, p.y, 6, "#eaf4fc", 420, 0.3);

      // POWER: storm dodge -> lightning
      if (this.powers.stormDodge) this.stormDodgeBurst();

      // CEREMONIAL COUNTER: a studied dragon punishes your dodge habit
      var d = this.dragon;
      if (d && d.ceremonial && d.punishDodge && d.state !== "bow") {
        var dd = d;
        setTimeout(function () {
          if (Game.state !== "PLAYING" || Game.dragon !== dd || dd.state === "bow") return;
          // the Dusk Cowl's shadow decoy draws the punishing snap shot
          var tgt = (Game.decoy && Game.decoy.t > 0) ? Game.decoy : Game.player;
          if (tgt !== Game.player) Game.decoy = null;
          var pa = Math.atan2(tgt.y - dd.y, tgt.x - dd.x);
          DragonShots.spawn({
            x: dd.x + Math.cos(pa) * 70, y: dd.y + Math.sin(pa) * 70,
            vx: Math.cos(pa) * 520, vy: Math.sin(pa) * 520,
            r: 18, dmg: 1, life: 2.4, color: PAL.gold, rot: pa, kind: "fire"
          });
          Audio2.tone(300, 0.1, "square", 0.08, 160);
        }, 320);
      }
    },

    stormDodgeBurst: function () {
      var p = this.player;
      var n = 5;
      for (var i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        PlayerShots.spawn({
          x: p.x, y: p.y,
          vx: Math.cos(a) * 540, vy: Math.sin(a) * 540,
          r: 14, dmg: 2.2, life: 0.6, color: PAL.wisteria, rot: a, kind: "bolt"
        });
      }
      Particles.burst(p.x, p.y, 8, PAL.wisteria, 4, 14, 0.4);
    },

    fire: function (charge) {
      var p = this.player;
      charge = charge || 0.06;
      var size = 0.55 + charge * 1.7;       // visual/hit scale
      var dmg = 3 + charge * 11;

      // POWER: tailwind fury — speed boosts damage
      if (this.powers.velocity) {
        var sp = Math.hypot(p.vx, p.vy);
        dmg *= 1 + Math.min(0.8, sp / 700);
      }
      // POWER: ember wake — first shot after dodge is big
      var big = false;
      if (this.powers.emberWake && p.justDodged > 0) {
        big = true; size = Math.max(size, 1.9); dmg *= 1.7; p.justDodged = 0;
      }

      var ang = p.facing;
      var sx = p.x + Math.cos(ang) * 30, sy = p.y + Math.sin(ang) * 30;
      var spd = 620;

      var shots = [{ ang: ang }];
      if (this.powers.split) { shots = [{ ang: ang - 0.18 }, { ang: ang + 0.18 }]; }

      for (var i = 0; i < shots.length; i++) {
        PlayerShots.spawn({
          x: sx, y: sy,
          vx: Math.cos(shots[i].ang) * spd, vy: Math.sin(shots[i].ang) * spd,
          r: 26 * size, dmg: dmg, life: 2.2, color: big ? PAL.rose : PAL.ember,
          rot: shots[i].ang, spin: 6, kind: "fire"
        });
      }

      // REGALIA: Tempest's Spade — a full charge cracks lightning off the tail
      if (charge >= 0.98 && Save.hasRegalia("tempestSpade")) {
        for (var ti = -1; ti <= 1; ti++) {
          var ta = ang + Math.PI + ti * 0.35;
          PlayerShots.spawn({
            x: p.x - Math.cos(ang) * 26, y: p.y - Math.sin(ang) * 26,
            vx: Math.cos(ta) * 540, vy: Math.sin(ta) * 540,
            r: 14, dmg: 2.4, life: 0.7, color: PAL.wisteria, rot: ta, kind: "bolt"
          });
        }
        Audio2.thunder(0.3);
      }
      Audio2.fireball(charge);
      // muzzle flash: glow bloom + sparks + (charged) shockwave ring
      Particles.glow(sx, sy, 0, 0, 20 * size, 1.6, 0.22, PAL.gold, 0.8, 0.9);
      Particles.burst(sx, sy, big ? 10 : 5, big ? PAL.rose : PAL.ember, 2.5, 12 * size, 0.34);
      Particles.sparkBurst(sx, sy, big ? 10 : 5, big ? PAL.rose : PAL.gold, 380 + charge * 300, 0.32);
      if (charge > 0.55) Particles.ring(sx, sy, big ? PAL.rose : PAL.ember, 16, 520, 0.35, 5);
      p.hitScale = 0.86; // recoil pop
    },

    // ----- DRAGON AI -----
    updateDragon: function (dt) {
      var d = this.dragon;
      if (!d) return;
      if (d.hitFlash > 0) d.hitFlash -= dt;

      // animation phases: slow powerful wing beats, serpentine tail sway
      var animSpd = d.phase === 2 ? 1.5 : 1;
      d.flapPhase = (d.flapPhase || 0) + dt * TAU * 0.42 * animSpd * (d.state === "bow" ? 0.4 : 1);
      d.swayPhase = (d.swayPhase || 0) + dt * 2.1 * animSpd * (d.state === "bow" ? 0.4 : 1);

      // defeated: dissolve into rising golden motes while it bows
      if (d.state === "bow") {
        if (Math.random() < dt * 26) {
          var ba = Math.random() * TAU, br = Math.random() * d.r * 0.7;
          Particles.glow(d.x + Math.cos(ba) * br, d.y + Math.sin(ba) * br,
            (Math.random() - 0.5) * 0.6, -0.9 - Math.random() * 1.2,
            5 + Math.random() * 9, 0.9, 1.1 + Math.random() * 0.6, PAL.gold, 0.6, 0.985);
        }
        return;
      }

      // ----- boss-intro flyby: swoop to the arena spot, hold fire -----
      if (this.introT > 0) {
        d.state = "roam"; d.stateT = 0;
        d.telegraph = 0; d.telegraphType = null;
        var it = 1 - this.introT / (this.introDur || 1);
        if (it < 0) it = 0; else if (it > 1) it = 1;
        if (!reduceMotion) {
          var ie = 1 - Math.pow(1 - it, 3); // smooth cubic ease-out
          d.y = -d.r + (d.introToY + d.r) * ie;
          d.x = d.introToX + Math.sin(it * Math.PI) * 26;
        }
        d.facing = this.angleLerp(d.facing,
          Math.atan2(this.player.y - d.y, this.player.x - d.x), 1 - Math.pow(0.05, dt));
        return; // no attack cooldown ticks during the entrance
      }

      // enraged: shed rising embers + heat (static crackle for the storm wyrm)
      if (d.phase === 2 && Math.random() < dt * 14) {
        var ea = Math.random() * TAU, er = d.r * (0.3 + Math.random() * 0.5);
        var ec = d.type === "storm"
          ? (Math.random() < 0.4 ? PAL.wisteria : "#8fd0ff")
          : d.type === "verdant"
          ? (Math.random() < 0.4 ? PAL.rose : PAL.sage)   // petals shaken loose
          : d.type === "gilded"
          ? (Math.random() < 0.4 ? "#fff3c4" : PAL.gold)  // treasure-light shed like dust
          : d.type === "umbra"
          ? (Math.random() < 0.4 ? PAL.wisteria : "#8a7bb0") // dusk shed like falling night
          : (Math.random() < 0.4 ? PAL.rose : PAL.ember);
        Particles.glow(d.x + Math.cos(ea) * er, d.y + Math.sin(ea) * er,
          (Math.random() - 0.5) * 0.8, -1.1 - Math.random() * 1.4,
          4 + Math.random() * 7, 0.9, 0.7 + Math.random() * 0.5,
          ec, 0.55, 0.98);
      }

      // phase transition (ceremonial dragons enrage earlier)
      if (d.phase === 1 && d.health <= d.maxHealth * (d.ceremonial ? 0.6 : 0.5)) {
        d.phase = 2;
        d.telegraph = 0; d.telegraphType = null;
        d.attackCd = 1.0;
        this.floatText(d.x, d.y, "Phase II", PAL.rose);
        this.addShake(8);
        Particles.burst(d.x, d.y, 18, PAL.rose, 5, 24, 0.4);
        Audio2.tone(120, 0.5, "sawtooth", 0.2, 220);
      }

      d.stateT += dt;

      // ----- roam movement toward target -----
      if (d.state === "roam") {
        var dx = d.targetX - d.x, dy = d.targetY - d.y;
        var dist = Math.hypot(dx, dy);
        if (dist < 24 || d.stateT > 2.2) {
          d.targetX = 90 + Math.random() * (VW - 180);
          d.targetY = VH * 0.14 + Math.random() * VH * 0.22;
          d.stateT = 0;
        }
        var sp = d.phase === 2 ? d.enragedSpeed : d.roamSpeed;
        if (dist > 1) { d.vx = (dx / dist) * sp; d.vy = (dy / dist) * sp; }
        d.x += d.vx * dt; d.y += d.vy * dt;
        d.facing = this.angleLerp(d.facing, Math.atan2(this.player.y - d.y, this.player.x - d.x), 1 - Math.pow(0.02, dt));

        // ceremonial dragons cycle their attacks noticeably faster;
        // the gentle-breeze assist slows every dragon's cycle ~25%
        d.attackCd -= dt * (d.ceremonial ? 1.3 : 1) * (Save.data.gentle ? 0.78 : 1);
        if (d.attackCd <= 0) this.dragonBeginAttack();
      }
      // ----- telegraph (wind-up) -----
      else if (d.state === "telegraph") {
        d.telegraph -= dt;
        // face player during aim
        d.facing = this.angleLerp(d.facing, Math.atan2(this.player.y - d.y, this.player.x - d.x), 1 - Math.pow(0.05, dt));
        d.vx *= 0.9; d.vy *= 0.9;
        d.x += d.vx * dt; d.y += d.vy * dt;
        if (d.telegraph <= 0) this.dragonExecute();
      }
      // ----- dash attack -----
      else if (d.state === "dash") {
        d.x += d.dashVx * dt; d.y += d.dashVy * dt;
        d.dashVx *= Math.pow(0.2, dt); d.dashVy *= Math.pow(0.2, dt);
        Particles.spawn(d.x, d.y, 0, 0, 30, 1.3, 0.4,
          d.type === "storm" ? "#9fc2e0" : d.type === "verdant" ? PAL.sage : d.type === "gilded" ? PAL.gold : d.type === "umbra" ? "#8a7bb0" : PAL.ember, 0.22, 0.92);
        d.stateT += dt;
        // keep in bounds
        if (d.x < 90) { d.x = 90; d.dashVx = Math.abs(d.dashVx); }
        if (d.x > VW - 90) { d.x = VW - 90; d.dashVx = -Math.abs(d.dashVx); }
        if (d.y < 90) { d.y = 90; d.dashVy = Math.abs(d.dashVy); }
        if (d.y > VH * 0.7) { d.y = VH * 0.7; d.dashVy = -Math.abs(d.dashVy); }
        if (d.stateT > 0.55) this.dragonEndAttack();
      }
      // ----- sweeping breath (ember) / sweeping sun-beam ray (gilded) -----
      else if (d.state === "breath") {
        d.stateT += dt;
        d.vx *= 0.94; d.vy *= 0.94;
        d.x += d.vx * dt; d.y += d.vy * dt;
        var isRay = d.telegraphType === "ray";
        var rayDur = d.phase === 2 ? 1.45 : 1.1;
        // emit breath cone (ray: a denser, faster, short-lived gold line)
        d.breathT = (d.breathT || 0) + dt;
        if (d.breathT > (isRay ? 0.026 : 0.045)) {
          d.breathT = 0;
          var sweep, spd;
          if (isRay) {
            var rp = Math.min(1, d.stateT / rayDur);
            sweep = d.breathAng + (rp - 0.5) * (d.phase === 2 ? 1.8 : 1.35) * (d.raySign || 1);
            spd = 430;
            DragonShots.spawn({
              x: d.x + Math.cos(sweep) * 70, y: d.y + Math.sin(sweep) * 70,
              vx: Math.cos(sweep) * spd, vy: Math.sin(sweep) * spd,
              r: 17, dmg: 1, life: 0.95, color: PAL.gold, rot: sweep, kind: "breath"
            });
          } else {
            sweep = d.breathAng + Math.sin(d.stateT * 3.2) * 0.55;
            spd = 300;
            DragonShots.spawn({
              x: d.x + Math.cos(d.facing) * 70, y: d.y + Math.sin(d.facing) * 70,
              vx: Math.cos(sweep) * spd, vy: Math.sin(sweep) * spd,
              r: 22, dmg: 1, life: 2.4, color: PAL.ember, rot: sweep, kind: "breath"
            });
          }
        }
        if (d.stateT > (isRay ? rayDur : (d.phase === 2 ? 1.7 : 1.3))) this.dragonEndAttack();
      }
      // ----- blooming petal spiral (verdant) -----
      else if (d.state === "spiral") {
        d.stateT += dt;
        d.vx *= 0.94; d.vy *= 0.94;
        d.x += d.vx * dt; d.y += d.vy * dt;
        d.spiralT = (d.spiralT || 0) + dt;
        var emitEvery = d.phase === 2 ? 0.07 : 0.09;
        while (d.spiralT > emitEvery) {
          d.spiralT -= emitEvery;
          d.spiralAng += 0.62;
          var arms = d.phase === 2 ? 2 : 1;
          for (var ai = 0; ai < arms; ai++) {
            var pa = d.spiralAng + ai * Math.PI;
            DragonShots.spawn({
              x: d.x + Math.cos(pa) * d.r * 0.45, y: d.y + Math.sin(pa) * d.r * 0.45,
              vx: Math.cos(pa) * 295, vy: Math.sin(pa) * 295,
              r: 13, dmg: 1, life: 2.6, color: "#d98ba0", rot: pa, kind: "petal"
            });
          }
        }
        if (d.stateT > (d.phase === 2 ? 1.8 : 1.4)) this.dragonEndAttack();
      }
      // ----- dusk veil (umbra): dissolve, slip elsewhere, shadowburst -----
      else if (d.state === "veil") {
        d.stateT += dt;
        d.vx = 0; d.vy = 0;
        // half-veiled: relocate to the rippling destination
        if (!d.veilMoved && d.stateT >= 0.4) {
          d.veilMoved = true;
          d.x = d.veilX; d.y = d.veilY;
          d.facing = Math.atan2(this.player.y - d.y, this.player.x - d.x);
        }
        // re-condense: burst back into being with a radial of dusk
        if (d.veiled && d.stateT >= 1.0) {
          d.veiled = false;
          var voff = Math.random() * TAU;
          for (var vi = 0; vi < 6; vi++) {
            var va = voff + (vi / 6) * TAU;
            DragonShots.spawn({
              x: d.x + Math.cos(va) * d.r * 0.4, y: d.y + Math.sin(va) * d.r * 0.4,
              vx: Math.cos(va) * 280, vy: Math.sin(va) * 280,
              r: 15, dmg: 1, life: 2.4, color: "#8a7bb0", rot: va, kind: "dusk"
            });
          }
          Particles.ring(d.x, d.y, PAL.wisteria, d.r * 0.5, 640, 0.42, 5);
          Particles.burst(d.x, d.y, 10, "#4a3f6e", 4, 18, 0.4);
          Audio2.noise(0.22, 0.12, 800);
          Audio2.tone(170, 0.3, "sine", 0.12, 90);
        }
        if (d.stateT > 1.18) this.dragonEndAttack();
      }
      // ----- dusk echoes (umbra): flanking ghosts each loose one aimed shot -----
      else if (d.state === "echoes") {
        d.stateT += dt;
        d.vx *= 0.94; d.vy *= 0.94;
        d.x += d.vx * dt; d.y += d.vy * dt;
        d.facing = this.angleLerp(d.facing, Math.atan2(this.player.y - d.y, this.player.x - d.x), 1 - Math.pow(0.05, dt));
        if (!d.echoFired && d.stateT >= 0.6) {
          d.echoFired = true;
          var epx = Math.cos(d.facing + Math.PI / 2), epy = Math.sin(d.facing + Math.PI / 2);
          for (var es = -1; es <= 1; es += 2) {
            var ex2 = d.x + epx * es * d.r * 1.3, ey2 = d.y + epy * es * d.r * 1.3;
            var ea2 = Math.atan2(this.player.y - ey2, this.player.x - ex2);
            DragonShots.spawn({
              x: ex2, y: ey2,
              vx: Math.cos(ea2) * 380, vy: Math.sin(ea2) * 380,
              r: 16, dmg: 1, life: 3, color: "#8a7bb0", rot: ea2, kind: "dusk"
            });
            Particles.glow(ex2, ey2, 0, 0, 20, 1.4, 0.3, PAL.wisteria, 0.5, 0.9);
          }
          Audio2.tone(240, 0.16, "sine", 0.09, 120);
        }
        if (d.stateT > 1.2) this.dragonEndAttack();
      }
    },

    dragonBeginAttack: function () {
      var d = this.dragon;
      d.state = "telegraph";
      d.stateT = 0;
      // choose attack — each dragon has its own kit
      var choices;
      if (d.type === "storm") {
        choices = ["fan", "lance", "nova"];
        if (d.phase === 2) choices = ["fan", "lance", "nova", "dash", "dash"];
      } else if (d.type === "verdant") {
        choices = ["spiral", "seeds", "spiral", "seeds"];
        if (d.phase === 2) choices = ["spiral", "seeds", "spiral", "dash", "dash"];
      } else if (d.type === "gilded") {
        choices = ["lures", "ray", "coins"];
        if (d.phase === 2) choices = ["lures", "ray", "coins", "dash", "dash"];
      } else if (d.type === "umbra") {
        choices = ["veil", "echoes", "crescent"];
        if (d.phase === 2) choices = ["veil", "echoes", "crescent", "dash", "dash"];
      } else {
        choices = ["volley", "aimed", "breath"];
        if (d.phase === 2) choices = ["volley", "aimed", "breath", "dash", "dash"];
      }
      // ceremonial adaptation: it has evolved a move from another dragon's kit
      if (d.ceremonial && d.stolen) { choices = choices.concat([d.stolen, d.stolen]); }
      d.telegraphType = choices[(Math.random() * choices.length) | 0];
      d.telegraph = d.telegraphType === "dash" ? 0.6
        : (d.telegraphType === "nova" || d.telegraphType === "spiral") ? 0.7
        : d.telegraphType === "ray" ? 0.65
        : d.telegraphType === "crescent" ? 0.6
        : d.telegraphType === "echoes" ? 0.55 : 0.5;
      // DAILY: Long Night — every wind-up is 15% shorter
      if (this.dailyMod("longNight")) d.telegraph *= 0.85;
      d.telegraphMax = d.telegraph;
      if (d.telegraphType === "breath" || d.telegraphType === "ray") {
        // REGALIA: Dusk Cowl — a fresh shadow decoy draws the telegraphed aim
        var at0 = (this.decoy && this.decoy.t > 0) ? this.decoy : this.player;
        d.breathAng = Math.atan2(at0.y - d.y, at0.x - d.x);
        d.raySign = Math.random() < 0.5 ? -1 : 1;
      }
    },

    dragonExecute: function () {
      var d = this.dragon;
      var p = this.player;
      var t = d.telegraphType;
      Audio2.tone(200, 0.18, "sawtooth", 0.12, 120);

      // REGALIA: Dusk Cowl — a fresh shadow decoy draws this attack's aim,
      // then dissipates (one attack takes the bait)
      var aimP = (this.decoy && this.decoy.t > 0) ? this.decoy : p;
      var usedDecoy = aimP !== p;
      if (usedDecoy) this.decoy = null;

      if (t === "volley") {
        var n = d.phase === 2 ? 9 : 6;
        var spread = Math.PI * (d.phase === 2 ? 0.9 : 0.6);
        var base = Math.atan2(aimP.y - d.y, aimP.x - d.x) - spread / 2;
        for (var i = 0; i < n; i++) {
          var a = base + spread * (i / (n - 1));
          DragonShots.spawn({
            x: d.x, y: d.y, vx: Math.cos(a) * 280, vy: Math.sin(a) * 280,
            r: 18, dmg: 1, life: 3, color: PAL.emberDeep, rot: a, kind: "fire"
          });
        }
        d.state = "roam"; d.stateT = 0; d.attackCd = d.phase === 2 ? 1.3 : 2.0;
      } else if (t === "aimed") {
        var shots = d.phase === 2 ? 3 : 2;
        for (var s = 0; s < shots; s++) {
          (function (delay) {
            setTimeout(function () {
              if (Game.state !== "PLAYING" || Game.dragon !== d) return;
              var aa = usedDecoy
                ? Math.atan2(aimP.y - d.y, aimP.x - d.x)
                : Math.atan2(Game.player.y - d.y, Game.player.x - d.x);
              DragonShots.spawn({
                x: d.x, y: d.y, vx: Math.cos(aa) * 420, vy: Math.sin(aa) * 420,
                r: 22, dmg: 1, life: 3, color: PAL.ember, rot: aa, kind: "fire"
              });
              Audio2.tone(260, 0.12, "square", 0.08);
            }, delay);
          })(s * 180);
        }
        d.state = "roam"; d.stateT = 0; d.attackCd = d.phase === 2 ? 1.4 : 2.2;
      } else if (t === "dash") {
        var ang = Math.atan2(aimP.y - d.y, aimP.x - d.x);
        d.dashVx = Math.cos(ang) * 900;
        d.dashVy = Math.sin(ang) * 900;
        d.facing = ang;
        d.state = "dash"; d.stateT = 0;
        Audio2.tone(150, 0.3, "sawtooth", 0.16, 300);
      } else if (t === "breath") {
        d.state = "breath"; d.stateT = 0; d.breathT = 0;
        d.breathAng = Math.atan2(aimP.y - d.y, aimP.x - d.x);
      }
      // ----- storm kit -----
      else if (t === "fan") {
        // a crackling fan of bolts — tighter and faster than Ember's volley
        var fn = d.phase === 2 ? 11 : 7;
        var fspread = Math.PI * (d.phase === 2 ? 0.7 : 0.48);
        var fbase = Math.atan2(aimP.y - d.y, aimP.x - d.x) - fspread / 2;
        for (var fi = 0; fi < fn; fi++) {
          var fa = fbase + fspread * (fi / (fn - 1));
          DragonShots.spawn({
            x: d.x, y: d.y, vx: Math.cos(fa) * 350, vy: Math.sin(fa) * 350,
            r: 15, dmg: 1, life: 2.6, color: "#8fd0ff", rot: fa, kind: "zap"
          });
        }
        Audio2.thunder(0.5);
        d.state = "roam"; d.stateT = 0; d.attackCd = d.phase === 2 ? 1.2 : 1.9;
      } else if (t === "lance") {
        // three fast bolts down one locked line — sidestep, don't outrun
        var la = Math.atan2(aimP.y - d.y, aimP.x - d.x);
        var ln = d.phase === 2 ? 4 : 3;
        for (var ls = 0; ls < ln; ls++) {
          (function (delay) {
            setTimeout(function () {
              if (Game.state !== "PLAYING" || Game.dragon !== d) return;
              DragonShots.spawn({
                x: d.x + Math.cos(la) * 70, y: d.y + Math.sin(la) * 70,
                vx: Math.cos(la) * 600, vy: Math.sin(la) * 600,
                r: 17, dmg: 1, life: 2.2, color: "#bfe3ff", rot: la, kind: "zap"
              });
              Audio2.tone(340, 0.1, "square", 0.08, 180);
            }, delay);
          })(ls * 130);
        }
        d.state = "roam"; d.stateT = 0; d.attackCd = d.phase === 2 ? 1.4 : 2.1;
      } else if (t === "nova") {
        // thunderclap: a radial shell of bolts from the body
        this.stormNova(d, d.phase === 2 ? 16 : 12, 255, 0);
        if (d.phase === 2) {
          setTimeout(function () {
            if (Game.state === "PLAYING" && Game.dragon === d) Game.stormNova(d, 16, 255, Math.PI / 16);
          }, 380);
        }
        Audio2.thunder(1);
        this.addShake(6);
        d.state = "roam"; d.stateT = 0; d.attackCd = d.phase === 2 ? 1.5 : 2.3;
      }
      // ----- verdant kit -----
      else if (t === "spiral") {
        // a blooming spiral of petals wheels out from the body over time
        d.state = "spiral"; d.stateT = 0; d.spiralT = 0;
        d.spiralAng = Math.atan2(aimP.y - d.y, aimP.x - d.x);
        Audio2.tone(320, 0.3, "sine", 0.1, 180);
      } else if (t === "seeds") {
        // lob three slow seed pods that drift toward you, then burst
        var sa = Math.atan2(aimP.y - d.y, aimP.x - d.x);
        var offs = d.phase === 2 ? [-0.7, -0.23, 0.23, 0.7] : [-0.55, 0, 0.55];
        for (var si = 0; si < offs.length; si++) {
          var seedAng = sa + offs[si];
          var seed = DragonShots.spawn({
            x: d.x + Math.cos(seedAng) * 60, y: d.y + Math.sin(seedAng) * 60,
            vx: Math.cos(seedAng) * 130, vy: Math.sin(seedAng) * 130,
            r: 20, dmg: 1, life: 6, color: "#93b48b", rot: seedAng, kind: "seed"
          });
          if (seed) seed.fuse = 2.1 + si * 0.25;
        }
        Audio2.tone(240, 0.25, "sine", 0.1, 130);
        d.state = "roam"; d.stateT = 0; d.attackCd = d.phase === 2 ? 1.6 : 2.4;
      }
      // ----- gilded kit (GREED) -----
      else if (t === "lures") {
        // scatter hovering false scales — gold and glinting, but rimmed
        // dark and pulsing slow. Get close (or wait) and they detonate.
        var ln2 = d.phase === 2 ? 4 : 3;
        for (var li2 = 0; li2 < ln2; li2++) {
          var lt = ln2 === 1 ? 0.5 : li2 / (ln2 - 1);
          var lx = VW * (0.18 + 0.64 * lt) + (Math.random() - 0.5) * 56;
          var ly = VH * (0.34 + Math.random() * 0.2);
          // launch velocity decays exponentially so each lure settles ~at
          // its scatter point, then hovers (no steering, gentle drift)
          var lu = DragonShots.spawn({
            x: d.x, y: d.y,
            vx: (lx - d.x) * 3.9, vy: (ly - d.y) * 3.9,
            r: 16, dmg: 1, life: 6, color: PAL.gold, rot: 0, kind: "lure"
          });
          if (lu) lu.fuse = 1.6 + li2 * 0.12;
        }
        Audio2.tone(880, 0.2, "sine", 0.08, 1180);
        d.state = "roam"; d.stateT = 0; d.attackCd = d.phase === 2 ? 1.5 : 2.3;
      } else if (t === "ray") {
        // sweeping sun-beam: reuses the breath state with a gold branch
        d.state = "breath"; d.stateT = 0; d.breathT = 0;
        if (d.breathAng == null) d.breathAng = Math.atan2(aimP.y - d.y, aimP.x - d.x);
        Audio2.tone(520, 0.5, "sawtooth", 0.1, 260);
      } else if (t === "coins") {
        // a lobbed volley of spinning coins that arc under gravity
        var cn = d.phase === 2 ? 7 : 5;
        var cAim = Math.atan2(aimP.y - d.y, aimP.x - d.x);
        for (var ci2 = 0; ci2 < cn; ci2++) {
          var lob = cAim + (cn === 1 ? 0 : (ci2 / (cn - 1) - 0.5)) * 1.15;
          DragonShots.spawn({
            x: d.x + Math.cos(lob) * 60, y: d.y + Math.sin(lob) * 60,
            vx: Math.cos(lob) * (180 + Math.random() * 80),
            vy: Math.sin(lob) * 150 - (130 + Math.random() * 90),
            r: 15, dmg: 1, life: 3.2, color: PAL.gold, rot: lob, kind: "coin",
            grav: 560
          });
        }
        Audio2.tone(660, 0.22, "triangle", 0.1, 420);
        Audio2.noise(0.12, 0.08, 2400);
        d.state = "roam"; d.stateT = 0; d.attackCd = d.phase === 2 ? 1.4 : 2.2;
      }
      // ----- umbra kit (DUSK) -----
      else if (t === "veil") {
        // dissolve into dusk, slip to a rippling point, burst back in shadow
        d.state = "veil"; d.stateT = 0;
        d.veiled = true; d.veilMoved = false;
        d.veilX = 90 + Math.random() * (VW - 180);
        d.veilY = VH * 0.14 + Math.random() * VH * 0.34;
        Particles.burst(d.x, d.y, 10, "#4a3f6e", 3, 18, 0.35);
        Audio2.noise(0.3, 0.1, 600);
        Audio2.tone(320, 0.35, "sine", 0.08, 110);
      } else if (t === "echoes") {
        // two ghost silhouettes condense at its flanks, then loose dusk
        d.state = "echoes"; d.stateT = 0; d.echoFired = false;
        Audio2.tone(300, 0.3, "sine", 0.08, 150);
      } else if (t === "crescent") {
        // a curved volley: the fan releases straight, then every blot bends
        // the same way (perpendicular curve field on dusk shots)
        var dn = d.phase === 2 ? 9 : 7;
        var dspread = Math.PI * 0.56; // ~100 degrees
        var dbase = Math.atan2(aimP.y - d.y, aimP.x - d.x) - dspread / 2;
        var dsign = Math.random() < 0.5 ? -1 : 1;
        for (var di = 0; di < dn; di++) {
          var da = dbase + dspread * (di / (dn - 1));
          DragonShots.spawn({
            x: d.x + Math.cos(da) * 50, y: d.y + Math.sin(da) * 50,
            vx: Math.cos(da) * 300, vy: Math.sin(da) * 300,
            r: 14, dmg: 1, life: 3, color: "#8a7bb0", rot: da, kind: "dusk",
            curve: 150 * dsign
          });
        }
        Audio2.tone(210, 0.26, "sine", 0.1, 100);
        Audio2.noise(0.14, 0.08, 900);
        d.state = "roam"; d.stateT = 0; d.attackCd = d.phase === 2 ? 1.3 : 2.1;
      }
    },

    // false-scale detonation: five radial gold shots
    burstLure: function (s) {
      s.active = false;
      var off = Math.random() * TAU;
      for (var i = 0; i < 5; i++) {
        var a = off + (i / 5) * TAU;
        DragonShots.spawn({
          x: s.x, y: s.y, vx: Math.cos(a) * 270, vy: Math.sin(a) * 270,
          r: 13, dmg: 1, life: 1.8, color: PAL.gold, rot: a, kind: "fire"
        });
      }
      Particles.burst(s.x, s.y, 8, PAL.gold, 3, 14, 0.4);
      Particles.ring(s.x, s.y, PAL.gold, 14, 430, 0.35, 4);
      Particles.sparkBurst(s.x, s.y, 6, "#fff3c4", 340, 0.3);
      Audio2.tone(700, 0.12, "square", 0.09, 300);
    },

    // seed pod detonation: a ring of petals
    burstSeed: function (s) {
      s.active = false;
      var n = 6;
      var off = Math.random() * TAU;
      for (var i = 0; i < n; i++) {
        var a = off + (i / n) * TAU;
        DragonShots.spawn({
          x: s.x, y: s.y, vx: Math.cos(a) * 265, vy: Math.sin(a) * 265,
          r: 13, dmg: 1, life: 1.6, color: "#d98ba0", rot: a, kind: "petal"
        });
      }
      Particles.burst(s.x, s.y, 8, PAL.sage, 3, 14, 0.4);
      Particles.ring(s.x, s.y, PAL.sage, 14, 420, 0.35, 4);
      Audio2.noise(0.16, 0.12, 1600);
    },

    stormNova: function (d, n, spd, offset) {
      for (var i = 0; i < n; i++) {
        var a = offset + (i / n) * TAU;
        DragonShots.spawn({
          x: d.x + Math.cos(a) * d.r * 0.5, y: d.y + Math.sin(a) * d.r * 0.5,
          vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
          r: 15, dmg: 1, life: 3, color: "#8fd0ff", rot: a, kind: "zap"
        });
      }
      Particles.ring(d.x, d.y, PAL.wisteria, d.r * 0.6, 900, 0.5, 7);
      Particles.sparkBurst(d.x, d.y, 10, "#bfe3ff", 480, 0.4);
    },

    dragonEndAttack: function () {
      var d = this.dragon;
      // the storm wyrm discharges as it pulls out of a dash
      if (d.type === "storm" && d.telegraphType === "dash") {
        this.stormNova(d, 6, 210, Math.random() * TAU);
        Audio2.thunder(0.4);
      }
      d.state = "roam"; d.stateT = 0;
      d.attackCd = d.phase === 2 ? 1.0 : 1.8;
      d.telegraphType = null;
      d.veiled = false; // safety: never leave a dragon untargetable
    },

    // ----- SHOTS / COLLISIONS -----
    updateShots: function (dt) {
      var p = this.player, d = this.dragon, self = this;

      PlayerShots.forEach(function (s) {
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.rot += s.spin * dt;
        s.life -= dt;
        s.trail.unshift({ x: s.x, y: s.y });
        if (s.trail.length > 7) s.trail.pop();
        if (s.kind === "fire" && Math.random() < dt * 10) {
          Particles.spark(s.x, s.y, s.rot + Math.PI + (Math.random() - 0.5) * 0.9, 120 + Math.random() * 120, PAL.gold, 0.3, 1.8);
        }
        // TRINKET: charged quill — a faint storm-blue spark trail (cosmetic)
        if (self.tk && self.tk.quill && Math.random() < dt * 9) {
          Particles.spark(s.x, s.y, s.rot + Math.PI + (Math.random() - 0.5) * 1.2, 80 + Math.random() * 100, "#bfe3ff", 0.26, 1.5);
        }
        if (s.life <= 0 || s.x < -40 || s.x > VW + 40 || s.y < -40 || s.y > VH + 40) { s.active = false; return; }
        // hit dragon (a veiled dragon is dusk itself — shots pass through)
        if (d && d.state !== "bow" && !d.veiled) {
          var dx = s.x - d.x, dy = s.y - d.y;
          var rr = d.r * 0.62 + s.r;
          if (dx * dx + dy * dy < rr * rr) {
            self.damageDragon(s.dmg, s.x, s.y);
            s.active = false;
          }
        }
      });

      DragonShots.forEach(function (s) {
        // seed pods drift toward the player, then burst into petals
        if (s.kind === "seed") {
          var sdx = p.x - s.x, sdy = p.y - s.y;
          var sl = Math.hypot(sdx, sdy) || 1;
          var steer = 220;
          s.vx += (sdx / sl) * steer * dt; s.vy += (sdy / sl) * steer * dt;
          var spd2 = Math.hypot(s.vx, s.vy);
          var maxSpd = 185;
          if (spd2 > maxSpd) { s.vx = s.vx / spd2 * maxSpd; s.vy = s.vy / spd2 * maxSpd; }
          s.fuse -= dt;
          if (s.fuse <= 0 || sl < 64) { self.burstSeed(s); return; }
        }
        // gilded lures settle, hover glinting, then detonate near the greedy
        if (s.kind === "lure") {
          s.vx *= Math.pow(0.005, dt); s.vy *= Math.pow(0.005, dt);
          s.x += Math.sin(self.time * 1.7 + s.seed) * 9 * dt;
          s.fuse -= dt;
          var lpx = p.x - s.x, lpy = p.y - s.y;
          if (s.fuse <= 0 || lpx * lpx + lpy * lpy < 70 * 70) { self.burstLure(s); return; }
        }
        // lobbed coins arc under gravity
        if (s.grav) s.vy += s.grav * dt;
        // dusk crescents bend: a small perpendicular acceleration curves
        // the whole volley the same way (0 for every other shot kind)
        if (s.curve) {
          var cvl = Math.hypot(s.vx, s.vy) || 1;
          var cnx = -s.vy / cvl, cny = s.vx / cvl;
          s.vx += cnx * s.curve * dt; s.vy += cny * s.curve * dt;
        }
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.rot += 3 * dt;
        s.life -= dt;
        s.trail.unshift({ x: s.x, y: s.y });
        if (s.trail.length > 5) s.trail.pop();
        if (s.life <= 0 || s.x < -50 || s.x > VW + 50 || s.y < -50 || s.y > VH + 50) { s.active = false; return; }
        // hit player
        if (p.iframes <= 0) {
          var dx = s.x - p.x, dy = s.y - p.y;
          var rr = p.r * 0.6 + s.r * 0.75;
          if (dx * dx + dy * dy < rr * rr) {
            self.hurtPlayer(1, s.x, s.y);
            s.active = false;
          }
        }
      });

      // dragon dash body-check on player
      if (d && d.state === "dash" && p.iframes <= 0) {
        var dx = p.x - d.x, dy = p.y - d.y;
        var rr = d.r * 0.5 + p.r * 0.6;
        if (dx * dx + dy * dy < rr * rr) this.hurtPlayer(1, p.x, p.y);
      }
    },

    damageDragon: function (dmg, x, y) {
      var d = this.dragon;
      if (!d || d.state === "bow") return;
      if (d.veiled) return; // dissolved into dusk — untargetable
      var before = d.health;
      d.health = Math.max(0, d.health - dmg);
      if (this.runStats) this.runStats.dmg += Math.min(dmg, before);
      d.hitFlash = 0.16;
      Particles.burst(x, y, Math.min(12, 4 + dmg), PAL.ember, 3, 14, 0.36);
      Particles.glow(x, y, 0, 0, 16 + dmg * 1.4, 1.5, 0.24, PAL.gold, 0.7, 0.9);
      Particles.sparkBurst(x, y, Math.min(10, 3 + (dmg | 0)), PAL.gold, 360, 0.34);
      Audio2.hitDragon();
      if (dmg > 9) {
        this.hitStop = 0.06; this.addShake(4);
        Particles.ring(x, y, PAL.gold, 18, 560, 0.4, 6);
      }

      // scale drops on milestones
      var ms = d.dropMilestones;
      for (var i = 0; i < ms.length; i++) {
        if (before > ms[i] && d.health <= ms[i]) {
          this.dropScale(d.x, d.y);
        }
      }

      this.floatText(x, y - 10, "-" + Math.round(dmg), dmg > 9 ? PAL.rose : "#fbf7ee");

      if (d.health <= 0) this.dragonDefeated();
    },

    dropScale: function (x, y) {
      var ang = Math.random() * Math.PI * 2;
      // 1 in 10 scales falls lustrous — bigger, iridescent, worth +3
      var rare = Math.random() < 0.1;
      Pickups.list.push({
        x: x, y: y, vx: Math.cos(ang) * 90, vy: Math.sin(ang) * 90 - 60,
        r: 22, t: 0, collected: false, magnet: false, rare: rare,
        type: this.dragon.type
      });
      Particles.burst(x, y, rare ? 12 : 6, rare ? PAL.wisteria : PAL.gold, 3, rare ? 16 : 12, 0.4);
      if (rare) Particles.ring(x, y, PAL.rose, 14, 420, 0.36, 4);
    },

    hurtPlayer: function (dmg, x, y) {
      var p = this.player;
      if (p.iframes > 0) return;
      // REGALIA: Sorrel's Mantle — the leaf ward drinks one blow
      if (p.ward) {
        p.ward = false;
        p.wardCd = 12;
        p.iframes = 0.8;
        Particles.burst(p.x, p.y, 10, PAL.sage, 4, 16, 0.4);
        Particles.ring(p.x, p.y, PAL.sage, 20, 540, 0.4, 5);
        this.floatText(p.x, p.y - 34, "ward spent", PAL.sage);
        Audio2.noise(0.14, 0.1, 1800);
        var wdx = p.x - x, wdy = p.y - y;
        var wl = Math.hypot(wdx, wdy) || 1;
        p.vx += (wdx / wl) * 200; p.vy += (wdy / wl) * 200;
        return;
      }
      p.health -= dmg;
      p.iframes = 0.9;       // brief mercy invuln
      p.hurtFlash = 0.5;
      p.hitScale = 1.35;
      this.flashRed = 0.6;
      this.addShake(12);
      this.hitStop = 0.05;
      buzz(35);
      Audio2.hurt();
      Particles.burst(p.x, p.y, 12, PAL.rose, 4, 16, 0.4);
      Particles.ring(p.x, p.y, PAL.rose, 20, 620, 0.42, 6);
      Particles.sparkBurst(p.x, p.y, 8, PAL.rose, 420, 0.36);
      // knockback away from source
      var kdx = p.x - x, kdy = p.y - y;
      var kl = Math.hypot(kdx, kdy) || 1;
      p.vx += (kdx / kl) * 300; p.vy += (kdy / kl) * 300;
      // POWER: reflect
      if (this.powers.reflect && this.dragon && this.dragon.state !== "bow") {
        this.damageDragon(4, this.dragon.x + (Math.random() - 0.5) * 40, this.dragon.y + (Math.random() - 0.5) * 40);
        this.floatText(this.dragon.x, this.dragon.y + 30, "reflect!", PAL.wisteria);
      }
      this.updateHUD();
      if (p.health <= 0) this.playerDefeated();
    },

    updatePickups: function (dt) {
      var p = this.player;
      var list = Pickups.list;
      for (var i = list.length - 1; i >= 0; i--) {
        var s = list[i];
        s.t += dt;
        // gravity-ish settle then magnet toward player
        var dx = p.x - s.x, dy = p.y - s.y;
        var dist = Math.hypot(dx, dy);
        // RELIC: thistle down — scales drift in from much farther away
        var magnetR = Save.hasRelic("thistleDown") ? 300 : 150;
        if (dist < magnetR || s.magnet) {
          s.magnet = true;
          var pull = 520;
          s.vx += (dx / dist) * pull * dt;
          s.vy += (dy / dist) * pull * dt;
        } else {
          s.vy += 60 * dt;
          s.vx *= Math.pow(0.5, dt); s.vy *= Math.pow(0.7, dt);
        }
        s.x += s.vx * dt; s.y += s.vy * dt;
        // collect
        if (dist < p.r * 0.7 + 12) {
          list.splice(i, 1);
          this.collectScale(s);
        } else if (s.t > 12) {
          list.splice(i, 1); // despawn
        }
      }
    },

    collectScale: function (s) {
      // lustrous scales bank 3; the gilded crest doubles AFTER the rare bonus
      var worth = s.rare ? 3 : 1;
      // TRINKET: burnished pinfeather — lustrous scales gleam one brighter
      if (s.rare && Save.hasTrinket("burnishedPinfeather")) worth += 1;
      if (Save.hasRegalia("gildedCrest") && this.player.health === this.player.maxHealth) worth *= 2;
      // DAILY: Brittle Scales — every scale banks double
      if (this.dailyMod("brittle")) worth *= 2;
      this.scaleProgress += worth;
      buzz(8);
      Audio2.scale();
      Particles.burst(this.player.x, this.player.y, 8, PAL.gold, 3, 12, 0.4);
      Particles.ring(this.player.x, this.player.y, PAL.gold, 12, 360, 0.32, 3);
      Particles.sparkBurst(this.player.x, this.player.y, 6, PAL.gold, 300, 0.3);
      if (s.rare) {
        this.floatText(this.player.x, this.player.y - 30, "+" + worth + " lustrous!", PAL.rose);
      } else {
        this.floatText(this.player.x, this.player.y - 30, "+" + worth + " scale" + (worth > 1 ? "s" : ""), PAL.gold);
      }
      this.updateHUD();
      if (this.scaleProgress >= this.nextPowerAt) {
        this.nextPowerAt += 4;
        this.offerPower();
      }
    },

    // ----- POWER OFFER -----
    offerPower: function () {
      // candidates the player doesn't have
      var avail = [];
      for (var id in POWERS) if (!this.powers[id]) avail.push(id);
      if (avail.length === 0) return;
      // pick up to 2
      var picks = [];
      var pool = avail.slice();
      for (var i = 0; i < 2 && pool.length; i++) {
        var idx = (Math.random() * pool.length) | 0;
        picks.push(pool.splice(idx, 1)[0]);
      }
      this.state = "POWER";
      Audio2.chargeStop();
      Audio2.power();
      var wrap = $("power-choices");
      wrap.innerHTML = "";
      for (var j = 0; j < picks.length; j++) {
        (function (pid) {
          var P = POWERS[pid];
          var btn = document.createElement("button");
          btn.className = "power-card";
          btn.type = "button";
          btn.innerHTML =
            '<span class="power-card-glyph">' + P.glyph + '</span>' +
            '<span class="power-card-text"><span class="power-card-name">' + P.name + '</span>' +
            '<span class="power-card-desc">' + P.desc + '</span></span>';
          btn.addEventListener("click", function () { Game.grantPower(pid); });
          wrap.appendChild(btn);
        })(picks[j]);
      }
      this.showScreen("power");
    },

    grantPower: function (id) {
      this.powers[id] = true;
      this.renderPowers();
      this.showScreen(null);
      this.state = "PLAYING";
      Audio2.power();
      var P = POWERS[id];
      this.floatText(VW / 2, VH * 0.5, P.name + " gained!", PAL.wisteria);
    },

    renderPowers: function () {
      var box = $("powers");
      box.innerHTML = "";
      for (var id in this.powers) {
        if (!this.powers[id]) continue;
        var el = document.createElement("div");
        el.className = "power-icon";
        el.title = POWERS[id].name + " — " + POWERS[id].desc;
        el.textContent = POWERS[id].glyph;
        box.appendChild(el);
      }
    },

    // ----- WIN / LOSE -----
    dragonDefeated: function () {
      var d = this.dragon;
      d.state = "bow"; d.bowT = 0;
      this.addShake(14);
      this.hitStop = 0.12;
      Particles.burst(d.x, d.y, 22, PAL.gold, 5, 26, 0.45);
      Particles.ring(d.x, d.y, PAL.gold, 30, 700, 0.7, 8);
      Particles.ring(d.x, d.y, "#fff6dd", 16, 460, 0.55, 4);
      Particles.sparkBurst(d.x, d.y, 16, PAL.gold, 520, 0.5);
      DragonShots.clear();
      buzz([20, 60, 40]);
      Audio2.victory();
      // bank only the scales earned since the previous duel
      Save.addScales(this.scaleProgress - this.scalesBanked);
      this.scalesBanked = this.scaleProgress;
      // lifetime records
      var rec0 = Save.data.records;
      rec0.totalDuelsWon++;
      if (this.scaleProgress > rec0.mostScalesRun) rec0.mostScalesRun = this.scaleProgress;
      Save.save();

      // ----- ceremonial victory: bonus scales + trophies, no relic, no crown -----
      if (d.ceremonial) {
        var bonus = 3 + d.tier;
        Save.addScales(bonus);
        Save.addDuel(d.type);
        // trophy ladder: 1st ceremony = plume, 2nd = regalia, then scales
        var plumeId = DRAGON_PLUME[d.type];
        var gotPlume = plumeId ? Save.addPlume(plumeId) : false;
        var regId = DRAGON_REGALIA[d.type];
        var gotRegalia = (!gotPlume && d.tier >= 1 && regId) ? Save.addRegalia(regId) : false;
        this.winIsFinal = false;
        var cName = d.name.replace("⟡ ", "").split(",")[0];
        var self2 = this;
        setTimeout(function () {
          self2.state = "WIN";
          self2.wipe();
          self2.setWinHeader("respect earned", "You have earned its respect");
          $("win-sub").textContent = cName + " bows once more, honored by the ceremony. " +
            bonus + " bonus scales join your hoard.";
          if (gotPlume && PLUMES[plumeId]) {
            var PL = PLUMES[plumeId];
            $("relic-grant").innerHTML =
              '<span class="relic-glyph">' + PL.glyph + '</span>' +
              '<span><span class="relic-text-name">Plume gained: ' + PL.name + '</span>' +
              '<br><span class="relic-text-desc">' + PL.desc + '</span></span>';
          } else if (gotRegalia && REGALIA[regId]) {
            var RG = REGALIA[regId];
            $("relic-grant").innerHTML =
              '<span class="relic-glyph">' + RG.glyph + '</span>' +
              '<span><span class="relic-text-name">Regalia gained: ' + RG.name + '</span>' +
              '<br><span class="relic-text-desc">' + RG.desc + '</span></span>';
          } else {
            $("relic-grant").innerHTML =
              '<span class="relic-glyph">✨</span>' +
              '<span><span class="relic-text-name">The ceremony deepens</span>' +
              '<br><span class="relic-text-desc">It will fight harder next time — and reward you better.</span></span>';
          }
          $("btn-continue").textContent = "Return to the sky";
          $("win-stats").textContent = self2.fmtRunStats();
          var ds2 = $("daily-share");
          if (ds2) ds2.hidden = true;
          self2.showScreen("win");
        }, reduceMotion ? 600 : 1400);
        return;
      }

      // grant this dragon's relic
      var relicId;
      if (d.type === "umbra") relicId = this.scaleProgress >= 24 ? "umbraGift" : "duskHeart";
      else if (d.type === "gilded") relicId = this.scaleProgress >= 20 ? "gildedGift" : "gildedHeart";
      else if (d.type === "verdant") relicId = this.scaleProgress >= 16 ? "verdantGift" : "thistleDown";
      else if (d.type === "storm") relicId = this.scaleProgress >= 12 ? "stormGift" : "galeFeather";
      else relicId = this.scaleProgress >= 8 ? "cinderGift" : "emberHeart";

      // GIFTS FROM THE HOARD: when BOTH of this dragon's relics are already
      // yours, it reaches deeper on a repeat victory — first its two
      // trinkets in order, then +2 bonus scales once the hoard runs dry.
      // Normal runs only: the Daily Flight keeps its own reward path.
      var giftTrinketId = null, giftScales = 0;
      var pair = DRAGON_RELICS[d.type];
      if (!this.daily && pair && Save.hasRelic(pair[0]) && Save.hasRelic(pair[1])) {
        var ladder = DRAGON_TRINKETS[d.type];
        if (!Save.hasTrinket(ladder[0])) giftTrinketId = ladder[0];
        else if (!Save.hasTrinket(ladder[1])) giftTrinketId = ladder[1];
        else giftScales = 2;
        if (giftTrinketId) {
          Save.addTrinket(giftTrinketId);
          this.refreshTrinkets(); // a keepsake starts working the moment it's yours
        } else {
          Save.addScales(giftScales);
        }
      }

      var hadBefore = Save.hasRelic(relicId);
      Save.addRelic(relicId); // dedupes an owned relic; still counts the win

      // mark this realm at peace
      var remaining = 0;
      if (this.sky) {
        for (var ri = 0; ri < this.sky.realms.length; ri++) {
          var rm = this.sky.realms[ri];
          if (rm.type === d.type) rm.defeated = true;
          else if (!rm.defeated) remaining++;
        }
      }
      var isFinal = remaining === 0;
      this.winIsFinal = isFinal;
      var firstName = d.name.split(",")[0];
      var self = this;

      // DAILY: another step of the route flown
      if (this.daily) {
        this.daily.idx++;
        if (isFinal) this.recordDaily(true);
      }

      // THE CROWNING — every realm at peace; the sky turns to gold
      if (isFinal) {
        Save.data.crowned = true;
        var fc = Save.data.records.fastestCrown;
        if (this.runStats && (fc == null || this.runStats.time < fc)) {
          Save.data.records.fastestCrown = Math.round(this.runStats.time);
        }
        Save.save();
        if (!reduceMotion) {
          Particles.ring(d.x, d.y, PAL.gold, 40, 900, 1.0, 10);
          Particles.ring(d.x, d.y, "#fff3c4", 24, 620, 0.8, 6);
          for (var ci3 = 0; ci3 < 10; ci3++) {
            Particles.glow(
              VW * (0.15 + Math.random() * 0.7), VH * (0.5 + Math.random() * 0.4),
              (Math.random() - 0.5) * 0.6, -1.4 - Math.random() * 1.6,
              8 + Math.random() * 12, 0.9, 1.3 + Math.random() * 0.6, PAL.gold, 0.6, 0.99);
          }
          this.flashWhite = 0.25;
        }
      }

      setTimeout(function () {
        self.state = "WIN";
        self.wipe(isFinal); // the crowning gets the golden wipe
        var R = RELICS[relicId];
        self.setWinHeader(isFinal ? "the crowning" : "respect earned",
          isFinal ? "Dragoose, Ruler of the Skies" : "You have earned its respect");
        if (isFinal) {
          $("win-sub").textContent = firstName + " bows amid the quieting sky. Every dragon's respect is yours — " +
            "the skies name you Dragoose, and " +
            self.scaleProgress + " scale" + (self.scaleProgress === 1 ? "" : "s") + " rest in your hoard.";
        } else if (self.daily) {
          var nxt2 = self.daily.route[self.daily.idx];
          $("win-sub").textContent = firstName + " bows its great head. The route carries on — " +
            DRAGONS[nxt2].name.split(",")[0] + " waits next.";
        } else {
          $("win-sub").textContent = firstName + " bows its great head. The sky opens again — " +
            remaining + " realm" + (remaining === 1 ? " still waits" : "s still wait") + " for you.";
        }
        // DAILY: the shareable result line (final crowning only)
        var ds = $("daily-share");
        if (ds) {
          if (isFinal && self.daily) {
            $("daily-share-text").textContent = self.dailyShareLine();
            var cb = $("btn-copy-daily");
            if (cb) cb.textContent = "copy";
            ds.hidden = false;
          } else {
            ds.hidden = true;
          }
        }
        if (giftTrinketId && TRINKETS[giftTrinketId]) {
          var T = TRINKETS[giftTrinketId];
          $("relic-grant").innerHTML =
            '<span class="relic-glyph">' + T.glyph + '</span>' +
            '<span><span class="relic-text-name">Gift from the hoard: ' + T.name + '</span>' +
            '<br><span class="relic-text-desc">' + T.desc + '</span></span>';
        } else if (giftScales > 0) {
          $("relic-grant").innerHTML =
            '<span class="relic-glyph">🪙</span>' +
            '<span><span class="relic-text-name">Gift from the hoard: +' + giftScales + ' scales</span>' +
            '<br><span class="relic-text-desc">Its hoard has nothing new — it shares scales instead.</span></span>';
        } else {
          $("relic-grant").innerHTML =
            '<span class="relic-glyph">' + R.glyph + '</span>' +
            '<span><span class="relic-text-name">' + (hadBefore ? "Relic strengthened: " : "Relic gained: ") + R.name + '</span>' +
            '<br><span class="relic-text-desc">' + R.desc + '</span></span>';
        }
        $("btn-continue").textContent = isFinal ? "Onward" : "Return to the sky";
        $("win-stats").textContent = self.fmtRunStats();
        self.showScreen("win");
      }, reduceMotion ? 600 : 1400);
    },

    playerDefeated: function () {
      this.state = "DEAD";
      Audio2.chargeStop();
      Audio2.death();
      this.flashWhite = 0.4;
      // DAILY: a fall still records the attempt (never over a better one)
      if (this.daily) this.recordDaily(false);
      Save.addScales(Math.floor(this.scaleProgress / 2)); // partial salvage
      if (this.scaleProgress > Save.data.records.mostScalesRun) {
        Save.data.records.mostScalesRun = this.scaleProgress; Save.save();
      }
      Particles.burst(this.player.x, this.player.y, 20, PAL.rose, 5, 24, 0.4);
      var self = this;
      setTimeout(function () {
        self.wipe();
        var dn = self.dragon ? self.dragon.name.split(",")[0] : "The dragon";
        var lines = [
          "You earned " + Math.floor(self.scaleProgress / 2) + " salvaged scales for the hoard.",
          "The dragon's respect must be won another day.",
          dn + " snorts. It expected more of a goose."
        ];
        $("dead-sub").textContent = lines[(Math.random() * lines.length) | 0];
        $("dead-stats").textContent = self.fmtRunStats();
        self.showScreen("dead");
      }, reduceMotion ? 300 : 700);
    },

    // ----- HUD -----
    updateHUD: function () {
      var d = this.dragon, p = this.player;
      // no duel, no boss bar (the open sky hides it)
      var bossBar = this._bossBarEl || (this._bossBarEl = document.querySelector(".boss-bar"));
      if (bossBar) bossBar.style.visibility = d ? "visible" : "hidden";
      if (d) {
        var pct = Math.max(0, d.health / d.maxHealth) * 100;
        var fill = $("boss-fill");
        fill.style.width = pct + "%";
        if (d.phase === 2) fill.classList.add("is-phase2"); else fill.classList.remove("is-phase2");
        $("boss-name").textContent = d.name + (d.phase === 2 ? " — enraged" : "");
      }
      $("scale-count").textContent = this.scaleProgress;
      // feathers
      var fb = $("feathers");
      if (p && fb.childElementCount !== p.maxHealth) {
        fb.innerHTML = "";
        for (var i = 0; i < p.maxHealth; i++) {
          var f = document.createElement("div");
          f.className = "feather";
          fb.appendChild(f);
        }
      }
      if (p) {
        var kids = fb.children;
        for (var j = 0; j < kids.length; j++) {
          if (j < p.health) kids[j].classList.remove("is-lost");
          else kids[j].classList.add("is-lost");
        }
      }
    },

    // =========================================================
    // RENDER
    // =========================================================
    render: function (alpha) {
      var g = ctx;
      g.clearRect(0, 0, VW, VH);

      // sky wash
      this.drawSky(g);

      g.save();
      // screen shake
      if (this.shake > 0) {
        var s = this.shake;
        g.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      }

      this.drawClouds(g, 0.5);   // far/mid clouds behind action

      if (this.state === "PLAYING" || this.state === "PAUSED" || this.state === "POWER" || this.state === "DEAD" || this.state === "WIN") {
        if (this.mode === "sky" && this.sky) this.drawRealms(g);
        if (this.dragon) this.drawDragon(g);
        Particles.draw(g);
        this.drawDragonShots(g);
        this.drawPickups(g);
        this.drawPlayerShots(g);
        if (this.player && this.state !== "DEAD") this.drawPlayer(g);
        if (this.player && this.state === "PLAYING") this.drawChargeUI(g);
      }

      this.drawClouds(g, 0.85, true); // nearest clouds in front for depth

      g.restore();

      // boss-intro name card (steady — drawn outside the shake transform)
      if (this.introT > 0 && this.mode === "duel" && this.dragon &&
          (this.state === "PLAYING" || this.state === "PAUSED")) {
        this.drawIntroCard(g);
      }

      // screen treatment: vignette + color grade in one pre-baked layer
      if (Fx.vignette) g.drawImage(Fx.vignette, 0, 0);

      // hit feedback: pain vignette instead of a flat color slab
      if (this.flashRed > 0 && Fx.redVignette) {
        g.save(); g.globalAlpha = Math.min(1, this.flashRed * 1.1);
        g.drawImage(Fx.redVignette, 0, 0); g.restore();
      }
      if (this.flashWhite > 0) {
        g.save(); g.globalAlpha = this.flashWhite; g.fillStyle = "#fbf7ee"; g.fillRect(0, 0, VW, VH); g.restore();
      }
    },

    drawSky: function (g) {
      // the slow-drifting backdrop is painted at half resolution every
      // other frame, then blitted in a single drawImage
      if (!Fx.skyLayer) {
        Fx.skyLayer = document.createElement("canvas");
        Fx.skyLayer.width = VW / 2; Fx.skyLayer.height = VH / 2;
        Fx.skyLayer._ctx = Fx.skyLayer.getContext("2d");
      }
      this._skyTick = (this._skyTick || 0) + 1;
      if (this._skyTick % 2 === 1) {
        var x = Fx.skyLayer._ctx;
        x.save();
        x.scale(0.5, 0.5);
        this.paintSky(x);
        x.restore();
      }
      g.drawImage(Fx.skyLayer, 0, 0, VW, VH);

      // dust motes glinting in the light (crisp, so drawn at full res)
      var mo = this.bg.motes || [];
      g.save();
      g.globalCompositeOperation = "lighter";
      for (var m = 0; m < mo.length; m++) {
        var mt = mo[m];
        var tw = 0.5 + 0.5 * Math.sin(this.time * mt.tw * 2 + mt.phase);
        g.globalAlpha = 0.1 + tw * 0.24;
        g.drawImage(Fx.dot("#fff7e0"), mt.x - mt.r * 2, mt.y - mt.r * 2, mt.r * 4, mt.r * 4);
      }
      g.restore();
    },

    paintSky: function (g) {
      var grd = g.createLinearGradient(0, 0, 0, VH);
      var t = (Math.sin(this.bg.washPhase) + 1) / 2;
      grd.addColorStop(0, "#e3f0f9");
      grd.addColorStop(0.34, this.mix("#b9d5eb", "#c4dcef", t));
      grd.addColorStop(0.68, this.mix("#83abce", "#8cb3d2", t));
      grd.addColorStop(1, "#4f7ba0");
      g.fillStyle = grd;
      g.fillRect(0, 0, VW, VH);

      // realm-proximity tint: nearing a realm warms the sky toward its pigment
      var tint = (this.mode === "sky" && this.sky) ? this.sky.tint : null;
      if (tint && tint.k > 0.02) {
        var tg = g.createRadialGradient(tint.x, tint.y, 0, tint.x, tint.y, VH * 0.85);
        tg.addColorStop(0, Fx.rgba(tint.color, 0.12 * tint.k));
        tg.addColorStop(0.55, Fx.rgba(tint.color, 0.05 * tint.k));
        tg.addColorStop(1, Fx.rgba(tint.color, 0));
        g.fillStyle = tg;
        g.fillRect(0, 0, VW, VH);
      }

      var sx = VW * 0.78, sy = VH * 0.1;

      // god rays sweeping slowly from the sun (pre-blurred fan)
      if (Fx.rays) {
        g.save();
        g.globalCompositeOperation = "lighter";
        g.translate(sx, sy);
        var spin = reduceMotion ? 0 : this.time * 0.025;
        var pulse = 0.5 + 0.5 * Math.sin(this.time * 0.35);
        g.rotate(spin);
        g.globalAlpha = 0.6 + pulse * 0.25;
        var rw = VH * 2.5;
        g.drawImage(Fx.rays, -rw / 2, -rw / 2, rw, rw);
        g.restore();
      }

      // the sun itself: layered bloom
      Fx.drawDot(g, sx, sy, 230, "#f7e9c4", 0.5, true);
      Fx.drawDot(g, sx, sy, 120, "#fbf0d2", 0.7, true);
      Fx.drawDot(g, sx, sy, 58, "#fffdf4", 0.95, true);

      // soft watercolor pigment blooms drifting
      g.save();
      g.globalAlpha = 0.09;
      var blobs = [
        { x: VW * 0.18, y: VH * 0.32, r: 210, c: PAL.wisteria },
        { x: VW * 0.82, y: VH * 0.6, r: 240, c: PAL.sage },
        { x: VW * 0.45, y: VH * 0.86, r: 210, c: PAL.rose }
      ];
      for (var i = 0; i < blobs.length; i++) {
        var b = blobs[i];
        var bx = b.x + Math.sin(this.bg.washPhase + i) * 24;
        var by = b.y + Math.cos(this.bg.washPhase + i * 1.3) * 20;
        g.drawImage(Fx.dot(b.c), bx - b.r, by - b.r, b.r * 2, b.r * 2);
      }
      g.restore();

      // horizontal haze bands (atmospheric depth)
      g.save();
      var hz1 = VH * (0.5 + 0.02 * Math.sin(this.time * 0.2));
      var hzg = g.createLinearGradient(0, hz1 - 90, 0, hz1 + 90);
      hzg.addColorStop(0, "rgba(232,242,250,0)");
      hzg.addColorStop(0.5, "rgba(232,242,250,0.13)");
      hzg.addColorStop(1, "rgba(232,242,250,0)");
      g.fillStyle = hzg;
      g.fillRect(0, hz1 - 90, VW, 180);
      var hz2 = VH * (0.82 + 0.015 * Math.cos(this.time * 0.16));
      hzg = g.createLinearGradient(0, hz2 - 70, 0, hz2 + 70);
      hzg.addColorStop(0, "rgba(214,231,244,0)");
      hzg.addColorStop(0.5, "rgba(214,231,244,0.12)");
      hzg.addColorStop(1, "rgba(214,231,244,0)");
      g.fillStyle = hzg;
      g.fillRect(0, hz2 - 70, VW, 140);
      g.restore();
    },

    drawClouds: function (g, depthFilter, front) {
      var c = this.bg.clouds;
      if (!Fx.cloudSprites.length) return;
      g.save();
      for (var i = 0; i < c.length; i++) {
        var cl = c[i];
        var isFront = cl.depth >= 0.8;
        if (front && !isFront) continue;
        if (!front && isFront) continue;
        var img = Fx.cloudSprites[cl.variant % Fx.cloudSprites.length];
        g.globalAlpha = cl.alpha;
        var w = 360 * cl.scale, h = 200 * cl.scale;
        if (cl.flip) {
          g.save();
          g.translate(cl.x, cl.y);
          g.scale(-1, 1);
          g.drawImage(img, -w / 2, -h / 2, w, h);
          g.restore();
        } else {
          g.drawImage(img, cl.x - w / 2, cl.y - h / 2, w, h);
        }
      }
      g.restore();
    },

    drawPlayer: function (g) {
      var p = this.player;

      // altitude shadow drifting on the haze below
      g.save();
      g.translate(p.x + 14, p.y + 34);
      g.scale(1.25, 0.55);
      g.globalAlpha = 0.16;
      g.drawImage(Fx.dot("#22334c"), -30, -30, 60, 60);
      g.restore();

      // rig Gary into the scratch canvas once per frame
      var sc = p.hitScale * 0.42;
      var k = (300 * sc) / 140;
      var scr = Fx.scratch("goose", 150, 130);
      var sg = scr._ctx;
      sg.save();
      sg.translate(75, 72);
      var plume = PLUMES[Save.data.plume];
      Art.goose(sg, {
        flap: p.flapPhase || 0,
        bank: p.bank,
        hurt: Math.min(1, p.hurtFlash * 1.6),
        charge: p.charging ? p.charge : 0,
        tint: plume ? plume.color : null,
        gear: {
          horns: Save.hasRegalia("emberHorns"),
          spade: Save.hasRegalia("tempestSpade"),
          mantle: Save.hasRegalia("sorrelMantle"),
          cowl: Save.hasRegalia("duskCowl"),
          crown: Save.data.crowned
        }
      });
      sg.restore();

      // REGALIA: Dusk Cowl — the shadow decoy left behind by a dodge, a
      // dark goose-shaped stain fading out (same cached rig, low alpha)
      var dc = this.decoy;
      if (dc) {
        var dct = Math.max(0, dc.t / (dc.maxT || 2));
        g.save();
        g.translate(dc.x, dc.y);
        g.rotate(dc.facing + Math.PI / 2);
        Fx.drawDot(g, 0, 0, 52, "#362d54", 0.3 * dct, false);
        g.globalAlpha = 0.16 + 0.18 * dct;
        g.scale(k, k);
        g.drawImage(scr, -75, -72);
        g.restore();
      }

      // dash afterimages (cool spectral ghosts)
      for (var gi = 0; gi < p.ghosts.length; gi++) {
        var gh = p.ghosts[gi];
        var gt = gh.life / gh.maxLife;
        g.save();
        g.translate(gh.x, gh.y);
        g.rotate(gh.facing + Math.PI / 2 + gh.bank * 0.5);
        g.globalAlpha = gt * 0.3;
        g.scale(k, k);
        g.drawImage(scr, -75, -72);
        g.restore();
      }

      g.save();
      // gentle hover bob (world-space, before rotation)
      g.translate(p.x, p.y + Math.sin(this.time * 2.4) * 2.2);
      // rig is drawn facing UP; rotate so up aligns with facing
      g.rotate(p.facing + Math.PI / 2 + p.bank * 0.5);
      // i-frame shimmer
      if (p.iframes > 0) {
        var flick = Math.sin(this.time * 40) * 0.5 + 0.5;
        g.globalAlpha = 0.45 + flick * 0.4;
      }
      g.scale(k, k);
      g.drawImage(scr, -75, -72);
      g.restore();

      // REGALIA: the leaf ward shimmers as a slow ring of green light
      if (p.ward) {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(this.time * 1.1);
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = Fx.rgba(PAL.sage, 0.4 + Math.sin(this.time * 4) * 0.12);
        g.lineWidth = 2.5;
        g.lineCap = "round";
        for (var wi = 0; wi < 4; wi++) {
          g.beginPath();
          g.arc(0, 0, 42, wi * (TAU / 4), wi * (TAU / 4) + 1.0);
          g.stroke();
        }
        Fx.drawDot(g, 0, 0, 50, PAL.sage, 0.08, true);
        g.restore();
      }
    },

    drawChargeUI: function (g) {
      var p = this.player;
      if (p.charge <= 0.02) return;
      var full = p.charge >= 0.98;
      g.save();
      g.translate(p.x, p.y);
      var radius = 36 + p.charge * 18;

      // gathering heat: layered additive aura, breathing with the charge
      var breathe = 1 + Math.sin(this.time * (6 + p.charge * 8)) * 0.06;
      var auraCol = this.mix(PAL.ember, PAL.rose, p.charge);
      Fx.drawDot(g, 0, 0, radius * 1.5 * breathe, PAL.ember, 0.12 + p.charge * 0.22, true);
      Fx.drawDot(g, 0, 0, radius * 0.9 * breathe, auraCol, 0.1 + p.charge * 0.3, true);
      if (full) Fx.drawDot(g, 0, 0, radius * 0.55, "#fff3d6", 0.5 + Math.sin(this.time * 12) * 0.2, true);

      // arc meter with a soft glow underlay
      g.globalCompositeOperation = "lighter";
      g.lineCap = "round";
      g.globalAlpha = 0.35;
      g.strokeStyle = auraCol;
      g.lineWidth = 9;
      g.beginPath();
      g.arc(0, 0, radius + 5, -Math.PI / 2, -Math.PI / 2 + p.charge * TAU);
      g.stroke();
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 0.95;
      g.strokeStyle = full ? PAL.gold : "#fbf7ee";
      g.lineWidth = 3.5;
      g.beginPath();
      g.arc(0, 0, radius + 5, -Math.PI / 2, -Math.PI / 2 + p.charge * TAU);
      g.stroke();
      // faint full-track guide
      g.globalAlpha = 0.18;
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(0, 0, radius + 5, 0, TAU); g.stroke();
      g.restore();
    },

    // layered procedural fireball: smoky base, additive flame body, hot core
    drawFireball: function (g, s, hotColor, dim) {
      var t = this.time;
      var flick = 0.92 + Math.sin(t * 26 + s.seed * 7) * 0.08;
      // trail: tapering embers along recent path
      var tr = s.trail;
      for (var i = 1; i < tr.length; i++) {
        var tt = 1 - i / tr.length;
        Fx.drawDot(g, tr[i].x, tr[i].y, s.r * (0.4 + tt * 0.55), hotColor, tt * (dim ? 0.16 : 0.24), true);
      }
      // smoky underlayer keeps the flame readable on a bright sky
      Fx.drawDot(g, s.x, s.y, s.r * 1.28, PAL.emberDeep, dim ? 0.5 : 0.6, false);
      // flame body streams slightly behind the direction of travel
      var bx = -Math.cos(s.rot) * s.r * 0.34, by = -Math.sin(s.rot) * s.r * 0.34;
      Fx.drawDot(g, s.x, s.y, s.r * 1.9 * flick, hotColor, dim ? 0.3 : 0.4, true);
      Fx.drawDot(g, s.x + bx, s.y + by, s.r * 1.05, hotColor, 0.75, true);
      Fx.drawDot(g, s.x, s.y, s.r * 0.72 * flick, PAL.gold, 0.85, true);
      Fx.drawDot(g, s.x + bx * 0.3, s.y + by * 0.3, s.r * 0.4 * flick, "#fffbe9", 0.95, true);
    },

    // jagged, flickering lightning bolt
    drawBolt: function (g, s, col) {
      col = col || PAL.wisteria;
      var ang = s.rot;
      var len = s.r * 3.4;
      var px = Math.cos(ang + Math.PI / 2), py = Math.sin(ang + Math.PI / 2);
      Fx.drawDot(g, s.x, s.y, s.r * 1.9, col, 0.5, true);
      g.save();
      g.globalCompositeOperation = "lighter";
      g.lineCap = "round"; g.lineJoin = "round";
      for (var pass = 0; pass < 2; pass++) {
        g.strokeStyle = pass === 0 ? Fx.rgba(col, 0.65) : "rgba(255,255,255,0.92)";
        g.lineWidth = pass === 0 ? 5.5 : 2.2;
        g.beginPath();
        var segs = 5;
        for (var i = 0; i <= segs; i++) {
          var ti = i / segs;
          var jit = (i === 0 || i === segs) ? 0 : (Math.random() - 0.5) * s.r * 1.1;
          var lx = s.x + Math.cos(ang) * (ti - 0.5) * len + px * jit;
          var ly = s.y + Math.sin(ang) * (ti - 0.5) * len + py * jit;
          if (i === 0) g.moveTo(lx, ly); else g.lineTo(lx, ly);
        }
        g.stroke();
      }
      g.restore();
    },

    drawPlayerShots: function (g) {
      var self = this;
      PlayerShots.forEach(function (s) {
        if (s.kind === "bolt") {
          self.drawBolt(g, s);
        } else {
          var hot = s.color === PAL.rose ? PAL.rose : PAL.ember;
          self.drawFireball(g, s, hot, false);
          // charged rose blasts get an extra corona
          if (s.color === PAL.rose) {
            Fx.drawDot(g, s.x, s.y, s.r * 2.5, PAL.rose, 0.16 + Math.sin(self.time * 18 + s.seed) * 0.05, true);
          }
        }
      });
    },

    drawDragonShots: function (g) {
      var self = this;
      DragonShots.forEach(function (s) {
        if (s.kind === "breath") {
          // breath droplets as pooled watercolor: each is a ragged pigment
          // blot — offset soft pools (stable per-droplet via the seed), a
          // darker edge settling behind the travel direction, and an alpha
          // ease so blots bloom wet then dry away
          var isRay2 = s.color === PAL.gold;                 // gilded sun-beam vs ember breath
          var maxL2 = isRay2 ? 0.95 : 2.4;
          var age2 = 1 - Math.max(0, s.life) / maxL2;        // 0 fresh -> 1 spent
          var ease2 = age2 < 0.22 ? age2 / 0.22 : 1 - (age2 - 0.22) / 0.78;
          if (ease2 < 0) ease2 = 0;
          var spread2 = 1 + age2 * 0.55;                     // pigment soaks outward
          var sd2 = s.seed;
          var bx3 = -Math.cos(s.rot) * s.r * 0.55;           // opposite travel
          var by3 = -Math.sin(s.rot) * s.r * 0.55;
          var edgeC2 = isRay2 ? "#a8863c" : PAL.emberDeep;
          var bodyC2 = isRay2 ? PAL.gold : PAL.ember;
          var coreC2 = isRay2 ? "#fff3c4" : PAL.gold;
          // wet base wash + darker edge pooling at the trailing rim
          Fx.drawDot(g, s.x + bx3 * 0.4, s.y + by3 * 0.4, s.r * 1.55 * spread2, edgeC2, 0.08 + 0.26 * ease2, false);
          Fx.drawDot(g, s.x + bx3, s.y + by3, s.r * 0.8 * spread2, edgeC2, 0.34 * ease2, false);
          // ragged blot: offset pigment pools of varying radius
          Fx.drawDot(g, s.x + Math.cos(sd2) * s.r * 0.42, s.y + Math.sin(sd2) * s.r * 0.42, s.r * 1.05 * spread2, bodyC2, 0.42 * ease2, true);
          Fx.drawDot(g, s.x + Math.cos(sd2 * 2.3) * s.r * 0.55, s.y + Math.sin(sd2 * 2.3) * s.r * 0.55, s.r * 0.72 * spread2, bodyC2, 0.38 * ease2, true);
          Fx.drawDot(g, s.x + Math.cos(sd2 * 3.7) * s.r * 0.3, s.y + Math.sin(sd2 * 3.7) * s.r * 0.3, s.r * 0.5 * spread2, coreC2, 0.5 * ease2, true);
          Fx.drawDot(g, s.x, s.y, s.r * 0.34, coreC2, 0.55 * ease2, true);
        } else if (s.kind === "zap") {
          // hostile lightning: deep indigo rim keeps it readable on the sky
          Fx.drawDot(g, s.x, s.y, s.r * 1.8, "#2f3f66", 0.34, false);
          self.drawBolt(g, s, s.color || "#8fd0ff");
        } else if (s.kind === "seed") {
          // drifting seed pod: dark husk, pulsing green heart, gold fuse glint
          var pu = 0.5 + Math.sin(self.time * (6 + s.seed) ) * 0.5;
          Fx.drawDot(g, s.x, s.y, s.r * 1.7, "#3c4f36", 0.5, false);
          Fx.drawDot(g, s.x, s.y, s.r * 1.15, PAL.sage, 0.75, true);
          Fx.drawDot(g, s.x, s.y, s.r * (0.5 + pu * 0.2), "#e5f0a8", 0.6 + pu * 0.3, true);
          for (var ti2 = 1; ti2 < s.trail.length; ti2++) {
            var tt2 = 1 - ti2 / s.trail.length;
            Fx.drawDot(g, s.trail[ti2].x, s.trail[ti2].y, s.r * 0.5 * tt2, PAL.sage, tt2 * 0.2, true);
          }
        } else if (s.kind === "petal") {
          // whirling petal: rose bloom over a moss rim
          Fx.drawDot(g, s.x, s.y, s.r * 1.6, "#5e4a4a", 0.3, false);
          Fx.drawDot(g, s.x, s.y, s.r * 1.25, PAL.rose, 0.7, true);
          Fx.drawDot(g, s.x, s.y, s.r * 0.55, "#f3d9de", 0.8, true);
        } else if (s.kind === "lure") {
          // false scale: gold glint with a dark rim + slow pulse (the tell)
          var lp2 = 0.5 + Math.sin(self.time * 2.2 + s.seed) * 0.5;
          Fx.drawDot(g, s.x, s.y, s.r * 2.0, "#59481f", 0.42, false);
          Fx.drawDot(g, s.x, s.y, s.r * 1.25, PAL.gold, 0.5 + lp2 * 0.3, true);
          Fx.drawDot(g, s.x, s.y, s.r * 0.55, "#fff3c4", 0.45 + lp2 * 0.4, true);
        } else if (s.kind === "dusk") {
          // dusk blot: violet bloom over a dark plum rim, trailing faint
          // wisps of falling night (5 drawDot calls max)
          Fx.drawDot(g, s.x, s.y, s.r * 1.8, "#362d54", 0.42, false);
          Fx.drawDot(g, s.x, s.y, s.r * 1.2, "#8a7bb0", 0.7, true);
          Fx.drawDot(g, s.x, s.y, s.r * 0.5, "#e6d8ff", 0.75, true);
          for (var du = 1; du < s.trail.length; du += 2) {
            var dut = 1 - du / s.trail.length;
            Fx.drawDot(g, s.trail[du].x, s.trail[du].y, s.r * 0.65 * dut, "#6d5f96", dut * 0.24, true);
          }
        } else if (s.kind === "coin") {
          // spinning gilded disc, flashing thin as it turns
          g.save();
          g.translate(s.x, s.y);
          g.rotate(s.rot * 0.4);
          var cw2 = Math.abs(Math.sin(self.time * 9 + s.seed)) * 0.75 + 0.25;
          g.scale(cw2, 1);
          g.beginPath(); g.arc(0, 0, s.r, 0, TAU);
          g.fillStyle = "#d9b96a"; g.fill();
          g.lineWidth = 2.4; g.strokeStyle = "#8a6f2e";
          g.globalAlpha = 0.85; g.stroke(); g.globalAlpha = 1;
          g.restore();
          Fx.drawDot(g, s.x, s.y, s.r * 1.7, PAL.gold, 0.22, true);
        } else {
          // hostile crimson rim under the flame so enemy fire reads at a glance
          Fx.drawDot(g, s.x, s.y, s.r * 1.7, "#a03428", 0.32, false);
          self.drawFireball(g, s, s.color === PAL.emberDeep ? PAL.emberDeep : PAL.ember, true);
        }
      });
    },

    drawPickups: function (g) {
      var img;
      for (var i = 0; i < Pickups.list.length; i++) {
        var s = Pickups.list[i];
        img = s.type === "ember" ? (Fx.baked.scaleEmber || images.scaleEmber)
            : (s.type === "storm" ? (Fx.baked.scaleStorm || images.scaleStorm) : (Fx.baked.scale || images.scale));
        if (!img) continue;
        g.save();
        g.translate(s.x, s.y);
        var bob = Math.sin(s.t * 5) * 4;
        g.translate(0, bob);

        // pulsing treasure glow (lustrous: iridescent hue-shifting shimmer)
        var pulse = 0.5 + Math.sin(s.t * 6) * 0.2;
        if (s.rare) {
          var li = (s.t * 2.4) | 0;
          Fx.drawDot(g, 0, 0, 54, LUSTRE[li % 3], pulse * 0.6, true);
          Fx.drawDot(g, 0, 0, 30, LUSTRE[(li + 1) % 3], pulse * 0.5, true);
          Fx.drawDot(g, 0, 0, 20, "#fff3cf", pulse * 0.55, true);
        } else {
          Fx.drawDot(g, 0, 0, 40, PAL.gold, pulse * 0.55, true);
          Fx.drawDot(g, 0, 0, 20, "#fff3cf", pulse * 0.5, true);
        }

        // rotating four-point gleam
        g.save();
        g.globalCompositeOperation = "lighter";
        g.rotate(s.t * 0.9);
        g.strokeStyle = "rgba(255,244,208,0.75)";
        g.lineCap = "round";
        for (var k = 0; k < 2; k++) {
          var gl = k === 0 ? 26 + pulse * 8 : 15;
          g.lineWidth = k === 0 ? 2 : 1.4;
          g.beginPath();
          g.moveTo(-gl, 0); g.lineTo(gl, 0);
          g.moveTo(0, -gl); g.lineTo(0, gl);
          g.stroke();
          g.rotate(Math.PI / 4);
        }
        g.restore();

        g.rotate(Math.sin(s.t * 2) * 0.3);
        var sz = s.rare ? 72 : 56;
        g.drawImage(img, -sz / 2, -sz / 2, sz, sz);
        g.restore();
      }
    },

    // boss-intro name card: serif name over a thin gold rule, fading with introT
    drawIntroCard: function (g) {
      var d = this.dragon;
      var t = 1 - this.introT / (this.introDur || 1);
      if (t < 0) t = 0; else if (t > 1) t = 1;
      // fade in over the first ~18%, out over the last ~28%
      var a = Math.min(1, t / 0.18, (1 - t) / 0.28);
      if (a <= 0.01) return;
      var cy = VH * 0.45;
      g.save();
      // a soft paper wash so the serif reads on any sky
      Fx.drawDot(g, VW / 2, cy + 6, 190, "#f6f1e7", 0.55 * a, false);
      g.globalAlpha = a;
      g.textAlign = "center";
      g.font = 'italic 600 33px "Cormorant Garamond", Georgia, serif';
      g.fillStyle = Fx.rgba(PAL.ink, 0.9);
      var nm = d.ceremonial ? d.name.replace("⟡ ", "") : d.name;
      g.fillText(nm, VW / 2, cy);
      // thin gold rule, drawing itself wider as the card settles
      var rw = 110 * (0.45 + 0.55 * Math.min(1, t / 0.4));
      g.strokeStyle = Fx.rgba(PAL.gold, 0.95);
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(VW / 2 - rw, cy + 16);
      g.lineTo(VW / 2 + rw, cy + 16);
      g.stroke();
      if (d.ceremonial) {
        g.font = 'italic 500 20px "Cormorant Garamond", Georgia, serif';
        g.fillStyle = Fx.rgba("#8a7940", 0.95);
        g.fillText("⟡ Ceremonial duel", VW / 2, cy + 42);
      }
      g.restore();
    },

    // the open sky's realm vortexes — swirling pools of each dragon's pigment
    drawRealms: function (g) {
      var t = this.time;

      // DAILY: a faint dashed path threading the realms in route order,
      // drifting slowly like a current in the sky (under the rings)
      if (this.daily && this.sky.routeOrder) {
        var ro = this.sky.routeOrder;
        g.save();
        g.strokeStyle = Fx.rgba(PAL.pondDeep, 0.26);
        g.lineWidth = 2;
        g.lineCap = "round";
        g.setLineDash(DAILY_DASH);
        if (!reduceMotion) g.lineDashOffset = -t * 12;
        g.beginPath();
        for (var pi = 0; pi < ro.length; pi++) {
          if (pi === 0) g.moveTo(ro[pi].x, ro[pi].y);
          else g.lineTo(ro[pi].x, ro[pi].y);
        }
        g.stroke();
        g.restore();
      }

      for (var i = 0; i < this.sky.realms.length; i++) {
        var rm = this.sky.realms[i];
        var bob = Math.sin(t * 0.9 + rm.phase) * 6;
        var x = rm.x, y = rm.y + bob;
        var breathe = 1 + Math.sin(t * 1.6 + rm.phase) * 0.05;

        if (rm.defeated) {
          // at peace: a calm golden bloom
          Fx.drawDot(g, x, y, rm.r * 1.15, PAL.gold, 0.16, true);
          Fx.drawDot(g, x, y, rm.r * 0.55, "#fff3d6", 0.22, true);
          // HARMONY: once crowned, the befriended dragon circles its realm
          if (Save.data.crowned) {
            var mimg = Fx.miniDragon(rm.type);
            var oa = this.time * 0.25 + rm.phase;
            var ox = x + Math.cos(oa) * rm.r * 1.35;
            var oy = y + Math.sin(oa) * rm.r * 1.35;
            g.save();
            g.translate(ox, oy);
            g.rotate(oa + Math.PI); // rig faces up; face along the orbit
            g.globalAlpha = 0.8;
            g.scale(0.5, 0.5);
            g.drawImage(mimg, -mimg.width / 2, -mimg.height / 2);
            g.restore();
          }
          g.save();
          g.globalAlpha = 0.5;
          g.strokeStyle = PAL.gold;
          g.lineWidth = 2;
          g.beginPath(); g.arc(x, y, rm.r * 0.8, 0, TAU); g.stroke();
          g.restore();
        } else {
          // pigment pool: layered washes + a slowly turning ragged ring
          Fx.drawDot(g, x, y, rm.r * 1.6 * breathe, rm.pal.a, 0.18, true);
          Fx.drawDot(g, x, y, rm.r * 1.05 * breathe, rm.pal.b, 0.3, false);
          Fx.drawDot(g, x, y, rm.r * 0.55, rm.pal.b, 0.32, false);
          Fx.drawDot(g, x, y, rm.r * 0.32, rm.pal.a, 0.3, true);

          g.save();
          g.translate(x, y);
          g.rotate(t * 0.35 + rm.phase);
          g.strokeStyle = Fx.rgba(rm.pal.b, 0.5);
          g.lineWidth = 2.5;
          g.lineCap = "round";
          for (var s2 = 0; s2 < 5; s2++) {
            g.beginPath();
            g.arc(0, 0, rm.r * 0.82, s2 * (TAU / 5), s2 * (TAU / 5) + 0.8);
            g.stroke();
          }
          // orbiting motes drawn into the swirl
          g.globalCompositeOperation = "lighter";
          for (var m2 = 0; m2 < 3; m2++) {
            var ma = t * (0.7 + m2 * 0.23) + m2 * 2.1 + rm.phase;
            Fx.drawDot(g, Math.cos(ma) * rm.r * 0.62, Math.sin(ma) * rm.r * 0.62,
              7 + m2 * 2, "#fff7e0", 0.5, true);
          }
          g.restore();

          // TRINKET: weathervane — an unbowed realm's ring glints when Gary
          // is facing it (in a daily, only the route's next stop answers)
          if (this.tk && this.tk.vane && this.player &&
              (!this.daily || rm.routeIdx === this.daily.idx)) {
            var va = Math.atan2(y - this.player.y, x - this.player.x);
            var vd = ((va - this.player.facing + Math.PI) % TAU + TAU) % TAU - Math.PI;
            if (vd < 0.3 && vd > -0.3) {
              var vp = reduceMotion ? 1 : 0.7 + Math.sin(t * 6 + rm.phase) * 0.3;
              Fx.drawDot(g, x, y - rm.r * 0.82, 9 * vp + 4, "#fff7e0", 0.85, true);
              Fx.drawDot(g, x, y - rm.r * 0.82, 3.5, "#ffffff", 0.9, true);
            }
          }
        }

        // realm label
        g.save();
        g.textAlign = "center";
        g.font = 'italic 500 21px "Cormorant Garamond", Georgia, serif';
        g.fillStyle = Fx.rgba("#2e3a48", rm.defeated ? 0.5 : 0.8);
        g.fillText(rm.name, x, y + rm.r + 26);
        if (rm.defeated) {
          g.font = '600 10px Karla, sans-serif';
          g.fillStyle = Fx.rgba("#8a7940", 0.85);
          g.fillText("R E S P E C T E D", x, y + rm.r + 43);
          if (!this.daily) {
            g.font = 'italic 14px "Cormorant Garamond", Georgia, serif';
            g.fillStyle = Fx.rgba("#2e3a48", 0.55);
            g.fillText("enter for a ceremonial duel", x, y + rm.r + 61);
          }
        }
        g.restore();

        // DAILY: route-order badge above each ring — the next stop on the
        // route glows gold; later stops sit faint; flown stops fade out
        if (this.daily && rm.routeIdx >= 0) {
          var isNext = !rm.defeated && rm.routeIdx === this.daily.idx;
          var bx = x, by = y - rm.r - 18;
          g.save();
          if (rm.defeated) g.globalAlpha = 0.35;
          Fx.drawDot(g, bx, by, 15, isNext ? PAL.gold : "#fdfbf4", isNext ? 0.55 : 0.4, true);
          g.strokeStyle = Fx.rgba(isNext ? "#8a7940" : PAL.ink, isNext ? 0.85 : 0.4);
          g.lineWidth = isNext ? 2 : 1.4;
          g.beginPath();
          g.arc(bx, by, isNext ? 12 + (reduceMotion ? 0 : Math.sin(t * 2.4 + rm.phase) * 1.2) : 11, 0, TAU);
          g.stroke();
          g.textAlign = "center";
          g.font = isNext ? '700 15px Karla, sans-serif' : '600 13px Karla, sans-serif';
          g.fillStyle = Fx.rgba(PAL.ink, isNext ? 0.92 : 0.55);
          g.fillText(rm.routeLabel, bx, by + 5);
          g.restore();
        }
      }

      // HARMONY: crowned skies belong to everyone — geese drift freely
      if (Save.data.crowned) {
        g.save();
        g.strokeStyle = "rgba(253, 251, 244, 0.9)";
        g.lineCap = "round";
        g.lineJoin = "round";
        for (var gz = 0; gz < HARMONY_GEESE.length; gz++) {
          var gs = HARMONY_GEESE[gz];
          var gx = ((this.time * gs.spd + gs.phase * 140) % (VW + 80)) - 40;
          var gy = VH * gs.y0 + Math.sin(this.time * gs.freq + gs.phase) * gs.amp;
          var fl2 = Math.sin(this.time * 5.2 + gs.phase * 3) * gs.size * 0.4;
          g.lineWidth = 1.7;
          g.globalAlpha = 0.65;
          g.beginPath();
          g.moveTo(gx - gs.size, gy - fl2);
          g.lineTo(gx, gy + gs.size * 0.42);
          g.lineTo(gx + gs.size, gy - fl2);
          g.stroke();
        }
        g.restore();
      }
    },

    drawDragon: function (g) {
      var d = this.dragon;

      // dusk veil: how solid the dragon is right now (1 = fully there)
      var veilA = 1;
      if (d.state === "veil") {
        if (d.stateT < 0.4) veilA = 1 - (d.stateT / 0.4) * 0.94;      // dissolve
        else if (d.stateT < 1.0) veilA = 0.06;                        // veiled
        else veilA = 0.06 + Math.min(1, (d.stateT - 1.0) / 0.15) * 0.94; // return
        // expanding dusk ripples telegraph the arrival point
        if (d.stateT >= 0.28 && d.stateT < 1.02) {
          var vp = Math.min(1, (d.stateT - 0.28) / 0.7);
          g.save();
          Fx.drawDot(g, d.veilX, d.veilY, d.r * (0.4 + vp * 0.55), "#4a3f6e", 0.14 + vp * 0.2, true);
          g.globalCompositeOperation = "lighter";
          g.lineCap = "round";
          for (var vri = 0; vri < 3; vri++) {
            var vq = vp - vri * 0.22;
            if (vq < 0 || vq > 1) continue;
            g.globalAlpha = (1 - vq) * 0.55;
            g.strokeStyle = vri === 1 ? "#cbb8e8" : "#8a7bb0";
            g.lineWidth = 3 - vri * 0.6;
            g.beginPath(); g.arc(d.veilX, d.veilY, 18 + vq * d.r * 1.1, 0, TAU); g.stroke();
          }
          g.restore();
        }
      }

      // altitude shadow
      g.save();
      g.translate(d.x + 26, d.y + 64);
      g.scale(1.5, 0.6);
      g.globalAlpha = 0.15 * veilA;
      g.drawImage(Fx.dot("#22334c"), -80, -80, 160, 160);
      g.restore();

      g.save();
      g.translate(d.x, d.y);

      // enraged: heat aura beneath the body (storm: cold static halo)
      if (d.phase === 2 && d.state !== "bow") {
        var hp = 0.5 + Math.sin(this.time * 5) * 0.5;
        var auraA = d.type === "storm" ? "#3d6288" : d.type === "verdant" ? "#597a52" : d.type === "umbra" ? "#4a3f6e" : PAL.emberDeep;
        var auraB = d.type === "storm" ? PAL.wisteria : d.type === "verdant" ? PAL.gold : d.type === "umbra" ? PAL.wisteria : PAL.rose;
        Fx.drawDot(g, 0, 0, d.r * (1.35 + hp * 0.12), auraA, 0.1 + hp * 0.08, true);
        Fx.drawDot(g, 0, 0, d.r * 0.9, auraB, 0.07 + hp * 0.07, true);
      }
      // bowing: warm golden halo of respect
      if (d.state === "bow") {
        Fx.drawDot(g, 0, 0, d.r * 1.5, PAL.gold, 0.2 + Math.sin(this.time * 3) * 0.06, true);
      }

      // ----- telegraphs: painterly, readable wind-ups -----
      if (d.state === "telegraph") {
        var prog = 1 - d.telegraph / d.telegraphMax;
        var pul = 0.5 + Math.sin(this.time * 18) * 0.5;
        var tc = d.telegraphType === "dash" ? PAL.rose
               : d.type === "storm" ? "#bfe3ff"
               : d.type === "verdant" ? "#d9ecc2"
               : d.type === "umbra" ? "#cbb8e8"
               : PAL.gold;
        var aim = d.telegraphType === "breath" ? d.breathAng : Math.atan2(this.player.y - d.y, this.player.x - d.x);

        // charging glow gathers on the dragon
        Fx.drawDot(g, 0, 0, d.r * (0.9 + prog * 0.5), tc, 0.16 + prog * 0.24, true);

        g.save();
        g.rotate(aim);
        if (d.telegraphType === "nova" || d.telegraphType === "spiral") {
          // radial wind-up: a swelling disc + jittering arcs (static or vines)
          var rc1 = d.telegraphType === "spiral" ? PAL.sage : PAL.wisteria;
          var rc2 = d.telegraphType === "spiral" ? "#d9ecc2" : "#8fd0ff";
          var nr = d.r * (0.7 + prog * 0.9);
          var ng = g.createRadialGradient(0, 0, d.r * 0.3, 0, 0, nr);
          ng.addColorStop(0, Fx.rgba(rc1, 0.28 * (0.3 + prog * 0.7)));
          ng.addColorStop(0.7, Fx.rgba(rc2, 0.16 * (0.3 + prog * 0.7)));
          ng.addColorStop(1, Fx.rgba(rc2, 0));
          g.fillStyle = ng;
          g.beginPath(); g.arc(0, 0, nr, 0, TAU); g.fill();
          g.globalCompositeOperation = "lighter";
          g.strokeStyle = Fx.rgba(d.telegraphType === "spiral" ? "#eef5da" : "#dff0ff", 0.3 + prog * 0.5 * pul);
          g.lineWidth = 2.5;
          for (var zi = 0; zi < 5; zi++) {
            var za = (zi / 5) * TAU + this.time * 3;
            var zr1 = d.r * 0.5, zr2 = nr * (0.85 + Math.random() * 0.2);
            g.beginPath();
            g.moveTo(Math.cos(za) * zr1, Math.sin(za) * zr1);
            var zmid = (zr1 + zr2) / 2, zj = (Math.random() - 0.5) * 24;
            g.lineTo(Math.cos(za) * zmid - Math.sin(za) * zj, Math.sin(za) * zmid + Math.cos(za) * zj);
            g.lineTo(Math.cos(za) * zr2, Math.sin(za) * zr2);
            g.stroke();
          }
        } else if (d.telegraphType === "breath") {
          // soft cone showing the sweep to come
          var cr = 430, half = 0.62;
          var cg = g.createRadialGradient(0, 0, d.r * 0.4, 0, 0, cr);
          cg.addColorStop(0, Fx.rgba(PAL.ember, 0.34 * (0.4 + prog * 0.6)));
          cg.addColorStop(0.6, Fx.rgba(PAL.ember, 0.14 * (0.4 + prog * 0.6)));
          cg.addColorStop(1, Fx.rgba(PAL.ember, 0));
          g.fillStyle = cg;
          g.beginPath();
          g.moveTo(0, 0);
          g.arc(0, 0, cr, -half, half);
          g.closePath();
          g.fill();
        } else if (d.telegraphType === "dash") {
          // rushing chevrons along the dash line
          g.globalCompositeOperation = "lighter";
          for (var ci = 0; ci < 3; ci++) {
            var cd2 = 120 + ci * 74 + prog * 40;
            var ca2 = (0.25 + prog * 0.55) * (1 - ci * 0.22) * (0.5 + pul * 0.5);
            g.strokeStyle = Fx.rgba(tc, ca2);
            g.lineWidth = 7 - ci * 1.6;
            g.lineCap = "round";
            g.beginPath();
            g.moveTo(cd2 - 26, -26);
            g.lineTo(cd2, 0);
            g.lineTo(cd2 - 26, 26);
            g.stroke();
          }
        } else if (d.telegraphType === "veil") {
          // gathering dusk: the dragon darkens inward — no aim line,
          // because it isn't aiming at you (yet)
          Fx.drawDot(g, 0, 0, d.r * (0.65 + prog * 0.55), "#4a3f6e", 0.16 + prog * 0.22, false);
          Fx.drawDot(g, 0, 0, d.r * 0.4, "#362d54", 0.1 + prog * 0.24, false);
        } else {
          // aimed / volley: tapered light beam toward the player
          var bl = Math.min(560, Math.hypot(this.player.x - d.x, this.player.y - d.y) + 60);
          var bg2 = g.createLinearGradient(0, 0, bl, 0);
          bg2.addColorStop(0, Fx.rgba(tc, 0.4 * (0.3 + prog * 0.7)));
          bg2.addColorStop(1, Fx.rgba(tc, 0));
          g.fillStyle = bg2;
          g.beginPath();
          g.moveTo(d.r * 0.5, -2 - prog * 7);
          g.lineTo(bl, -1);
          g.lineTo(bl, 1);
          g.lineTo(d.r * 0.5, 2 + prog * 7);
          g.closePath();
          g.fill();
        }
        g.restore();

        // pulsing warning ring
        g.save();
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 0.25 + prog * 0.3 * pul;
        g.strokeStyle = tc;
        g.lineWidth = 3;
        g.beginPath(); g.arc(0, 0, d.r * (1.05 + prog * 0.18), 0, TAU); g.stroke();
        g.restore();
      }

      // gentle hover bob (skip while dashing)
      if (d.state !== "dash") g.translate(0, Math.sin(this.time * 1.7) * 5);

      g.rotate(d.facing - Math.PI / 2); // rig is drawn facing UP

      var sc = 0.62;
      var bowP = 0;
      // bow animation — fold wings, dip the head, sink & fade slightly
      if (d.state === "bow") {
        d.bowT += 1 / 60;
        sc = 0.62 * (1 - Math.min(0.15, d.bowT * 0.1));
        bowP = Math.min(1, d.bowT * 0.8);
        g.globalAlpha = Math.max(0.55, 1 - d.bowT * 0.15);
      }
      // phase 2 subtle pulsing
      if (d.phase === 2) sc *= 1 + Math.sin(this.time * 6) * 0.015;

      // rig the dragon into the scratch canvas once per frame
      var k = (680 * sc) / 460;
      var scr = Fx.scratch("dragon", 460, 370);
      var sg = scr._ctx;
      sg.save();
      sg.translate(230, 150);
      Art.dragon(sg, {
        t: this.time,
        swayPhase: d.swayPhase || 0,
        flapPhase: d.flapPhase || 0,
        phase2: d.phase === 2,
        flash: Math.min(1, d.hitFlash * 4),
        bow: bowP,
        variant: d.type
      });
      sg.restore();
      g.scale(k, k);
      // dusk veil: one alpha fades the whole cached figure
      if (d.state === "veil") g.globalAlpha = Math.max(0.04, Math.min(1, veilA));
      g.drawImage(scr, -230, -150);
      // dusk echoes: two ghost silhouettes flank it — the SAME cached rig
      // drawn twice more at low alpha (no extra rigging per frame)
      if (d.state === "echoes") {
        var ga2 = Math.min(1, d.stateT / 0.2, (1.2 - d.stateT) / 0.2);
        if (ga2 > 0) {
          g.globalAlpha = 0.35 * ga2;
          g.drawImage(scr, -230 - 156, -150);
          g.drawImage(scr, -230 + 156, -150);
        }
      }
      g.restore();
    },

    // color mix helper
    mix: function (a, b, t) {
      var ca = this.hex(a), cb = this.hex(b);
      var r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
      var gg = Math.round(ca[1] + (cb[1] - ca[1]) * t);
      var bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
      return "rgb(" + r + "," + gg + "," + bl + ")";
    },
    hex: function (h) {
      h = h.replace("#", "");
      return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
    }
  };

  // ---------------------------------------------------------
  // PRELOAD + BOOT
  // ---------------------------------------------------------
  function preload(done) {
    var keys = Object.keys(IMG_SRC);
    var loaded = 0, total = keys.length;
    var fill = $("loading-fill");
    keys.forEach(function (k) {
      var img = new Image();
      img.onload = img.onerror = function () {
        loaded++;
        if (fill) fill.style.width = (loaded / total * 100) + "%";
        if (loaded >= total) done();
      };
      img.src = IMG_SRC[k];
      images[k] = img;
    });
  }

  // main loop (fixed timestep + clamped)
  var lastT = 0, accum = 0;
  function loop(now) {
    if (!lastT) lastT = now;
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > MAX_FRAME) dt = MAX_FRAME;
    accum += dt;
    var steps = 0;
    while (accum >= DT && steps < 5) {
      Game.update(DT);
      accum -= DT;
      steps++;
    }
    if (steps >= 5) accum = 0; // spiral guard
    Game.render(accum / DT);
    requestAnimationFrame(loop);
  }

  function boot() {
    Game.init();
    preload(function () {
      Fx.bakeSprites();
      setTimeout(function () {
        Game.toTitle();
        Game.wipe();
      }, 350);
    });
    requestAnimationFrame(loop);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // expose minimal hooks for automated testing (no globals leaked otherwise)
  window.__dragoose = {
    game: Game, input: Input, art: Art, daily: Daily, save: Save, particles: Particles,
    forceWin: function () { if (Game.dragon) Game.damageDragon(9999, Game.dragon.x, Game.dragon.y); },
    forceHurt: function () { if (Game.player) { Game.player.iframes = 0; Game.hurtPlayer(99, Game.player.x, Game.player.y + 50); } },
    state: function () { return Game.state; }
  };
})();
