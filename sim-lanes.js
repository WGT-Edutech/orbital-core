/* Which lane count makes a whole-ring rule actually winnable?
   Rewrites the LANES const in the game source, then plays greedy and random
   bots. Buried holes are permanent in this geometry (nothing can be placed
   under an existing piece), so a ring with even 1 unreachable hole can never
   clear. Fewer lanes = an easier ring to tile exactly. */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const rawJs = html.match(/<script>([\s\S]*?)<\/script>/g).pop()
  .replace(/^<script>/, "").replace(/<\/script>$/, "");

/* --- shared headless stubs (same shape as sim-play.js) --- */
const param = (v=0)=>({value:v,setValueAtTime(){},linearRampToValueAtTime(){},
  exponentialRampToValueAtTime(){},setTargetAtTime(){},cancelScheduledValues(){}});
const anode = ()=>({connect(){},disconnect(){},start(){},stop(){},frequency:param(),
  detune:param(),Q:param(),gain:param(),threshold:param(),knee:param(),ratio:param(),
  attack:param(),release:param(),type:"",buffer:null,loop:false,playbackRate:param(),pan:param()});
const rec2d=()=>{const h={};for(const k of ["fillStyle","strokeStyle","font","textAlign",
  "textBaseline","globalAlpha","lineWidth","lineCap","shadowBlur","shadowColor","filter",
  "globalCompositeOperation"]){Object.defineProperty(h,k,{get:()=>0,set(){}});}
  for(const k of ["save","restore","beginPath","closePath","moveTo","lineTo","arc","fill",
    "stroke","fillRect","clearRect","roundRect","clip","translate","rotate","scale",
    "setTransform","fillText","strokeText","quadraticCurveTo","bezierCurveTo","ellipse",
    "rect","drawImage"]) h[k]=()=>{};
  h.createLinearGradient=()=>({addColorStop(){}});
  h.createRadialGradient=()=>({addColorStop(){}}); return h;};
const stubCtx=new Proxy({},{get:()=>rec2d()});
const el=()=>new Proxy({style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},
  getContext:()=>stubCtx,addEventListener(){},appendChild(){},remove(){},querySelectorAll:()=>[],
  querySelector:()=>null,setAttribute(){},getBoundingClientRect:()=>({width:900,height:700,left:0,top:0,right:900,bottom:700})},
  {get:(t,k)=>(k in t?t[k]:el()),set:(t,k,v)=>{t[k]=v;return true;}});
globalThis.window={matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},
  removeEventListener(){},innerWidth:1600,innerHeight:900,devicePixelRatio:1,
  AudioContext:function(){this.state="running";this.resume=()=>{};this.suspend=()=>{};
    for(const m of ["createOscillator","createGain","createBiquadFilter","createBufferSource",
      "createStereoPanner","createDynamicsCompressor"]) this[m]=anode;
    this.createBuffer=(a,b)=>({getChannelData:()=>new Float32Array(b),length:b,sampleRate:a,
      numberOfChannels:1,duration:b/a});
    this.createWaveShaper=()=>({curve:null,oversample:"none",connect(){}});
    this.destination={};this.sampleRate=44100;this.currentTime=0;
    this.listener={setPosition(){},setValueAtTime(){}};},
  webkitAudioContext:undefined,performance:{now:()=>0},requestAnimationFrame:()=>0,
  cancelAnimationFrame(){},navigator:{userAgent:"node",vibrate:()=>{}},
  localStorage:{getItem:()=>null,setItem(){}}};
globalThis.document={getElementById:el,createElement:el,querySelector:el,
  querySelectorAll:()=>[],addEventListener(){},removeEventListener(){},body:el(),
  documentElement:el(),fonts:{ready:Promise.resolve()}};
globalThis.navigator=window.navigator; globalThis.requestAnimationFrame=()=>0;
globalThis.cancelAnimationFrame=()=>{}; globalThis.localStorage=window.localStorage;
globalThis.performance=window.performance;

module.exports = { rawJs };

/* Build a game instance with LANES overridden. */
function build(lanes, rings){
  const js = rawJs
    .replace(/const LANES\s*=\s*\d+;/, "const LANES = " + lanes + ";")
    .replace(/const RINGS\s*=\s*\d+;/, "const RINGS = " + rings + ";");
  return new Function(js + "\n;return {" + [
    "LANES","RINGS","game","blankGrid","makePiece","cellsAt","fits","commit","update",
    "startRun","gameOver","countFilled","spawn","tryOrbit","tryRotate","tryRapidLock",
    "corePurge","stackDepth","innermostOccupied"
  ].join(",") + "};")();
}

