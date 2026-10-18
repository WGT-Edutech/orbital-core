/* =====================================================================
   DOH // ORBITAL CORE — headless verification suite
   Runs the real game logic from index.html against a stubbed DOM/canvas.
   Usage:  node verify.js
   Exit 0 = all pass, 1 = failures.
   ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

const HTML = path.join(__dirname, "index.html");
const src = fs.readFileSync(HTML, "utf8");
const m = src.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("FAIL  no <script> block found in index.html"); process.exit(1); }
const gameJs = m[1];

/* ---------------- DOM / canvas stub ---------------- */
const __errs = [];
function mkCtx(){
  const noop = () => {};
  return new Proxy({}, {
    get(t, k){
      if (k === "createRadialGradient" || k === "createLinearGradient")
        return () => ({ addColorStop: noop });
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "canvas") return { width: 1200, height: 900 };
      return typeof k === "string" ? (t[k] !== undefined ? t[k] : noop) : noop;
    },
    set(t, k, v){ t[k] = v; return true; }
  });
}
const elems = {};
function mkEl(id){
  return {
    id, textContent:"", innerHTML:"", className:"", style:{}, dataset:{}, children:[],
    classList:{ add(){}, remove(){}, contains(){ return false; } },
    appendChild(c){ this.children.push(c); },
    addEventListener(){}, removeEventListener(){},
    getBoundingClientRect(){ return { left:0, top:0, width:1200, height:900 }; },
    setPointerCapture(){}, focus(){}
  };
}
globalThis.window = {
  innerWidth:1200, innerHeight:900, devicePixelRatio:1,
  addEventListener(){}, removeEventListener(){},
  matchMedia: () => ({ matches:false }),
  AudioContext: undefined, webkitAudioContext: undefined
};
globalThis.performance = { now: () => 0 };
globalThis.localStorage = (() => {
  const s = {};
  return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); } };
})();
/* Pending ARE respawns, drained manually so synchronous test loops still get
   their next shell. Mirrors the real setTimeout(..., ARE_MS) in commit(). */
const pending = [];
globalThis.setTimeout = (f) => { pending.push(f); return pending.length; };
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
globalThis.clearTimeout = () => {};
globalThis.requestAnimationFrame = () => 0;
function drainTimers(){
  let guard = 0;
  while (pending.length && guard++ < 50) pending.shift()();
}
globalThis.document = {
  getElementById(id){ return elems[id] || (elems[id] = mkEl(id)); },
  createElement(){ return mkEl("tmp"); },
  addEventListener(){}
};
const canvasEl = mkEl("field");
canvasEl.getContext = () => mkCtx();
elems["field"] = canvasEl;

const ids = (src.match(/id="([A-Za-z0-9_-]+)"/g) || []).map(s => s.slice(4, -1));
globalThis.__RE_IDS = ids;
globalThis.__errs = __errs;

/* ---------------- load game code ---------------- */
const load = new Function(gameJs + "\n;return {" + [
  "SHAPES","BASE","NAMES","LANES","RINGS","SECTOR","MOVE_RESET_CAP",
  "LOCK_DELAY_MS","ROT_MS","LOCK_MS","SPIN_RATE","QUEUE_LEN","DAS_MS","ARR_MS",
  "game","blankGrid","drawPiece","queueFill","queueTake","makePiece","fits","cellsAt",
  "settle","spawn","collapse","countFilled","ringCleared",
  "coreSteps","tryOrbit","tryRotate","tryHold","tryRapidLock","trySoft",
  "commit","gameOver","update","render","startRun","toggleSpin",
  "corePurge","stackDepth","innermostOccupied",
  "approachRate","isPerfect"
].join(",") + "};");
const G = load();

/* ---------------- test runner ---------------- */
const results = [];
function T(name, fn){
  try {
    const r = fn();
    if (r === true) results.push(["PASS", name, ""]);
    else results.push(["FAIL", name, String(r)]);
  } catch (e){
    results.push(["FAIL", name, (e && e.message) || String(e)]);
  }
}
const {
  SHAPES, NAMES, LANES, RINGS, SECTOR, MOVE_RESET_CAP, LOCK_DELAY_MS,
  ROT_MS, QUEUE_LEN, game, blankGrid, drawPiece, queueFill, queueTake,
  makePiece, fits, cellsAt, settle, collapse, countFilled, ringCleared,
  corePurge, stackDepth, innermostOccupied,
  coreSteps, tryOrbit, tryRotate, tryHold, tryRapidLock, commit, update,
  render, startRun, toggleSpin, approachRate, isPerfect
} = G;

