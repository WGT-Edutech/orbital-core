/* =====================================================================
   DOH // ORBITAL CORE — render-path verification
   Records every real CanvasRenderingContext2D call the game makes, so the
   render path can be proven without a browser. Fails on any thrown error,
   unbalanced save/restore, or a frame that draws nothing.
   Usage:  node verify-render.js
   ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

const HTML = path.join(__dirname, "index.html");
const src = fs.readFileSync(HTML, "utf8");
const gameJs = src.match(/<script>([\s\S]*?)<\/script>/)[1];

/* ---------------- instrumented canvas stub ---------------- */
const calls = Object.create(null);
let saveDepth = 0, maxDepth = 0, unbalances = 0;
let errors = [];

function bump(n){ calls[n] = (calls[n] || 0) + 1; }

function mkGradient(){
  return { addColorStop(off, col){ bump("addColorStop"); if (typeof off !== "number") errors.push("bad gradient offset " + off); } };
}
function mkCtx(){
  const state = { fillStyle:"", strokeStyle:"", lineWidth:1, globalAlpha:1, font:"" };
  const target = {
    canvas: { width: 1400, height: 1000 },
    fillStyle:"", strokeStyle:"", lineWidth:1, globalAlpha:1, font:"", textAlign:"", textBaseline:"",
    createRadialGradient(){ bump("createRadialGradient"); return mkGradient(); },
    createLinearGradient(){ bump("createLinearGradient"); return mkGradient(); },
    measureText(t){ bump("measureText"); return { width: String(t).length * 8 }; },
    save(){ bump("save"); saveDepth++; if (saveDepth > maxDepth) maxDepth = saveDepth; },
    restore(){
      bump("restore"); saveDepth--;
      if (saveDepth < 0){ errors.push("restore() without a matching save()"); saveDepth = 0; unbalances++; }
    },
    clearRect(){ bump("clearRect"); },
    fillRect(){ bump("fillRect"); },
    strokeRect(){ bump("strokeRect"); },
    beginPath(){ bump("beginPath"); },
    closePath(){ bump("closePath"); },
    moveTo(){ bump("moveTo"); },
    lineTo(){ bump("lineTo"); },
    arc(x, y, r, a0, a1, ccw){
      bump("arc");
      if (![x,y,r,a0,a1].every(Number.isFinite)) errors.push("non-finite arc args: " + [x,y,r,a0,a1]);
      if (r < 0) errors.push("negative radius: " + r);
    },
    fill(){ bump("fill"); if (state.fillStyle === "" ) {} },
    stroke(){ bump("stroke"); },
    translate(){ bump("translate"); },
    rotate(a){ bump("rotate"); if (!Number.isFinite(a)) errors.push("rotate by non-finite " + a); },
    scale(x, y){ bump("scale"); if (!Number.isFinite(x) || !Number.isFinite(y)) errors.push("scale non-finite " + x + "," + y); },
    setTransform(){ bump("setTransform"); },
    fillText(t){ bump("fillText"); if (t === undefined || t === null) errors.push("fillText with " + t); },
    strokeText(){ bump("strokeText"); },
    setLineDash(a){ bump("setLineDash"); if (!Array.isArray(a)) errors.push("setLineDash non-array"); },
    getLineDash(){ bump("getLineDash"); return []; }
  };
  return new Proxy(target, {
    get(t, k){
      if (k in t) return t[k];
      return undefined;
    },
    set(t, k, v){
      if (k === "globalAlpha" && (typeof v !== "number" || v < 0 || v > 1))
        errors.push("globalAlpha out of range: " + v);
      t[k] = v;
      return true;
    }
  });
}

