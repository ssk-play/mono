/**
 * GrayBox Runtime Engine v0.3
 *
 * 320×240, 4-color grayscale, 30fps, 2ch square wave
 * Standalone runtime — no game code included.
 *
 * Usage:
 *   <script src="runtime/engine.js"></script>
 *   <script>
 *     const { cls, spr, text, btn, ... } = GrayBox;
 *     GrayBox._update = function() { ... };
 *     GrayBox._draw = function() { ... };
 *     GrayBox.boot("screen");
 *   </script>
 */
const GrayBox = (() => {
  "use strict";

  const W = 320;
  const H = 240;
  const FPS = 30;
  const COLORS = ["#1a1a1a", "#6b6b6b", "#b0b0b0", "#e8e8e8"];

  let canvas, ctx, buf, buf32;

  function hexToABGR(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }
  const COLOR_U32 = COLORS.map(hexToABGR);

  const sprites = {};
  const tilemap = {};

  const keyMap = {
    "ArrowUp": "up", "ArrowDown": "down", "ArrowLeft": "left", "ArrowRight": "right",
    "w": "up", "s": "down", "a": "left", "d": "right",
    "ㅈ": "up", "ㄴ": "down", "ㅁ": "left", "ㅇ": "right",
    "z": "a", "Z": "a", "x": "b", "X": "b", "ㅋ": "a", "ㅌ": "b",
    "Enter": "a", " ": "a"
  };
  const keys = {};
  const keysPrev = {};

  // --- Audio ---
  let audioCtx = null;
  const channels = [null, null];
  const channelGains = [null, null];
  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < 2; i++) {
        channelGains[i] = audioCtx.createGain();
        channelGains[i].gain.value = 0.15;
        channelGains[i].connect(audioCtx.destination);
      }
    }
  }
  const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  function noteToFreq(noteStr) {
    const match = noteStr.match(/^([A-G]#?)(\d)$/);
    if (!match) return 440;
    const name = match[1];
    const octave = parseInt(match[2]);
    const semitone = NOTE_NAMES.indexOf(name);
    if (semitone === -1) return 440;
    const midi = (octave + 1) * 12 + semitone;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // --- Font (4×7 bitmap) ---
  const FONT_W = 4;
  const FONT_H = 7;
  const FONT = {};
  const fontData = {
    "A":"0110100110011111100110011001","B":"1110100110101110100110011110",
    "C":"0110100110001000100001100110","D":"1100101010011001100110101100",
    "E":"1111100010001110100010001111","F":"1111100010001110100010001000",
    "G":"0111100010001011100101100111","H":"1001100110011111100110011001",
    "I":"1110010001000100010001001110","J":"0111001000100010001010100100",
    "K":"1001101011001100101010011001","L":"1000100010001000100010001111",
    "M":"1001111111011001100110011001","N":"1001110111011001100110011001",
    "O":"0110100110011001100110010110","P":"1110100110011110100010001000",
    "Q":"0110100110011001101101100001","R":"1110100110011110101010011001",
    "S":"0111100010000110000110001110","T":"1111001000100010001000100010",
    "U":"1001100110011001100110010110","V":"1001100110011001100101100110",
    "W":"1001100110011001101111011001","X":"1001100101100110011010011001",
    "Y":"1001100101100010001000100010","Z":"1111000100100100100010001111",
    "0":"0110100111011011101110010110","1":"0100110001000100010001001110",
    "2":"0110100100010010010010001111","3":"1110000100010110000110011110",
    "4":"1001100110011111000100010001","5":"1111100010001110000100011110",
    "6":"0110100010001110100110010110","7":"1111000100010010010001001000",
    "8":"0110100110010110100110010110","9":"0110100110010111000100010110",
    " ":"0000000000000000000000000000",
    ".":"0000000000000000000001000100",
    ",":"0000000000000000001000101000",
    "!":"0100010001000100000000000100",
    "?":"0110100100010010000000000010",
    "-":"0000000000001110000000000000",
    "+":"0000001001001110010000100000",
    ":":"0000010001000000010001000000",
    "/":"0001000100100010010010001000",
    "*":"0000101001001110010010100000",
    "#":"0101111101011111010100000000",
    "(":"0010010010001000010001000010",
    ")":"0100001000010001000100100100",
    "=":"0000000011110000111100000000",
    "'":"0100010010000000000000000000",
    "\"":"1010101000000000000000000000",
    "<":"0010010010001000010000100010",
    ">":"1000010000100001001001001000",
    "_":"0000000000000000000000001111",
  };
  for (const [ch, bits] of Object.entries(fontData)) {
    FONT[ch] = [];
    for (let i = 0; i < bits.length; i++) FONT[ch].push(parseInt(bits[i]));
  }

  // --- API ---
  const API = {};
  API._init = null;
  API._update = null;
  API._draw = null;
  API.frame = 0;
  API.WIDTH = W;
  API.HEIGHT = H;
  API.COLORS = COLORS;

  // Graphics
  API.cls = function(c) { buf32.fill(COLOR_U32[c || 0]); };
  API.pix = function(x, y, c) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    buf32[y * W + x] = COLOR_U32[c] || COLOR_U32[0];
  };
  API.line = function(x0, y0, x1, y1, c) {
    x0=Math.floor(x0); y0=Math.floor(y0); x1=Math.floor(x1); y1=Math.floor(y1);
    const dx=Math.abs(x1-x0), dy=Math.abs(y1-y0);
    const sx=x0<x1?1:-1, sy=y0<y1?1:-1;
    let err=dx-dy;
    while(true) {
      API.pix(x0,y0,c);
      if(x0===x1&&y0===y1) break;
      const e2=2*err;
      if(e2>-dy){err-=dy;x0+=sx;}
      if(e2<dx){err+=dx;y0+=sy;}
    }
  };
  API.rect = function(x,y,w,h,c) {
    API.line(x,y,x+w-1,y,c); API.line(x+w-1,y,x+w-1,y+h-1,c);
    API.line(x+w-1,y+h-1,x,y+h-1,c); API.line(x,y+h-1,x,y,c);
  };
  API.rectf = function(x,y,w,h,c) {
    x=Math.floor(x); y=Math.floor(y);
    const col=COLOR_U32[c]||COLOR_U32[0];
    for(let py=Math.max(0,y);py<Math.min(H,y+h);py++)
      for(let px=Math.max(0,x);px<Math.min(W,x+w);px++)
        buf32[py*W+px]=col;
  };
  API.circ = function(cx,cy,r,c) {
    let x=r,y=0,d=1-r; cx=Math.floor(cx); cy=Math.floor(cy);
    while(x>=y){
      API.pix(cx+x,cy+y,c);API.pix(cx-x,cy+y,c);
      API.pix(cx+x,cy-y,c);API.pix(cx-x,cy-y,c);
      API.pix(cx+y,cy+x,c);API.pix(cx-y,cy+x,c);
      API.pix(cx+y,cy-x,c);API.pix(cx-y,cy-x,c);
      y++; if(d<0){d+=2*y+1;}else{x--;d+=2*(y-x)+1;}
    }
  };
  API.circf = function(cx,cy,r,c) {
    cx=Math.floor(cx); cy=Math.floor(cy);
    const col=COLOR_U32[c]||COLOR_U32[0]; const r2=r*r;
    for(let py=-r;py<=r;py++) for(let px=-r;px<=r;px++)
      if(px*px+py*py<=r2){ const sx=cx+px,sy=cy+py;
        if(sx>=0&&sx<W&&sy>=0&&sy<H) buf32[sy*W+sx]=col; }
  };

  // Sprites
  API.sprite = function(id, data) {
    const arr = new Uint8Array(64); let i = 0;
    for (const ch of data) { if (ch>='0'&&ch<='3') { arr[i++]=parseInt(ch); if(i>=64) break; } }
    sprites[id] = arr;
  };
  API.spr = function(id, x, y, flipX, flipY) {
    const s=sprites[id]; if(!s) return;
    x=Math.floor(x); y=Math.floor(y);
    for(let py=0;py<8;py++) for(let px=0;px<8;px++){
      const sx=flipX?7-px:px, sy=flipY?7-py:py;
      const c=s[sy*8+sx], dx=x+px, dy=y+py;
      if(dx>=0&&dx<W&&dy>=0&&dy<H) buf32[dy*W+dx]=COLOR_U32[c];
    }
  };
  // Transparent sprite (color 0 = skip)
  API.sprT = function(id, x, y, flipX, flipY) {
    const s=sprites[id]; if(!s) return;
    x=Math.floor(x); y=Math.floor(y);
    for(let py=0;py<8;py++) for(let px=0;px<8;px++){
      const sx=flipX?7-px:px, sy=flipY?7-py:py;
      const c=s[sy*8+sx]; if(c===0) continue;
      const dx=x+px, dy=y+py;
      if(dx>=0&&dx<W&&dy>=0&&dy<H) buf32[dy*W+dx]=COLOR_U32[c];
    }
  };
  // Rotated sprite (draws 8x8 sprite rotated by angle in radians)
  API.sprRot = function(id, cx, cy, angle) {
    const s = sprites[id]; if (!s) return;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    for (let py = -5; py <= 5; py++) {
      for (let px = -5; px <= 5; px++) {
        const srcX = Math.floor(cosA * px + sinA * py + 3.5);
        const srcY = Math.floor(-sinA * px + cosA * py + 3.5);
        if (srcX < 0 || srcX >= 8 || srcY < 0 || srcY >= 8) continue;
        const c = s[srcY * 8 + srcX];
        const dx = Math.floor(cx + px), dy = Math.floor(cy + py);
        if (dx >= 0 && dx < W && dy >= 0 && dy < H) buf32[dy * W + dx] = COLOR_U32[c];
      }
    }
  };
  // Read pixel color index from buffer
  API.gpix = function(x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || x >= W || y < 0 || y >= H) return -1;
    const v = buf32[y * W + x];
    for (let i = 0; i < 4; i++) if (COLOR_U32[i] === v) return i;
    return -1;
  };

  // Text
  API.text = function(str, x, y, c) {
    str=String(str).toUpperCase(); let cx=Math.floor(x); const cy=Math.floor(y);
    const col=COLOR_U32[c]||COLOR_U32[3];
    for(const ch of str){
      const glyph=FONT[ch];
      if(glyph) for(let py=0;py<FONT_H;py++) for(let px=0;px<FONT_W;px++)
        if(glyph[py*FONT_W+px]){ const dx=cx+px,dy=cy+py;
          if(dx>=0&&dx<W&&dy>=0&&dy<H) buf32[dy*W+dx]=col; }
      cx+=FONT_W+1;
    }
  };

  // Tilemap
  API.mget = function(cx,cy) { return tilemap[cx+","+cy]||0; };
  API.mset = function(cx,cy,id) { tilemap[cx+","+cy]=id; };
  API.map = function(mx,my,mw,mh,sx,sy) {
    for(let ty=0;ty<mh;ty++) for(let tx=0;tx<mw;tx++){
      const id=API.mget(mx+tx,my+ty); if(id>0) API.spr(id,sx+tx*8,sy+ty*8); }
  };

  // Input
  const VALID_KEYS = {up:1,down:1,left:1,right:1,a:1,b:1};
  API.btn = function(k) {
    if(!VALID_KEYS[k]) console.warn("GrayBox: invalid key \""+k+"\". Use: up/down/left/right/a/b");
    return !!keys[k];
  };
  API.btnp = function(k) {
    if(!VALID_KEYS[k]) console.warn("GrayBox: invalid key \""+k+"\". Use: up/down/left/right/a/b");
    return !!keys[k] && !keysPrev[k];
  };

  // Sound
  API.note = function(ch, noteStr, dur) {
    ensureAudio(); if(ch<0||ch>1) return; API.stop(ch);
    const osc=audioCtx.createOscillator(); osc.type="square";
    osc.frequency.value=noteToFreq(noteStr);
    osc.connect(channelGains[ch]); osc.start();
    osc.stop(audioCtx.currentTime+dur); channels[ch]=osc;
  };
  API.stop = function(ch) {
    if(ch===undefined){API.stop(0);API.stop(1);return;}
    if(channels[ch]){try{channels[ch].stop();}catch(e){} channels[ch]=null;}
  };

  // Utilities
  API.rnd = function(max) { return Math.random()*max; };
  API.flr = Math.floor;
  API.abs = Math.abs;
  API.min = Math.min;
  API.max = Math.max;
  API.sin = Math.sin;
  API.cos = Math.cos;
  API.atan2 = Math.atan2;
  API.sqrt = Math.sqrt;
  API.PI = Math.PI;

  // Collision helper (AABB overlap)
  API.overlap = function(x1,y1,w1,h1, x2,y2,w2,h2) {
    return x1+w1>x2 && x1<x2+w2 && y1+h1>y2 && y1<y2+h2;
  };

  // Vibration (mobile)
  API.vibrate = function(ms) { if (navigator.vibrate) navigator.vibrate(ms || 0); };

  // --- Attract Mode (input recording & playback) ---
  const KEY_BITS = ["up","down","left","right","a","b"];
  let demoState = "idle";       // idle | recording | playback
  let demoRecording = [];       // array of per-frame 6-bit bitmasks
  let demoPlaybackData = null;  // loaded recording for playback
  let demoPlaybackIdx = 0;
  let demoIdleFrames = 0;       // frames since last real input
  const DEMO_IDLE_THRESHOLD = 150; // 5 seconds at 30fps
  const DEMO_MAX_FRAMES = 1800;   // 60 seconds max recording
  let realKeyActive = false;    // any real key pressed this frame
  let gameId = "";              // derived from URL path

  function getDemoKey() { return "graybox_demo_" + gameId; }

  function packKeys() {
    let bits = 0;
    for (let i = 0; i < 6; i++) if (keys[KEY_BITS[i]]) bits |= (1 << i);
    return bits;
  }

  function unpackKeys(bits) {
    for (let i = 0; i < 6; i++) keys[KEY_BITS[i]] = !!(bits & (1 << i));
  }

  function saveDemoToStorage() {
    if (demoRecording.length < 60) return; // too short, skip
    try {
      const existing = localStorage.getItem(getDemoKey());
      if (existing) {
        const old = JSON.parse(existing);
        if (old.length >= demoRecording.length) return; // keep longer recording
      }
      localStorage.setItem(getDemoKey(), JSON.stringify(demoRecording));
    } catch(e) {} // localStorage full or unavailable
  }

  function loadDemoFromStorage() {
    try {
      const data = localStorage.getItem(getDemoKey());
      if (data) return JSON.parse(data);
    } catch(e) {}
    return null;
  }

  function startDemoPlayback() {
    demoPlaybackData = loadDemoFromStorage();
    if (!demoPlaybackData || demoPlaybackData.length < 60) {
      demoPlaybackData = null;
      return false;
    }
    demoState = "playback";
    demoPlaybackIdx = 0;
    API.frame = 0;
    // Reset all keys
    for (const k of KEY_BITS) { keys[k] = false; keysPrev[k] = false; }
    return true;
  }

  function stopDemoPlayback() {
    demoState = "idle";
    demoPlaybackData = null;
    demoPlaybackIdx = 0;
    demoIdleFrames = 0;
    // Clear all keys to prevent ghost inputs
    for (const k of KEY_BITS) { keys[k] = false; keysPrev[k] = false; }
  }

  // --- Game loop ---
  function tick() {
    // Attract mode logic
    if (demoState === "playback") {
      // Playback: inject recorded keys
      if (demoPlaybackIdx < demoPlaybackData.length) {
        unpackKeys(demoPlaybackData[demoPlaybackIdx]);
        demoPlaybackIdx++;
      } else {
        // Recording ended, restart from beginning
        demoPlaybackIdx = 0;
        API.frame = 0;
        unpackKeys(0);
      }
    } else {
      // Check if real input happened
      realKeyActive = false;
      for (const k of KEY_BITS) if (keys[k]) { realKeyActive = true; break; }

      if (realKeyActive) {
        demoIdleFrames = 0;
        if (demoState === "idle") {
          // Start recording on first real input
          demoState = "recording";
          demoRecording = [];
        }
      } else {
        demoIdleFrames++;
      }

      // Recording: capture frame input
      if (demoState === "recording") {
        demoRecording.push(packKeys());
        if (!realKeyActive && demoIdleFrames > 90) {
          // 3 seconds idle = stop recording & save
          saveDemoToStorage();
          demoState = "idle";
          demoIdleFrames = 0;
        }
        if (demoRecording.length >= DEMO_MAX_FRAMES) {
          saveDemoToStorage();
          demoState = "idle";
        }
      }

      // Idle: start playback after threshold
      if (demoState === "idle" && demoIdleFrames >= DEMO_IDLE_THRESHOLD) {
        startDemoPlayback();
      }
    }

    if (API._update) API._update();
    if (API._draw) API._draw();

    // Draw "DEMO" indicator during playback
    if (demoState === "playback") {
      const col = COLOR_U32[API.frame % 40 < 20 ? 3 : 2];
      // Draw "DEMO" at top-right corner (small, non-intrusive)
      const dx = W - 26, dy = 2;
      const demoText = "DEMO";
      let cx = dx;
      for (const ch of demoText) {
        const glyph = FONT[ch];
        if (glyph) for (let py = 0; py < FONT_H; py++) for (let px = 0; px < FONT_W; px++)
          if (glyph[py * FONT_W + px]) {
            const sx = cx + px, sy = dy + py;
            if (sx >= 0 && sx < W && sy >= 0 && sy < H) buf32[sy * W + sx] = col;
          }
        cx += FONT_W + 1;
      }
    }

    ctx.putImageData(buf, 0, 0);
    for (const k in keys) keysPrev[k] = keys[k];
    API.frame++;
  }

  // --- Boot ---
  API.boot = function(canvasId) {
    canvas = document.getElementById(canvasId || "screen");
    canvas.width = W;
    canvas.height = H;
    function fitCanvas() {
      var maxW = window.innerWidth - 40;
      var maxH = window.innerHeight - 60;
      var s = Math.min(maxW / W, maxH / H);
      canvas.style.width = (W * s) + "px";
      canvas.style.height = (H * s) + "px";
    }
    fitCanvas();
    window.addEventListener("resize", fitCanvas);
    ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    buf = ctx.createImageData(W, H);
    buf32 = new Uint32Array(buf.data.buffer);

    // Derive gameId from URL path
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    gameId = pathParts[pathParts.length - 2] || pathParts[pathParts.length - 1] || "unknown";

    document.addEventListener("keydown", e => {
      const k = keyMap[e.key];
      if (k) {
        // If in playback mode, stop it on real input
        if (demoState === "playback") {
          stopDemoPlayback();
          API.frame = 0;
        }
        keys[k] = true;
        e.preventDefault();
      }
    });
    document.addEventListener("keyup", e => {
      const k = keyMap[e.key];
      if (k) { keys[k] = false; e.preventDefault(); }
    });
    document.addEventListener("keydown", ensureAudio, { once: true });
    document.addEventListener("click", e => {
      ensureAudio();
      // Touch/click also stops playback
      if (demoState === "playback") {
        stopDemoPlayback();
        API.frame = 0;
      }
    }, { once: false });

    if (API._init) API._init();
    setInterval(tick, 1000 / FPS);
  };

  // Low-level access for games needing custom rendering
  API._sprites = sprites;
  API._COLOR_U32 = COLOR_U32;
  Object.defineProperty(API, '_buf32', { get() { return buf32; } });

  return API;
})();
