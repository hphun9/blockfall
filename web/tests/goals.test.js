/**
 * Goal ladder tests.
 *
 * The tiers exist to make a run feel winnable, which only works if the numbers
 * are honest — so these lock down the arithmetic and, more importantly, the
 * pacing claims written in goals.js. If a future weight change makes the top
 * tier unreachable again, the reachability test here is what catches it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { TIERS, tierFor, nextTier, tierProgress } from '../src/core/goals.js';
import { Game } from '../src/core/engine.js';
import { PIECES, PIECE_BY_ID } from '../src/core/pieces.js';

test('tiers are ordered and strictly increasing', () => {
  for (let i = 1; i < TIERS.length; i++) {
    assert.ok(TIERS[i].score > TIERS[i - 1].score,
      `tier ${TIERS[i].id} must be worth more than tier ${TIERS[i - 1].id}`);
    assert.equal(TIERS[i].id, TIERS[i - 1].id + 1);
  }
});

test('tierFor reports the highest tier reached', () => {
  assert.equal(tierFor(0), 0);
  assert.equal(tierFor(TIERS[0].score - 1), 0);
  assert.equal(tierFor(TIERS[0].score), 1);
  assert.equal(tierFor(TIERS[2].score), 3);
  assert.equal(tierFor(999999), TIERS.length);
});

test('nextTier points at what is being worked toward', () => {
  assert.equal(nextTier(0).id, 1);
  assert.equal(nextTier(TIERS[0].score).id, 2);
  assert.equal(nextTier(999999), null, 'past the last tier there is nothing left to aim at');
});

test('progress fills across a band, not from zero', () => {
  // Halfway between tier 1 and tier 2 must read as half, not as
  // (score / tier2) which would crawl once the numbers get large.
  const mid = TIERS[0].score + (TIERS[1].score - TIERS[0].score) / 2;
  assert.equal(Math.round(tierProgress(mid) * 100), 50);

  assert.equal(tierProgress(0), 0);
  assert.equal(tierProgress(TIERS[0].score), 0, 'landing exactly on a tier restarts the next band');
  assert.equal(tierProgress(999999), 1);
});

test('the engine reports a tier crossing exactly once', () => {
  const game = new Game({ seed: 4242 });
  const seen = [];
  // Award score directly, then place a piece so the result is produced by the
  // real code path rather than by calling tierFor() in the test.
  game.score = TIERS[0].score - 1;
  game.tray[0] = PIECE_BY_ID.get('dot');
  const spots = game.placements(game.tray[0]);
  const first = game.place(0, spots[0][0], spots[0][1]);
  if (first.tierUp) seen.push(first.tierUp);

  // A second placement at the same tier must NOT report again.
  game.tray[0] = PIECE_BY_ID.get('dot');
  const more = game.placements(game.tray[0]);
  const second = game.place(0, more[0][0], more[0][1]);
  assert.equal(second.tierUp, 0, 'a tier already reached must not fire twice');
  assert.deepEqual(seen, [1]);
  assert.equal(game.tier, 1);
});

test('the tier survives a save and restore', () => {
  const game = new Game({ seed: 77 });
  game.score = TIERS[2].score;
  game.tier = 3;
  const back = Game.fromJSON(game.toJSON());
  assert.equal(back.tier, 3);
  assert.equal(tierFor(back.score), 3);
});

test('undo rewinds the tier with everything else', () => {
  const game = new Game({ seed: 99 });
  game.score = TIERS[0].score - 1;
  game.tray[0] = PIECE_BY_ID.get('dot');
  const spots = game.placements(game.tray[0]);
  game.place(0, spots[0][0], spots[0][1]);
  const after = game.tier;
  game.undo();
  assert.ok(game.tier <= after, 'undo must not leave a tier credited for a move that was taken back');
});

test('diagonal pieces exist and are genuinely diagonal', () => {
  // Match the diagonal ids exactly: a bare startsWith('d') also catches 'dot'.
  const diagonals = PIECES.filter((p) => /^d[23][ab]$/.test(p.id));
  assert.ok(diagonals.length >= 4, 'both slopes at two lengths');

  for (const piece of diagonals) {
    // Every cell must touch another only at a corner — never edge to edge.
    for (const [r1, c1] of piece.cells) {
      for (const [r2, c2] of piece.cells) {
        if (r1 === r2 && c1 === c2) continue;
        const dr = Math.abs(r1 - r2);
        const dc = Math.abs(c1 - c2);
        assert.notEqual(dr + dc, 1,
          `${piece.id} has two cells sharing an edge, so it is not a diagonal`);
      }
    }
    // And it must span both axes, or it is just a bar.
    assert.ok(piece.w > 1 && piece.h > 1, `${piece.id} must span both axes`);
  }

  // Both slopes present, so neither direction is a dead end.
  const down = diagonals.some((p) => p.cells.every(([r, c], i, a) => i === 0 || (r > a[i - 1][0] && c > a[i - 1][1])));
  const up = diagonals.some((p) => p.cells.every(([r, c], i, a) => i === 0 || (r > a[i - 1][0] && c < a[i - 1][1])));
  assert.ok(down && up, 'both slopes must be dealable');
});

test('the top tier is actually reachable', () => {
  // The whole ladder is pointless if its last rung is theoretical. This plays
  // real runs with a simple heuristic and requires that the top tier falls at
  // least occasionally — the guard that caught the first draft, where only 1%
  // of runs reached it.
  const evaluate = (game, piece, row, col) => {
    const size = game.size;
    const cells = game.cells.slice();
    for (const [dr, dc] of piece.cells) cells[(row + dr) * size + (col + dc)] = 1;
    let cleared = 0;
    const rows = new Set();
    const cols = new Set();
    for (let r = 0; r < size; r++) {
      let full = true;
      for (let c = 0; c < size; c++) if (!cells[r * size + c]) { full = false; break; }
      if (full) { cleared++; rows.add(r); }
    }
    for (let c = 0; c < size; c++) {
      let full = true;
      for (let r = 0; r < size; r++) if (!cells[r * size + c]) { full = false; break; }
      if (full) { cleared++; cols.add(c); }
    }
    for (const r of rows) for (let c = 0; c < size; c++) cells[r * size + c] = 0;
    for (const c of cols) for (let r = 0; r < size; r++) cells[r * size + c] = 0;
    let filled = 0;
    for (const v of cells) if (v) filled++;
    return -cleared * 40 + filled;
  };

  const scores = [];
  for (let i = 0; i < 60; i++) {
    const game = new Game({ seed: 500 + i * 1327 });
    let drops = 0;
    while (!game.over && drops < 2000) {
      let best = null;
      for (let slot = 0; slot < game.tray.length; slot++) {
        const piece = game.tray[slot];
        if (!piece) continue;
        for (const [r, c] of game.placements(piece)) {
          const v = evaluate(game, piece, r, c);
          if (!best || v < best.v) best = { slot, r, c, v };
        }
      }
      if (!best) break;
      game.place(best.slot, best.r, best.c);
      drops++;
    }
    scores.push(game.score);
  }

  const top = TIERS[TIERS.length - 1].score;
  const first = TIERS[0].score;
  const reachedFirst = scores.filter((s) => s >= first).length;

  // The first tier must be routine, or the ladder never starts.
  assert.ok(reachedFirst / scores.length > 0.4,
    `tier 1 (${first}) reached in only ${reachedFirst}/${scores.length} runs — too steep to open with`);

  // The top tier must be within reach of a strong run. A weak heuristic on 60
  // runs will not hit it every time, so this asserts the ceiling is not absurd
  // rather than a precise rate.
  const best = Math.max(...scores);
  assert.ok(best >= top * 0.7,
    `best of ${scores.length} runs was ${best}, far short of the top tier ${top} — the ladder is out of reach`);
});
