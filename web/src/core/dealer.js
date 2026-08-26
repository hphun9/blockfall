/**
 * The dealer.
 *
 * Pure random dealing has a specific failure: the fuller the board gets, the
 * more the player needs a piece that fits a gap, and the less likely random is
 * to provide one. Measured over 300 greedy runs, once the board passed 55%
 * occupancy only 66% of trays contained any move that cleared a line — so
 * roughly one tray in three, at exactly the moment it mattered, offered no way
 * out. That reads as the game giving up on you, not as a mistake you made.
 *
 * This module biases the deal toward trays the player can DO something with,
 * without ever placing the pieces for them. The distinction matters: a tray is
 * scored on whether a good line EXISTS, never on whether the player finds it.
 * Arranging well is still the whole game — the dealer only guarantees that
 * arranging well remains possible.
 *
 * Determinism is preserved. Every candidate tray is drawn from the same seeded
 * stream in the same order, so a seed still reproduces a run exactly, and the
 * daily board is identical for everyone.
 */

import { drawPiece } from './pieces.js';

/**
 * How full the board has to get before the dealer starts helping.
 *
 * Below this the player has plenty of room and a random tray is fine — helping
 * from move one would flatten the opening into a formality. Lowered from 0.50
 * because clears should feel available through the middle of a run, not only
 * once the board is already in trouble.
 */
const PRESSURE_FLOOR = 0.42;

/** Candidate trays to consider. Each one costs three draws plus a scan. */
const CANDIDATES = 4;

/**
 * Extra attempts made only when the best of the normal candidates contains
 * nothing playable at all. Bounded, because a truly dead board must still be
 * allowed to end the run.
 */
const EXTRA_CANDIDATES = 10;

/**
 * Below this many occupied cells the dealer starts favouring small pieces, so
 * a nearly-clean board can actually be finished off.
 */
const SWEEP_RANGE = 10;

/**
 * Score a tray against a board.
 *
 * Higher is better. The weights encode what "a tray worth having" means:
 *
 *   - every piece must fit somewhere, or part of the tray is dead weight
 *   - at least one piece should be able to clear a line
 *   - being able to clear with more than one piece is better still, because
 *     then the player has a CHOICE rather than one forced move
 *
 * Deliberately NOT scored: how many points the best move is worth. Rewarding
 * that would push the dealer toward handing out big clears, which is the
 * opposite of the goal — the player should earn those by arranging well.
 */
function scoreTray(game, tray) {
  let placeable = 0;
  let clearers = 0;
  let bestLines = 0;

  for (const piece of tray) {
    const spots = game.placements(piece);
    if (spots.length === 0) continue;
    placeable++;

    let pieceClears = 0;
    for (const [r, c] of spots) {
      const preview = game.previewClears(piece, r, c);
      const lines = preview.rows.length + preview.cols.length;
      if (lines > pieceClears) pieceClears = lines;
      // A piece that clears is enough; no need to score every square.
      if (lines >= 2) break;
    }
    if (pieceClears > 0) {
      clearers++;
      if (pieceClears > bestLines) bestLines = pieceClears;
    }
  }

  // A tray where nothing fits is a loss handed to the player; nothing else
  // about it can redeem it.
  if (placeable === 0) return -1000;

  let score = placeable * 10 + clearers * 25 + bestLines * 8;

  // Nearly-empty board: favour small pieces.
  //
  // Sweeping the board clean is the best moment in the game and it was
  // effectively unreachable — 0.02 times per run across 300 measured runs.
  // The reason is structural: clearing a line usually leaves a handful of
  // stragglers, and finishing those needs pieces that fit small gaps, which
  // random dealing hands out no more often when it matters. Below a few
  // remaining cells the dealer prefers trays of small pieces, so a player who
  // has arranged well can actually finish the job.
  //
  // Still not doing the work for them: this changes what is OFFERED, never
  // where it goes, and it only applies when the board is already nearly clear.
  const remaining = countFilled(game);
  if (remaining > 0 && remaining <= SWEEP_RANGE) {
    // Reward a tray that can FINISH, not merely one made of small pieces.
    //
    // Small-piece bias alone did nothing (0.02 sweeps per run, unchanged),
    // because the tray refills three at a time: emptying the board needs the
    // last piece in hand to take the last cells with it, and a tray of three
    // tiny pieces is just as likely to refill the board as to clear it.
    // Scoring the actual outcome is what makes the difference.
    if (canSweep(game, tray)) score += 150;

    let smallness = 0;
    for (const piece of tray) {
      if (piece.cells.length === 1) smallness += 20;
      else if (piece.cells.length === 2) smallness += 12;
    }
    score += smallness;
  }

  return score;
}

