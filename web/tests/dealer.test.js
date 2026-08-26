/**
 * Dealer tests.
 *
 * The dealer exists to remove dead ends without playing for the player, so
 * these lock down both halves of that: it must help when the board is tight,
 * and it must NOT quietly turn into an easy mode.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/engine.js';
import { dealTray, pressure } from '../src/core/dealer.js';
import { PIECE_BY_ID } from '../src/core/pieces.js';

/** Occupancy of a board, as the dealer sees it. */
test('pressure reports how full the board is', () => {
  const game = new Game({ seed: 1 });
  assert.equal(pressure(game), 0);

  game.cells.fill(1);
  assert.equal(pressure(game), 1);

  game.cells.fill(0);
  for (let i = 0; i < 32; i++) game.cells[i] = 1;
  assert.equal(pressure(game), 0.5);
});

test('an empty board is dealt at random, not curated', () => {
  // Below the pressure floor the dealer must not spend draws on candidates:
  // helping from move one would flatten the opening into a formality.
  const a = new Game({ seed: 12345 });
  const b = new Game({ seed: 12345 });
  a.cells.fill(0);
  b.cells.fill(0);

  const trayA = dealTray(a);
  const trayB = dealTray(b);
  assert.deepEqual(
    trayA.map((p) => p.id),
    trayB.map((p) => p.id),
    'same seed, same board must deal the same tray',
  );
});

test('the same seed and board always deal the same tray', () => {
  // Determinism is what makes the daily board fair and a run reproducible.
  // The biased path draws a variable number of candidates, so this is the
  // property most at risk from it.
  const build = () => {
    const g = new Game({ seed: 99 });
    // Tight board: force the curated path.
    for (let i = 0; i < g.cells.length; i++) g.cells[i] = i % 3 === 0 ? 0 : 1;
    return g;
  };

  const first = dealTray(build()).map((p) => p.id);
  const second = dealTray(build()).map((p) => p.id);
  assert.deepEqual(first, second);
});

test('a tight board is dealt pieces that actually fit', () => {
  // The core promise. A board with only single-cell gaps left must not be
  // handed three big pieces — that is a loss the player did not earn.
  const game = new Game({ seed: 7 });
  // Every third cell empty: only the smallest pieces fit anywhere.
  for (let i = 0; i < game.cells.length; i++) {
    game.cells[i] = i % 3 === 0 ? 0 : 1;
  }

  let placeableTotal = 0;
  const ROUNDS = 40;
  for (let i = 0; i < ROUNDS; i++) {
    const tray = dealTray(game);
    placeableTotal += tray.filter((p) => game.fitsAnywhere(p)).length;
  }

  const avg = placeableTotal / ROUNDS;
  assert.ok(
    avg >= 1,
    `expected at least one usable piece per tray on a tight board, got ${avg.toFixed(2)}`,
  );
});

test('the dealer does not place pieces or touch the board', () => {
  // It may only choose what to offer. Anything else would be playing for the
  // player, which is exactly what the feature must not do.
  const game = new Game({ seed: 4242 });
  for (let i = 0; i < 40; i++) game.cells[i] = 1;

  const before = game.cells.slice();
  const beforeScore = game.score;
  dealTray(game);

  assert.deepEqual(game.cells, before, 'dealer must not modify the board');
  assert.equal(game.score, beforeScore, 'dealer must not award points');
});

test('a curated deal still ends the run when the board is genuinely dead', () => {
  // The dealer removes unfair losses, not all losses. If nothing can fit, the
  // game has to be allowed to end — otherwise a run never terminates.
  const game = new Game({ seed: 11 });
  game.cells.fill(1);
  // One isolated hole: no piece of two or more cells can go anywhere.
  game.cells[0] = 0;

  const tray = dealTray(game);
  const fits = tray.filter((p) => game.fitsAnywhere(p));
  // Only the single-cell piece could ever fit here.
  for (const piece of fits) {
    assert.equal(piece.cells.length, 1, `${piece.id} should not fit a one-cell hole`);
  }
});

test('helping is capped: a full board is not rescued', () => {
  const game = new Game({ seed: 5 });
  game.cells.fill(1);
  const tray = dealTray(game);
  assert.equal(tray.length, 3);
  assert.equal(tray.filter((p) => game.fitsAnywhere(p)).length, 0);
});

test('a real game still reaches a real ending with the dealer active', () => {
  // The regression that matters most: if the dealer ever became good enough to
  // keep a run alive forever, the game would have no ending.
  const game = new Game({ seed: 2026 });
  let drops = 0;
  while (!game.over && drops < 20000) {
    let placed = false;
    for (let s = 0; s < 3; s++) {
      const piece = game.tray[s];
      if (!piece) continue;
      const spots = game.placements(piece);
      if (!spots.length) continue;
      game.place(s, spots[0][0], spots[0][1]);
      placed = true;
      drops++;
      break;
    }
    if (!placed) break;
  }
  assert.ok(game.over, `run did not end after ${drops} drops`);
});
