/* Measure WHERE the code rain actually lands, in real pixels.
   Records every fillText(x, y) the rain emits across many frames and reports
   the bounding box + coverage as a fraction of the canvas. This is the check I
   should have run originally instead of counting draw calls. */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const js = src.match(/<script>([\s\S]*?)<\/script>/)[1];

/* canvas stub that records fillText positions and the transform in force */
const texts = [];
let cur = { a:1, b:0, c:0, d:1, e:0, f:0 };
const param = (v=0)=>({value:v,setValueAtTime(){},linearRampToValueAtTime(){},
  exponentialRampToValueAtTime(){},setTargetAtTime(){},cancelScheduledValues(){}});
const anode=()=>({connect(){},disconnect(){},start(){},stop(){},frequency:param(),
  detune:param(),Q:param(),gain:param(),threshold:param(),knee:param(),ratio:param(),
  attack:param(),release:param(),type:"",buffer:null,loop:false,playbackRate:param(),pan:param()});
function mkCtx(W, H){
  // fillStyle MUST be captured as a real property, otherwise the alpha
  // measurement silently falls back to 1.0 and reports a false "VISIBLE".
  const g = {
    canvas:{ width:W, height:H }, strokeStyle:"", lineWidth:1,
    globalAlpha:1, font:"", textAlign:"", textBaseline:"", lineCap:"",
    shadowBlur:0, shadowColor:"", filter:"", globalCompositeOperation:"",
    _fillStyle:"#000",
    setTransform(a,b,c,d,e,f){ cur = {a,b,c,d,e,f}; },
    save(){}, restore(){},
    translate(){ cur = {a:cur.a,b:cur.b,c:cur.c,d:cur.d,e:cur.e,f:cur.f}; },
    scale(){ cur = {a:cur.a,b:cur.b,c:cur.c,d:cur.d,e:cur.e,f:cur.f}; },
    rotate(){},
    measureText(){ return { width:8 }; },
    fillRect(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){},
    lineTo(){}, arc(){}, fill(){}, stroke(){}, roundRect(){}, clip(){},
    quadraticCurveTo(){}, bezierCurveTo(){}, ellipse(){}, rect(){}, drawImage(){},
    setLineDash(){}, getLineDash(){ return []; },
    createLinearGradient(){ return {addColorStop(){}}; },
    createRadialGradient(){ return {addColorStop(){}}; },
    strokeText(){},
    fillText(t, x, y){
      // transform point through the current matrix
      const px = cur.a * x + cur.c * y + cur.e;
      const py = cur.b * x + cur.d * y + cur.f;
      texts.push({ px, py, alpha: g.globalAlpha, font: g.font, fill: g.fillStyle });
    }
  };
  Object.defineProperty(g, "fillStyle", {
    get(){ return g._fillStyle; },
    set(v){ g._fillStyle = v; }
  });
  return g;
}
let CTX = mkCtx(1600, 900);
const el = (W,H)=>{
  const base = { style:{}, dataset:{}, classList:{add(){},remove(){},toggle(){}},
    getContext:()=>CTX, addEventListener(){}, appendChild(){}, remove(){},
    querySelectorAll:()=>[], querySelector:()=>null, setAttribute(){},
    getBoundingClientRect:()=>({width:W,height:H,left:0,top:0,right:W,bottom:H}) };
  return new Proxy(base, { get:(t,k)=> (k in t ? t[k] : el(W,H)),
    set:(t,k,v)=>{t[k]=v; return true;} });
};
const doc = el(1600,900);
doc.getElementById = () => el(1600,900);
doc.createElement = () => el(1600,900);
doc.querySelector = () => el(1600,900);
doc.querySelectorAll = () => [];
doc.addEventListener = ()=>{};
doc.removeEventListener = ()=>{};
// pickGlyphs() probes font support; report every glyph as available so the
// measurement reflects the full Matrix katakana set.
doc.fonts = { check: () => true };

globalThis.window = { matchMedia:()=>({matches:false,addEventListener(){}}),
  addEventListener(){}, removeEventListener(){}, innerWidth:1600, innerHeight:900,
  devicePixelRatio:1,
  AudioContext:function(){ this.state="running"; this.destination={}; this.sampleRate=44100;
    this.currentTime=0; for(const m of ["createOscillator","createGain","createBiquadFilter",
      "createBufferSource","createDynamicsCompressor"]) this[m]=anode;
    this.createBuffer=()=>({getChannelData:()=>new Float32Array(8)}); this.resume=()=>{}; },
  performance:{now:()=>0}, requestAnimationFrame:()=>0, cancelAnimationFrame(){},
  navigator:{userAgent:"node"}, localStorage:{getItem:()=>null,setItem(){}} };
globalThis.document = doc;
globalThis.navigator=window.navigator; globalThis.requestAnimationFrame=()=>0;
globalThis.cancelAnimationFrame=()=>{}; globalThis.localStorage=window.localStorage;
globalThis.performance=window.performance;

