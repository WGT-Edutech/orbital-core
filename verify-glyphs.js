/* Verify the Matrix glyph fallback chain picks a SUPPORTED set.
   Simulates a font that has full-width katakana but NOT half-width (the
   common Windows monospace case) and confirms we do not emit tofu. */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const js = src.match(/<script>([\s\S]*?)<\/script>/)[1];

/* Load ONLY the rain glyph code, not the whole game (which needs a full DOM).
   Slices the source from the glyph constants through pickGlyphs' end. */
const start = js.indexOf("const RAIN_PX");
const endMark = "function sizeRain";
const end = js.indexOf(endMark);
if (start < 0 || end < 0) { console.error("could not locate glyph block in index.html"); process.exit(1); }
const glyphCode = js.slice(start, end);

function run(label, supportFn){
  const doc = { fonts: { check: (font, ch) => supportFn(ch) } };
  const g = {
    canvas:{width:100,height:100}, getContext:()=>g,
    save(){},restore(){},translate(){},scale(){},rotate(){},setTransform(){},
    fillRect(){},clearRect(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},
    arc(){},fill(){},stroke(){},roundRect(){},clip(){},quadraticCurveTo(){},
    bezierCurveTo(){},ellipse(){},rect(){},drawImage(){},setLineDash(){},
    getLineDash(){return[];},measureText(){return{width:8};},strokeText(){},
    fillText(){},createLinearGradient(){return{addColorStop(){}}},
    createRadialGradient(){return{addColorStop(){}}},
  };
  Object.defineProperty(g, "fillStyle", { get(){return g._f||"#000";}, set(v){g._f=v;} });
  const el = new Proxy({ style:{}, dataset:{}, classList:{add(){},remove(){},toggle(){}},
    getContext:()=>g, addEventListener(){}, querySelectorAll:()=>[], querySelector:()=>null },
    { get:(t,k)=> (k in t ? t[k] : {}), set:(t,k,v)=>{t[k]=v; return true;} });
  const d = Object.assign(el, doc);
  const set = new Function("document", glyphCode + "\n;return pickGlyphs();")(d);
  // Half-width katakana lives at U+FF61..U+FF9F (NOT 0xFF00..0xFF60).
  // Full-width katakana lives at U+30A0..U+30FF.
  const isHalf = c => { const n = c.charCodeAt(0); return n >= 0xFF61 && n <= 0xFF9F; };
  const isFull = c => { const n = c.charCodeAt(0); return n >= 0x30A0 && n <= 0x30FF; };
  const halfCount = Array.from(set).filter(isHalf).length;
  const fullCount = Array.from(set).filter(isFull).length;
  const digitCount = Array.from(set).filter(c => c >= "0" && c <= "9").length;
  const tofu = Array.from(set).some(c => c === "�");
  console.log(label.padEnd(46), "set=" + String(set.length).padStart(3),
    " half=" + halfCount, " full=" + fullCount, " digits=" + digitCount,
    tofu ? " TOFU!" : "");
  return { set, halfCount, fullCount, digitCount, tofu };
}

/* case 1: full support (mac / a font with half-width katakana) */
const a = run("full font (half-width available)", () => true);
/* case 2: half-width MISSING, full-width present (typical Windows mono) */
const b = run("half-width MISSING, full-width present",
  ch => !(ch.charCodeAt(0) >= 0xFF61 && ch.charCodeAt(0) <= 0xFF9F));
/* case 3: no katakana at all, digits only */
const c = run("no katakana at all, digits only",
  ch => ch >= "0" && ch <= "9");

const fails = [];
if (a.tofu || b.tofu || c.tofu) fails.push("tofu glyph present");
if (b.halfCount > 0) fails.push("used half-width katakana in a font that lacks it");
if (b.fullCount < 10) fails.push("did not fall back to full-width katakana");
if (c.set.length < 10) fails.push("digit-only fallback too small");
if (a.halfCount < 10) fails.push("did not use half-width when available");

console.log(fails.length ? "\nFAIL: " + fails.join("; ") : "\nPASS: glyph fallback chain is correct");
process.exit(fails.length ? 1 : 0);
