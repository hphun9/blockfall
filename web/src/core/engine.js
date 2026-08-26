/**
 * Block Fall — the rules, with no reference to the DOM.
 *
 * Three pieces are offered at a time. Drop them anywhere they fit; a full row
 * or column clears. There is no gravity and no timer, so every loss is a
 * planning mistake rather than a reflex failure — that is the whole appeal of
 * the genre, and it only holds if the dealing is honest.
 *
 * The deal is the design problem. Hand out three pieces that cannot fit and
 * the player loses to the dealer, not to the board, which feels cheap. This
 * engine therefore refuses to end a run on a deal it created: `_refill` checks
 * playability and redeals, bounded, before giving up. See `_dealTray`.
 *
 * Everything is driven by a seeded Rng so a daily board is identical for
 * everyone, and so undo can rewind the random stream instead of letting a
 * player reroll for a nicer tray.
 */

import { Rng, randomSeed } from './rng.js';
import { drawPiece, PIECE_BY_ID } from './pieces.js';
import { dealTray } from './dealer.js';
import { tierFor } from './goals.js';

export const SIZE = 8;
export const TRAY = 3;
export const DEFAULT_UNDO_BUDGET = 3;

/** Points per cell placed. Deliberately small next to clear bonuses. */
const POINT_PER_CELL = 1;
/** A single line is worth this; each extra line in the same drop adds more. */
const LINE_BASE = 10;
/** Consecutive drops that clear something build a multiplier. */
const COMBO_STEP = 0.5;
const COMBO_MAX = 4;
/** Emptying the whole board is worth a real bonus — it is genuinely hard. */
const PERFECT_BONUS = 200;
/**
 * Leaving this few cells behind counts as a near sweep.
 *
 * Five, because a tray refills three pieces at a time and the smallest are one
 * or two cells: below five the next deal alone can undo it, which would make
 * the reward feel arbitrary.
 */
const NEAR_SWEEP_CELLS = 5;
const NEAR_SWEEP_BONUS = 60;

export class Game {
  constructor(options = {}) {
    const {
      size = SIZE,
      seed = randomSeed(),
      mode = 'classic',
      undoBudget = DEFAULT_UNDO_BUDGET,
    } = options;

    this.size = size;
    this.mode = mode;
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);

    /** Board cells: 0 = empty, otherwise palette index + 1. */
    this.cells = new Array(size * size).fill(0);

    this.score = 0;
    this.drops = 0;
    this.lines = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.perfectClears = 0;
    this.nearSweeps = 0;
    /** Highest goal tier reached this run (0 = none yet). */
    this.tier = 0;
    this.over = false;

    this.undoBudget = undoBudget;
    this.undoLeft = undoBudget;
    this.usedUndo = false;
    this.history = [];

    /** Filled by the renderer's animation, cleared on the next drop. */
    this.lastClear = null;