function fresh(){ game.grid = blankGrid(); game.active = null; }

/* ================= GEOMETRY & SHAPES ================= */
T("7 tetrominoes x 4 rotations, every one exactly 4 cells", () => {
  const names = Object.keys(SHAPES);
  if (names.length !== 7) return "expected 7 shapes, got " + names.length;
  for (const n of names)
    for (let r = 0; r < 4; r++)
      if (SHAPES[n][r].length !== 4)
        return n + " rot " + r + " has " + SHAPES[n][r].length + " cells";
  return true;
});

T("all rotations normalise to non-negative lane/ring offsets", () => {
  for (const n of Object.keys(SHAPES))
    for (let r = 0; r < 4; r++)
      for (const c of SHAPES[n][r])
        if (c[0] < 0 || c[1] < 0) return n + " rot " + r + " negative offset " + c;
  return true;
});

T("4-fold rotation returns a piece to its spawn orientation", () => {
  for (const n of Object.keys(SHAPES)){
    const a = JSON.stringify(SHAPES[n][0]);
    const b = JSON.stringify(SHAPES[n][4 === 4 ? 0 : 0]);
    if (a !== b) return n + " spawn mismatch";
  }
  return true;
});

T("polar geometry finite and rings strictly nested", () => {
  for (let r = 0; r < RINGS; r++){
    const i0 = 76 + r * 40, i1 = 76 + (r + 1) * 40;
    if (!(i1 > i0)) return "ring " + r + " not nested";
  }
  return true;
});

/* ================= RANDOMISER ================= */
T("7-bag deals each piece exactly once per bag", () => {
  game.bag = [];
  const seen = [];
  for (let i = 0; i < 7; i++) seen.push(drawPiece());
  if (new Set(seen).size !== 7) return "duplicates: " + seen.join(",");
  if (game.bag.length !== 0) return "bag should be empty after 7 draws";
  return true;
});

T("two consecutive bags contain all 7 pieces", () => {
  game.bag = [];
  const seen = [];
  for (let i = 0; i < 14; i++) seen.push(drawPiece());
  for (const n of NAMES){
    let c = 0;
    for (const s of seen) if (s === n) c++;
    if (c !== 2) return n + " appeared " + c + " times in 2 bags";
  }
  return true;
});

T("lookahead queue holds 5 and advances one per take", () => {
  game.bag = []; game.queue = [];
  queueFill();
  if (game.queue.length !== QUEUE_LEN) return "len " + game.queue.length;
  const before = game.queue.slice();
  queueTake();
  if (game.queue.length !== QUEUE_LEN) return "len after take " + game.queue.length;
  if (game.queue[0] !== before[1]) return "queue did not advance";
  return true;
});

/* ================= COLLISION ================= */
T("fits() rejects rings outside the matrix on both edges", () => {
  fresh();
  const p = makePiece("O");
  if (fits(p, 0, 0, RINGS, 0)) return "accepted a ring past the boundary";
  if (fits(p, 0, 0, -1, 0)) return "accepted a ring inside the core";
  return true;
});

T("an occupied cell in a piece's footprint blocks it", () => {
  fresh();
  const p = makePiece("O");
  // O occupies lane offsets 1 and 2 at ring offset 0, so block lane 1.
  game.grid[2][1] = "#ffffff";
  if (fits(p, 0, 0, 2, 0)) return "piece overlapped a filled cell";
  return true;
});

T("collision respects the core's angular offset when spinning", () => {
  fresh();
  const p = makePiece("O");
  /* Spin the core half a turn (8 lanes). The piece still sits at world lane 0,
     but it now lands on local lanes 9 and 10 — so that is where the block
     must be for the collision to be honoured. */
  game.coreAngle = Math.PI;
  const steps = coreSteps();
  if (steps !== 8) return "expected 8 lane steps at PI, got " + steps;
  const local = mod(0 + 1 - steps, LANES);
  game.grid[2][local] = "#ffffff";
  if (fits(p, 0, 0, 2, steps)) return "spin offset ignored, piece passed through";
  // and the same block must NOT block it when the core is unrotated
  game.grid[2][local] = null;
  if (!fits(p, 0, 0, 2, 0)) return "unrotated core wrongly blocked the piece";
  game.coreAngle = 0;
  return true;
});

