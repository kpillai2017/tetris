/* =============================================================================
 * TETRIS — a complete game in dependency-free vanilla JavaScript.
 *
 * HOW TO READ THIS FILE
 * ---------------------
 * The file is organised top-to-bottom in the order a game actually runs:
 *
 *   1. Configuration      — board size, colours, piece shapes
 *   2. State              — the variables that hold the whole game in memory
 *   3. Model logic        — spawning, collision, movement, rotation, scoring
 *   4. Rendering          — painting the board, ghost piece and previews
 *   5. Game loop          — one tick per animation frame
 *   6. Audio              — the Korobeiniki theme via the Web Audio API
 *   7. Input & bootstrap  — keyboard wiring and the first frame
 *
 * The one idea that makes the rest make sense: **the board is the only source
 * of truth.** Nothing tracks "where did the piece move to" separately — every
 * action is validated by asking one question, `collide()`, "if I put the piece
 * here, does it overlap a wall, the floor, or an already-locked cell?"
 * ========================================================================== */

'use strict';

/* =============================================================================
 * 1. CONFIGURATION
 * ========================================================================== */

/** Number of columns in the playfield (10 is the classic Tetris width). */
const COLS = 10;
/** Number of rows in the playfield (20 is the classic visible height). */
const ROWS = 20;
/**
 * Size of one cell in pixels. The <canvas> in index.html is sized 240x480
 * precisely because COLS * CELL === 10 * 24 === 240 and ROWS * CELL === 480.
 * Change CELL here and remember to update the canvas width/height too.
 */
const CELL = 24;

/**
 * One colour per piece type. These strings are stored directly inside the
 * board matrix, which is why the board is described as "a grid of colour
 * strings or null" rather than a grid of piece types.
 */
const COLORS = {
  I: '#4fd5ff',
  J: '#4f6aff',
  L: '#ff9b3d',
  O: '#ffd93d',
  S: '#54e375',
  T: '#b64fff',
  Z: '#ff556e',
};

/**
 * The seven tetrominoes as 2D arrays of 0/1 flags: 0 = empty cell,
 * 1 = part of the piece. Rendering, collision, movement and rotation all
 * operate on these matrices, so this single table defines how every piece
 * looks and behaves.
 *
 * Note the deliberately uniform bounding boxes — they are what make rotation
 * simple:
 *   - I sits in a 4x4 box (so its "flat" row can spin into a "tall" column
 *     without changing the piece's footprint size)
 *   - J, L, S, T, Z sit in 3x3 boxes
 *   - O is 2x2 and is already symmetric, so rotating it changes nothing
 * The extra empty rows/columns are the "rotate in place" padding.
 */
const SHAPES = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
};

/* =============================================================================
 * 2. STATE
 *
 * There is no framework and no class — the entire game is these variables.
 * `const` for things that never change (config, DOM handles), `let` for the
 * mutable game state. A `restart()` just assigns fresh values to the `let`s,
 * which is why restarting is so cheap.
 * ========================================================================== */

/**
 * The playfield: a ROWS x COLS matrix where every cell is either
 * `null` (empty) or a CSS colour string (a locked block).
 * Locked cells no longer remember which piece they came from.
 */
const board = createMatrix(ROWS, COLS);

/* Grab the 2D drawing contexts once, up front. Looking these up per frame would
 * mean walking the DOM 60 times a second for no reason. */
const boardCtx = document.getElementById('board').getContext('2d');
const holdCtx = document.getElementById('hold-canvas').getContext('2d');
const nextCtx = document.getElementById('next-canvas').getContext('2d');

/* The translucent message box layered on top of the board (PAUSED / GAME OVER). */
const overlay = document.getElementById('overlay');
const overlayMessage = document.getElementById('overlay-message');
const overlaySub = document.getElementById('overlay-sub');

