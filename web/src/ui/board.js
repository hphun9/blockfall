/**
 * Rendering the board and the tray.
 *
 * The board is a fixed grid of cell elements that are reused for the life of
 * the page — only their `data-c` attribute changes. Rebuilding the grid every
 * frame would be simpler to write but would restart CSS animations and drop
 * the drag preview, so the cells are stateful on purpose.
 */

export class BoardView {
  constructor(el) {
    this.el = el;
    this.size = 0;
    this.cells = [];
    /** Cell -> the colour it had before the preview touched it (null = empty). */
    this._touched = new Map();
  }

  /** Build (or rebuild) the grid for a given board size. */
  mount(size) {
    if (this.size === size && this.cells.length === size * size) return;
    this.size = size;
    this.el.style.setProperty('--n', String(size));
    this.el.replaceChildren();
    this.cells = [];
    for (let i = 0; i < size * size; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      this.el.appendChild(cell);
      this.cells.push(cell);
    }
    this._sizeCells();
  }

  /** Cell radius scales with cell size so every skin keeps its proportions. */
  _sizeCells() {
    const rect = this.el.getBoundingClientRect();
    if (rect.width === 0) return;
    const styles = getComputedStyle(this.el);
    const ratio = parseFloat(styles.getPropertyValue('--gap-ratio')) || 0.075;
    const rRatio = parseFloat(styles.getPropertyValue('--cell-radius-ratio')) || 0.22;

    const approx = rect.width / this.size;
    const gap = Math.max(3, Math.round(approx * ratio));
    const pad = Math.round(gap * 1.6);
    const cell = (rect.width - pad * 2 - gap * (this.size - 1)) / this.size;

    this.el.style.setProperty('--gap', `${gap}px`);
    this.el.style.setProperty('--board-pad', `${pad}px`);
    this.el.style.setProperty('--cell-r', `${Math.round(cell * rRatio)}px`);

    // Remembered so the tray and the drag ghost can match the board exactly —
    // one number, one source, no chance of the three drifting apart.
    this.cellSize = cell;
    this.gapSize = gap;
  }

  /** Board cell size in px. Zero until the board has been laid out. */
  metrics() {
    return { cell: this.cellSize ?? 0, gap: this.gapSize ?? 0 };
  }

  /** Re-measure after a resize or a skin change. */
  refresh() {
    this._sizeCells();
  }

  /** Paint the board from the engine's cell array. */
  draw(cells, animateIdx = null) {
    // A full repaint is the authority on what the board holds, so any preview
    // bookkeeping is void from here on — keeping it would let clearPreview
    // later restore a colour the engine has since removed.
    this._touched.clear();

    for (let i = 0; i < this.cells.length; i++) {
      const el = this.cells[i];
      const value = cells[i];
      if (value) {
        if (el.dataset.c !== String(value)) el.dataset.c = String(value);
      } else if (el.dataset.c !== undefined) {
        delete el.dataset.c;
      }
      el.classList.remove('ghost', 'ghost-bad', 'will-clear', 'blocked-by');
    }
    if (animateIdx) {
      for (const i of animateIdx) {
        const el = this.cells[i];
        el.classList.remove('drop-in');
        void el.offsetWidth; // restart the animation
        el.classList.add('drop-in');
      }
    }
  }

  /**
   * Show where a dragged piece would land.
   *
   * Two rules matter here, and both were learned the hard way:
   *
   * 1. A cell that already holds a block is NEVER repainted. Covering it makes
   *    the board lie about what is underneath, and the player is left guessing
   *    why the piece will not go down. The occupied cell keeps its own colour
   *    and gets a warning ring instead.
   * 2. Anything this method touches is recorded so `clearPreview` can put it
   *    back exactly. Painting `data-c` onto an empty cell and only removing the
   *    class later left empty cells stuck showing a colour — a board that
   *    looked full where it was not.
   */
  preview(piece, row, col, valid, clears) {
    this.clearPreview();
    if (!piece) return;

    for (const [dr, dc] of piece.cells) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= this.size || c >= this.size) continue;

      const idx = r * this.size + c;
      const el = this.cells[idx];
      const occupied = el.dataset.c !== undefined;

