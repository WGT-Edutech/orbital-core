/* =====================================================================
   Playability check: with ONLY whole-ring clears, is the game beatable?
   Loads the real game, then plays it with two different bots:
     - random: no aim, just locks wherever the piece falls
     - greedy: searches placements and picks the one that most reduces
       the "holes" in the outermost occupied ring
   A beatable-but-not-trivial design should see random lose fast and
   greedy clear rings and survive for a long time.
   ===================================================================== */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const gameJs = html.match(/<script>([\s\S]*?)<\/script>/g).pop()
  .replace(/^<script>/, "").replace(/<\/script>$/, "");

/* ---- minimal DOM + canvas so the game boots headless ---- */
const calls = [];
function rec2d(c) {
  const h = {};
  for (const k of ["fillStyle","strokeStyle","font","textAlign","textBaseline",
                   "globalAlpha","lineWidth","lineCap","shadowBlur","shadowColor",
                   "filter","globalCompositeOperation"]) {
    Object.defineProperty(h, k, { get:()=>c[k], set:v=>{c[k]=v; calls.push(k);} });
  }
  for (const k of ["save","restore","beginPath","closePath","moveTo","lineTo","arc",
                   "fill","stroke","fillRect","clearRect","roundRect","clip",
                   "translate","rotate","scale","setTransform","fillText","strokeText",
                   "createLinearGradient","createRadialGradient","quadraticCurveTo",
                   "bezierCurveTo","ellipse","rect","drawImage"]) {
    h[k] = (...a) => { calls.push(k); if (k==="createLinearGradient"||k==="createRadialGradient")
      return { addColorStop(){} }; return undefined; };
  }
  return h;
}
const stubCtx = new Proxy({}, { get:(t,k)=> rec2d(calls) });
const el = () => new Proxy({ style:{}, dataset:{}, classList:{add(){},remove(){},toggle(){}},
  getContext:()=>stubCtx, addEventListener(){}, appendChild(){}, remove(){},
  querySelectorAll:()=>[], querySelector:()=>null, setAttribute(){},
  getBoundingClientRect:()=>({width:900,height:700,left:0,top:0,right:900,bottom:700}) },
  { get:(t,k)=> (k in t ? t[k] : el()), set:(t,k,v)=>{t[k]=v; return true;} });

/* Audio stubs must expose the AudioParam methods the game actually calls,
   otherwise the first tryOrbit() throws before any piece is placed. */
const param = (v=0) => ({ value:v, setValueAtTime(){}, linearRampToValueAtTime(){},
  exponentialRampToValueAtTime(){}, setTargetAtTime(){}, cancelScheduledValues(){} });
const node = (extra) => Object.assign({
  connect(){}, disconnect(){}, start(){}, stop(){},
  frequency:param(), detune:param(), Q:param(), gain:param(),
  threshold:param(), knee:param(), ratio:param(), attack:param(), release:param(),
  type:"", buffer:null, loop:false, playbackRate:param(), pan:param()
}, extra || {});

globalThis.window = {
  matchMedia:()=>({ matches:false, addEventListener(){} }),
  addEventListener(){}, removeEventListener(){},
  innerWidth:1600, innerHeight:900, devicePixelRatio:1,
  AudioContext:function(){ this.state="running"; this.resume=()=>{}; this.suspend=()=>{};
    this.createOscillator=()=>node(); this.createGain=()=>node();
    this.createBiquadFilter=()=>node(); this.createBufferSource=()=>node();
    this.createStereoPanner=()=>node();
    this.createBuffer=(a,b)=>({ getChannelData:()=>new Float32Array(b), length:b,
      sampleRate:a, numberOfChannels:1, duration:b/a });
    this.createDynamicsCompressor=()=>node();
    this.createWaveShaper=()=>({ curve:null, oversample:"none", connect(){} });
    this.destination={}; this.sampleRate=44100; this.currentTime=0;
    this.listener = { setPosition(){}, setValueAtTime(){} }; },
  webkitAudioContext:undefined,
  performance:{ now:()=>0 }, requestAnimationFrame:()=>0, cancelAnimationFrame(){},
  navigator:{ userAgent:"node", vibrate:()=>{} }, localStorage:{ getItem:()=>null, setItem(){} }
};
globalThis.document = {
  getElementById:el, createElement:el, querySelector:el, querySelectorAll:()=>[],
  addEventListener(){}, removeEventListener(){}, body:el(), documentElement:el(),
  fonts:{ ready:Promise.resolve() }
};
globalThis.navigator = window.navigator;
globalThis.requestAnimationFrame = ()=>0;
globalThis.cancelAnimationFrame = ()=>{};
globalThis.localStorage = window.localStorage;
globalThis.performance = window.performance;

