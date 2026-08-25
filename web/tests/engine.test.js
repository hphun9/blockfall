import test from 'node:test';
import assert from 'node:assert/strict';

import { Game, SIZE, TRAY } from '../src/core/engine.js';
import { PIECES, PIECE_BY_ID, drawPiece } from '../src/core/pieces.js';
import { Rng, fnv1a, dailySeed } from '../src/core/rng.js';

/** Fill every cell of a row so the next drop completes it. */
function fillRowExcept(game, row, keepCol) {
  for (let c = 0; c < game.size; c++) {
    if (c !== keepCol) game.cells[row * game.size + c] = 1;
  }
}

test('a fresh board is empty and the tray is full', () => {
  const game = new Game({ seed: 1 });
  assert.equal(game.filled(), 0);
  assert.equal(game.tray.length, TRAY);
  assert.ok(game.tray.every((p) => p && p.cells.length > 0));
  assert.equal(game.score, 0);
  assert.equal(game.over, false);
});

test('placing a piece writes exactly its own cells', () => {
  const game = new Game({ seed: 2 });
  const piece = PIECE_BY_ID.get('sq2');
  game.tray[0] = piece;
  const before = game.filled();
  const res = game.place(0, 0, 0);
  assert.ok(res);
  assert.equal(game.filled(), before + 4);
  assert.equal(game.at(0, 0) !== 0, true);
  assert.equal(game.at(1, 1) !== 0, true);
  assert.equal(game.at(2, 2), 0);
});

test('a piece cannot overlap or hang off the edge', () => {
  const game = new Game({ seed: 3 });
  const bar = PIECE_BY_ID.get('h5');
  game.tray[0] = bar;

  assert.equal(game.fits(bar, 0, SIZE - 4), false, 'must not hang off the right');
  assert.equal(game.fits(bar, -1, 0), false, 'must not sit above the board');
  assert.equal(game.place(0, 0, SIZE - 4), null, 'an illegal drop returns null');

  game.place(0, 0, 0);
  game.tray[1] = bar;
  assert.equal(game.fits(bar, 0, 0), false, 'must not overlap what is there');
});

test('completing a row clears it', () => {
  const game = new Game({ seed: 4 });
  fillRowExcept(game, 3, 7);
  game.tray[0] = PIECE_BY_ID.get('dot');
  const res = game.place(0, 3, 7);

  assert.deepEqual(res.rows, [3]);
  for (let c = 0; c < SIZE; c++) assert.equal(game.at(3, c), 0, 'row 3 is now empty');
  assert.equal(game.lines, 1);
});

test('completing a column clears it', () => {
  const game = new Game({ seed: 5 });
  for (let r = 0; r < SIZE - 1; r++) game.cells[r * SIZE + 2] = 1;
  game.tray[0] = PIECE_BY_ID.get('dot');
  const res = game.place(0, SIZE - 1, 2);

  assert.deepEqual(res.cols, [2]);
  for (let r = 0; r < SIZE; r++) assert.equal(game.at(r, 2), 0);
});

test('a row and a column can clear on the same drop', () => {
  const game = new Game({ seed: 6 });
  fillRowExcept(game, 0, 0);
  for (let r = 1; r < SIZE; r++) game.cells[r * SIZE] = 1;
  game.tray[0] = PIECE_BY_ID.get('dot');

  const res = game.place(0, 0, 0);
  assert.deepEqual(res.rows, [0]);
  assert.deepEqual(res.cols, [0]);
  assert.equal(game.lines, 2);
});

test('clearing two lines pays more than twice one line', () => {
  // Both boards keep a stray block so neither run collects the perfect-clear
  // bonus — otherwise the single-line case sweeps the board and wins on a
  // bonus that has nothing to do with the comparison.
  const one = new Game({ seed: 7 });
  fillRowExcept(one, 0, 0);
  one.cells[5 * SIZE + 5] = 1;
  one.tray[0] = PIECE_BY_ID.get('dot');
  const gainedOne = one.place(0, 0, 0).gained;

  const two = new Game({ seed: 7 });
  fillRowExcept(two, 0, 0);
  for (let r = 1; r < SIZE; r++) two.cells[r * SIZE] = 1;
  two.cells[5 * SIZE + 5] = 1;
  two.tray[0] = PIECE_BY_ID.get('dot');
  const gainedTwo = two.place(0, 0, 0).gained;

  assert.ok(gainedTwo > gainedOne * 2,
    `two lines (${gainedTwo}) should beat two separate singles (${gainedOne * 2})`);
});

test('a drop that clears nothing still scores something', () => {
  // Otherwise the early game feels like it is not counting.
  const game = new Game({ seed: 8 });
  game.tray[0] = PIECE_BY_ID.get('sq2');
  const res = game.place(0, 0, 0);
  assert.ok(res.gained > 0);
  assert.equal(res.rows.length, 0);
});