/** FIFO queue of upcoming piece types, refilled 7 at a time (see refillBag). */
let bag = [];
/** The piece in play: { type, matrix, x, y }. `null` between pieces. */
let current = null;
/** Type of the piece parked in the HOLD slot, or null. */
let holdType = null;
/** Hold is only allowed once per piece — reset by lockPiece(). */
let canHold = true;
/** True while the game loop is frozen but the board is still drawn. */
let paused = false;
/** Terminal state; input and the drop timer both stop. */
let gameOver = false;

let score = 0;
let lines = 0;
let level = 1;

/** Milliseconds of elapsed gravity time; the piece drops when it exceeds the interval. */
let dropCounter = 0;
/** Milliseconds per automatic row of gravity. Gets faster as levels rise. */
let dropInterval = 1000;
/** Timestamp (ms) of the previous animation frame — used to measure `delta`. */
let lastTime = 0;

/* =============================================================================
 * 3. MODEL LOGIC
 * ========================================================================== */

/**
 * Build an empty rows x cols matrix.
 * `Array.from` with a mapper creates one independent inner array per row —
 * note the `new Array(cols).fill(null)` inside, which is what stops every row
 * from sharing (aliasing) the same array.
 */
function createMatrix(rows, cols) {
  return Array.from({ length: rows }, () => new Array(cols).fill(null));
}

/**
 * THE 7-BAG RANDOMISER — the single most important fairness rule in Tetris.
 *
 * Pure `Math.random()` piece selection is miserable to play: you can get twelve
 * I pieces in a row and 400 pieces without seeing an S or a Z. Instead we
 * shuffle all seven types, deal them out one by one, and only reshuffle when
 * the bag empties. The guarantee: every piece appears exactly once per 7
 * before any can repeat. "Dry" runs become impossible, max piece delay is 12.
 *
 * This is the classic Fisher-Yates shuffle: walk backwards, swap each element
 * with a random earlier one.
 */
function refillBag() {
  const types = Object.keys(SHAPES);
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }
  bag.push(...types);
}

/**
 * Spawn the next piece.
 *
 * - Refills the bag when fewer than 3 previews remain, so the NEXT panel can
 *   always show 3 pieces.
 * - `row.slice()` is a deep-enough copy: a fresh matrix per piece. Without it
 *   every piece would share (and corrupt) the SHAPES table.
 * - Horizontal spawn is centred: `(COLS - width) / 2`, floored.
 * - Spawning *into* an occupied cell means the stack reached the ceiling.
 */
function nextPiece() {
  if (bag.length < 3) refillBag();
  const type = bag.shift();
  current = {
    type,
    matrix: SHAPES[type].map(row => row.slice()),
    x: Math.floor((COLS - SHAPES[type][0].length) / 2),
    y: 0,
  };
  if (collide(current.matrix, current.x, current.y)) {
    endGame();
  }
  renderNextQueue();
}

/**
 * The one and only validity test for the whole game.
 *
 * Would the piece sit at (x, y) overlap a wall, the floor, or a locked block?
 * Returns true when the position is ILLEGAL (naming it after the bad outcome
 * keeps every call site reading as a guard: `if (collide(...)) return;`).
 *
 * Two subtleties:
 * - Only `matrix[r][c] === 1` cells are tested. The padding zeros of the
 *   bounding box are allowed to hang over an edge, which is exactly what lets
 *   an I piece rest half-off the floor.
 * - `by < 0` is NOT a collision: pieces spawn at y = 0 and may be partly above
 *   the visible board. The row index is only dereferenced once `by >= 0`, which
 *   avoids `board[-1]` (undefined -> TypeError).
 */
function collide(matrix, x, y) {
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (!matrix[r][c]) continue;
      const bx = x + c;
      const by = y + r;
      if (bx < 0 || bx >= COLS || by >= ROWS) return true;
      if (by >= 0 && board[by][bx]) return true;
    }
  }
  return false;
}

