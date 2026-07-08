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

      // ---- neck (ink under-stroke = outline) + head ----
      g.strokeStyle = ink; g.lineWidth = 11.5; g.globalAlpha = 0.8;
      g.beginPath(); g.moveTo(0, -18); g.lineTo(0, -38); g.stroke();
      g.globalAlpha = 1;
      g.strokeStyle = CB; g.lineWidth = 8;
      g.beginPath(); g.moveTo(0, -17); g.lineTo(0, -38); g.stroke();

      g.save();
      g.translate(0, -43);
      g.scale(0.92, 1);
      g.beginPath(); g.arc(0, 0, 9.5, 0, TAU);
      g.fillStyle = CB; g.fill();
      g.strokeStyle = ink; g.globalAlpha = 0.8; g.lineWidth = 2; g.stroke();
      g.globalAlpha = 1;
      g.restore();
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
      // dragonfire smolders in his beak while charging
      if (o.charge > 0.01) {
        Fx.drawDot(g, 0, -56, 9 + o.charge * 10, PAL.ember, 0.3 + o.charge * 0.45, true);
      }
      g.restore();
    },

    // ----- THE DRAGONS -----
    dragonPal: {
      ember: { hi: "#e89058", lo: "#b04830", belly: "#f2c68c", memHi: "#d96a45", memLo: "#8e2f24", bone: "#ead9a4", boneTip: "#b6a06a", eye: "#ffd97a", spade: "#a83a54", vein: "#d98ba0" },
      storm: { hi: "#7fa8c9", lo: "#3d6288", belly: "#d3e2ef", memHi: "#5f86ab", memLo: "#2e4d6e", bone: "#dbe6f0", boneTip: "#8fa6bd", eye: "#bfe3ff", spade: "#4f6d94", vein: "#a292c4" }
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
        invulnFlash: 0, hurtFlash: 0, hitScale: 1,
        ghosts: []
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
      // wing-beat: quickens when flying hard, races while charging
      p.flapPhase = (p.flapPhase || 0) + dt * TAU * (2.0 + Math.min(2.4, speed * 0.005) + (p.charging ? 1.1 : 0));
      if (speed > 30) {
        var target = Math.atan2(p.vy, p.vx);
        p.facing = this.angleLerp(p.facing, target, 1 - Math.pow(0.0001, dt));
      }
      var targetBank = Math.max(-0.5, Math.min(0.5, p.vx / 700));
      p.bank += (targetBank - p.bank) * (1 - Math.pow(0.001, dt));

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
      var dash = 760;
      p.vx = Math.cos(ang) * dash;
      p.vy = Math.sin(ang) * dash;
      p.facing = ang;
      p.dashTime = 0.18;
      p.iframes = 0.42;
      p.dodgeCd = 0.6;
      p.justDodged = 1.2;
      Audio2.dodge();
      Particles.burst(p.x, p.y, 8, "#cfe3f1", 3, 12, 0.3);
      Particles.ring(p.x, p.y, "#eaf4fc", 14, 460, 0.32, 4);
      Particles.sparkBurst(p.x, p.y, 6, "#eaf4fc", 420, 0.3);

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
      // enraged: shed rising embers + heat
      if (d.phase === 2 && Math.random() < dt * 14) {
        var ea = Math.random() * TAU, er = d.r * (0.3 + Math.random() * 0.5);
        Particles.glow(d.x + Math.cos(ea) * er, d.y + Math.sin(ea) * er,
          (Math.random() - 0.5) * 0.8, -1.1 - Math.random() * 1.4,
          4 + Math.random() * 7, 0.9, 0.7 + Math.random() * 0.5,
          Math.random() < 0.4 ? PAL.rose : PAL.ember, 0.55, 0.98);
      }

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
        s.trail.unshift({ x: s.x, y: s.y });
        if (s.trail.length > 7) s.trail.pop();
        if (s.kind === "fire" && Math.random() < dt * 10) {
          Particles.spark(s.x, s.y, s.rot + Math.PI + (Math.random() - 0.5) * 0.9, 120 + Math.random() * 120, PAL.gold, 0.3, 1.8);
        }
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
      var before = d.health;
      d.health = Math.max(0, d.health - dmg);
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
      Particles.ring(this.player.x, this.player.y, PAL.gold, 12, 360, 0.32, 3);
      Particles.sparkBurst(this.player.x, this.player.y, 6, PAL.gold, 300, 0.3);
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
      Particles.ring(d.x, d.y, PAL.gold, 30, 700, 0.7, 8);
      Particles.ring(d.x, d.y, "#fff6dd", 16, 460, 0.55, 4);
      Particles.sparkBurst(d.x, d.y, 16, PAL.gold, 520, 0.5);
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
      Art.goose(sg, {
        flap: p.flapPhase || 0,
        bank: p.bank,
        hurt: Math.min(1, p.hurtFlash * 1.6),
        charge: p.charging ? p.charge : 0
      });
      sg.restore();

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
    drawBolt: function (g, s) {
      var ang = s.rot;
      var len = s.r * 3.4;
      var px = Math.cos(ang + Math.PI / 2), py = Math.sin(ang + Math.PI / 2);
      Fx.drawDot(g, s.x, s.y, s.r * 1.9, PAL.wisteria, 0.5, true);
      g.save();
      g.globalCompositeOperation = "lighter";
      g.lineCap = "round"; g.lineJoin = "round";
      for (var pass = 0; pass < 2; pass++) {
        g.strokeStyle = pass === 0 ? Fx.rgba(PAL.wisteria, 0.65) : "rgba(255,255,255,0.92)";
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
          // breath cone droplets: soft, smoky, painterly
          var t2 = s.life / 2.4;
          Fx.drawDot(g, s.x, s.y, s.r * 1.5, PAL.emberDeep, 0.4 * t2 + 0.15, false);
          Fx.drawDot(g, s.x, s.y, s.r * 1.1, PAL.ember, 0.5, true);
          Fx.drawDot(g, s.x, s.y, s.r * 0.5, PAL.gold, 0.55, true);
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

        // pulsing treasure glow
        var pulse = 0.5 + Math.sin(s.t * 6) * 0.2;
        Fx.drawDot(g, 0, 0, 40, PAL.gold, pulse * 0.55, true);
        Fx.drawDot(g, 0, 0, 20, "#fff3cf", pulse * 0.5, true);

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
        var sz = 56;
        g.drawImage(img, -sz / 2, -sz / 2, sz, sz);
        g.restore();
      }
    },

    drawDragon: function (g) {
      var d = this.dragon;

      // altitude shadow
      g.save();
      g.translate(d.x + 26, d.y + 64);
      g.scale(1.5, 0.6);
      g.globalAlpha = 0.15;
      g.drawImage(Fx.dot("#22334c"), -80, -80, 160, 160);
      g.restore();

      g.save();
      g.translate(d.x, d.y);

      // enraged: heat aura beneath the body
      if (d.phase === 2 && d.state !== "bow") {
        var hp = 0.5 + Math.sin(this.time * 5) * 0.5;
        Fx.drawDot(g, 0, 0, d.r * (1.35 + hp * 0.12), PAL.emberDeep, 0.1 + hp * 0.08, true);
        Fx.drawDot(g, 0, 0, d.r * 0.9, PAL.rose, 0.07 + hp * 0.07, true);
      }
      // bowing: warm golden halo of respect
      if (d.state === "bow") {
        Fx.drawDot(g, 0, 0, d.r * 1.5, PAL.gold, 0.2 + Math.sin(this.time * 3) * 0.06, true);
      }

      // ----- telegraphs: painterly, readable wind-ups -----
      if (d.state === "telegraph") {
        var prog = 1 - d.telegraph / d.telegraphMax;
        var pul = 0.5 + Math.sin(this.time * 18) * 0.5;
        var tc = d.telegraphType === "dash" ? PAL.rose : PAL.gold;
        var aim = d.telegraphType === "breath" ? d.breathAng : Math.atan2(this.player.y - d.y, this.player.x - d.x);

        // charging glow gathers on the dragon
        Fx.drawDot(g, 0, 0, d.r * (0.9 + prog * 0.5), tc, 0.16 + prog * 0.24, true);

        g.save();
        g.rotate(aim);
        if (d.telegraphType === "breath") {
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
      g.drawImage(scr, -230, -150);
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
    game: Game, input: Input, art: Art,
    forceWin: function () { if (Game.dragon) Game.damageDragon(9999, Game.dragon.x, Game.dragon.y); },
    forceHurt: function () { if (Game.player) { Game.player.iframes = 0; Game.hurtPlayer(99, Game.player.x, Game.player.y + 50); } },
    state: function () { return Game.state; }
  };
})();