test('consecutive clears build a combo, a blank drop resets it', () => {
  const game = new Game({ seed: 9 });

  fillRowExcept(game, 0, 0);
  game.tray[0] = PIECE_BY_ID.get('dot');
  game.place(0, 0, 0);
  assert.equal(game.combo, 1);

  fillRowExcept(game, 1, 0);
  game.tray[1] = PIECE_BY_ID.get('dot');
  game.place(1, 1, 0);
  assert.equal(game.combo, 2);

  game.tray[2] = PIECE_BY_ID.get('dot');
  game.place(2, 5, 5);
  assert.equal(game.combo, 0, 'a drop with no clear breaks the chain');
});

test('the tray refills only when all three are used', () => {
  const game = new Game({ seed: 10 });
  game.tray = [PIECE_BY_ID.get('dot'), PIECE_BY_ID.get('dot'), PIECE_BY_ID.get('dot')];

  game.place(0, 0, 0);
  assert.equal(game.tray[0], null, 'used slot stays empty');
  assert.ok(game.tray[1] && game.tray[2], 'the others are untouched');

  game.place(1, 0, 2);
  game.place(2, 0, 4);
  assert.ok(game.tray.every((p) => p !== null), 'now it refills');
});

test('a fresh tray always contains a playable piece', () => {
  // The fairness rule: losing must be the player's doing, never the dealer's.
  for (let seed = 0; seed < 300; seed++) {
    const game = new Game({ seed });
    assert.ok(
      game.tray.some((p) => game.fitsAnywhere(p)),
      `seed ${seed} dealt an unplayable opening tray`
    );
  }
});

test('the run ends only when nothing in the tray fits', () => {
  const game = new Game({ seed: 11 });
  // Leave a single hole: only the 1-cell piece can be placed.
  game.cells.fill(1);
  game.cells[0] = 0;
  game.tray = [PIECE_BY_ID.get('sq2'), PIECE_BY_ID.get('h5'), PIECE_BY_ID.get('sq3')];
  assert.equal(game.isStuck(), true);

  game.tray[0] = PIECE_BY_ID.get('dot');
  assert.equal(game.isStuck(), false, 'one fitting piece is enough to play on');
});

test('undo restores the board, the score and the random stream', () => {
  const game = new Game({ seed: 12 });
  const cellsBefore = game.cells.slice();
  const scoreBefore = game.score;
  const trayBefore = game.tray.map((p) => p.id);
  const rngBefore = game.rng.state;

  game.place(0, 0, 0);
  assert.notDeepEqual(game.cells, cellsBefore);

  assert.equal(game.undo(), true);
  assert.deepEqual(game.cells, cellsBefore);
  assert.equal(game.score, scoreBefore);
  assert.deepEqual(game.tray.map((p) => p.id), trayBefore);
  assert.equal(game.rng.state, rngBefore, 'the stream rewinds, so no rerolling');
});

test('undo is limited and cannot be spent before a move', () => {
  const game = new Game({ seed: 13, undoBudget: 2 });
  assert.equal(game.canUndo(), false, 'nothing to undo yet');

  game.place(0, 0, 0);
  assert.equal(game.undo(), true);
  game.place(0, 0, 0);
  assert.equal(game.undo(), true);
  assert.equal(game.undoLeft, 0);

  game.place(0, 0, 0);
  assert.equal(game.canUndo(), false, 'budget spent');
});

test('previewClears agrees with what actually happens', () => {
  const game = new Game({ seed: 14 });
  fillRowExcept(game, 4, 3);
  const piece = PIECE_BY_ID.get('dot');
  const preview = game.previewClears(piece, 4, 3);
  assert.deepEqual(preview.rows, [4]);

  game.tray[0] = piece;
  const actual = game.place(0, 4, 3);
  assert.deepEqual(actual.rows, preview.rows);
  assert.deepEqual(actual.cols, preview.cols);
});

test('previewClears on an illegal square reports nothing', () => {
  const game = new Game({ seed: 15 });
  game.cells[0] = 1;
  const preview = game.previewClears(PIECE_BY_ID.get('dot'), 0, 0);
  assert.deepEqual(preview, { rows: [], cols: [] });
});

test('the same seed replays identically', () => {
  const moves = [];
  const a = new Game({ seed: 4242 });
  for (let i = 0; i < 40 && !a.over; i++) {
    const slot = a.tray.findIndex((p) => p && a.fitsAnywhere(p));
    if (slot < 0) break;
    const [r, c] = a.placements(a.tray[slot])[0];
    moves.push([slot, r, c]);
    a.place(slot, r, c);
  }

  const b = new Game({ seed: 4242 });
  for (const [slot, r, c] of moves) b.place(slot, r, c);

  assert.deepEqual(b.cells, a.cells);
  assert.equal(b.score, a.score);
});