/**
 * Rotate a square matrix 90 degrees.
 *
 * `matrix[0].map((_, i) => matrix.map(row => row[i]))` transposes it: it
 * becomes a new matrix with rows and columns swapped. A transpose is a
 * reflection (a "flip"), so one more step turns the flip into a true rotation:
 *   - dir > 0 (clockwise): reverse each row  -> mirror across the main diagonal
 *   - dir < 0 (anticlockwise): reverse row order -> mirror across the other one
 *
 * A square matrix is required, which is precisely why every shape above is
 * defined inside a square bounding box.
 */
function rotate(matrix, dir) {
  const rotated = matrix[0].map((_, i) => matrix.map(row => row[i]));
  if (dir < 0) return rotated.reverse();
  return rotated.map((row) => row.reverse());
}

/**
 * Try to rotate the current piece, with WALL KICKS.
 *
 * Real pieces do not rotate in a vacuum: rotating against a wall or a stack
 * would embed them in a block. So we try the rotation, and if it collides we
 * retry at nudges of 0, -1, +1, -2, +2 columns and take the first that fits.
 * (Full guideline Tetris uses a 5-state kick table per piece; this simplified
 * set covers the common cases and is enough for a clean implementation.)
 */
function tryRotate(dir) {
  if (paused || gameOver || !current) return;
  const rotated = rotate(current.matrix, dir);
  for (const kick of [0, -1, 1, -2, 2]) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.matrix = rotated;
      current.x += kick;
      return;
    }
  }
}

/** Move left (dx = -1) or right (dx = +1), but only into a legal position. */
function move(dx) {
  if (paused || gameOver || !current) return;
  if (!collide(current.matrix, current.x + dx, current.y)) {
    current.x += dx;
  }
}

/**
 * Soft drop: one row down for +1 point.
 * If the piece is already resting on something we lock it immediately, so a
 * player can slam downwards to commit a piece instead of waiting for gravity.
 * Resetting dropCounter also refunds the gravity timer, giving the classic
 * "drop repeatedly to slide a piece along the floor" technique.
 */
function softDrop() {
  if (paused || gameOver || !current) return;
  if (!collide(current.matrix, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateStats();
  } else {
    lockPiece();
  }
  dropCounter = 0;
}

/**
 * Hard drop: fall as far as possible in one go, then lock.
 * The `while` loop is just a linear probe downwards — the piece is guaranteed
 * to stop because the floor always collides. 2 points per cell skipped rewards
 * dropping from a height.
 */
function hardDrop() {
  if (paused || gameOver || !current) return;
  let dist = 0;
  while (!collide(current.matrix, current.x, current.y + 1)) {
    current.y++;
    dist++;
  }
  score += dist * 2;
  lockPiece();
  updateStats();
}

/**
 * Commit the current piece to the board.
 *
 * The piece's live matrix (which rotates and moves) is copied into the
 * persistent board as colour strings, and the piece is retired. Rows that fall
 * out of the top are skipped by the `current.y + r >= 0` guard. Then clear
 * any full rows and pull in the next piece. Note that the lock delay is
 * instantaneous: real Tetris gives you a moment to slide a piece after it
 * touches down, which is why this feels slightly harsher.
 */
function lockPiece() {
  for (let r = 0; r < current.matrix.length; r++) {
    for (let c = 0; c < current.matrix[r].length; c++) {
      if (current.matrix[r][c] && current.y + r >= 0) {
        board[current.y + r][current.x + c] = COLORS[current.type];
      }
    }
  }
  clearLines();
  current = null;
  canHold = true;
  nextPiece();
}

/**
 * Remove every full row.
 *
 * Scan bottom-to-top. `splice` removes the full row and shifts everything above
 * it down one slot; `unshift` inserts a fresh empty row at the top to keep the
 * matrix exactly ROWS tall. Because the row we removed was full and the rows
 * that just shifted down into `r` have NOT been checked yet, we `r++` and
 * re-examine that same index — skipping it would miss Tetris (four lines) on a
 * single piece. `cleared` is capped at 4 by construction.
 *
 * Scoring is the classic guideline table scaled by level:
 *   1 line 100, 2 lines 300, 3 lines 500, 4 lines 800  (the "Tetris" bonus)
 * A new level every 10 lines, and gravity tightens by 100ms per level down to
 * a floor of 80ms (0.12s/row) so the game stays playable at high levels.
 */
function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(cell => cell)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(null));
      cleared++;
      r++;
    }
  }
  if (cleared > 0) {
    const points = [0, 100, 300, 500, 800][cleared] * level;
    score += points;
    lines += cleared;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(1000 - (level - 1) * 100, 80);
    updateStats();
  }
}