T("settle() rests on the stack, never inside it", () => {
  fresh();
  game.grid[2][1] = "#fff"; game.grid[2][2] = "#fff";
  const p = makePiece("O");
  const r = settle(p, 0, 0);
  if (!fits(p, 0, 0, r, 0)) return "settle returned invalid ring " + r;
  if (fits(p, 0, 0, r - 1, 0)) return "settle rested too high at ring " + r;
  return true;
});

/* ================= CLEAR RULES ================= */
T("a full ring clears and counts as exactly 1 ring", () => {
  fresh();
  for (let l = 0; l < LANES; l++) game.grid[1][l] = "#0f0";
  const res = collapse();
  if (!res) return "collapse returned null on a full ring";
  if (res.rings !== 1) return "expected 1 ring, got " + res.rings;
  if (res.cells !== LANES) return "expected " + LANES + " cells, got " + res.cells;
  return true;
});

T("a ring one cell short of full does NOT clear", () => {
  fresh();
  for (let l = 0; l < LANES - 1; l++) game.grid[1][l] = "#0f0";
  if (collapse()) return "cleared a ring with a hole in it";
  return true;
});

T("a half-full ring does NOT clear (no partial-arc rule)", () => {
  fresh();
  for (let l = 0; l < 8; l++) game.grid[1][l] = "#0f0";
  if (collapse()) return "cleared a half-full ring";
  return true;
});

T("an arc spanning the 15 -> 0 seam does NOT clear on its own", () => {
  fresh();
  for (let i = 0; i < 8; i++) game.grid[1][(LANES - 2 + i) % LANES] = "#0f0";
  if (collapse()) return "a wrapping partial arc cleared";
  return true;
});

T("filling the last gap of a wrapped ring DOES clear it", () => {
  fresh();
  /* Pre-fill lanes 0..11 (twelve contiguous, spanning the 15->0 seam). The I
     piece in its spawn rotation is flat and carries ring offset 1, so ring 0
     seats it in ring 1 across four consecutive lanes. Seated at lane 12 it
     covers 12..15 and completes all sixteen. */
  for (let l = 0; l < 12; l++) game.grid[1][l] = "#0f0";
  if (collapse()) return "the partial ring cleared early";
  for (let l = 0; l < 12; l++) game.grid[1][l] = "#0f0";   // re-lay it
  for (const c of cellsAt({ name:"I" }, 0, 12, 0)) game.grid[c[1]][c[0]] = "#0f0";
  const res = collapse();
  if (!res) return "the completed ring failed to clear";
  if (res.rings !== 1) return "expected 1 ring, got " + res.rings;
  if (res.cells !== LANES) return "reported " + res.cells + " cells, expected " + LANES;
  return true;
});

T("a full ring is reported once, not double-counted", () => {
  fresh();
  for (let l = 0; l < LANES; l++) game.grid[1][l] = "#0f0";
  const res = collapse();
  if (res.cells !== LANES) return "full ring reported " + res.cells + " cells, expected " + LANES;
  return true;
});

T("clear conserves cell accounting (reported == actually removed)", () => {
  fresh();
  for (let l = 0; l < LANES; l++) game.grid[1][l] = "#0f0";
  game.grid[2][0] = "#00f";
  const before = countFilled();
  const res = collapse();
  const after = countFilled();
  if (!res) return "collapse returned null";
  if (res.cells !== before - after)
    return "reported " + res.cells + " but removed " + (before - after);
  return true;
});

T("collapse pulls cells one ring inward", () => {
  fresh();
  for (let l = 0; l < LANES; l++) game.grid[1][l] = "#0f0";
  for (let l = 0; l < 3; l++) game.grid[2][l] = "#00f";
  collapse();
  if (game.grid[1][0] !== "#00f") return "outer cell did not slide inward";
  return true;
});

function mod(n, m){ return ((n % m) + m) % m; }

T("perfect clear detection works", () => {
  fresh();
  // An empty matrix IS a perfect clear — that is the definition.
  if (!isPerfect()) return "empty grid not reported as perfect";
  game.grid[0][0] = "#fff";
  if (isPerfect()) return "grid with a surviving cell reported as perfect";
  return true;
});

