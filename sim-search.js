/* Is a whole ring completable AT ALL in this geometry?
   The greedy bot is a weak proxy. This asks the exact question instead:
   starting from an empty board, can a search over placements find a line of
   play that completes one full ring without ever needing a purge?

   It does a beam search: keep the N most promising board states, and for
   each piece consider every legal placement. If any reachable state has a
   full ring, the rule is satisfiable and the game is winnable. */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const rawJs = html.match(/<script>([\s\S]*?)<\/script>/g).pop()
  .replace(/^<script>/, "").replace(/<\/script>$/, "");

/* ---- stubs ---- */
const param=(v=0)=>({value:v,setValueAtTime(){},linearRampToValueAtTime(){},
  exponentialRampToValueAtTime(){},setTargetAtTime(){},cancelScheduledValues(){}});
const anode=()=>({connect(){},disconnect(){},start(){},stop(){},frequency:param(),
  detune:param(),Q:param(),gain:param(),threshold:param(),knee:param(),ratio:param(),
  attack:param(),release:param(),type:"",buffer:null,loop:false,playbackRate:param(),pan:param()});
const rec2d=()=>{const h={};for(const k of ["fillStyle","strokeStyle","font","textAlign",
  "textBaseline","globalAlpha","lineWidth","lineCap","shadowBlur","shadowColor","filter",
  "globalCompositeOperation"]){Object.defineProperty(h,k,{get:()=>0,set(){}});}
  for(const k of ["save","restore","beginPath","closePath","moveTo","lineTo","arc","fill",
    "stroke","fillRect","clearRect","roundRect","clip","translate","rotate","scale",
    "setTransform","fillText","strokeText","quadraticCurveTo","bezierCurveTo","ellipse",
    "rect","drawImage"]) h[k]=()=>{};
  h.createLinearGradient=()=>({addColorStop(){}});h.createRadialGradient=()=>({addColorStop(){}});
  return h;};
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
globalThis.document={getElementById:el,createElement:el,querySelector:el,querySelectorAll:()=>[],
  addEventListener(){},removeEventListener(){},body:el(),documentElement:el(),
  fonts:{ready:Promise.resolve()}};
globalThis.navigator=window.navigator;globalThis.requestAnimationFrame=()=>0;
globalThis.cancelAnimationFrame=()=>{};globalThis.localStorage=window.localStorage;
globalThis.performance=window.performance;

const LANES = Number(process.argv[2] || 16);
const RINGS = Number(process.argv[3] || 12);
const DEPTH = Number(process.argv[4] || 14);   // pieces to search ahead
const BEAM  = Number(process.argv[5] || 60);

const G = new Function(rawJs
  .replace(/const LANES\s*=\s*\d+;/, "const LANES = " + LANES + ";")
  .replace(/const RINGS\s*=\s*\d+;/, "const RINGS = " + RINGS + ";")
  + "\n;return {LANES,RINGS,blankGrid,makePiece,cellsAt,fits,queueFill,queueTake,drawPiece,COLOURS};")();

/* deterministic piece stream so results are reproducible */
let seed = 987654321;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
function makeBag(){
  const b = G.NAMES ? G.NAMES.slice() : ["I","J","L","O","S","Z","T"];
  for (let i = b.length - 1; i > 0; i--){
    const j = Math.floor(rnd() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
const bag = makeBag();
let bagPos = 0;
const nextName = () => (bagPos < bag.length ? bag[bagPos++] : (()=>{ const b = makeBag(); bagPos = 1; return b[0]; })());

function holes(grid){
  let n = 0;
  for (let r = 0; r < RINGS; r++) for (let l = 0; l < LANES; l++) if (grid[r][l] === null) n++;
  return n;
}
function applyPiece(grid, name, rot, lane, ring){
  const p = { name };
  const g2 = grid.map(r => r.slice());
  for (const c of G.cellsAt(p, rot, lane, ring)){
    if (c[1] < 0 || c[1] >= RINGS) continue;
    g2[c[1]][c[0]] = G.COLOURS[name];
  }
  const gone = [];
  for (let r = 0; r < RINGS; r++){
    let full = true;
    for (let l = 0; l < LANES; l++) if (g2[r][l] === null){ full = false; break; }
    if (full) gone.push(r);
  }
  for (const r of gone) for (let l = 0; l < LANES; l++) g2[r][l] = null;
  const ng = G.blankGrid();
  for (let k = 0; k < RINGS; k++){
    let sh = 0; for (const g of gone) if (g < k) sh++;
    if (k - sh >= 0) for (let l = 0; l < LANES; l++) ng[k - sh][l] = g2[k][l];
  }
  return { grid: ng, rings: gone.length };
}
function placements(p){
  const out = [];
  for (let rot = 0; rot < 4; rot++)
    for (let lane = 0; lane < LANES; lane++)
      for (let ring = 0; ring < RINGS; ring++)
        if (G.fits(p, rot, lane, ring, 0)) out.push({ rot, lane, ring });
  return out;
}
function height(grid){
  for (let r = RINGS - 1; r >= 0; r--)
    for (let l = 0; l < LANES; l++) if (grid[r][l] !== null) return r + 1;
  return 0;
}

/* Beam search over board states. Returns the best ring-clear depth found. */
let beam = [{ grid: G.blankGrid(), rings: 0, hist: [] }];
let bestRings = 0, firstClearAt = -1;

for (let d = 0; d < DEPTH; d++){
  const next = [];
  for (const st of beam){
    const name = nextName();
    const p = { name };
    for (const pl of placements(p)){
      const res = applyPiece(st.grid, name, pl.rot, pl.lane, pl.ring);
      if (res.grid === null) continue;
      const total = st.rings + res.rings;
      if (total > bestRings){
        bestRings = total;
        if (firstClearAt < 0) firstClearAt = d + 1;
      }
      if (height(res.grid) >= RINGS) continue;    // would breach
      next.push({ grid: res.grid, rings: total, hist: st.hist.concat([name + "@" + pl.lane]) });
    }
  }
  if (!next.length) break;
  // rank: more rings cleared, then lower height, then fewer holes
  next.sort((a, b) =>
    (b.rings - a.rings) ||
    (height(a.grid) - height(b.grid)) ||
    (holes(a.grid) - holes(b.grid)));
  beam = next.slice(0, BEAM);
}

console.log("LANES=" + LANES + " RINGS=" + RINGS + " depth=" + DEPTH + " beam=" + BEAM);
console.log("  full rings reachable: " + bestRings + (firstClearAt > 0 ? " (first at piece " + firstClearAt + ")" : ""));
console.log("  verdict: " + (bestRings > 0 ? "SATISFIABLE - a ring CAN be completed" : "NOT SATISFIABLE in this search"));