function ringHoles(G, grid){
  const h = [];
  for (let r = 0; r < G.RINGS; r++){
    let n = 0;
    for (let l = 0; l < G.LANES; l++) if (grid[r][l] === null) n++;
    h.push(n);
  }
  return h;
}
function fullRings(G, grid){
  return ringHoles(G, grid).filter(x => x === 0).length;
}
function heightOf(G, grid){
  for (let r = G.RINGS - 1; r >= 0; r--)
    for (let l = 0; l < G.LANES; l++) if (grid[r][l] !== null) return r + 1;
  return 0;
}
function placements(G, p){
  const out = [];
  for (let rot = 0; rot < 4; rot++)
    for (let lane = 0; lane < G.LANES; lane++)
      for (let ring = 0; ring < G.RINGS; ring++)
        if (G.fits(p, rot, lane, ring, 0)) out.push({ rot, lane, ring });
  return out;
}
function simulate(G, grid, p, pl){
  const g2 = grid.map(r => r.slice());
  for (const c of G.cellsAt(p, pl.rot, pl.lane, pl.ring)){
    if (c[1] < 0 || c[1] >= G.RINGS) continue;
    g2[c[1]][c[0]] = "#fff";
  }
  const gone = [];
  for (let r = 0; r < G.RINGS; r++){
    let full = true;
    for (let l = 0; l < G.LANES; l++) if (g2[r][l] === null){ full = false; break; }
    if (full) gone.push(r);
  }
  for (const r of gone) for (let l = 0; l < G.LANES; l++) g2[r][l] = null;
  const ng = G.blankGrid();
  for (let k = 0; k < G.RINGS; k++){
    let sh = 0; for (const g of gone) if (g < k) sh++;
    if (k - sh >= 0) for (let l = 0; l < G.LANES; l++) ng[k - sh][l] = g2[k][l];
  }
  return ng;
}
/* Mirror the real corePurge() so the bot reasons about it. */
function simulatePurge(G, grid){
  let depth = 0;
  for (let r = G.RINGS - 1; r >= 0; r--){
    let any = false;
    for (let l = 0; l < G.LANES; l++) if (grid[r][l] !== null){ any = true; break; }
    if (any){ depth = r + 1; break; }
  }
  if (depth < 9) return grid;
  let inner = -1;
  for (let r = 0; r < G.RINGS; r++){
    let any = false;
    for (let l = 0; l < G.LANES; l++) if (grid[r][l] !== null){ any = true; break; }
    if (any){ inner = r; break; }
  }
  if (inner < 0) return grid;
  const ng = G.blankGrid();
  for (let k = inner + 1; k < G.RINGS; k++)
    for (let l = 0; l < G.LANES; l++) ng[k - 1][l] = grid[k][l];
  return ng;
}

function evaluate(G, grid, p, pl){
  const after = simulatePurge(G, simulate(G, grid, p, pl));
  let s = 0;
  const cl = fullRings(G, after);
  if (cl > 0) s += 10000 + cl * 5000;
  s -= heightOf(G, after) * 40;
  s -= ringHoles(G, after).reduce((a,b)=>a+b,0) * 12;
  s -= pl.ring * 8;
  return s;
}
function playGreedy(G, maxPieces){
  G.startRun();
  let pieces = 0, guard = 0;
  while (G.game.mode === "play" && pieces < maxPieces && guard < 300000){
    guard++;
    if (!G.game.active){ G.spawn(); if (!G.game.active) break; }
    const p = G.game.active;
    const pls = placements(G, p);
    if (!pls.length){ G.gameOver(); break; }
    let best = pls[0], bs = -Infinity;
    for (const pl of pls){ const s = evaluate(G, G.game.grid, p, pl); if (s > bs){ bs = s; best = pl; } }
    for (let i = 0; i < 4 && p.rot !== best.rot; i++) G.tryRotate(1);
    const d = (best.lane - p.lane + G.LANES) % G.LANES;
    for (let i = 0; i < d; i++) G.tryOrbit(1);
    G.tryRapidLock();
    if (G.game.mode === "play"){
      pieces++;
      for (let f = 0; f < 200 && G.game.mode === "play"; f++) G.update(16.67);
    }
  }
  return { pieces, rings: G.game.rings, mode: G.game.mode, score: G.game.score };
}

console.log("\nlanes rings | greedy: pieces  rings  outcome  | verdict");
console.log("-----------------------------------------------------------");
for (const lanes of [6, 8, 10, 12, 16]){
  const G = build(lanes, 12);
  const r = playGreedy(G, 600);
  const clears = r.rings > 0;
  console.log(
    String(lanes).padStart(5), String(12).padStart(5), " |",
    String(r.pieces).padStart(15), String(r.rings).padStart(6),
    ("  " + r.mode).padEnd(16), "|",
    clears ? "BEATABLE" : "unwinnable (" + r.pieces + " pieces)");
}
