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
 * early would flatten the difficulty curve and make the opening boring.
 */
const PRESSURE_FLOOR = 0.5;

/** Candidate trays to consider. Each one costs three draws plus a scan. */
const CANDIDATES = 3;

/**
 * Extra attempts made only when the best of the normal candidates contains
 * nothing playable at all. Bounded, because a truly dead board must still be
 * allowed to end the run.
 */
const EXTRA_CANDIDATES = 10;

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

  return placeable * 10 + clearers * 25 + bestLines * 8;
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

  if (!alwaysHelp && pressure(game) < PRESSURE_FLOOR) {
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