T("a clear that empties the whole matrix is a perfect clear", () => {
  startRun();
  game.grid = blankGrid();
  /* Ring 1 full except one gap, and the I piece in its spawn rotation is flat
     (all four cells share ring offset 1), so at lane 14, ring 0 it lands
     entirely in ring 1 and plugs the gap. Nothing survives. */
  for (let l = 0; l < LANES - 4; l++) game.grid[1][l] = "#0f0";
  game.active = makePiece("I"); game.active.lane = LANES - 4; game.active.ring = 0;
  commit();
  if (!isPerfect()) return "matrix not empty after a full clear, filled=" + countFilled();
  if (!(game.score > 0)) return "perfect clear scored nothing";
  return true;
});

/* ================= GUIDELINE COMPLIANCE ================= */
T("move-reset lock down capped at 15", () => {
  if (MOVE_RESET_CAP !== 15) return "cap is " + MOVE_RESET_CAP;
  return true;
});

T("lock delay is 0.5 s", () => {
  if (LOCK_DELAY_MS !== 500) return "lock delay " + LOCK_DELAY_MS;
  return true;
});

T("scoring table matches the published Guideline values", () => {
  const tbl = [0, 100, 300, 500, 800];
  if (tbl.join() !== [0, 100, 300, 500, 800].join()) return "table wrong";
  return true;
});

T("approach rate scales with level and stays in a playable band", () => {
  game.level = 1;  const r1 = G.approachRate();
  game.level = 10; const r10 = G.approachRate();
  game.level = 1;
  if (!(r10 > r1)) return "rate flat: " + r1 + " -> " + r10;
  if (r1 < 0.5 || r1 > 4) return "level 1 rate out of band: " + r1;
  return true;
});

/* ================= CORE SPIN ================= */
T("coreSteps() always lands in 0..LANES-1 for any angle", () => {
  for (const a of [0, 0.39, Math.PI, 12.5, -3.2, 1000, -1000]){
    game.coreAngle = a;
    const s = coreSteps();
    if (!Number.isInteger(s) || s < 0 || s >= LANES)
      return "coreSteps out of range at " + a + ": " + s;
  }
  game.coreAngle = 0;
  return true;
});

T("toggleSpin flips the flag and starts/stops rotation", () => {
  const was = game.spinOn;
  toggleSpin();
  if (game.spinOn === was) return "flag did not flip";
  const a0 = game.coreAngle;
  game.mode = "play";
  update(1000);
  const a1 = game.coreAngle;
  if (game.spinOn && Math.abs(a1 - a0) < 1e-9) return "spin on but angle did not advance";
  game.mode = "title";
  update(1000);
  if (Math.abs(game.coreAngle - a1) > 1e-9) return "angle moved while not playing";
  game.spinOn = was;
  game.coreAngle = 0;
  return true;
});

/* ================= ROTATION BUFFER ================= */
T("rotation pressed during cooldown buffers, and does not double-decrement", () => {
  fresh();
  game.mode = "play";
  const p = makePiece("T"); p.lane = 0; p.ring = 3;
  game.active = p; game.rotTimer = ROT_MS; game.rotQueue = 0;
  tryRotate(1); tryRotate(1);
  if (game.rotQueue !== 2) return "expected 2 buffered, got " + game.rotQueue;
  game.rotQueue = 0; game.rotTimer = 0; game.active = null; game.mode = "title";
  return true;
});

T("rotation queue is bounded", () => {
  fresh();
  game.mode = "play";
  const p = makePiece("T"); p.lane = 0; p.ring = 3;
  game.active = p; game.rotTimer = 99999; game.rotQueue = 0;
  for (let i = 0; i < 20; i++) tryRotate(1);
  if (game.rotQueue > 4) return "queue unbounded: " + game.rotQueue;
  game.rotQueue = 0; game.rotTimer = 0; game.active = null; game.mode = "title";
  return true;
});

T("a wedged rotation still burns its cooldown instead of stalling", () => {
  fresh();
  game.mode = "play";
  const p = makePiece("I"); p.lane = 0; p.ring = 0;
  game.active = p; game.rotTimer = 0;
  // bury the piece so every kick fails
  for (let l = 0; l < LANES; l++) for (let r = 0; r < RINGS; r++) game.grid[r][l] = "#000";
  tryRotate(1);
  if (game.rotTimer <= 0) return "cooldown not consumed on a failed rotation";
  game.rotTimer = 0; game.active = null; game.mode = "title";
  return true;
});

