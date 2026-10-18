# DOH // ORBITAL CORE

Circular Tetris on a polar lattice. Single-file HTML5 canvas, no build step,
no dependencies, no external assets.

## Play

Open `index.html` in any modern browser. Nothing to install.

    node verify.js           # 51 logic tests
    node verify-render.js    # 8 render-path tests
    node verify-glyphs.js    # katakana font-fallback chain (3 font scenarios)
    node measure-rain.js     # rain coverage + VISIBILITY gate (exits 1 if too faint)

## Files

| File | Role |
|---|---|
| `index.html` | The entire game: markup, styles, logic, render, audio |
| `verify.js` | Headless logic suite (42 tests) |
| `verify-render.js` | Instrumented canvas suite (7 tests) |

## Design

**Matrix** 16 lanes x 12 rings of polar grid around a central core.
Ring 0 hugs the core; the outermost ring is the lose boundary.

**Core** The DOH core spins at the centre. It is the base the stack grows
out of, and clears pull the stack back down onto it. Spin defaults OFF and is
toggled with `G` — with spin on, the entire locked construction rotates, so
the gap slides underneath your aim. The falling piece and the locked stack use
different coordinate frames (world vs core-local, converted by
`localLane = mod(worldLane - coreSteps, LANES)`), and the renderer honours the
same split, so a piece always appears to land exactly where it locks.

**Shell** One tetromino at a time, dealt from a 7-bag with 5-piece lookahead.
Shells *approach* inward rather than falling; you decide when they bind.

**Aim** `Left/Right` orbits the shell around the circumference. `Up` rotates
it. `Space` slams it into the gap you chose. The approach does not wait, so
rotation time and approach distance are the real skill.

**Clear** A ring clears ONLY when all 16 lanes are filled. Partial arcs do not
clear and score nothing. This is the single difficulty lever: an earlier build
let 8-cell arcs clear, which kept the stack permanently shallow so a run could
essentially never lose. Cells outward of a cleared ring slide one ring inward.

**Core purge** A hole that gets buried under other rings can never be filled
again, so a whole-ring-only rule can strand a run that can no longer clear
anything. When the stack reaches 9 rings deep (`PURGE_DEPTH`), the core burns
the innermost occupied ring and everything outside it slides in. It awards no
points, counts as no ring, and breaks the combo — a pressure valve, not a
rescue. It runs *after* the boundary breach check, so it can never save a
topped-out run. Verified with a beam search: 4 rings are completable at 16
lanes (`sim-search.js`).

**Lose** The stack reaches the outer boundary. A clear on that same lock can
still save you.

## Controls

| Input | Action |
|---|---|
| `Left` `Right` / `A` `D` | Orbit the shell around the circle |
| `Up` / `W` | Rotate the shell |
| `Z` / `Ctrl` | Rotate back |
| `Space` | Rapid lock into the aimed gap |
| `Down` / `S` | Soft drop |
| `C` / `Shift` | Hold |
| `G` | Core spin on/off |
| `P` / `Esc` | Pause |
| `M` | Mute |
| `R` | Restart |

Touch: top band rotates, left/right thirds orbit, bottom band rapid-locks.

## Mechanics sourced

Tetris Guideline — move-reset lock down capped at 15, 0.5 s lock delay,
7-bag randomiser, ghost piece, hold, DAS 167 ms / ARR 33 ms / ARE 100 ms,
scoring 100/300/500/800 x level, B2B difficult x1.5, combo 50 x n x level,
perfect clear 800-2000 x level.

Polar geometry and clear rules from `github.com/dsebastien/orbital-tetris`
(16x6 lattice, pieces rest on first contact, arc and full-ring clears,
inward collapse, boundary loss) — reimplemented in vanilla canvas.

Story from *Arkanoid: Revenge of Doh* (Taito 1987, re-released in Arcade
Archives 2 on 3 Sept 2026): DOH is a dimension-controlling entity that crossed
dimensions to invade our universe. Original artwork and code — no assets used.

## Known limits

- Single difficulty curve; no level select or persistent unlocks.
- No PWA manifest or service worker, so it is not installable offline.
- Best score is stored in localStorage only; no leaderboard.
- The core-spin rate is fixed and not exposed as a difficulty setting.
- On viewports below roughly 800x600 the field scales down to ~0.5 scale;
  cells stay legible but the HUD gets tight. Phone portrait is playable but
  cramped — the game is tuned for a desktop window.
- `APPROACH_BASE` is coupled to `RINGS` on purpose. See the note beside it
  before changing the depth again.