/**
 * HOLD (the swap slot).
 *
 * Swaps the current piece with the parked one. If the slot was empty we simply
 * take the next piece from the queue. `canHold = false` locks the slot until
 * the next lockPiece(), which is what stops players from cycling through the
 * whole bag to farm a perfect I-piece setup.
 */
function hold() {
  if (paused || gameOver || !current || !canHold) return;
  const temp = holdType;
  holdType = current.type;
  canHold = false;
  if (temp) {
    current = {
      type: temp,
      matrix: SHAPES[temp].map(row => row.slice()),
      x: Math.floor((COLS - SHAPES[temp][0].length) / 2),
      y: 0,
    };
  } else {
    nextPiece();
  }
  renderHold();
}

/* =============================================================================
 * 4. THE GAME LOOP
 * ========================================================================== */

/**
 * Runs once per animation frame, forever, via requestAnimationFrame at the end.
 *
 * `requestAnimationFrame` is the right clock for a game: the browser calls us
 * in sync with the display refresh, and the timestamp it hands us is
 * milliseconds. So instead of assuming a fixed 60fps we measure `delta` and
 * accumulate it into dropCounter. Gravity therefore stays accurate on 120Hz
 * monitors instead of dropping twice as fast.
 *
 * When paused/over we return early but keep re-queueing the frame: the loop
 * must never stop, or unfreezing it would require restarting the rAF chain.
 */
function update(time = 0) {
  if (paused || gameOver) {
    requestAnimationFrame(update);
    return;
  }
  const delta = time - lastTime;
  lastTime = time;
  dropCounter += delta;
  if (dropCounter > dropInterval) {
    if (current && !collide(current.matrix, current.x, current.y + 1)) {
      current.y++;
    } else if (current) {
      lockPiece();
    }
    dropCounter = 0;
  }
  draw();
  requestAnimationFrame(update);
}

/* =============================================================================
 * 5. RENDERING
 *
 * The board is redrawn from scratch every frame (no diffing, no retained
 * scene). At 10x20 = 200 cells that is trivially cheap, and it keeps the
 * renderer stateless — a nice trade for a project this size.
 * ========================================================================== */

/**
 * Paint one cell as a filled square with a lighter border.
 * The border inset by 1px on each side is what gives the blocks their
 * "outlined tile" look without any image assets.
 */
function drawCell(ctx, x, y, size, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x * size, y * size, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x * size + 1, y * size + 1, size - 2, size - 2);
}

/**
 * Draw a piece matrix offset onto some board.
 * Skips cells above the visible area (offsetY + r < 0) so a piece poking out of
 * the top of the screen is clipped rather than drawn at a negative coordinate.
 */
function drawMatrix(ctx, matrix, offsetX, offsetY, color) {
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] && offsetY + r >= 0) {
        drawCell(ctx, offsetX + c, offsetY + r, CELL, color);
      }
    }
  }
}

/**
 * One frame: background, grid, locked blocks, ghost piece, live piece.
 * The ghost (drop shadow) is found by probing downwards from the current
 * position, then drawn first in translucent white so the real piece sits on top.
 */