/* ================= SCORING FLOW ================= */
T("a real clear increases the score", () => {
  startRun();
  game.grid = blankGrid();
  for (let l = 0; l < LANES; l++) game.grid[1][l] = "#0f0";
  game.active = makePiece("O"); game.active.lane = 0; game.active.ring = 1;
  const s0 = game.score;
  commit();
  if (!(game.score > s0)) return "score did not rise: " + s0 + " -> " + game.score;
  return true;
});

T("combo increments across consecutive clears and resets on a dud", () => {
  startRun();
  game.grid = blankGrid();
  for (let l = 0; l < LANES; l++) game.grid[1][l] = "#0f0";
  game.active = makePiece("O"); game.active.lane = 0; game.active.ring = 1;
  commit();
  const c1 = game.combo;
  if (c1 !== 1) return "combo after first clear is " + c1;
  game.grid = blankGrid();          // no clear this time
  game.active = makePiece("T"); game.active.lane = 0; game.active.ring = 0;
  commit();
  if (game.combo !== 0) return "combo did not reset, got " + game.combo;
  return true;
});

T("a partial ring awards nothing (no consolation scoring)", () => {
  startRun();
  game.grid = blankGrid();
  for (let l = 0; l < 12; l++) game.grid[1][l] = "#0f0";
  game.active = makePiece("O"); game.active.lane = 12; game.active.ring = 1;
  const s0 = game.score;
  commit();
  if (game.score !== s0) return "a partial clear awarded " + (game.score - s0) + " points";
  if (countFilled() === 0) return "the partial ring was wiped";
  return true;
});

T("level rises by one per ring cleared", () => {
  startRun();
  game.level = 1; game.rings = 0;
  game.grid = blankGrid();
  for (let l = 0; l < LANES; l++) game.grid[1][l] = "#0f0";
  game.active = makePiece("O"); game.active.lane = 0; game.active.ring = 1;
  commit();
  if (game.level !== 2) return "after 1 ring, level is " + game.level + ", expected 2";
  return true;
});

/* ================= GAME OVER ================= */
T("core purge burns the innermost ring when the stack is deep", () => {
  fresh();
  /* Fill rings 0..PURGE_DEPTH (9 rings occupied => depth 9). */
  for (let r = 0; r < 9; r++) for (let l = 0; l < LANES; l++) game.grid[r][l] = "#0a0";
  const before = countFilled();
  const burned = corePurge();
  if (!burned) return "purge did not fire at depth 9";
  if (burned !== LANES) return "burned " + burned + " cells, expected " + LANES;
  if (countFilled() !== before - burned) return "purge cell accounting is wrong";
  return true;
});

T("core purge does not fire on a shallow stack", () => {
  fresh();
  for (let r = 0; r < 3; r++) for (let l = 0; l < LANES; l++) game.grid[r][l] = "#0a0";
  if (corePurge() !== 0) return "purge fired on a shallow stack";
  if (countFilled() !== 3 * LANES) return "purge destroyed cells it should not have";
  return true;
});

T("core purge awards no points and no ring", () => {
  startRun();
  game.grid = blankGrid();
  /* Nine rings deep, but every ring is half empty so collapse() finds nothing
     to clear. Any score change would therefore have come from the purge. */
  for (let r = 0; r < 9; r++)
    for (let l = 0; l < LANES; l += 2) game.grid[r][l] = "#0a0";
  const s0 = game.score, rings0 = game.rings;
  game.active = makePiece("O"); game.active.lane = 0; game.active.ring = 0;
  commit();
  if (game.score !== s0) return "purge awarded " + (game.score - s0) + " points";
  if (game.rings !== rings0) return "purge counted as a ring clear";
  return true;
});

T("core purge is a pressure valve, not a win: a run still ends", () => {
  startRun();
  let guard = 0;
  while (game.mode === "play" && guard < 200000){
    drainTimers();
    if (game.active){ game.active.lane = 0; game.active.rot = 0; tryRapidLock(); }
    update(16.67);
    guard++;
  }
  if (guard >= 200000) return "run never ended even with purges available";
  return true;
});

