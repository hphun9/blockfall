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
    this._ghost = [];
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
  }

  /** Re-measure after a resize or a skin change. */
  refresh() {
    this._sizeCells();
  }

  /** Paint the board from the engine's cell array. */
  draw(cells, animateIdx = null) {
    for (let i = 0; i < this.cells.length; i++) {
      const el = this.cells[i];
      const value = cells[i];
      if (value) {
        if (el.dataset.c !== String(value)) el.dataset.c = String(value);
      } else if (el.dataset.c !== undefined) {
        delete el.dataset.c;
      }
      el.classList.remove('ghost', 'ghost-bad', 'will-clear');
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
   * `valid` false still paints something — silence would leave the player
   * guessing why the piece will not go down.
   */
  preview(piece, row, col, valid, clears) {
    this.clearPreview();
    if (!piece) return;

    for (const [dr, dc] of piece.cells) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= this.size || c >= this.size) continue;
      const el = this.cells[r * this.size + c];
      if (valid) {
        el.classList.add('ghost');
        el.dataset.c = String(piece.colour + 1);
        this._ghost.push(el);
      } else {
        el.classList.add('ghost-bad');
        this._ghost.push(el);
      }
    }

    if (valid && clears) {
      for (const r of clears.rows) {
        for (let c = 0; c < this.size; c++) {
          const el = this.cells[r * this.size + c];
          el.classList.add('will-clear');
          this._ghost.push(el);
        }
      }
      for (const c of clears.cols) {
        for (let r = 0; r < this.size; r++) {
          const el = this.cells[r * this.size + c];
          el.classList.add('will-clear');
          this._ghost.push(el);
        }
      }
    }
  }

  clearPreview() {
    for (const el of this._ghost) {
      el.classList.remove('ghost', 'ghost-bad', 'will-clear');
    }
    this._ghost = [];
  }

  /** Run the clear animation, then hand back so the caller can repaint. */
  animateClear(indices) {
    return new Promise((resolve) => {
      if (!indices || indices.length === 0) { resolve(); return; }
      for (const i of indices) this.cells[i].classList.add('clearing');
      setTimeout(() => {
        for (const i of indices) this.cells[i].classList.remove('clearing');
        resolve();
      }, 260);
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

/** Draw the three tray slots. */
export function renderTray(slots, tray, fitsAnywhere) {
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

    // Size the preview to the slot rather than to a fixed number, so a block
    // fills the space it is given on a large phone instead of floating in the
    // middle of it — and so the 5-long bar still fits on a small one.
    const box = Math.max(piece.w, piece.h);
    const avail = Math.max(48, Math.min(slotEl.clientWidth, slotEl.clientHeight) - 22);
    const gap = 3;
    const px = Math.max(9, Math.floor((avail - gap * (box - 1)) / box));

    const grid = document.createElement('div');
    grid.className = 'piece';
    grid.style.gridTemplateColumns = `repeat(${piece.w}, ${px}px)`;
    grid.style.setProperty('--pc', `${px}px`);
    grid.style.setProperty('--pr', `${Math.max(3, Math.round(px * 0.24))}px`);

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
  });
}