test('save and restore round-trips a game in progress', () => {
  const game = new Game({ seed: 16 });
  game.place(0, 0, 0);
  game.place(1, 4, 4);

  const restored = Game.fromJSON(JSON.parse(JSON.stringify(game.toJSON())));
  assert.deepEqual(restored.cells, game.cells);
  assert.equal(restored.score, game.score);
  assert.equal(restored.rng.state, game.rng.state);
  assert.deepEqual(restored.tray.map((p) => p && p.id), game.tray.map((p) => p && p.id));
});

test('every piece is well formed', () => {
  for (const piece of PIECES) {
    assert.ok(piece.cells.length > 0, `${piece.id} has no cells`);
    assert.ok(piece.w > 0 && piece.h > 0, `${piece.id} has no extent`);
    assert.ok(piece.w <= SIZE && piece.h <= SIZE, `${piece.id} cannot fit the board`);
    assert.ok(piece.weight > 0, `${piece.id} would never be drawn`);

    const seen = new Set(piece.cells.map(([r, c]) => `${r},${c}`));
    assert.equal(seen.size, piece.cells.length, `${piece.id} lists a cell twice`);

    const touchesTop = piece.cells.some(([r]) => r === 0);
    const touchesLeft = piece.cells.some(([, c]) => c === 0);
    assert.ok(touchesTop && touchesLeft, `${piece.id} is not anchored to its corner`);
  }
});

test('piece ids are unique', () => {
  const ids = PIECES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the dealer eventually produces every piece', () => {
  const rng = new Rng(99);
  const seen = new Set();
  for (let i = 0; i < 20000; i++) seen.add(drawPiece(rng).id);
  assert.equal(seen.size, PIECES.length, 'some piece can never be drawn');
});

test('small pieces are dealt more often than awkward ones', () => {
  // Not cosmetic: uniform dealing makes the board deadlock unfairly.
  const rng = new Rng(1234);
  const count = new Map();
  for (let i = 0; i < 30000; i++) {
    const id = drawPiece(rng).id;
    count.set(id, (count.get(id) ?? 0) + 1);
  }
  assert.ok(count.get('dot') > count.get('s0'), 'the single should beat the S piece');
  assert.ok(count.get('h3') > count.get('sq3'), 'a short bar should beat the 3x3 block');
});

test('the daily seed depends on the date and nothing else', () => {
  assert.equal(dailySeed('2026-08-25'), dailySeed('2026-08-25'));
  assert.notEqual(dailySeed('2026-08-25'), dailySeed('2026-08-26'));
  assert.equal(typeof dailySeed('2026-08-25'), 'number');
});

test('fnv1a is stable', () => {
  assert.equal(fnv1a(''), 0x811c9dc5);
  assert.equal(fnv1a('a'), fnv1a('a'));
  assert.notEqual(fnv1a('a'), fnv1a('b'));
});

test('a game cannot be continued after it ends', () => {
  const game = new Game({ seed: 17 });
  game.cells.fill(1);
  game.over = true;
  assert.equal(game.place(0, 0, 0), null);
});

test('placing into an empty slot does nothing', () => {
  const game = new Game({ seed: 18 });
  game.tray[1] = null;
  assert.equal(game.place(1, 0, 0), null);
});

test('sweeping the board clean is reported and paid for', () => {
  // The rarest thing a player can do; the UI hangs a skin change off it, so a
  // silent regression here would quietly remove a whole reward.
  const game = new Game({ seed: 40 });
  game.cells.fill(0);
  // One row short of complete, with nothing else on the board.
  for (let c = 0; c < SIZE - 1; c++) game.cells[c] = 1;
  game.tray[0] = PIECE_BY_ID.get('dot');

  const res = game.place(0, 0, SIZE - 1);
  assert.equal(res.perfect, true, 'the board is empty afterwards');
  assert.equal(game.filled(), 0);
  assert.equal(game.perfectClears, 1);
  assert.ok(res.gained > 200, 'the bonus is actually paid');
});

test('an ordinary clear is not a perfect clear', () => {
  const game = new Game({ seed: 41 });
  game.cells.fill(0);
  for (let c = 0; c < SIZE - 1; c++) game.cells[c] = 1;
  game.cells[3 * SIZE + 3] = 1; // one stray block left over
  game.tray[0] = PIECE_BY_ID.get('dot');

  const res = game.place(0, 0, SIZE - 1);
  assert.equal(res.perfect, false);
  assert.equal(game.perfectClears, 0);
  assert.ok(game.filled() > 0);
});

test('a drop that clears nothing on an empty board is not perfect', () => {
  // filled() === 0 must never be enough on its own.
  const game = new Game({ seed: 42 });
  game.cells.fill(0);
  game.tray[0] = PIECE_BY_ID.get('dot');
  const res = game.place(0, 4, 4);
  assert.equal(res.perfect, false);
});

