# TETRIS

A complete, dependency-free implementation of Tetris that runs in the browser.
Three files, no build step, no framework, no assets — the whole game (including
its music) is written from scratch in plain HTML, CSS and JavaScript.

It is also heavily commented: the code is meant to be *read*, not just played.

```
TETRIS

┌──────────┐   ┌────────────┐   ┌──────────┐
│   HOLD   │   │            │   │   NEXT   │
│          │   │            │   │          │
├──────────┤   │            │   ├──────────┤
│  SCORE   │   │   PLAYING  │   │  MUSIC   │
│  LEVEL   │   │   FIELD    │   ├──────────┤
│  LINES   │   │  10 x 20   │   │ CONTROLS │
└──────────┘   │            │   └──────────┘
               │            │
               └────────────┘
```

## Contents

- [Features](#features)
- [Installing and running](#installing-and-running)
- [How to play](#how-to-play)
- [How the code works](#how-the-code-works)
  - [Project layout](#project-layout)
  - [The one big idea: the board is the source of truth](#the-one-big-idea-the-board-is-the-source-of-truth)
  - [Pieces and the 7-bag randomiser](#pieces-and-the-7-bag-randomiser)
  - [Collision](#collision)
  - [Rotation and wall kicks](#rotation-and-wall-kicks)
  - [Locking, line clears and scoring](#locking-line-clears-and-scoring)
  - [The game loop](#the-game-loop)
  - [Rendering](#rendering)
  - [Music](#music)
- [Customising it](#customising-it)
- [Publishing to GitHub](#publishing-to-github)
- [License](#license)

## Features

- **7-bag randomiser** — every piece appears once per bag of seven, so no
  unfair droughts. The single most important rule for making Tetris feel fair.
- **Hold slot** — swap the current piece for the parked one, once per piece.
- **Ghost piece** — a translucent preview of where the piece will land.
- **Full rotation** — clockwise and anticlockwise, with wall kicks.
- **Classic scoring** — 100/300/500/800 x level, plus soft-drop and hard-drop
  points, a new level every 10 lines, and gravity that tightens as you climb.
- **Synthesised music** — the *Korobeiniki* theme (Russian folk song, "Theme A")
  played by oscillators via the Web Audio API. No audio files are shipped.
- **Next queue** — the next three pieces, so you can plan ahead.
- **Pause / restart** — `P` to pause, `R` to restart after a game over.
- **Responsive chrome** — plain CSS custom properties, no framework.

## Installing and running

There is **nothing to install**. No `npm install`, no dependencies, no build.
The project is three static files.

### Option 1 — open the file directly (quickest)

```bash
open index.html          # macOS
xdg-open index.html      # Linux
start index.html         # Windows
```

The game works, but note two browser restrictions:

- Browsers block audio until you interact with the page, so music only starts
  after your first keypress or click (the code handles this for you).
- Some browsers treat each `file://` page as a unique, unstable origin, which
  can make the `localStorage` music preference unavailable. Everything else is
  unaffected.

### Option 2 — serve it locally (recommended)

Any static file server works. This is the most reliable way to exercise
`localStorage` and audio.

```bash
# Python (preinstalled on macOS and most Linux distros)
python3 -m http.server 8000

# or Node.js
npx serve .
# or PHP
php -S localhost:8000
```

Then open <http://localhost:8000>.

**Requirements:** any browser from the last few years — Chrome, Firefox, Safari
or Edge. It uses `requestAnimationFrame`, ES2020 syntax, CSS custom properties
and the Web Audio API. No polyfills needed.

## How to play

Clear as many complete horizontal lines as you can. Lose when a new piece
spawns on top of your stack.

### Controls

| Key              | Action                                |
| ---------------- | ------------------------------------- |
| <kbd>←</kbd> <kbd>→</kbd> | Move left / right              |
| <kbd>↓</kbd>     | Soft drop (1 point per row)            |
| <kbd>Space</kbd> | Hard drop (2 points per row skipped)   |
| <kbd>↑</kbd> or <kbd>X</kbd> | Rotate clockwise           |
| <kbd>Z</kbd>     | Rotate anticlockwise                   |
| <kbd>C</kbd>     | Hold — swap with the parked piece      |
| <kbd>P</kbd>     | Pause / resume                         |
| <kbd>M</kbd>     | Music on / off (also a button)         |
| <kbd>R</kbd>     | Restart, once the game is over         |

### Scoring

| Event            | Points          |
| ---------------- | --------------- |
| 1 line           | 100 x level     |
| 2 lines          | 300 x level     |
| 3 lines          | 500 x level     |
| 4 lines (Tetris) | 800 x level     |
| Soft drop        | 1 per row       |
| Hard drop        | 2 per row       |

A new level every 10 cleared lines. Each level makes gravity 100 ms faster,
down to a floor of 80 ms per row so it stays playable at high levels.

### Tips

- Rotate before you drop. Pieces lock the instant they touch down — there is no
  lock delay — so a piece that lands and then needs to be shuffled is gone.
- Use **hold** to save an awkward piece, not just to delay it. Holding a
  well-placed I-piece and dealing yourself an O or an S is a large advantage.
- The **ghost piece** shows the landing spot. Build flat, then use hard drop.
- Clearing **four lines at once** is worth eight times a single. Look for the
  well on the right-hand side for I-pieces.

## How the code works

### Project layout

```
tetris/
├── index.html   # structure: the three panels, the canvases, the ids
├── style.css    # presentation: layout, panels, neon theme (CSS variables)
├── game.js      # all logic: model, rendering, game loop, audio, input
├── .gitignore
├── .gitattributes
├── .editorconfig
├── LICENSE
└── README.md
```

The split is the classic one:

| File         | Responsibility                                             |
| ------------ | ---------------------------------------------------------- |
| `index.html` | **What exists** — canvases, panels, and the `id`s JS looks up |
| `style.css`  | **How it looks** — layout and theme, no JS involved           |
| `game.js`    | **What it does** — state, rules, drawing, audio, input        |

There is no framework, so the layering is by convention: `index.html` provides
`id`s, `game.js` reads them with `document.getElementById` and paints into their
2D contexts. If you rename an `id` in the HTML, rename the lookup in the JS.

`game.js` itself is ordered the way a game actually runs:

| Lines    | Section                        | What lives there                          |
| -------- | ------------------------------ | ----------------------------------------- |
| 25–105   | Configuration                  | `COLS`, `ROWS`, `CELL`, colours, `SHAPES` |
| 107–156  | State                          | Every mutable variable in the game        |
| 158–413  | Model logic                    | Spawning, collision, movement, scoring    |
| 415–449  | The game loop                  | `update()` — one tick per frame           |
| 451–564  | Rendering                      | `draw()` and the canvas helpers           |
| 566–619  | Game flow                      | Pause, game over, restart                 |
| 621–782  | Music                          | Web Audio synthesis of the theme          |
| 784–end  | Input and bootstrap            | The keydown switch; start the loop        |

### The one big idea: the board is the source of truth

Everything else follows from this. The playfield is a 20 x 10 matrix, and every
cell is either `null` (empty) or a CSS colour string (a locked block):

```js
const board = createMatrix(ROWS, COLS);   // game.js:120
```

A locked cell does not remember which piece it came from. The falling piece is a
*separate* small matrix that moves around on top:

```js
current = {
  type,                                    // 'T'
  matrix: SHAPES[type].map(row => row.slice()),  // its shape
  x,                                       // top-left column on the board
  y,                                       // top-left row on the board
};
```

So no action ever mutates the board directly. Movement, rotation and dropping all
ask the same question — *"is this position legal?"* — and only the pieces that
come to rest are ever written into `board` (in `lockPiece()`, `game.js:339`).
That single indirection is why the game is only ~500 lines long and why there
are no bugs of the shape "the piece and the board disagree".

### Pieces and the 7-bag randomiser

Each tetromino is a 2D array of `0`/`1` flags, where `0` is an empty cell
(`game.js:68`):

```js
T: [
  [0, 1, 0],
  [1, 1, 1],
  [0, 0, 0],
],
```

Note the deliberately square bounding boxes. `I` gets a 4x4 box, the rest 3x3,
`O` is 2x2. The empty padding around each shape is what lets a piece rotate
*in place* without its footprint changing size — and square matrices are exactly
what the transpose-based `rotate()` requires.

Pieces are not chosen with plain `Math.random()`. That feels unfair: you can get
twelve I-pieces in a row, or 400 pieces without seeing an S or a Z. Instead,
`refillBag()` (`game.js:183`) shuffles all seven types with Fisher-Yates and
deals them from a queue, reshuffling only when the bag empties. **Every piece
appears exactly once per seven**, which caps the maximum drought at 12 pieces.

### Collision

`collide(matrix, x, y)` (`game.js:232`) is the only validity test in the game.
It returns `true` when a position is *illegal* — the piece would overlap a wall,
the floor, or a locked block:

```js
const bx = x + c;   // absolute board column
const by = y + r;   // absolute board row
if (bx < 0 || bx >= COLS || by >= ROWS) return true;   // out of bounds
if (by >= 0 && board[by][bx]) return true;            // hit a block
```

Two subtleties are worth internalising:

1. **Only cells with a `1` are tested.** The padding zeros are allowed to hang
   over an edge, which is exactly what lets an I-piece rest with half of its
   bounding box off the floor.
2. **`by < 0` is not a collision.** Pieces spawn at `y = 0` and may legitimately
   extend above the visible board. The row is only dereferenced once
   `by >= 0`, which is what prevents a `board[-1]` lookup from throwing.

Every movement is then a one-line guard: `if (!collide(...)) { move it }`.

### Rotation and wall kicks

`rotate(matrix, dir)` (`game.js:257`) transposes the matrix, then mirrors it
once more to turn a reflection into a real rotation:

```js
const rotated = matrix[0].map((_, i) => matrix.map(row => row[i]));  // transpose
if (dir < 0) return rotated.reverse();                // CCW
return rotated.map((row) => row.reverse());           // CW
```

Real pieces do not rotate in a vacuum, though — rotating against a wall would
embed them in a block. So `tryRotate()` (`game.js:272`) tries the rotation and,
if it collides, retries at nudges of `0, -1, +1, -2, +2` columns, taking the
first that fits. Those nudges are **wall kicks**. (Guideline Tetris uses a
five-state kick table per piece and rotation direction; this simplified set
covers the common cases.)

### Locking, line clears and scoring

`lockPiece()` (`game.js:339`) copies the piece's matrix into `board` as colour
strings, clears any full rows, and deals the next piece. Cells that fall out of
the top of the screen are skipped.

`clearLines()` (`game.js:368`) scans bottom-to-top. For each full row it
`splice`s it out and `unshift`s a fresh empty row onto the top, which shifts
everything above it down one slot. The subtle line is `r++`:

```js
for (let r = ROWS - 1; r >= 0; r--) {
  if (board[r].every(cell => cell)) {
    board.splice(r, 1);
    board.unshift(new Array(COLS).fill(null));
    cleared++;
    r++;   // rows above just shifted INTO r and have not been checked yet
  }
}
```

Without that increment you would miss a four-line clear ("Tetris") when a
vertical I-piece completes several rows at once.

Points come from the classic table, scaled by level, and every 10 lines raises
the level and shortens `dropInterval`.

### The game loop

`update()` (`game.js:430`) runs once per animation frame:

```js
function update(time = 0) {
  if (paused || gameOver) { requestAnimationFrame(update); return; }
  const delta = time - lastTime;      // how long since the previous frame
  lastTime = time;
  dropCounter += delta;               // gravity is time-based, not frame-based
  if (dropCounter > dropInterval) { /* fall one row, or lock */ }
  draw();
  requestAnimationFrame(update);
}
```

Two things make this robust:

- **It measures elapsed time instead of assuming 60 fps.** The browser hands us
  a timestamp in milliseconds, so on a 120 Hz monitor the piece still falls at
  the intended speed instead of twice as fast.
- **The loop is never torn down.** Pausing returns early but re-queues the next
  frame, so unfreezing never has to restart the chain.

`togglePause()` also resets `lastTime` on resume (`game.js:574`). Without that,
the first unpaused frame would measure a `delta` spanning the entire pause and
instantly slam the piece to the floor.

### Rendering

The board is redrawn from scratch every frame — no diffing, no retained scene
graph. At 10 x 20 = 200 cells that is trivially cheap, and it keeps the
renderer stateless, which is a good trade at this size.

The **ghost piece** in `draw()` (`game.js:491`) is found by probing downwards:

```js
let ghostY = current.y;
while (!collide(current.matrix, current.x, ghostY + 1)) ghostY++;
```

It is drawn first in translucent white so the live piece lands on top of it.
The three canvases are related by the constants in section 1: `COLS * CELL`
must equal the board canvas width (10 x 24 = 240) and `ROWS * CELL` its height
(20 x 24 = 480). Change `CELL` and you must update `index.html` to match.

### Music

The *Korobeiniki* theme is stored as data, not audio. Each note is a
`[name, length]` pair, where length is in eighth-notes and `'R'` is a rest:

```js
['E5', 2], ['B4', 1], ['C5', 1], ['D5', 2], ...
```

Two independent voices (a square-wave melody and a triangle-wave bass) are
scheduled slightly *ahead* of the audio clock. This is the standard Web Audio
**lookahead pattern**: a coarse 60 ms timer wakes up often, but it schedules
notes 0.3 s in advance rather than trying to play them in real time. Playback
therefore stays rock-steady even if the timer is throttled or the main thread
stutters.

Note names become frequencies in two steps (`noteFreq`, `game.js:693`): first to
a MIDI number (C4 = 60, `#` adds a semitone), then to hertz anchored at
A4 = 440 Hz:

```js
f = 440 * 2 ** ((midi - 69) / 12);
```

The music preference is saved in `localStorage`, but browsers forbid audio
before a user gesture — so if the saved preference is "on", playback is kicked
off by the first keypress (`game.js:799`).

## Customising it

The code is commented for reading, so these are one-line changes:

| Want to change                     | Where                                            |
| ---------------------------------- | ------------------------------------------------ |
| Board size                         | `COLS` / `ROWS` in `game.js:29-31`, **and** the board `width`/`height` in `index.html:60` |
| Cell size                          | `CELL` in `game.js:37`, **and** the canvas size in `index.html:60` |
| Piece colours                      | `COLORS` in `game.js:44`                          |
| Piece shapes                       | `SHAPES` in `game.js:68` (keep them square)       |
| Starting speed / speed curve       | `dropInterval` maths in `clearLines()`, `game.js:383` |
| Line-clear scoring                 | The `[0, 100, 300, 500, 800]` table, `game.js:379` |
| Next-queue length                  | `Math.min(3, bag.length)` in `renderNextQueue()`, `game.js:553` |
| Rebind a key                      | The `switch` in the keydown handler, `game.js:804` |
| Theme colours                      | The `:root` custom properties in `style.css:26`   |

A few natural next features, roughly in order of how much they teach:

- **Lock delay** — a short grace period after a piece touches down before it
  locks, which is how real Tetris feels. Needs a timer reset in `lockPiece()`.
- **T-spin detection** — reward rotations that slot a piece into a tight
  overhang. Requires tracking the last successful kick.
- **Proper SRS rotation** — a per-piece kick table instead of `[0,-1,1,-2,2]`.
- **Tests** — the game logic is pure enough to unit test by injecting a fake
  board; `collide()`, `rotate()` and `clearLines()` are the obvious first targets.

## Publishing to GitHub

The repository is already initialised and has the usual ignore/config files
(`.gitignore`, `.gitattributes`, `.editorconfig`). To publish it:

```bash
git add .
git commit -m "Initial commit: commented Tetris in vanilla JS"
git remote add origin https://github.com/<user>/tetris.git
git push -u origin main
```

For a nicer link, replace the README's plain clone instructions with a badge, or
just enable Pages (Settings → Pages → deploy from branch) if you want it hosted
at `https://<user>.github.io/tetris/` — the game is pure static files, so it
works as-is with no server.

## License

[MIT](LICENSE) © 2026 Kumar Pillai.