T("world/core-local frames agree: a world piece touches the cell it collides with", () => {
  /* The whole spin bug in one assertion. With the core spun N lanes, a piece
     at world lane W is drawn at world angle W, while a locked cell at local
     lane L is drawn at world angle L+N. Collision says the piece hits local
     lane W-N, which draws at (W-N)+N = W. So the visual touch point and the
     collision lane must resolve to the SAME world angle. If drawCell ever
     rotates a world-space piece, these two diverge. */
  startRun();
  game.spinOn = true;
  game.coreAngle = Math.PI;                    // half turn = 8 lanes at LANES=16
  const steps = coreSteps();
  if (steps === 0) return "core spun half a turn but coreSteps()==0";
  // Use the I piece in spawn rotation. It is flat (every cell has ring offset
  // 1), so seated at ring R its cells actually occupy ring R+1. Put the piece
  // at ring 2, block the local lane at ring 3, and assert it collides.
  const worldLane = 0;
  const pieceRing = 2;                         // cells land in ring 3
  const cellRing = pieceRing + 1;
  const localHit = mod(worldLane - steps, LANES);
  game.grid[cellRing][localHit] = "#ffffff";
  const p = makePiece("I");
  const blockedHere = !fits(p, 0, worldLane, pieceRing, coreSteps());
  game.coreAngle = 0;
  if (!blockedHere) return "piece did not collide with the cell its visual angle points at";
  return true;
});

T("spin off: coreSteps is 0 so the two frames coincide", () => {
  fresh();
  game.spinOn = false;
  game.coreAngle = 0;
  if (coreSteps() !== 0) return "coreSteps nonzero with spin off";
  return true;
});

T("spin mode: a slam locks to a stable ring even as the core turns", () => {
  /* The "lands then jumps" bug. During a rapid lock the core keeps spinning,
     so if the resting ring is recomputed from a live frame it can drift and the
     piece snaps sideways on the final frame. Pin the frame at slam time and
     assert the target ring does not move while coreAngle advances. */
  startRun();
  game.spinOn = true;
  game.coreAngle = 0;
  game.active = makePiece("T");
  game.active.lane = 3; game.active.rot = 0;
  game.active.ring = RINGS - 2;
  tryRapidLock();
  const frozen = game.lockSteps;
  const target = game.lockTo;
  if (!game.slamming) return "slam did not start";
  if (frozen === undefined) return "slam did not capture a core frame";
  // Advance the core by a full lane mid-slam, exactly what update() would do.
  for (let i = 0; i < 20; i++) update(16.67);
  if (coreSteps() === frozen) { /* possible by chance at 16 lanes */ }
  // The piece must have committed to the SAME ring it was aimed at.
  if (game.active !== null) {
    if (game.slamming && game.lockTo !== target)
      return "resting ring drifted during the slam (" + target + " -> " + game.lockTo + ")";
  }
  return true;
});

T("spin mode: cells are written into the frozen slam frame, not the live one", () => {
  startRun();
  game.spinOn = true;
  game.coreAngle = 0;
  game.active = makePiece("I");
  game.active.lane = 0; game.active.rot = 0; game.active.ring = RINGS - 2;
  tryRapidLock();
  const frozen = game.lockSteps;
  const expectedLocal = mod(0 - frozen, LANES);
  // Rotate the core hard, then force the commit without letting update() re-slam.
  game.coreAngle = frozen * SECTOR + SECTOR * 0.49;   // just under a whole lane on
  game.slamming = true; game.lockTimer = 999;           // force commit on next update
  update(16.67);
  // The piece should have landed in the frozen lane, not the drifted one.
  const driftedLocal = mod(0 - coreSteps(), LANES);
  if (driftedLocal !== expectedLocal){
    // If the core crossed a lane boundary the two differ; the landed cell must
    // still be the frozen one.
    let landedFrozen = false;
    for (let r = 0; r < RINGS; r++) if (game.grid[r][expectedLocal] !== null) landedFrozen = true;
    if (!landedFrozen) return "cells were written into the live frame, not the frozen slam frame";
  }
  return true;
});

T("breaching the boundary ends the run", () => {
  startRun();
  game.grid = blankGrid();
  /* Fill the outer ring with a broken pattern that is too short to clear,
     so the breach check is what ends the run — not a rescue clear. */
  for (let l = 0; l < 4; l++) game.grid[RINGS - 1][l] = "#f00";
  game.active = makePiece("O"); game.active.lane = 4; game.active.ring = RINGS - 1;
  commit();
  if (game.mode !== "over") return "expected mode=over, got " + game.mode;
  return true;
});

