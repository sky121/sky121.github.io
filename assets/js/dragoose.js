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

  var IMG_SRC = {
    goose: "images/dragoose/goose.png",
    dragonEmber: "images/dragoose/dragon-ember.png",
    dragonStorm: "images/dragoose/dragon-storm.png",
    fireball: "images/dragoose/fireball.png",
    scale: "images/dragoose/scale.png",
    scaleEmber: "images/dragoose/scale-ember.png",
    scaleStorm: "images/dragoose/scale-storm.png",
    cloud: "images/dragoose/cloud.png"
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

  // ---------------------------------------------------------
  // SAVE MODULE (localStorage hoard)
  // ---------------------------------------------------------
  var Save = {
    data: { scales: 0, relics: [], wins: 0 },
    load: function () {
      try {
        var raw = localStorage.getItem(SAVE_KEY);
        if (raw) {
          var p = JSON.parse(raw);
          if (p && typeof p === "object") {
            this.data.scales = p.scales | 0;
            this.data.relics = Array.isArray(p.relics) ? p.relics : [];
            this.data.wins = p.wins | 0;
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
    hasRelic: function (id) { return this.data.relics.indexOf(id) !== -1; }
  };

  // ---------------------------------------------------------
  // AUDIO MODULE (Web Audio, synthesized)
  // ---------------------------------------------------------
  var Audio2 = {
    ctx: null, master: null, muted: false, ready: false, chargeOsc: null, chargeGain: null,
    init: function () {
      if (this.ready) return;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
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
    dodge: function () { this.noise(0.22, 0.18, 2200); this.tone(520, 0.18, "sine", 0.08, 900); },
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
    hitDragon: function () { this.tone(330, 0.1, "square", 0.1, 220); this.noise(0.08, 0.08, 2600); },
    hurt: function () { this.tone(140, 0.3, "sawtooth", 0.22, 70); this.noise(0.2, 0.15, 700); },
    scale: function () { this.tone(880, 0.16, "sine", 0.12, 1320); this.tone(1320, 0.18, "sine", 0.08); },
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
      Audio2.init(); Audio2.resume();
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
          Audio2.init(); Audio2.resume();
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
  // PARTICLE POOL (watercolor blooms)
  // ---------------------------------------------------------
  var Particles = {
    pool: [], max: 260, idx: 0,
    init: function () {
      for (var i = 0; i < this.max; i++) {
        this.pool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, r: 0, gr: 0, life: 0, maxLife: 1, color: "#fff", alpha: 0.4, drag: 0.9 });
      }
    },
    spawn: function (x, y, vx, vy, r, grow, life, color, alpha, drag) {
      var p = null;
      // find inactive starting from idx (round-robin to bound cost)
      for (var i = 0; i < this.max; i++) {
        var j = (this.idx + i) % this.max;
        if (!this.pool[j].active) { p = this.pool[j]; this.idx = (j + 1) % this.max; break; }
      }
      if (!p) { p = this.pool[this.idx]; this.idx = (this.idx + 1) % this.max; }
      p.active = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
      p.r = r; p.gr = grow == null ? 1 : grow; p.life = life; p.maxLife = life;
      p.color = color; p.alpha = alpha == null ? 0.4 : alpha; p.drag = drag == null ? 0.92 : drag;
    },
    burst: function (x, y, n, color, spread, baseR, alpha) {
      n = Math.min(n, 22);
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2;
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
        p.x += p.vx * dt * 60; p.y += p.vy * dt * 60;
        p.vx *= p.drag; p.vy *= p.drag;
        p.r *= (1 + (p.gr - 1) * dt * 4);
      }
    },
    draw: function (g) {
      g.save();
      g.globalCompositeOperation = "source-over";
      for (var i = 0; i < this.max; i++) {
        var p = this.pool[i];
        if (!p.active) continue;
        var t = p.life / p.maxLife;
        g.globalAlpha = p.alpha * t;
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    },
    clear: function () { for (var i = 0; i < this.max; i++) this.pool[i].active = false; }
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
            p.power = cfg.power || null;
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
    cinderGift: { name: "Cinder's Gift", glyph: "🔥", desc: "Begin each run already wielding Ember Wake." }
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
        { depth: 0.25, count: 4, scale: 1.6, alpha: 0.32 },
        { depth: 0.5, count: 4, scale: 1.1, alpha: 0.42 },
        { depth: 0.85, count: 3, scale: 0.75, alpha: 0.5 }
      ];
      for (var L = 0; L < layers.length; L++) {
        var ly = layers[L];
        for (var i = 0; i < ly.count; i++) {
          this.bg.clouds.push({
            x: Math.random() * VW,
            y: Math.random() * (VH + 300) - 150,
            depth: ly.depth, scale: ly.scale * (0.7 + Math.random() * 0.6),
            alpha: ly.alpha, speed: 8 + ly.depth * 26
          });
        }
      }
    },

    bindUI: function () {
      $("btn-start").addEventListener("click", function () { Game.startRun(); });
      $("btn-pause").addEventListener("click", function () { Game.togglePause(); });
      $("btn-resume").addEventListener("click", function () { Game.togglePause(); });
      $("btn-restart-pause").addEventListener("click", function () { Game.startRun(); });
      $("btn-retry").addEventListener("click", function () { Game.startRun(); });
      $("btn-continue").addEventListener("click", function () { Game.toTitle(); });
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
      this.renderHoard();
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
        $("hoard-stats").textContent = parts.join(" · ");
      } else {
        box.hidden = true;
      }
    },

    // ----- START A RUN -----
    startRun: function () {
      this.showScreen(null);
      hud.hidden = false;
      Particles.clear();
      PlayerShots.clear(); DragonShots.clear(); Pickups.clear();
      this.floatLayer.innerHTML = "";
      this.scaleProgress = 0;
      this.nextPowerAt = 3;
      this.powers = {};
      this.shake = 0; this.hitStop = 0; this.flashRed = 0; this.flashWhite = 0;

      var startHealth = 4;
      if (Save.hasRelic("emberHeart")) startHealth = 5;

      this.player = {
        x: VW / 2, y: VH * 0.72, vx: 0, vy: 0,
        facing: -Math.PI / 2, bank: 0,
        r: 30, health: startHealth, maxHealth: startHealth,
        iframes: 0, dodgeCd: 0, dashTime: 0,
        charge: 0, charging: false, justDodged: 0,
        invulnFlash: 0, hurtFlash: 0, hitScale: 1
      };

      // relic perk: start with a power
      if (Save.hasRelic("cinderGift")) { this.powers.emberWake = true; }
      this.renderPowers();

      this.dragon = this.makeDragon("ember");
      this.updateHUD();
      this.state = "PLAYING";
      this.wipe();
    },

    makeDragon: function (type) {
      var d = {
        type: type,
        name: type === "ember" ? "Ember, the Cinder Wyrm" : "Tempest, the Storm Wyrm",
        x: VW / 2, y: VH * 0.24,
        vx: 0, vy: 0, r: 110,
        health: 100, maxHealth: 100,
        facing: Math.PI / 2,
        phase: 1,
        state: "roam", stateT: 0, attackCd: 2.2,
        telegraph: 0, telegraphType: null, telegraphMax: 0,
        targetX: VW / 2, targetY: VH * 0.24,
        hitFlash: 0, bowT: 0,
        dropMilestones: [80, 60, 45, 30, 18, 8], // health thresholds that drop scales
        dashVx: 0, dashVy: 0
      };
      return d;
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
    wipe: function () {
      bloomWipe.classList.remove("is-wiping");
      void bloomWipe.offsetWidth;
      bloomWipe.classList.add("is-wiping");
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

      this.updatePlayer(dt);
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
        if (c[i].y - 120 > VH) { c[i].y = -150 - Math.random() * 120; c[i].x = Math.random() * VW; }
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
        p.charge = Math.min(1, p.charge + dt * 1.05);
        Audio2.chargeUpdate(p.charge);
      } else if (p.charging) {
        // holding ended without release event (safety)
        p.charging = false;
      }

      // ----- steering -----
      var accel = 1500;
      var targetVX = 0, targetVY = 0, steering = false;
      if (Input.pointerDown) {
        var dx = Input.px - p.x, dy = Input.py - p.y;
        var dist = Math.hypot(dx, dy);
        if (dist > 6) {
          var pull = Math.min(1, dist / 160);
          targetVX = (dx / dist) * 460 * pull;
          targetVY = (dy / dist) * 460 * pull;
          steering = true;
        }
      }
      var kv = Input.keyVec();
      if (kv.x || kv.y) {
        var kl = Math.hypot(kv.x, kv.y) || 1;
        targetVX = (kv.x / kl) * 460;
        targetVY = (kv.y / kl) * 460;
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
      if (speed > 30) {
        var target = Math.atan2(p.vy, p.vx);
        p.facing = this.angleLerp(p.facing, target, 1 - Math.pow(0.0001, dt));
      }
      var targetBank = Math.max(-0.5, Math.min(0.5, p.vx / 700));
      p.bank += (targetBank - p.bank) * (1 - Math.pow(0.001, dt));

      // dash trail
      if (p.dashTime > 0) {
        Particles.spawn(p.x, p.y, 0, 0, 22, 1.4, 0.4, "#cfe3f1", 0.3, 0.9);
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
      var dash = 760;
      p.vx = Math.cos(ang) * dash;
      p.vy = Math.sin(ang) * dash;
      p.facing = ang;
      p.dashTime = 0.18;
      p.iframes = 0.42;
      p.dodgeCd = 0.6;
      p.justDodged = 1.2;
      Audio2.dodge();
      Particles.burst(p.x, p.y, 10, "#cfe3f1", 3, 12, 0.32);

      // POWER: storm dodge -> lightning
      if (this.powers.stormDodge) this.stormDodgeBurst();
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
      Audio2.fireball(charge);
      Particles.burst(sx, sy, big ? 10 : 5, big ? PAL.rose : PAL.ember, 2.5, 12 * size, 0.34);
      p.hitScale = 0.86; // recoil pop
    },

    // ----- DRAGON AI -----
    updateDragon: function (dt) {
      var d = this.dragon;
      if (!d) return;
      if (d.hitFlash > 0) d.hitFlash -= dt;

      // phase transition
      if (d.phase === 1 && d.health <= d.maxHealth * 0.5) {
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
        var sp = d.phase === 2 ? 150 : 105;
        if (dist > 1) { d.vx = (dx / dist) * sp; d.vy = (dy / dist) * sp; }
        d.x += d.vx * dt; d.y += d.vy * dt;
        d.facing = this.angleLerp(d.facing, Math.atan2(this.player.y - d.y, this.player.x - d.x), 1 - Math.pow(0.02, dt));

        d.attackCd -= dt;
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
        Particles.spawn(d.x, d.y, 0, 0, 30, 1.3, 0.4, PAL.ember, 0.22, 0.92);
        d.stateT += dt;
        // keep in bounds
        if (d.x < 90) { d.x = 90; d.dashVx = Math.abs(d.dashVx); }
        if (d.x > VW - 90) { d.x = VW - 90; d.dashVx = -Math.abs(d.dashVx); }
        if (d.y < 90) { d.y = 90; d.dashVy = Math.abs(d.dashVy); }
        if (d.y > VH * 0.7) { d.y = VH * 0.7; d.dashVy = -Math.abs(d.dashVy); }
        if (d.stateT > 0.55) this.dragonEndAttack();
      }
      // ----- sweeping breath -----
      else if (d.state === "breath") {
        d.stateT += dt;
        d.vx *= 0.94; d.vy *= 0.94;
        d.x += d.vx * dt; d.y += d.vy * dt;
        // emit breath cone
        d.breathT = (d.breathT || 0) + dt;
        if (d.breathT > 0.045) {
          d.breathT = 0;
          var sweep = d.breathAng + Math.sin(d.stateT * 3.2) * 0.55;
          var spd = 300;
          DragonShots.spawn({
            x: d.x + Math.cos(d.facing) * 70, y: d.y + Math.sin(d.facing) * 70,
            vx: Math.cos(sweep) * spd, vy: Math.sin(sweep) * spd,
            r: 22, dmg: 1, life: 2.4, color: PAL.ember, rot: sweep, kind: "breath"
          });
        }
        if (d.stateT > (d.phase === 2 ? 1.7 : 1.3)) this.dragonEndAttack();
      }
    },

    dragonBeginAttack: function () {
      var d = this.dragon;
      d.state = "telegraph";
      d.stateT = 0;
      // choose attack
      var choices = ["volley", "aimed", "breath"];
      if (d.phase === 2) choices = ["volley", "aimed", "breath", "dash", "dash"];
      d.telegraphType = choices[(Math.random() * choices.length) | 0];
      d.telegraph = d.telegraphType === "dash" ? 0.6 : 0.5;
      d.telegraphMax = d.telegraph;
      if (d.telegraphType === "breath") {
        d.breathAng = Math.atan2(this.player.y - d.y, this.player.x - d.x);
      }
    },

    dragonExecute: function () {
      var d = this.dragon;
      var p = this.player;
      var t = d.telegraphType;
      Audio2.tone(200, 0.18, "sawtooth", 0.12, 120);

      if (t === "volley") {
        var n = d.phase === 2 ? 9 : 6;
        var spread = Math.PI * (d.phase === 2 ? 0.9 : 0.6);
        var base = Math.atan2(p.y - d.y, p.x - d.x) - spread / 2;
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
              var aa = Math.atan2(Game.player.y - d.y, Game.player.x - d.x);
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
        var ang = Math.atan2(p.y - d.y, p.x - d.x);
        d.dashVx = Math.cos(ang) * 900;
        d.dashVy = Math.sin(ang) * 900;
        d.facing = ang;
        d.state = "dash"; d.stateT = 0;
        Audio2.tone(150, 0.3, "sawtooth", 0.16, 300);
      } else if (t === "breath") {
        d.state = "breath"; d.stateT = 0; d.breathT = 0;
        d.breathAng = Math.atan2(p.y - d.y, p.x - d.x);
      }
    },

    dragonEndAttack: function () {
      var d = this.dragon;
      d.state = "roam"; d.stateT = 0;
      d.attackCd = d.phase === 2 ? 1.0 : 1.8;
      d.telegraphType = null;
    },

    // ----- SHOTS / COLLISIONS -----
    updateShots: function (dt) {
      var p = this.player, d = this.dragon, self = this;

      PlayerShots.forEach(function (s) {
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.rot += s.spin * dt;
        s.life -= dt;
        if (s.life <= 0 || s.x < -40 || s.x > VW + 40 || s.y < -40 || s.y > VH + 40) { s.active = false; return; }
        // hit dragon
        if (d && d.state !== "bow") {
          var dx = s.x - d.x, dy = s.y - d.y;
          var rr = d.r * 0.62 + s.r;
          if (dx * dx + dy * dy < rr * rr) {
            self.damageDragon(s.dmg, s.x, s.y);
            s.active = false;
          }
        }
      });

      DragonShots.forEach(function (s) {
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.rot += 3 * dt;
        s.life -= dt;
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
      var before = d.health;
      d.health = Math.max(0, d.health - dmg);
      d.hitFlash = 0.16;
      Particles.burst(x, y, Math.min(12, 4 + dmg), PAL.ember, 3, 14, 0.36);
      Particles.burst(x, y, 4, PAL.gold, 2, 10, 0.3);
      Audio2.hitDragon();
      if (dmg > 9) { this.hitStop = 0.06; this.addShake(4); }

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
      Pickups.list.push({
        x: x, y: y, vx: Math.cos(ang) * 90, vy: Math.sin(ang) * 90 - 60,
        r: 22, t: 0, collected: false, magnet: false,
        type: this.dragon.type
      });
      Particles.burst(x, y, 6, PAL.gold, 3, 12, 0.4);
    },

    hurtPlayer: function (dmg, x, y) {
      var p = this.player;
      if (p.iframes > 0) return;
      p.health -= dmg;
      p.iframes = 0.9;       // brief mercy invuln
      p.hurtFlash = 0.5;
      p.hitScale = 1.35;
      this.flashRed = 0.6;
      this.addShake(12);
      this.hitStop = 0.05;
      Audio2.hurt();
      Particles.burst(p.x, p.y, 12, PAL.rose, 4, 16, 0.4);
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
        if (dist < 150 || s.magnet) {
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
      this.scaleProgress++;
      Audio2.scale();
      Particles.burst(this.player.x, this.player.y, 8, PAL.gold, 3, 12, 0.4);
      this.floatText(this.player.x, this.player.y - 30, "+1 scale", PAL.gold);
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
      DragonShots.clear();
      Audio2.victory();
      // bank scales
      Save.addScales(this.scaleProgress);
      // grant relic
      var relicId = this.scaleProgress >= 12 ? "cinderGift" : "emberHeart";
      var hadBefore = Save.hasRelic(relicId);
      Save.addRelic(relicId);

      var self = this;
      setTimeout(function () {
        self.state = "WIN";
        self.wipe();
        var R = RELICS[relicId];
        $("win-sub").textContent = "Ember bows its great head. " + self.scaleProgress + " scales now rest in your hoard.";
        $("relic-grant").innerHTML =
          '<span class="relic-glyph">' + R.glyph + '</span>' +
          '<span><span class="relic-text-name">' + (hadBefore ? "Relic strengthened: " : "Relic gained: ") + R.name + '</span>' +
          '<br><span class="relic-text-desc">' + R.desc + '</span></span>';
        self.showScreen("win");
      }, reduceMotion ? 600 : 1400);
    },

    playerDefeated: function () {
      this.state = "DEAD";
      Audio2.chargeStop();
      Audio2.death();
      this.flashWhite = 0.4;
      Save.addScales(Math.floor(this.scaleProgress / 2)); // partial salvage
      Particles.burst(this.player.x, this.player.y, 20, PAL.rose, 5, 24, 0.4);
      var self = this;
      setTimeout(function () {
        self.wipe();
        var lines = [
          "You earned " + Math.floor(self.scaleProgress / 2) + " salvaged scales for the hoard.",
          "The dragon's respect must be won another day.",
          "Ember snorts. It expected more of a goose."
        ];
        $("dead-sub").textContent = lines[(Math.random() * lines.length) | 0];
        self.showScreen("dead");
      }, reduceMotion ? 300 : 700);
    },

    // ----- HUD -----
    updateHUD: function () {
      var d = this.dragon, p = this.player;
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

      // hit flashes (full screen)
      if (this.flashRed > 0) {
        g.save(); g.globalAlpha = this.flashRed * 0.5;
        g.fillStyle = "#c25a3a"; g.fillRect(0, 0, VW, VH); g.restore();
      }
      if (this.flashWhite > 0) {
        g.save(); g.globalAlpha = this.flashWhite; g.fillStyle = "#fbf7ee"; g.fillRect(0, 0, VW, VH); g.restore();
      }
    },

    drawSky: function (g) {
      var grd = g.createLinearGradient(0, 0, 0, VH);
      var t = (Math.sin(this.bg.washPhase) + 1) / 2;
      grd.addColorStop(0, "#cfe3f1");
      grd.addColorStop(0.4, this.mix("#aecbe4", "#bcd4ea", t));
      grd.addColorStop(0.75, this.mix("#7fa8c9", "#86b0cf", t));
      grd.addColorStop(1, "#5b86ad");
      g.fillStyle = grd;
      g.fillRect(0, 0, VW, VH);
      // soft watercolor blooms drifting
      g.save();
      g.globalAlpha = 0.1;
      var blobs = [
        { x: VW * 0.2, y: VH * 0.3, r: 200, c: PAL.wisteria },
        { x: VW * 0.8, y: VH * 0.6, r: 230, c: PAL.sage },
        { x: VW * 0.5, y: VH * 0.85, r: 200, c: PAL.rose }
      ];
      for (var i = 0; i < blobs.length; i++) {
        var b = blobs[i];
        var rg = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        rg.addColorStop(0, b.c); rg.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = rg;
        g.beginPath();
        g.arc(b.x + Math.sin(this.bg.washPhase + i) * 24, b.y + Math.cos(this.bg.washPhase + i * 1.3) * 20, b.r, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    },

    drawClouds: function (g, depthFilter, front) {
      var c = this.bg.clouds;
      var img = images.cloud;
      if (!img) return;
      g.save();
      for (var i = 0; i < c.length; i++) {
        var cl = c[i];
        var isFront = cl.depth >= 0.8;
        if (front && !isFront) continue;
        if (!front && isFront) continue;
        g.globalAlpha = cl.alpha;
        var w = 300 * cl.scale, h = 180 * cl.scale;
        g.drawImage(img, cl.x - w / 2, cl.y - h / 2, w, h);
      }
      g.restore();
    },

    drawPlayer: function (g) {
      var p = this.player;
      var img = images.goose;
      if (!img) return;
      g.save();
      g.translate(p.x, p.y);
      // sprite faces UP; rotate so up aligns with facing
      g.rotate(p.facing + Math.PI / 2);
      g.rotate(p.bank * 0.5); // banking tilt
      var sc = p.hitScale * 0.42;
      // i-frame shimmer
      if (p.iframes > 0) {
        var flick = Math.sin(this.time * 40) * 0.5 + 0.5;
        g.globalAlpha = 0.45 + flick * 0.4;
      }
      if (p.hurtFlash > 0) {
        g.globalAlpha = Math.min(1, g.globalAlpha) ;
      }
      var w = 280 * sc, h = 280 * sc;
      g.drawImage(img, -w / 2, -h / 2, w, h);
      // hurt red tint
      if (p.hurtFlash > 0) {
        g.globalCompositeOperation = "source-atop";
        g.globalAlpha = p.hurtFlash * 0.6;
        g.fillStyle = "#c25a3a";
        g.fillRect(-w / 2, -h / 2, w, h);
      }
      g.restore();
    },

    drawChargeUI: function (g) {
      var p = this.player;
      if (p.charge <= 0.02) return;
      g.save();
      g.translate(p.x, p.y);
      var radius = 36 + p.charge * 16;
      // glow ring
      g.globalAlpha = 0.25 + p.charge * 0.35;
      var rg = g.createRadialGradient(0, 0, radius * 0.5, 0, 0, radius);
      rg.addColorStop(0, "rgba(224,138,90,0)");
      rg.addColorStop(0.7, this.mix(PAL.ember, PAL.rose, p.charge));
      rg.addColorStop(1, "rgba(224,138,90,0)");
      g.fillStyle = rg;
      g.beginPath(); g.arc(0, 0, radius, 0, Math.PI * 2); g.fill();
      // arc meter
      g.globalAlpha = 0.85;
      g.strokeStyle = p.charge >= 0.98 ? PAL.gold : "#fbf7ee";
      g.lineWidth = 4;
      g.beginPath();
      g.arc(0, 0, radius + 4, -Math.PI / 2, -Math.PI / 2 + p.charge * Math.PI * 2);
      g.stroke();
      g.restore();
    },

    drawPlayerShots: function (g) {
      var img = images.fireball;
      PlayerShots.forEach(function (s) {
        g.save();
        g.translate(s.x, s.y);
        g.rotate(s.rot);
        if (s.kind === "bolt") {
          // lightning bolt — wisteria glow
          g.globalAlpha = 0.8;
          var rg = g.createRadialGradient(0, 0, 0, 0, 0, s.r * 1.6);
          rg.addColorStop(0, "#ffffff");
          rg.addColorStop(0.4, PAL.wisteria);
          rg.addColorStop(1, "rgba(162,146,196,0)");
          g.fillStyle = rg;
          g.beginPath(); g.arc(0, 0, s.r * 1.6, 0, Math.PI * 2); g.fill();
        } else if (img) {
          var sz = s.r * 2.6;
          if (s.color === PAL.rose) {
            g.globalAlpha = 0.4;
            g.drawImage(img, -sz * 0.62, -sz * 0.62, sz * 1.24, sz * 1.24);
            g.globalAlpha = 1;
          }
          g.drawImage(img, -sz / 2, -sz / 2, sz, sz);
        }
        g.restore();
      });
    },

    drawDragonShots: function (g) {
      var img = images.fireball;
      var d = this.dragon;
      DragonShots.forEach(function (s) {
        g.save();
        g.translate(s.x, s.y);
        g.rotate(s.rot);
        var sz = s.r * 2.4;
        if (img) {
          // tint enemy shots toward deep ember
          g.globalAlpha = 0.92;
          g.drawImage(img, -sz / 2, -sz / 2, sz, sz);
        } else {
          g.fillStyle = PAL.emberDeep;
          g.beginPath(); g.arc(0, 0, s.r, 0, Math.PI * 2); g.fill();
        }
        g.restore();
      });
    },

    drawPickups: function (g) {
      var img;
      for (var i = 0; i < Pickups.list.length; i++) {
        var s = Pickups.list[i];
        img = s.type === "ember" ? images.scaleEmber : (s.type === "storm" ? images.scaleStorm : images.scale);
        if (!img) continue;
        g.save();
        g.translate(s.x, s.y);
        var bob = Math.sin(s.t * 5) * 4;
        g.translate(0, bob);
        g.rotate(Math.sin(s.t * 2) * 0.3);
        // glow
        g.globalAlpha = 0.5 + Math.sin(s.t * 6) * 0.18;
        var rg = g.createRadialGradient(0, 0, 0, 0, 0, 34);
        rg.addColorStop(0, "rgba(205,184,120,0.9)");
        rg.addColorStop(1, "rgba(205,184,120,0)");
        g.fillStyle = rg;
        g.beginPath(); g.arc(0, 0, 34, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        var sz = 56;
        g.drawImage(img, -sz / 2, -sz / 2, sz, sz);
        g.restore();
      }
    },

    drawDragon: function (g) {
      var d = this.dragon;
      var img = d.type === "ember" ? images.dragonEmber : images.dragonStorm;
      if (!img) return;
      g.save();
      g.translate(d.x, d.y);

      // telegraph indicator (wind-up tint + aim line)
      if (d.state === "telegraph") {
        var prog = 1 - d.telegraph / d.telegraphMax;
        g.save();
        g.globalAlpha = 0.25 + prog * 0.3;
        var tg = g.createRadialGradient(0, 0, d.r * 0.4, 0, 0, d.r * 1.3);
        var tc = d.telegraphType === "dash" ? PAL.rose : PAL.gold;
        tg.addColorStop(0, tc);
        tg.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = tg;
        g.beginPath(); g.arc(0, 0, d.r * 1.3, 0, Math.PI * 2); g.fill();
        // aim line toward player
        g.globalAlpha = 0.35 + Math.sin(this.time * 20) * 0.2;
        g.strokeStyle = tc;
        g.lineWidth = 3 + prog * 4;
        g.setLineDash([12, 10]);
        g.beginPath();
        g.moveTo(0, 0);
        var aim = d.telegraphType === "breath" ? d.breathAng : Math.atan2(this.player.y - d.y, this.player.x - d.x);
        g.lineTo(Math.cos(aim) * 360, Math.sin(aim) * 360);
        g.stroke();
        g.restore();
      }

      g.rotate(d.facing - Math.PI / 2); // sprite faces UP

      var sc = 0.62;
      // bow animation — sink & fade slightly
      if (d.state === "bow") {
        d.bowT += 1 / 60;
        sc = 0.62 * (1 - Math.min(0.15, d.bowT * 0.1));
        g.globalAlpha = Math.max(0.5, 1 - d.bowT * 0.18);
      }
      // phase 2 subtle pulsing
      if (d.phase === 2) sc *= 1 + Math.sin(this.time * 6) * 0.015;

      var w = 680 * sc, h = 680 * sc;
      g.drawImage(img, -w / 2, -h / 2, w, h);

      // hit flash
      if (d.hitFlash > 0) {
        g.globalCompositeOperation = "source-atop";
        g.globalAlpha = d.hitFlash * 3;
        g.fillStyle = "#fbf7ee";
        g.fillRect(-w / 2, -h / 2, w, h);
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
    game: Game, input: Input,
    forceWin: function () { if (Game.dragon) Game.damageDragon(9999, Game.dragon.x, Game.dragon.y); },
    forceHurt: function () { if (Game.player) { Game.player.iframes = 0; Game.hurtPlayer(99, Game.player.x, Game.player.y + 50); } },
    state: function () { return Game.state; }
  };
})();
