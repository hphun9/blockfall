/**
 * The piece catalogue.
 *
 * Every shape is a list of [row, col] offsets from its own top-left corner.
 * Rotations are baked in as separate entries rather than computed: the player
 * never rotates a piece in this genre, so a rotation function would be dead
 * code, and a flat list makes the dealer's weighting obvious at a glance.
 *
 * Weights matter more than they look. Deal uniformly and the board fills with
 * awkward S/Z shapes until it deadlocks through no fault of the player, which
 * reads as unfair rather than hard. Small, forgiving pieces are therefore
 * common and the difficult ones are rare — the same instinct behind Tetris's
 * bag randomiser, expressed as a weight table because pieces here are drawn
 * three at a time rather than one.
 */

/**
 * @typedef {Object} Piece
 * @property {string} id
 * @property {number[][]} cells  [row, col] offsets
 * @property {number} w  width in cells
 * @property {number} h  height in cells
 * @property {number} weight  relative draw frequency
 * @property {number} colour  palette index 0..7
 */

function makePiece(id, cells, weight, colour) {
  let w = 0;
  let h = 0;
  for (const [r, c] of cells) {
    if (r + 1 > h) h = r + 1;
    if (c + 1 > w) w = c + 1;
  }
  return { id, cells, w, h, weight, colour, size: cells.length };
}

export const PIECES = [
  // ---- singles and short bars: the relief valves ----------------------
  makePiece('dot', [[0, 0]], 10, 0),
  makePiece('h2', [[0, 0], [0, 1]], 9, 1),
  makePiece('v2', [[0, 0], [1, 0]], 9, 1),
  makePiece('h3', [[0, 0], [0, 1], [0, 2]], 8, 2),
  makePiece('v3', [[0, 0], [1, 0], [2, 0]], 8, 2),

  // ---- squares --------------------------------------------------------
  makePiece('sq2', [[0, 0], [0, 1], [1, 0], [1, 1]], 8, 3),
  makePiece('sq3', [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], 2, 4),

  // ---- long bars: powerful, so kept uncommon --------------------------
  makePiece('h4', [[0, 0], [0, 1], [0, 2], [0, 3]], 5, 5),
  makePiece('v4', [[0, 0], [1, 0], [2, 0], [3, 0]], 5, 5),
  makePiece('h5', [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], 3, 6),
  makePiece('v5', [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 3, 6),

  // ---- L / J, all four rotations --------------------------------------
  makePiece('l0', [[0, 0], [1, 0], [2, 0], [2, 1]], 4, 7),
  makePiece('l1', [[0, 0], [0, 1], [0, 2], [1, 0]], 4, 7),
  makePiece('l2', [[0, 0], [0, 1], [1, 1], [2, 1]], 4, 7),
  makePiece('l3', [[0, 2], [1, 0], [1, 1], [1, 2]], 4, 7),
  makePiece('j0', [[0, 1], [1, 1], [2, 0], [2, 1]], 4, 3),
  makePiece('j1', [[0, 0], [1, 0], [1, 1], [1, 2]], 4, 3),
  makePiece('j2', [[0, 0], [0, 1], [1, 0], [2, 0]], 4, 3),
  makePiece('j3', [[0, 0], [0, 1], [0, 2], [1, 2]], 4, 3),

  // ---- small corners: the workhorses ----------------------------------
  makePiece('c0', [[0, 0], [0, 1], [1, 0]], 7, 2),
  makePiece('c1', [[0, 0], [0, 1], [1, 1]], 7, 2),
  makePiece('c2', [[0, 1], [1, 0], [1, 1]], 7, 2),
  makePiece('c3', [[0, 0], [1, 0], [1, 1]], 7, 2),

  // ---- T ---------------------------------------------------------------
  makePiece('t0', [[0, 0], [0, 1], [0, 2], [1, 1]], 4, 4),
  makePiece('t1', [[0, 1], [1, 0], [1, 1], [2, 1]], 4, 4),
  makePiece('t2', [[0, 1], [1, 0], [1, 1], [1, 2]], 4, 4),
  makePiece('t3', [[0, 0], [1, 0], [1, 1], [2, 0]], 4, 4),

  // ---- S / Z: the genuinely awkward ones, deliberately rare -----------
  makePiece('s0', [[0, 1], [0, 2], [1, 0], [1, 1]], 2, 6),
  makePiece('s1', [[0, 0], [1, 0], [1, 1], [2, 1]], 2, 6),
  makePiece('z0', [[0, 0], [0, 1], [1, 1], [1, 2]], 2, 5),
  makePiece('z1', [[0, 1], [1, 0], [1, 1], [2, 0]], 2, 5),

  // ---- diagonals: cells touching only at their corners ----------------
  //
  // These are the shapes the genre is known for and the ones this catalogue
  // was missing. They play unlike anything above: every other piece is a
  // solid blob that fills a contiguous patch, whereas a diagonal deliberately
  // leaves gaps between its own cells. That forces a different read of the
  // board — you stop hunting for a hole the piece fits into and start looking
  // for a staircase it completes.
  //
  // Both slopes are included so neither direction is a dead end, and the
  // 2-cell versions are common enough to be useful while the 3-cell ones stay
  // rare: a 3-long diagonal needs a very specific board to be worth anything.
  makePiece('d2a', [[0, 0], [1, 1]], 6, 4),
  makePiece('d2b', [[0, 1], [1, 0]], 6, 4),
  makePiece('d3a', [[0, 0], [1, 1], [2, 2]], 3, 7),
  makePiece('d3b', [[0, 2], [1, 1], [2, 0]], 3, 7),
];

export const PIECE_BY_ID = new Map(PIECES.map((p) => [p.id, p]));

const TOTAL_WEIGHT = PIECES.reduce((sum, p) => sum + p.weight, 0);

/**
 * Draw one piece from the weighted table.
 *
 * Takes an Rng so the caller controls the stream — the daily board and the
 * undo rewind both depend on being able to replay draws exactly.
 */
export function drawPiece(rng) {
  let roll = rng.nextInt(TOTAL_WEIGHT);
  for (const piece of PIECES) {
    roll -= piece.weight;
    if (roll < 0) return piece;
  }
  return PIECES[0]; // unreachable; keeps the return type honest
}