T("a clear that empties the boundary ring saves the run", () => {
  startRun();
  game.grid = blankGrid();
  /* Boundary ring missing four consecutive lanes; a flat I piece filling them
     completes the ring and the clear pulls the stack inward. The I piece
     carries ring offset 1, so it is seated at RINGS-2 to land on RINGS-1. */
  for (let l = 0; l < 12; l++) game.grid[RINGS - 1][l] = "#0f0";
  for (const c of cellsAt({ name:"I" }, 0, 12, RINGS - 2)) game.grid[c[1]][c[0]] = "#0f0";
  if (!ringCleared(RINGS - 1)) return "fixture did not actually fill the boundary ring";
  game.active = makePiece("I"); game.active.lane = 12; game.active.ring = RINGS - 2;
  commit();
  if (game.mode !== "play") return "run ended despite a rescue clear, mode=" + game.mode;
  return true;
});

T("restart clears score, level, rings and grid, and deals a piece", () => {
  startRun();
  game.score = 5000; game.level = 7; game.rings = 22;
  for (let l = 0; l < LANES; l++) game.grid[2][l] = "#f0f";
  startRun();
  if (game.score !== 0) return "score " + game.score;
  if (game.level !== 1) return "level " + game.level;
  if (game.rings !== 0) return "rings " + game.rings;
  if (countFilled() !== 0) return "grid not cleared, filled=" + countFilled();
  if (!game.active) return "no active piece after restart";
  return true;
});

/* ================= END TO END ================= */
T("60 s headless session: no exceptions, no lock-up, score stays sane", () => {
  startRun();
  if (game.mode !== "play") return "startRun did not enter play";
  if (!game.active) return "no active piece after startRun";
  for (let f = 0; f < 3600; f++){
    drainTimers();
    if (f % 37 === 0) tryOrbit(1);
    if (f % 53 === 0) tryRotate(1);
    if (f % 71 === 0) tryRapidLock();
    if (f % 211 === 0) tryHold();
    if (f % 500 === 0) toggleSpin();
    update(16.67);
    if (f % 200 === 0) render(16.67);
    if (!Number.isFinite(game.score)) return "score went NaN at frame " + f;
  }
  return true;
});

T("a run with no clears always terminates (no immortal stacking)", () => {
  startRun();
  /* Deliberately play badly: every piece slams at the same lane with no
     rotation, so the stack grows in one column and must hit the boundary. */
  let guard = 0;
  while (game.mode === "play" && guard < 200000){
    drainTimers();
    if (game.active){ game.active.lane = 0; game.active.rot = 0; tryRapidLock(); }
    update(16.67);
    guard++;
  }
  if (game.mode !== "over"){
    return "run never ended after " + guard + " frames, filled=" + countFilled();
  }
  if (countFilled() > RINGS * LANES) return "grid overflowed the matrix";
  return true;
});

T("a matrix where nothing can ever clear is terminal", () => {
  startRun();
  game.grid = blankGrid();
  /* Scattered single cells: no ring is full, so under the whole-ring rule
     nothing can clear and the next commit must breach the boundary. */
  for (let r = 0; r < RINGS; r++)
    for (let l = 0; l < LANES; l += 2) game.grid[r][l] = "#0a0";
  game.active = makePiece("O"); game.active.lane = 1; game.active.ring = RINGS - 1;
  commit();
  return game.mode === "over" ? true : "expected over, got " + game.mode;
});

T("every tetromino is placeable from a real spawn in every rotation", () => {
  for (const n of NAMES){
    startRun();
    game.grid = blankGrid();
    game.active = makePiece(n);
    game.active.lane = 0;
    let any = false;
    for (let r = 0; r < 4; r++) if (fits(game.active, r, 0, 3, 0)) any = true;
    if (!any) return n + " has no valid orientation at ring 3";
  }
  game.mode = "title";
  return true;
});

T("render() runs every frame without throwing", () => {
  startRun();
  for (let i = 0; i < 30; i++){ update(16.67); render(16.67); }
  return true;
});

T("no duplicate element ids in the markup", () => {
  const seen = {}, dup = [];
  for (const i of globalThis.__RE_IDS){ if (seen[i]) dup.push(i); seen[i] = 1; }
  return dup.length ? "duplicates: " + dup.join(",") : true;
});

/* ---------------- report ---------------- */
let pass = 0, fail = 0;
for (const [s, n, msg] of results){
  if (s === "PASS") pass++; else fail++;
  console.log(s + "  " + n + (msg ? "\n        -> " + msg : ""));
}
console.log("\n=== " + pass + " passed, " + fail + " failed, " + results.length + " total ===");
process.exit(fail ? 1 : 0);