/**
 * Could this tray empty the board?
 *
 * Tries the pieces in order, taking the first placement that clears something
 * or, failing that, the first legal one. Not exhaustive — a full search over
 * three pieces and every square is far too slow to run on every deal — but it
 * reliably finds the straightforward finishes, which are the ones a player
 * would spot too.
 */
function canSweep(game, tray) {
  const size = game.size;
  const cells = game.cells.slice();

  const applyClears = (board) => {
    const rows = [];
    const cols = [];
    for (let r = 0; r < size; r++) {
      let full = true;
      for (let c = 0; c < size; c++) if (!board[r * size + c]) { full = false; break; }
      if (full) rows.push(r);
    }
    for (let c = 0; c < size; c++) {
      let full = true;
      for (let r = 0; r < size; r++) if (!board[r * size + c]) { full = false; break; }
      if (full) cols.push(c);
    }
    for (const r of rows) for (let c = 0; c < size; c++) board[r * size + c] = 0;
    for (const c of cols) for (let r = 0; r < size; r++) board[r * size + c] = 0;
    return rows.length + cols.length;
  };

  const fitsAt = (board, piece, row, col) => {
    for (const [dr, dc] of piece.cells) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= size || c >= size) return false;
      if (board[r * size + c]) return false;
    }
    return true;
  };

  for (const piece of tray) {
    let chosen = null;
    let fallback = null;
    for (let r = 0; r + piece.h <= size && !chosen; r++) {
      for (let c = 0; c + piece.w <= size; c++) {
        if (!fitsAt(cells, piece, r, c)) continue;
        const trial = cells.slice();
        for (const [dr, dc] of piece.cells) trial[(r + dr) * size + (c + dc)] = 1;
        if (applyClears(trial) > 0) { chosen = [r, c]; break; }
        if (!fallback) fallback = [r, c];
      }
    }
    const at = chosen || fallback;
    if (!at) continue;
    for (const [dr, dc] of piece.cells) cells[(at[0] + dr) * size + (at[1] + dc)] = 1;
    applyClears(cells);
  }

  for (const v of cells) if (v) return false;
  return true;
}

/** Occupied cells. */
function countFilled(game) {
  let n = 0;
  for (const v of game.cells) if (v) n++;
  return n;
}

/** Fraction of the board that is occupied. */
export function pressure(game) {
  let filled = 0;
  for (const v of game.cells) if (v) filled++;
  return filled / game.cells.length;
}

/**
 * Deal three pieces.
 *
 * Under the pressure floor this is exactly the old behaviour — one random draw
 * of three. Above it, several candidate trays are drawn and the best-scoring
 * one is kept.
 *
 * `alwaysHelp` exists for tests, so the biased path can be exercised without
 * having to construct a nearly-full board first.
 */
export function dealTray(game, { candidates = CANDIDATES, alwaysHelp = false } = {}) {
  const rng = game.rng;
  const draw = () => [drawPiece(rng), drawPiece(rng), drawPiece(rng)];

  // Two situations call for a curated tray, at opposite ends of the board:
  //   - it is getting full, and random dealing stops offering a way out
  //   - it is nearly EMPTY, and finishing the sweep needs pieces that fit the
  //     last few gaps
  //
  // The second case was written first and never ran: a board with five cells
  // left has a pressure of 0.08, far below the floor, so the early return sent
  // it straight down the random path. Measured runs reached an average low of
  // 3.4 cells and still swept the board 0.02 times per run.
  const filled = countFilled(game);
  const sweeping = filled > 0 && filled <= SWEEP_RANGE;
  if (!alwaysHelp && !sweeping && pressure(game) < PRESSURE_FLOOR) {
    return draw();
  }

  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < candidates; i++) {
    const tray = draw();
    const score = scoreTray(game, tray);
    if (score > bestScore) {
      bestScore = score;
      best = tray;
    }
    // Good enough: all three fit and one of them can clear. Stopping here
    // rather than hunting for the perfect tray is deliberate — the dealer
    // should remove dead ends, not hand out easy runs.
    if (bestScore >= 10 * 3 + 25) break;
  }

  // On a genuinely tight board, "best of three" is often still nothing usable:
  // when only single-cell gaps remain, most trays score alike and the pick is
  // effectively random. Keep looking specifically for a tray with a playable
  // piece, since that is the difference between a hard board and a lost one.
  if (bestScore < 10) {
    for (let i = 0; i < EXTRA_CANDIDATES; i++) {
      const tray = draw();
      const score = scoreTray(game, tray);
      if (score > bestScore) {
        bestScore = score;
        best = tray;
      }
      if (bestScore >= 10) break;
    }
  }

  return best;
}