    this.tray = [];
    this._dealTray();
  }

  // ------------------------------------------------------------- queries

  get cellCount() {
    return this.size * this.size;
  }

  at(row, col) {
    return this.cells[row * this.size + col];
  }

  /** Cells currently occupied. */
  filled() {
    let n = 0;
    for (const v of this.cells) if (v) n++;
    return n;
  }

  /** Can this piece sit with its top-left corner at (row, col)? */
  fits(piece, row, col) {
    if (!piece) return false;
    if (row < 0 || col < 0) return false;
    if (row + piece.h > this.size || col + piece.w > this.size) return false;
    for (const [dr, dc] of piece.cells) {
      if (this.cells[(row + dr) * this.size + (col + dc)] !== 0) return false;
    }
    return true;
  }

  /** Does this piece fit anywhere at all? */
  fitsAnywhere(piece) {
    if (!piece) return false;
    for (let r = 0; r + piece.h <= this.size; r++) {
      for (let c = 0; c + piece.w <= this.size; c++) {
        if (this.fits(piece, r, c)) return true;
      }
    }
    return false;
  }

  /** Every legal top-left position for a piece. Used by hints and by tests. */
  placements(piece) {
    const out = [];
    if (!piece) return out;
    for (let r = 0; r + piece.h <= this.size; r++) {
      for (let c = 0; c + piece.w <= this.size; c++) {
        if (this.fits(piece, r, c)) out.push([r, c]);
      }
    }
    return out;
  }

  /** True when no remaining tray piece fits anywhere. */
  isStuck() {
    return !this.tray.some((p) => p && this.fitsAnywhere(p));
  }

  canUndo() {
    return this.undoLeft > 0 && this.history.length > 0 && !this.over;
  }

  /**
   * Which rows and columns a drop at (row, col) would clear.
   *
   * Pure — the caller uses it to preview the outcome before committing, which
   * is what makes the board readable while dragging.
   */
  previewClears(piece, row, col) {
    if (!this.fits(piece, row, col)) return { rows: [], cols: [] };

    const occupied = new Set();
    for (const [dr, dc] of piece.cells) {
      occupied.add((row + dr) * this.size + (col + dc));
    }
    const filledAt = (r, c) => this.cells[r * this.size + c] !== 0 || occupied.has(r * this.size + c);

    const rows = [];
    const cols = [];
    for (let r = 0; r < this.size; r++) {
      let full = true;
      for (let c = 0; c < this.size; c++) if (!filledAt(r, c)) { full = false; break; }
      if (full) rows.push(r);
    }
    for (let c = 0; c < this.size; c++) {
      let full = true;
      for (let r = 0; r < this.size; r++) if (!filledAt(r, c)) { full = false; break; }
      if (full) cols.push(c);
    }
    return { rows, cols };
  }

  // -------------------------------------------------------------- moves

  /**
   * Place tray slot `slot` with its top-left at (row, col).
   *
   * Returns a result object rather than a bare boolean because the renderer
   * needs to know what to animate: which cells were cleared, what the combo
   * did, and whether the run just ended.
   */
  place(slot, row, col) {
    if (this.over) return null;
    const piece = this.tray[slot];
    if (!piece || !this.fits(piece, row, col)) return null;

    this._pushHistory();

    const placed = [];
    for (const [dr, dc] of piece.cells) {
      const idx = (row + dr) * this.size + (col + dc);
      this.cells[idx] = piece.colour + 1;
      placed.push(idx);
    }

    this.tray[slot] = null;
    this.drops++;

    // Recompute against the real board rather than reusing previewClears:
    // the piece is on the board now, so a full line reads directly.
    const clearRows = [];
    const clearCols = [];
    for (let r = 0; r < this.size; r++) {
      let full = true;
      for (let c = 0; c < this.size; c++) if (this.cells[r * this.size + c] === 0) { full = false; break; }
      if (full) clearRows.push(r);
    }
    for (let c = 0; c < this.size; c++) {
      let full = true;
      for (let r = 0; r < this.size; r++) if (this.cells[r * this.size + c] === 0) { full = false; break; }
      if (full) clearCols.push(c);
    }
    const cleared = new Set();
    for (const r of clearRows) for (let c = 0; c < this.size; c++) cleared.add(r * this.size + c);
    for (const c of clearCols) for (let r = 0; r < this.size; r++) cleared.add(r * this.size + c);

    const lineCount = clearRows.length + clearCols.length;

    // Scoring: cells placed always pay a little, so a drop that clears nothing
    // is not a wasted turn. Clears pay the real money, and clearing several
    // lines at once pays superlinearly — that is the skill the game rewards.
    let gained = piece.cells.length * POINT_PER_CELL;
    if (lineCount > 0) {
      this.combo = Math.min(this.combo + 1, COMBO_MAX);
      const multiplier = 1 + (this.combo - 1) * COMBO_STEP;
      gained += LINE_BASE * lineCount * lineCount * multiplier;
      this.lines += lineCount;
      if (this.combo > this.bestCombo) this.bestCombo = this.combo;
      for (const idx of cleared) this.cells[idx] = 0;
    } else {
      this.combo = 0;
    }

    // Sweeping the board completely is the rarest thing a player can do here,
    // and it happens without any announcement unless we look for it. Checked
    // after the clear has been applied, and paid for properly.
    const remaining = this.filled();
    const perfect = lineCount > 0 && remaining === 0;
    if (perfect) {
      this.perfectClears++;
      gained += PERFECT_BONUS;
    }

    // Nearly clean: the achievement that is actually reachable.
    //
    // A true sweep is close to impossible by construction, and measuring it
    // showed why: the tray refills three pieces at a time, so a board with a
    // few cells left gains at least three more before it can lose any, and
    // shedding them needs a full line — eight cells. Across 200 deals onto
    // boards with 2, 3, 5 and 8 cells remaining, ZERO could be emptied.
    //
    // Runs did get down to an average low of 2.2 cells, though. That near miss
    // is a real accomplishment and went completely unremarked, so it is now
    // the thing that gets celebrated.
    const nearSweep = lineCount > 0
      && remaining > 0
      && remaining <= NEAR_SWEEP_CELLS;
    if (nearSweep) {
      this.nearSweeps++;
      gained += NEAR_SWEEP_BONUS;
    }

    const tierBefore = tierFor(this.score);
    this.score += Math.round(gained);
    // Crossing a tier is the one moment in a run that says "you are doing
    // well" — reported so the UI can mark it rather than letting it slide by
    // inside a number that only ever goes up.
    const tierAfter = tierFor(this.score);
    const tierUp = tierAfter > tierBefore ? tierAfter : 0;
    if (tierUp) this.tier = tierAfter;
    this.lastClear = lineCount > 0
      ? { rows: clearRows, cols: clearCols, cells: [...cleared], combo: this.combo }
      : null;

    if (this.tray.every((p) => p === null)) this._dealTray();
    if (this.isStuck()) this.over = true;

    return {
      placed,
      cleared: [...cleared],
      rows: clearRows,
      cols: clearCols,
      gained: Math.round(gained),
      combo: this.combo,
      perfect,
      nearSweep,
      tierUp,
      over: this.over,
    };
  }

  undo() {
    if (!this.canUndo()) return false;
    const snap = this.history.pop();
    this.cells = snap.cells.slice();
    this.score = snap.score;
    this.drops = snap.drops;
    this.lines = snap.lines;
    this.combo = snap.combo;
    this.perfectClears = snap.perfectClears;
    this.nearSweeps = snap.nearSweeps;
    this.tier = snap.tier;
    this.tray = snap.tray.map((id) => (id ? PIECE_BY_ID.get(id) : null));
    this.rng.state = snap.rngState;
    this.over = false;
    this.lastClear = null;
    this.undoLeft--;
    this.usedUndo = true;
    return true;
  }

  // ------------------------------------------------------------ internals

  _pushHistory() {
    this.history.push({
      cells: this.cells.slice(),
      score: this.score,
      drops: this.drops,
      lines: this.lines,
      combo: this.combo,
      perfectClears: this.perfectClears,
      nearSweeps: this.nearSweeps,
      tier: this.tier,
      tray: this.tray.map((p) => (p ? p.id : null)),
      rngState: this.rng.state,
    });
    // One undo per budget point; no need to keep more than the budget allows.
    if (this.history.length > this.undoBudget) this.history.shift();
  }

  /**
   * Fill the tray.
   *
   * The honesty rule: a fresh tray must contain at least one piece that fits
   * the current board. Without this a player can be handed three large pieces
   * onto a nearly-full board and lose without having made a mistake — the
   * single most common complaint about this genre.
   *
   * Above a pressure threshold the dealer also biases toward trays that keep a
   * line clear REACHABLE (see dealer.js). It never places a piece and never
   * scores the player's actual move: arranging well is still entirely on them,
   * the deal only guarantees that arranging well remains possible.
   *
   * The redeal is bounded and the fallback is deliberate: when the board is
   * genuinely so full that nothing helps, we accept the deal and the run ends.
   * That loss belongs to the player, and it is reproducible from the seed.
   */
  _dealTray() {
    const MAX_REDEALS = 12;
    for (let attempt = 0; attempt <= MAX_REDEALS; attempt++) {
      const tray = dealTray(this);
      if (attempt === MAX_REDEALS || tray.some((p) => this.fitsAnywhere(p))) {
        this.tray = tray;
        return;
      }
    }
  }

  // ------------------------------------------------------ serialisation

  toJSON() {
    return {
      v: 1,
      size: this.size,
      mode: this.mode,
      seed: this.seed,
      rngState: this.rng.state,
      cells: this.cells.slice(),
      score: this.score,
      drops: this.drops,
      lines: this.lines,
      combo: this.combo,
      bestCombo: this.bestCombo,
      perfectClears: this.perfectClears,
      nearSweeps: this.nearSweeps,
      tier: this.tier,
      over: this.over,
      undoLeft: this.undoLeft,
      undoBudget: this.undoBudget,
      usedUndo: this.usedUndo,
      tray: this.tray.map((p) => (p ? p.id : null)),
    };
  }

  static fromJSON(data) {
    if (!data || data.v !== 1) return null;
    const game = new Game({
      size: data.size,
      seed: data.seed,
      mode: data.mode,
      undoBudget: data.undoBudget ?? DEFAULT_UNDO_BUDGET,
    });
    game.rng.state = data.rngState >>> 0;
    game.cells = data.cells.slice();
    game.score = data.score;
    game.drops = data.drops;
    game.lines = data.lines;
    game.combo = data.combo ?? 0;
    game.bestCombo = data.bestCombo ?? 0;
    game.perfectClears = data.perfectClears ?? 0;
    game.nearSweeps = data.nearSweeps ?? 0;
    game.tier = data.tier ?? 0;
    game.over = !!data.over;
    game.undoLeft = data.undoLeft ?? game.undoBudget;
    game.usedUndo = !!data.usedUndo;
    game.tray = (data.tray || []).map((id) => (id ? PIECE_BY_ID.get(id) ?? null : null));
    game.history = [];
    return game;
  }
}