function draw() {
  boardCtx.fillStyle = '#000';
  boardCtx.fillRect(0, 0, COLS * CELL, ROWS * CELL);

  // Faint vertical grid lines, drawn at the edges of the cells.
  boardCtx.strokeStyle = 'rgba(255,255,255,0.05)';
  boardCtx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) {
    boardCtx.beginPath();
    boardCtx.moveTo(x * CELL, 0);
    boardCtx.lineTo(x * CELL, ROWS * CELL);
    boardCtx.stroke();
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) drawCell(boardCtx, c, r, CELL, board[r][c]);
    }
  }

  if (current) {
    // Ghost piece: where the piece would come to rest if dropped right now.
    let ghostY = current.y;
    while (!collide(current.matrix, current.x, ghostY + 1)) ghostY++;
    drawMatrix(boardCtx, current.matrix, current.x, ghostY, 'rgba(255,255,255,0.12)');
    drawMatrix(boardCtx, current.matrix, current.x, current.y, COLORS[current.type]);
  }
}

/**
 * Draw a piece centred inside a small preview canvas (HOLD / NEXT).
 * Unlike the board, these use a fixed 18px cell so the side panels stay small.
 */
function drawPreview(ctx, canvasWidth, type, yOffset) {
  const matrix = SHAPES[type];
  const size = 18;
  const w = matrix[0].length * size;
  const h = matrix.length * size;
  const xOff = Math.floor((canvasWidth - w) / 2);
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c]) {
        ctx.fillStyle = COLORS[type];
        ctx.fillRect(xOff + c * size, yOffset + r * size, size, size);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.strokeRect(xOff + c * size + 1, yOffset + r * size + 1, size - 2, size - 2);
      }
    }
  }
}

/** Repaint the HOLD slot. The 24px y-offset visually centres a 3x3 shape. */
function renderHold() {
  holdCtx.fillStyle = '#000';
  holdCtx.fillRect(0, 0, 96, 96);
  if (holdType) drawPreview(holdCtx, 96, holdType, 24);
}

/** Repaint the NEXT queue: up to 3 upcoming pieces, spaced 72px apart. */
function renderNextQueue() {
  nextCtx.fillStyle = '#000';
  nextCtx.fillRect(0, 0, 96, 232);
  for (let i = 0; i < Math.min(3, bag.length); i++) {
    drawPreview(nextCtx, 96, bag[i], 20 + i * 72);
  }
}

/** Copy the model state into the sidebar text. Called whenever a value changes. */
function updateStats() {
  document.getElementById('score').textContent = score;
  document.getElementById('level').textContent = level;
  document.getElementById('lines').textContent = lines;
}

/* =============================================================================
 * 6. GAME FLOW
 * ========================================================================== */

/**
 * Freeze / unfreeze. The `lastTime` reset on resume is important: while paused
 * we stop updating `lastTime`, so the first unpaused frame would otherwise see
 * a `delta` spanning the whole pause and instantly slam the piece to the floor.
 */
function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (paused) {
    overlayMessage.textContent = 'PAUSED';
    overlaySub.textContent = 'Press P to resume';
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
    lastTime = performance.now();
  }
}

/** Terminal state. The board stays visible behind the overlay. */
function endGame() {
  gameOver = true;
  overlayMessage.textContent = 'GAME OVER';
  overlaySub.textContent = `Score: ${score} — Press R to restart`;
  overlay.classList.remove('hidden');
}

/**
 * Full reset to a fresh game. Because all mutable state lives in top-level
 * `let` bindings, restarting is just re-assigning them — the board is cleared
 * in place (keeping the same array, which the drawing code already holds a
 * reference to) rather than rebuilt.
 */
function restart() {
  for (let r = 0; r < ROWS; r++) board[r].fill(null);
  bag = [];
  refillBag();
  score = 0;
  lines = 0;
  level = 1;
  dropInterval = 1000;
  dropCounter = 0;
  holdType = null;
  canHold = true;
  paused = false;
  gameOver = false;
  overlay.classList.add('hidden');
  renderHold();
  updateStats();
  nextPiece();
}

/* =============================================================================
 * 7. MUSIC — "Korobeiniki" (Theme A) synthesised with the Web Audio API
 *
 * No audio files: notes are described as data (["E5", 2] = play E5 for two
 * eighth-notes) and turned into oscillators at runtime. Two independent
 * "voices" (melody + bass) are scheduled slightly ahead of the audio clock.
 * ========================================================================== */