const G = new Function(js + `
;return {game,startRun,update,render,resize,RAIN_PX:typeof RAIN_PX!=="undefined"?RAIN_PX:39,
         RAIN_PITCH:typeof RAIN_PITCH!=="undefined"?RAIN_PITCH:46,
         pickGlyphs:typeof pickGlyphs!=="undefined"?pickGlyphs:null};`)();
const PITCH = G.RAIN_PITCH;

/* drive 120 frames of play */
G.startRun();
for (let f = 0; f < 120; f++){ G.update(16.67); G.render(16.67); }

const W = 1600, H = 900;
if (!texts.length){ console.log("NO fillText calls at all — rain did not run"); process.exit(0); }

let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
for (const t of texts){
  if (t.px<minX)minX=t.px; if(t.px>maxX)maxX=t.px;
  if (t.py<minY)minY=t.py; if(t.py>maxY)maxY=t.py;
}
const inBounds = texts.filter(t=>t.px>=0&&t.px<=W&&t.py>=0&&t.py<=H).length;
const pctX = ((maxX-minX)/W*100).toFixed(1);
const pctY = ((maxY-minY)/H*100).toFixed(1);
const cols = new Set(texts.map(t=>Math.round(t.px))).size;

console.log("canvas (CSS px):", W, "x", H);
console.log("font size       :", G.RAIN_PX + "px   pitch:", PITCH + "px");
const glyphSet = G.pickGlyphs ? G.pickGlyphs() : "";
console.log("glyph set       :", glyphSet.length, "chars, sample:", glyphSet.slice(0, 12));
console.log("fillText calls  :", texts.length, "over 120 frames");
console.log("x range         :", minX.toFixed(0), "->", maxX.toFixed(0), " = " + pctX + "% of width");
console.log("y range         :", minY.toFixed(0), "->", maxY.toFixed(0), " = " + pctY + "% of height");
console.log("distinct x cols :", cols, "(expected ~" + Math.ceil(W/PITCH) + ")");
console.log("in-bounds       :", inBounds, "/", texts.length, "=" + (inBounds/texts.length*100).toFixed(1) + "%");

/* per-column occupancy: how much of the width actually has rain */
const colCount = new Array(Math.ceil(W/PITCH)).fill(0);
for (const t of texts){ const c = Math.floor(t.px/PITCH); if (c>=0 && c<colCount.length) colCount[c]++; }
const empty = colCount.filter(n=>n===0).length;
console.log("empty columns   :", empty, "/", colCount.length);
const avgPerCol = (texts.length/colCount.length).toFixed(1);
console.log("avg glyphs/col  :", avgPerCol);
console.log("min/max per col :", Math.min(...colCount), "/", Math.max(...colCount));

/* ---- the check I should have written first: is it actually VISIBLE? ----
   Parse the alpha out of each fillStyle and report the real distribution.
   Counting draw calls proves nothing; these numbers decide whether a human
   can see the effect against the #04070a background. */
function alphaOf(style){
  const s = (style || "").trim();
  // rgba(r,g,b,a) — the alpha is the FOURTH component, not the second.
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m){
    const parts = m[1].split(",").map(x => parseFloat(x));
    if (parts.length >= 4) return parts[3];
    if (parts.length === 3) return 1;
  }
  const h = /^#([0-9a-f]{6})$/i.exec(s);
  if (h){ const v = parseInt(h[1],16); return ((v>>16&255)*0.299+(v>>8&255)*0.587+(v&255)*0.114)/255; }
  if (s === "#000" || s === "black") return 0;
  return 1;
}
const alphas = texts.map(t => alphaOf(t.fill)).sort((a,b)=>a-b);
const q = p => alphas[Math.floor(alphas.length*p)].toFixed(3);
const mean = (alphas.reduce((a,b)=>a+b,0)/alphas.length).toFixed(3);
console.log("\n--- effective alpha (visibility) ---");
console.log("p10/p50/p90     :", q(0.10), "/", q(0.50), "/", q(0.90));
console.log("mean            :", mean);
const dim = alphas.filter(a => a < 0.12).length;
console.log("glyphs under 0.12:", dim, "=" + (dim/alphas.length*100).toFixed(1) + "%  (invisible)");
const bright = alphas.filter(a => a >= 0.35).length;
console.log("glyphs over 0.35 :", bright, "=" + (bright/alphas.length*100).toFixed(1) + "%  (clearly read)");
const verdict = (parseFloat(mean) >= 0.25 && dim/alphas.length < 0.25) ? "VISIBLE" : "TOO FAINT";
console.log("VERDICT         :", verdict);
/* Exit non-zero so this can gate a commit. A "TOO FAINT" backdrop is a real
   regression even though every draw call succeeded. */
if (verdict !== "VISIBLE"){
  console.error("\nFAIL: code rain is too faint to see. Raise the alpha floor.");
  process.exit(1);
}