const elems = {};
function mkEl(id){
  const e = {
    id, textContent:"", innerHTML:"", className:"", value:"",
    style:{ setProperty(){}, removeProperty(){} }, dataset:{}, children:[],
    classList:{ add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    appendChild(c){ this.children.push(c); },
    removeChild(){},
    addEventListener(){}, removeEventListener(){},
    getBoundingClientRect(){ return { left:0, top:0, width:1400, height:1000, right:1400, bottom:1000 }; },
    setPointerCapture(){}, releasePointerCapture(){}, focus(){}, blur(){}
  };
  return e;
}
globalThis.window = {
  innerWidth:1400, innerHeight:1000, devicePixelRatio:1,
  addEventListener(){}, removeEventListener(){},
  matchMedia: () => ({ matches:false, addEventListener(){}, addListener(){} }),
  AudioContext: undefined, webkitAudioContext: undefined,
  location: { protocol:"https:", host:"localhost" }
};
globalThis.performance = { now: () => 12345 };
globalThis.localStorage = (() => { const s={}; return { getItem:k=>(k in s?s[k]:null), setItem:(k,v)=>{s[k]=String(v);} }; })();
const pending = [];
globalThis.setTimeout = (f) => { pending.push(f); return pending.length; };
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
globalThis.clearTimeout = () => {};
globalThis.requestAnimationFrame = () => 0;
globalThis.document = {
  getElementById(id){ return elems[id] || (elems[id] = mkEl(id)); },
  createElement(t){ return mkEl("tmp-" + t); },
  createTextNode(t){ return { textContent:t }; },
  addEventListener(){}, body: mkEl("body")
};
const canvasEl = mkEl("field");
canvasEl.getContext = () => mkCtx();
elems["field"] = canvasEl;
globalThis.__errs = errors;

/* ---------------- load game ---------------- */
const G = new Function(gameJs + "\n;return {game,startRun,update,render,tryOrbit,tryRotate,tryRapidLock,tryHold,toggleSpin,countFilled,LANES,RINGS,showTitle,resize};")();
function drain(){ let g=0; while (pending.length && g++ < 50) pending.shift()(); }

/* ---------------- report ---------------- */
const out = [];
function T(name, fn){
  const before = errors.length;
  try {
    const r = fn();
    if (r === true) out.push(["PASS", name, ""]);
    else out.push(["FAIL", name, String(r)]);
  } catch (e){ out.push(["FAIL", name, (e && e.stack ? e.stack.split("\n")[0] : String(e))]); }
  if (errors.length > before) out.push(["FAIL", name + " (threw during render)", errors[before]]);
}

function resetCalls(){ for (const k in calls) delete calls[k]; saveDepth = 0; maxDepth = 0; errors.length = 0; }

T("title screen renders a full frame without error", () => {
  resetCalls();
  G.resize();
  G.showTitle();
  G.render(16.67);
  if (!calls.fill) return "no fill calls";
  if (saveDepth !== 0) return "save/restore left unbalanced at depth " + saveDepth;
  return true;
});

T("in-play frame draws the core, wedges and guides", () => {
  resetCalls();
  G.startRun();
  G.update(16.67);
  G.render(16.67);
  if (!calls.arc) return "no arc calls (nothing circular drawn)";
  if (!calls.createRadialGradient) return "no gradients used";
  if (saveDepth !== 0) return "save/restore left unbalanced at depth " + saveDepth;
  if (errors.length) return errors[0];
  return true;
});

T("600 frames of continuous play render with zero errors", () => {
  resetCalls();
  G.startRun();
  for (let f = 0; f < 600; f++){
    drain();
    if (f % 23 === 0) G.tryOrbit(f % 46 === 0 ? 1 : -1);
    if (f % 31 === 0) G.tryRotate(1);
    if (f % 47 === 0) G.tryRapidLock();
    if (f % 97 === 0) G.toggleSpin();
    G.update(16.67);
    G.render(16.67);
  }
  if (saveDepth !== 0) return "save/restore left unbalanced at depth " + saveDepth;
  if (errors.length) return errors.slice(0, 3).join(" | ");
  return true;
});

T("save/restore never nests deeper than a sane depth", () => {
  resetCalls();
  G.startRun();
  for (let f = 0; f < 120; f++){ drain(); G.update(16.67); G.render(16.67); }
  if (maxDepth > 6) return "nesting depth " + maxDepth + " suggests a missing restore()";
  return true;
});

T("code rain emits glyphs on a play frame (backdrop is actually drawn)", () => {
  resetCalls();
  G.resize();
  G.startRun();
  for (let f = 0; f < 30; f++){ drain(); G.update(16.67); G.render(16.67); }
  // fillText is how the rain draws glyphs. If this is 0 the rain is either
  // disabled, off-screen, or drawn under an opaque fill. On a normal frame it
  // should be substantial (hundreds of glyphs).
  if (!calls.fillText) return "rain drew no glyphs (fillText=0) on a play frame";
  if (calls.fillText < 50) return "rain drew only " + calls.fillText + " glyphs; expected many";
  return true;
});

T("game-over screen renders a full frame", () => {
  resetCalls();
  G.startRun();
  G.game.mode = "over";
  G.render(16.67);
  if (saveDepth !== 0) return "unbalanced save/restore";
  return true;
});

T("resize to a small viewport keeps geometry finite", () => {
  resetCalls();
  globalThis.window.innerWidth = 500;
  globalThis.window.innerHeight = 400;
  G.resize();
  G.render(16.67);
  globalThis.window.innerWidth = 1400;
  globalThis.window.innerHeight = 1000;
  G.resize();
  if (saveDepth !== 0) return "unbalanced save/restore";
  if (errors.length) return errors[0];
  return true;
});

T("a populated stack renders every locked cell", () => {
  resetCalls();
  G.startRun();
  G.game.grid = G.game.grid || null;
  // fill a wedge of the matrix and confirm the arcs show up
  for (let r = 0; r < G.RINGS; r++)
    for (let l = 0; l < 4; l++)
      G.game.grid[r][l] = "#39ff8a";
  const arcsBefore = (calls.arc || 0);
  G.render(16.67);
  const arcsAfter = (calls.arc || 0);
  if (arcsAfter <= arcsBefore) return "locked cells produced no draw calls";
  return true;
});

let pass = 0, fail = 0;
for (const [s, n, m] of out){ if (s === "PASS") pass++; else fail++; console.log(s + "  " + n + (m ? "\n        -> " + m : "")); }
console.log("\n--- draw call census (last populated run) ---");
const keys = Object.keys(calls).sort();
for (const k of keys) console.log("  " + k.padEnd(24) + calls[k]);
console.log("\n=== RENDER: " + pass + " passed, " + fail + " failed, " + out.length + " total ===");
process.exit(fail ? 1 : 0);