/** Duration of one eighth-note, in seconds. Every note length multiplies this. */
const EIGHTH = 0.19;

/**
 * Lead melody. Each entry is [note name or "R" for rest, length in eighths].
 * The 'R' rests exist so phrases and bars stay in sync between the parts.
 */
const MELODY = [
  ['E5', 2], ['B4', 1], ['C5', 1], ['D5', 2], ['C5', 1], ['B4', 1],
  ['A4', 2], ['A4', 1], ['C5', 1], ['E5', 2], ['D5', 1], ['C5', 1],
  ['B4', 3], ['C5', 1], ['D5', 2], ['E5', 2],
  ['C5', 2], ['A4', 2], ['A4', 2], ['R', 2],
  ['D5', 3], ['F5', 1], ['A5', 2], ['G5', 1], ['F5', 1],
  ['E5', 3], ['C5', 1], ['E5', 2], ['D5', 1], ['C5', 1],
  ['B4', 3], ['C5', 1], ['D5', 2], ['E5', 2],
  ['C5', 2], ['A4', 2], ['A4', 2], ['R', 2],
  ['E4', 4], ['C4', 4],
  ['D4', 4], ['B3', 4],
  ['C4', 4], ['A3', 4],
  ['G#3', 4], ['B3', 4],
  ['E4', 4], ['C4', 4],
  ['D4', 4], ['B3', 4],
  ['C4', 2], ['E4', 2], ['A5', 4],
  ['G#5', 8],
];

/** Bass line, same format. Loops against the melody for the full tune. */
const BASS = [
  ['A2', 2], ['E2', 2], ['A2', 2], ['E2', 2],
  ['A2', 2], ['E2', 2], ['A2', 2], ['E2', 2],
  ['A2', 2], ['E2', 2], ['A2', 2], ['E2', 2],
  ['A2', 2], ['E2', 2], ['A2', 2], ['E2', 2],
  ['D2', 2], ['A2', 2], ['D2', 2], ['A2', 2],
  ['C2', 2], ['G2', 2], ['C2', 2], ['G2', 2],
  ['B1', 2], ['E2', 2], ['B1', 2], ['E2', 2],
  ['A2', 2], ['E2', 2], ['A2', 2], ['E2', 2],
  ['A2', 4], ['A2', 4],
  ['G2', 4], ['G2', 4],
  ['F2', 4], ['F2', 4],
  ['E2', 4], ['E2', 4],
  ['A2', 4], ['A2', 4],
  ['G2', 4], ['G2', 4],
  ['F2', 4], ['A2', 4],
  ['G#2', 4], ['E2', 4],
];

const musicBtn = document.getElementById('music-btn');
/** Lazily created on the first user gesture (browsers block audio otherwise). */
let audioCtx = null;
/** Persisted preference, so music stays off/on across reloads. */
let musicOn = localStorage.getItem('tetris-music') === 'on';
/** Handle for the interval that keeps topping up the schedule. */
let musicTimer = null;
/** Playback position per voice: which note index, and when it should start. */
let lead = { idx: 0, time: 0 };
let bass = { idx: 0, time: 0 };

/**
 * Convert a note name like "C4" or "G#3" into a frequency in Hz.
 *
 * Step 1: name -> MIDI note number. MIDI numbers are just semitones above C-1
 *   (0-127), and middle C (C4) is 60. '#' adds one semitone.
 * Step 2: MIDI -> Hz with the equal-temperament formula anchored at A4 = 440Hz
 *   (MIDI 69): f = 440 * 2^((midi - 69) / 12).
 */