const G = new Function(gameJs + "\n;return {" + [
  "LANES","RINGS","COLOURS","NAMES","game","blankGrid","makePiece","cellsAt","fits",
  "settle","commit","update","render","startRun","gameOver","isPerfect","countFilled",
  "ringCleared","collapse","drawPiece","queueFill","queueTake","spawn","tryOrbit",
  "tryRotate","tryRapidLock","coreSteps"
].join(",") + "};")();

/* ================= bots ================= */
/* Count, per ring, how many lanes are empty. A full ring clears. */
function ringHoles(grid){
  const h = [];
  for (let r = 0; r < G.RINGS; r++){
    let n = 0;
    for (let l = 0; l < G.LANES; l++) if (grid[r][l] === null) n++;
    h.push(n);
  }
  return h;
}
/* How many rings are complete right now. */
function fullRings(grid){
  let n = 0;
  for (let r = 0; r < G.RINGS; r++) if (!ringHoles(grid)[r]) n++;
  return n;
}
/* Peak stack height: outermost occupied ring + 1. */
function height(grid){
  for (let r = G.RINGS - 1; r >= 0; r--)
    for (let l = 0; l < G.LANES; l++)
      if (grid[r][l] !== null) return r + 1;
  return 0;
}

/* Enumerate every (rot, lane, ring) the piece can legally occupy. */
function placements(p){
  const out = [];
  for (let rot = 0; rot < 4; rot++)
    for (let lane = 0; lane < G.LANES; lane++)
      for (let ring = 0; ring < G.RINGS; ring++)
        if (G.fits(p, rot, lane, ring, 0)) out.push({ rot, lane, ring });
  return out;
}

/* Place into a COPY so the real grid is untouched while we evaluate. */
function simulate(grid, p, pl){
  const g2 = grid.map(row => row.slice());
  for (const c of G.cellsAt(p, pl.rot, pl.lane, pl.ring)){
    if (c[1] < 0 || c[1] >= G.RINGS) continue;
    g2[c[1]][c[0]] = "#fff";
  }
  /* Mirror collapse(): full rings clear, everything outward slides in. */
  const gone = [];
  for (let r = 0; r < G.RINGS; r++){
    let full = true;
    for (let l = 0; l < G.LANES; l++) if (g2[r][l] === null){ full = false; break; }
    if (full) gone.push(r);
  }
  for (const r of gone) for (let l = 0; l < G.LANES; l++) g2[r][l] = null;
  const ng = G.blankGrid();
  for (let k = 0; k < G.RINGS; k++){
    let shift = 0;
    for (const g of gone) if (g < k) shift++;
    const dest = k - shift;
    if (dest < 0) continue;
    for (let l = 0; l < G.LANES; l++) ng[dest][l] = g2[k][l];
  }
  return ng;
}