      if (valid) {
        // A valid drop only ever covers empty cells, so painting is safe here.
        this._remember(el, occupied);
        el.classList.add('ghost');
        el.dataset.c = String(piece.colour + 1);
      } else if (occupied) {
        // The cell the player is colliding with: mark it, do not hide it.
        this._remember(el, occupied);
        el.classList.add('blocked-by');
      } else {
        this._remember(el, occupied);
        el.classList.add('ghost-bad');
      }
    }

    if (valid && clears) {
      for (const r of clears.rows) {
        for (let c = 0; c < this.size; c++) {
          const el = this.cells[r * this.size + c];
          this._remember(el, el.dataset.c !== undefined);
          el.classList.add('will-clear');
        }
      }
      for (const c of clears.cols) {
        for (let r = 0; r < this.size; r++) {
          const el = this.cells[r * this.size + c];
          this._remember(el, el.dataset.c !== undefined);
          el.classList.add('will-clear');
        }
      }
    }
  }

  /** Record a cell's pre-preview state once, so it can be restored exactly. */
  _remember(el, hadColour) {
    if (this._touched.has(el)) return;
    this._touched.set(el, hadColour ? el.dataset.c : null);
  }

  clearPreview() {
    for (const [el, colour] of this._touched) {
      el.classList.remove('ghost', 'ghost-bad', 'will-clear', 'blocked-by');
      // Restore precisely: a cell that was empty must go back to empty, not
      // keep the colour the preview painted on it.
      if (colour === null) delete el.dataset.c;
      else el.dataset.c = colour;
    }
    this._touched.clear();
  }

  /**
   * Throw a few sparks off the cleared cells.
   *
   * Capped hard: this fires on every clear, and a particle per cell on a
   * multi-line clear would be dozens of elements for a 550ms effect.
   */
  sparks(indices, colour) {
    if (!indices || !indices.length) return;
    const wrap = this.el.parentElement;
    if (!wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    const picked = indices.length <= 8
      ? indices
      : indices.filter((_, i) => i % Math.ceil(indices.length / 8) === 0);

    for (const i of picked) {
      const cell = this.cells[i];
      if (!cell) continue;
      const b = cell.getBoundingClientRect();
      const cx = b.left + b.width / 2 - wrapRect.left;
      const cy = b.top + b.height / 2 - wrapRect.top;
      for (let k = 0; k < 3; k++) {
        const el = document.createElement('i');
        el.className = 'spark';
        const angle = Math.random() * Math.PI * 2;
        const dist = 18 + Math.random() * 26;
        el.style.left = `${cx}px`;
        el.style.top = `${cy}px`;
        el.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
        el.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
        if (colour) el.style.setProperty('--spark', colour);
        wrap.appendChild(el);
        setTimeout(() => el.remove(), 600);
      }
    }
  }

  /**
   * Run the clear animation, then hand back so the caller can repaint.
   *
   * Cells fire in reading order with a small stagger, so the line visibly
   * sweeps instead of blinking out all at once — the difference between the
   * clear feeling like an event and feeling like a repaint.
   */
  animateClear(indices) {
    return new Promise((resolve) => {
      if (!indices || indices.length === 0) { resolve(); return; }
      const ordered = [...indices].sort((a, b) => a - b);
      const step = Math.min(26, 220 / ordered.length);
      ordered.forEach((i, n) => {
        const el = this.cells[i];
        el.style.animationDelay = `${n * step}ms`;
        el.classList.add('clearing');
      });
      const total = 340 + ordered.length * step;
      setTimeout(() => {
        for (const i of ordered) {
          this.cells[i].classList.remove('clearing');
          this.cells[i].style.animationDelay = '';
        }
        resolve();
      }, total);
    });
  }

  /** Screen position of a cell's centre, for score popups. */
  cellCentre(index) {
    const el = this.cells[index];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const host = this.el.getBoundingClientRect();
    return { x: rect.left - host.left + rect.width / 2, y: rect.top - host.top + rect.height / 2 };
  }
}

/**
 * How big a tray block is, relative to a board cell.
 *
 * Every tray piece is drawn at the SAME cell size — never scaled to fill its
 * slot. Filling the slot is what breaks the player's sense of scale: a
 * single-cell block would be drawn larger than a five-cell bar, so nothing in
 * the tray tells you how much room a piece actually needs.
 */
export const TRAY_SCALE = 0.62;

/**
 * The cell size for a tray preview.
 *
 * Three slots across a phone screen leaves each one about 124px wide, and five
 * cells at the shared scale need roughly 150px. Rather than shrink every piece
 * to fit the longest one — which was the original bug, in a subtler form — only
 * the oversized piece is scaled down, and only as far as it has to be.
 *
 * So a 1-, 2- or 3-cell piece is always drawn at exactly TRAY_SCALE of a board
 * cell, which is what the eye actually calibrates against; the rare 4- and
 * 5-long bars sit slightly smaller. The alternative keeps a perfect ratio for
 * the bars and throws it away for everything else.
 */
export function trayCellSize(boardCell, slotEl, piece) {
  const wanted = boardCell * TRAY_SCALE;
  if (!slotEl || !slotEl.clientWidth || !piece) return wanted;

  const gap = Math.max(2, wanted * 0.09);
  const across = Math.max(piece.w, piece.h);
  const roomW = slotEl.clientWidth - 14;
  const roomH = slotEl.clientHeight - 14;
  const room = Math.min(roomW, roomH);

  const fits = (room - gap * (across - 1)) / across;
  return Math.max(7, Math.min(wanted, fits));
}

/** Draw the three tray slots. */
export function renderTray(slots, tray, fitsAnywhere, boardCell) {
  slots.forEach((slotEl, i) => {
    const piece = tray[i];
    slotEl.replaceChildren();
    slotEl.classList.toggle('empty', !piece);
    slotEl.classList.remove('dead');
    if (!piece) {
      slotEl.setAttribute('aria-disabled', 'true');
      return;
    }
    slotEl.removeAttribute('aria-disabled');
    if (!fitsAnywhere(piece)) slotEl.classList.add('dead');

    const px = trayCellSize(boardCell, slotEl, piece);
    const gap = Math.max(2, px * 0.09);

    const grid = document.createElement('div');
    grid.className = 'piece';
    grid.style.gridTemplateColumns = `repeat(${piece.w}, ${px}px)`;
    grid.style.gap = `${gap}px`;
    grid.style.setProperty('--pc', `${px}px`);
    grid.style.setProperty('--pr', `${Math.max(2, px * 0.24)}px`);

    const occupied = new Set(piece.cells.map(([r, c]) => `${r},${c}`));
    for (let r = 0; r < piece.h; r++) {
      for (let c = 0; c < piece.w; c++) {
        const i2 = document.createElement('i');
        if (occupied.has(`${r},${c}`)) i2.dataset.c = String(piece.colour + 1);
        else i2.className = 'gap';
        grid.appendChild(i2);
      }
    }
    slotEl.appendChild(grid);

    // A freshly dealt tray pops in, staggered, so a refill reads as an event
    // rather than the pieces silently changing.
    grid.style.animationDelay = `${i * 55}ms`;
    grid.classList.add('deal-in');
  });
}