test('perfect clears survive save and restore', () => {
  const game = new Game({ seed: 43 });
  game.cells.fill(0);
  for (let c = 0; c < SIZE - 1; c++) game.cells[c] = 1;
  game.tray[0] = PIECE_BY_ID.get('dot');
  game.place(0, 0, SIZE - 1);

  const restored = Game.fromJSON(JSON.parse(JSON.stringify(game.toJSON())));
  assert.equal(restored.perfectClears, game.perfectClears);
});

test('a real game always reaches a real ending', () => {
  // Losing is the one outcome every run must be able to reach. If the tray
  // refill or the stuck check regressed, a run could go on forever or end
  // early — neither shows up in a unit test of a single move.
  for (const seed of [1, 77, 512, 9001, 31337]) {
    const game = new Game({ seed });
    let drops = 0;
    while (!game.over && drops < 2000) {
      let played = false;
      for (let slot = 0; slot < TRAY && !played; slot++) {
        const piece = game.tray[slot];
        if (!piece) continue;
        const spots = game.placements(piece);
        if (spots.length === 0) continue;
        const [r, c] = spots[0];
        game.place(slot, r, c);
        played = true;
        drops++;
      }
      if (!played) break;
    }

    assert.equal(game.over, true, `seed ${seed} never ended`);
    assert.equal(game.isStuck(), true, `seed ${seed} ended while a move was still legal`);
    assert.ok(drops > 5, `seed ${seed} ended after only ${drops} drops`);
  }
});

test('the game is over exactly when no tray piece fits', () => {
  const game = new Game({ seed: 50 });
  // Fill everything but a single cell: only the 1-cell piece can be placed.
  game.cells.fill(1);
  game.cells[0] = 0;

  game.tray = [PIECE_BY_ID.get('h2'), PIECE_BY_ID.get('sq2'), PIECE_BY_ID.get('h5')];
  assert.equal(game.isStuck(), true, 'nothing fits the single hole');

  game.tray[2] = PIECE_BY_ID.get('dot');
  assert.equal(game.isStuck(), false, 'one fitting piece is enough');
});

/**
 * A board that is stuck without being clearable.
 *
 * Filling the last hole of a completely full board clears the whole thing, so
 * "fill everything but one cell" does NOT produce a loss. Instead this leaves a
 * scattered set of holes too small and too separated for any piece to use, with
 * no row or column ever completable.
 */
function makeDeadBoard(game) {
  game.cells.fill(1);
  // Poke isolated single holes on a diagonal: every row and every column keeps
  // exactly one gap, so nothing can complete, and no two gaps are adjacent so
  // only a 1-cell piece could ever be placed.
  for (let r = 0; r < game.size; r++) {
    game.cells[r * game.size + r] = 0;
  }
}

test('a finished game refuses further moves', () => {
  const game = new Game({ seed: 51 });
  makeDeadBoard(game);
  // No piece in this tray is a single cell, so none of them fits.
  game.tray = [PIECE_BY_ID.get('h2'), PIECE_BY_ID.get('sq2'), PIECE_BY_ID.get('h5')];

  assert.equal(game.isStuck(), true);
  game.over = true;
  assert.equal(game.place(1, 0, 0), null, 'no move is accepted after the end');
});

test('the end survives a save and restore', () => {
  // The sheet is shown from the restored state, so `over` must persist.
  const game = new Game({ seed: 52 });
  makeDeadBoard(game);
  game.tray = [PIECE_BY_ID.get('h2'), PIECE_BY_ID.get('sq2'), PIECE_BY_ID.get('h5')];
  game.over = game.isStuck();
  assert.equal(game.over, true);
  game.score = 1234;

  const restored = Game.fromJSON(JSON.parse(JSON.stringify(game.toJSON())));
  assert.equal(restored.over, true);
  assert.equal(restored.score, game.score);
  assert.equal(restored.isStuck(), true, 'the restored board is still unplayable');
});

test('a long run stays consistent', () => {
  // Plays greedily to the end and checks nothing corrupts on the way.
  const game = new Game({ seed: 777 });
  let guard = 0;
  while (!game.over && guard++ < 500) {
    let done = false;
    for (let slot = 0; slot < TRAY && !done; slot++) {
      const piece = game.tray[slot];
      if (!piece) continue;
      const spots = game.placements(piece);
      if (spots.length === 0) continue;
      const [r, c] = spots[0];
      game.place(slot, r, c);
      done = true;
    }
    if (!done) break;

    const occupied = game.cells.filter((v) => v !== 0).length;
    assert.equal(occupied, game.filled());
    assert.ok(game.score >= 0);
    assert.ok(game.cells.every((v) => v >= 0 && v <= 8));
  }
  assert.ok(game.drops > 0, 'the run should have made progress');
});