function noteFreq(name) {
  const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const m = name.match(/^([A-G])(#?)(\d)$/);
  const midi = 12 * (parseInt(m[3], 10) + 1) + SEMITONES[m[1]] + (m[2] ? 1 : 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Play one note: an oscillator for the pitch and a gain node for the volume.
 *
 * The envelope ramps 0 -> vol over 10ms (a click-free attack), holds, then
 * ramps back to 0 just before the note ends (a click-free release). `time` is
 * an absolute AudioContext timestamp, which is how Web Audio avoids the jitter
 * you get from firing oscillators "right now" in a setInterval.
 */
function playNote(freq, time, dur, type, vol) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(vol, time + 0.01);
  gain.gain.setValueAtTime(vol, Math.max(time + 0.01, time + dur - 0.03));
  gain.gain.linearRampToValueAtTime(0, time + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(time);
  osc.stop(time + dur);
}

/**
 * Queue notes for one voice until we are ~0.3s ahead of playback.
 *
 * This is the standard Web Audio LOOKAHEAD pattern: a coarse timer (60ms) wakes
 * up often, but schedules audio ahead of the clock instead of trying to play
 * notes in real time. That keeps playback rock-steady even if the timer itself
 * is throttled or the main thread stutters. `idx` wraps with `% seq.length` to
 * loop the tune forever.
 */
function scheduleVoice(seq, voice, type, vol) {
  while (voice.time < audioCtx.currentTime + 0.3) {
    const [name, len] = seq[voice.idx];
    const dur = len * EIGHTH;
    if (name !== 'R') playNote(noteFreq(name), voice.time, dur * 0.92, type, vol);
    voice.time += dur;
    voice.idx = (voice.idx + 1) % seq.length;
  }
}

/** Advance both voices. Square wave lead, triangle bass. */
function scheduleMusic() {
  scheduleVoice(MELODY, lead, 'square', 0.1);
  scheduleVoice(BASS, bass, 'triangle', 0.16);
}

/** Create the audio context (once), resume it, rewind both voices, start scheduling. */
function startMusic() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  audioCtx.resume();
  lead.time = bass.time = audioCtx.currentTime + 0.1;
  lead.idx = bass.idx = 0;
  scheduleMusic();
  musicTimer = setInterval(scheduleMusic, 60);
}

/** Stop scheduling. Already-scheduled notes ring out in under 0.3s. */
function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
}

/** Flip the music preference, remember it, and apply it. */
function toggleMusic() {
  musicOn = !musicOn;
  localStorage.setItem('tetris-music', musicOn ? 'on' : 'off');
  updateMusicButton();
  if (musicOn) startMusic();
  else stopMusic();
}

/** Sync the on-screen MUSIC button with the current state. */
function updateMusicButton() {
  musicBtn.textContent = musicOn ? 'MUSIC: ON' : 'MUSIC: OFF';
  musicBtn.classList.toggle('on', musicOn);
}

musicBtn.addEventListener('click', toggleMusic);
updateMusicButton();

/* =============================================================================
 * 8. INPUT & BOOTSTRAP
 * ========================================================================== */

/**
 * One listener for the whole keyboard.
 *
 * Two details worth copying into any browser game:
 * - The switch is the single mapping from "key pressed" to "game action",
 *   so the controls list in index.html can be checked against one place.
 * - Arrow keys and Space scroll the page by default; `preventDefault()` on the
 *   ones the game claims keeps the page still.
 */
document.addEventListener('keydown', (e) => {
  // Audio requires a user gesture, so if the saved preference is "on" we
  // cannot start playing until the first keypress or click.
  if (musicOn && !musicTimer) startMusic();
  if (e.key === 'r' || e.key === 'R') {
    if (gameOver) restart();
    return;
  }
  switch (e.key) {
    case 'ArrowLeft': move(-1); break;
    case 'ArrowRight': move(1); break;
    case 'ArrowDown': softDrop(); break;
    case 'ArrowUp':
    case 'x':
    case 'X': tryRotate(1); break;
    case 'z':
    case 'Z': tryRotate(-1); break;
    case ' ': hardDrop(); e.preventDefault(); break;
    case 'c':
    case 'C': hold(); break;
    case 'p':
    case 'P': togglePause(); break;
    case 'm':
    case 'M': toggleMusic(); break;
  }
});

/* Deal the first piece, then start the animation loop. The loop never stops on
 * its own, so this is the only place it is kicked off. */
restart();
requestAnimationFrame(update);