/* Score a candidate placement: prefer clears, then low stack, then flat top. */
function evaluate(grid, p, pl){
  const after = simulate(grid, p, pl);
  const cleared = fullRings(after);
  const h = height(after);
  const holes = ringHoles(after).reduce((a,b)=>a+b,0);
  let s = 0;
  if (cleared > 0) s += 10000 + cleared * 5000;   // clearing is the whole game
  s -= h * 40;                                    // keep the stack low
  s -= holes * 12;                                // avoid burying gaps
  // Prefer filling near the core: smaller ring index is safer.
  s -= pl.ring * 8;
  return s;
}

function playRun(botName, maxPieces){
  G.startRun();
  let pieces = 0, clears = 0, guard = 0;
  const rnd = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();

  while (G.game.mode === "play" && pieces < maxPieces && guard < 200000){
    guard++;
    if (!G.game.active){ G.spawn ? G.spawn() : null; if (!G.game.active) break; }
    const p = G.game.active;

    if (botName === "random"){
      // move a random number of lanes, then slam
      const n = Math.floor(rnd() * G.LANES);
      for (let i = 0; i < n; i++) G.tryOrbit(1);
      G.tryRapidLock();
    } else {
      const pls = placements(p);
      if (!pls.length){ G.gameOver(); break; }
      let best = pls[0], bestScore = -Infinity;
      for (const pl of pls){
        const s = evaluate(G.game.grid, p, pl);
        if (s > bestScore){ bestScore = s; best = pl; }
      }
      // Drive the real piece to the chosen placement through real input paths.
      for (let i = 0; i < 4 && p.rot !== best.rot; i++) G.tryRotate(1);
      let d = (best.lane - p.lane + G.LANES) % G.LANES;
      for (let i = 0; i < d; i++) G.tryOrbit(1);
      G.tryRapidLock();
    }

    if (G.game.mode === "play"){
      pieces++;
      if (botName === "greedy" && DBG && pieces <= 32){
        const h = ringHoles(G.game.grid);
        const nz = h.filter(x => x > 0);
        console.log("  p" + pieces + " holes=" + JSON.stringify(h) +
          " minHole=" + (nz.length ? Math.min.apply(null, nz) : 0));
      }
      // advance timers so the next shell spawns
      for (let f = 0; f < 200 && G.game.mode === "play"; f++) G.update(16.67);
    }
  }
  clears = G.game.rings;
  return { bot:botName, pieces, rings:clears, score:G.game.score,
           level:G.game.level, mode:G.game.mode, height:height(G.game.grid) };
}

/* ================= runner ================= */
const DBG = process.env.DBG === "1";
const runs = [];
for (let i = 0; i < 3; i++) runs.push(playRun("random", 400));
for (let i = 0; i < 3; i++) runs.push(playRun("greedy", 400));

console.log("bot      pieces  rings  level  height  score      outcome");
console.log("------------------------------------------------------------");
for (const r of runs){
  console.log(
    r.bot.padEnd(8),
    String(r.pieces).padStart(6),
    String(r.rings).padStart(6),
    String(r.level).padStart(6),
    String(r.height).padStart(6),
    String(r.score).padStart(9),
    "  " + r.mode);
}

const rndRuns  = runs.filter(r => r.bot === "random");
const grdRuns  = runs.filter(r => r.bot === "greedy");
const avg = (a,k) => (a.reduce((s,r)=>s+r[k],0) / a.length).toFixed(1);
console.log("\nrandom: avg rings " + avg(rndRuns,"rings") + ", avg pieces " + avg(rndRuns,"pieces"));
console.log("greedy: avg rings " + avg(grdRuns,"rings") + ", avg pieces " + avg(grdRuns,"pieces"));

const greedyClears = grdRuns.some(r => r.rings > 0);
const greedySurvives = grdRuns.some(r => r.pieces >= 400);
console.log("\nBEATABLE (greedy clears at least one ring): " + (greedyClears ? "YES" : "NO"));
console.log("NOT TRIVIAL (random bot fails to clear):   " +
  (rndRuns.every(r => r.rings === 0) ? "YES" : "NO - random also clears"));
