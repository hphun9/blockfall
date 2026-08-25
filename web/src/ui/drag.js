/**
 * Dragging a block from the tray onto the board.
 *
 * Pointer Events throughout, so mouse, touch and stylus take one code path
 * instead of three. `setPointerCapture` keeps the gesture alive even when the
 * finger leaves the element it started on — without it a drag dies the moment
 * the block crosses the tray's edge, which is every drag.
 *
 * The one real design decision here is the grab offset. Naively the piece
 * centres on the finger, which puts the finger on top of the very cells the
 * player is trying to aim at. Instead the piece is lifted above the touch
 * point on a touchscreen (`LIFT`), the way a good mobile puzzle does it, so
 * the landing zone stays visible while dragging.
 */

/**
 * How far the dragged piece floats above the pointer.
 *
 * On touch the finger covers the target, so the piece is lifted clear of it.
 * On a mouse the cursor is a point and hides nothing — but the piece still
 * needs *some* lift, because a piece dropped low in the window otherwise
 * overhangs the footer controls and buries the mode switch and the help
 * button under a floating block.
 */
const LIFT_TOUCH = 52;
const LIFT_MOUSE = 18;

export class DragController {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.layer   fixed overlay the floating piece lives in
   * @param {HTMLElement} opts.board   the grid element, for hit-testing
   * @param {() => number} opts.getSize board size in cells
   * @param {(slot:number) => object|null} opts.getPiece
   * @param {(slot:number, row:number, col:number) => void} opts.onDrop
   * @param {(slot:number, row:number, col:number) => void} opts.onHover
   * @param {() => void} opts.onCancel
   */
  constructor(opts) {
    this.opts = opts;
    this.active = null;
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
  }

  /** Wire a tray slot. Called once per slot element. */
  attach(slotEl, slotIndex) {
    slotEl.addEventListener('pointerdown', (event) => this._start(event, slotEl, slotIndex));
  }

  _start(event, slotEl, slotIndex) {
    if (this.active) return;
    const piece = this.opts.getPiece(slotIndex);
    if (!piece) return;

    event.preventDefault();
    slotEl.setPointerCapture?.(event.pointerId);

    const cell = this._cellSize();
    const gap = this._gap();
    const touch = event.pointerType !== 'mouse';

    const ghost = document.createElement('div');
    ghost.className = 'drag-piece';
    ghost.style.setProperty('--dgap', `${gap}px`);
    ghost.style.gridTemplateColumns = `repeat(${piece.w}, ${cell}px)`;
    ghost.style.gridTemplateRows = `repeat(${piece.h}, ${cell}px)`;

    // The tray draws the long bars a little smaller than TRAY_SCALE so they
    // fit their slot; reading the real size keeps the lift continuous instead
    // of starting those pieces at the wrong scale and jumping.
    const trayCell = this.opts.trayCellFor?.(slotIndex, slotEl) ?? cell * 0.62;

    const occupied = new Set(piece.cells.map(([r, c]) => `${r},${c}`));
    for (let r = 0; r < piece.h; r++) {
      for (let c = 0; c < piece.w; c++) {
        const i = document.createElement('i');
        if (occupied.has(`${r},${c}`)) {
          i.dataset.c = String(piece.colour + 1);
        } else {
          i.className = 'gap';
        }
        i.style.width = `${cell}px`;
        i.style.height = `${cell}px`;
        ghost.appendChild(i);
      }
    }

    this.opts.layer.appendChild(ghost);

    // Animate the lift explicitly rather than relying on a class change and a
    // forced reflow: the CSS route depends on the browser committing the start
    // style in its own frame, and when it does not, the piece silently appears
    // at full size with no lift at all. WebAnimations has no such ambiguity.
    const fromScale = Math.min(1, trayCell / cell);
    ghost.style.transition = 'none';
    ghost.animate(
      [
        { transform: `translate(-50%, -50%) scale(${fromScale})` },
        { transform: 'translate(-50%, -50%) scale(1)' },
      ],
      { duration: 150, easing: 'cubic-bezier(.2, 1.2, .4, 1)', fill: 'backwards' }
    );
    slotEl.classList.add('dragging');

    this.active = {
      slotIndex,
      slotEl,
      piece,
      ghost,
      pointerId: event.pointerId,
      lift: touch ? LIFT_TOUCH : LIFT_MOUSE,
      cell,
      gap,
      lastCell: null,
    };

    globalThis.addEventListener('pointermove', this._onMove, { passive: false });
    globalThis.addEventListener('pointerup', this._onUp);
    globalThis.addEventListener('pointercancel', this._onUp);

    this._onMove(event);
  }

  /**
   * The lowest the floating piece's bottom edge may reach.
   *
   * Measured from the footer rather than hard-coded, so it stays correct on any
   * screen height. Returns null when there is no footer to protect.
   */
  _dragFloor() {
    const foot = document.querySelector('.foot');
    if (!foot) return null;
    const r = foot.getBoundingClientRect();
    if (!r.height) return null;
    return r.top - 6;
  }

  _onMove(event) {
    const a = this.active;
    if (!a || event.pointerId !== a.pointerId) return;
    event.preventDefault();

    const x = event.clientX;
    let y = event.clientY - a.lift;

    // Keep the floating piece out of the footer.
    //
    // Without this the piece follows the pointer all the way down and sits on
    // top of the mode switch and the help button — they look "sticky", because
    // a block is physically covering them. The piece is anchored at its centre,
    // so clamping its centre keeps its bottom edge above the controls while the
    // drop target itself is unaffected: the board is above this line anyway.
    const floor = this._dragFloor();
    if (floor != null) {
      const half = (a.piece.h * a.cell + (a.piece.h - 1) * a.gap) / 2;
      y = Math.min(y, floor - half);
    }

    a.ghost.style.left = `${x}px`;
    a.ghost.style.top = `${y}px`;

    const target = this._hitTest(x, y, a.piece, a.cell, a.gap);
    const key = target ? `${target.row},${target.col}` : null;
    if (key !== a.lastCell) {
      a.lastCell = key;
      if (target) this.opts.onHover(a.slotIndex, target.row, target.col);
      else this.opts.onCancel();
    }
  }

  _onUp(event) {
    const a = this.active;
    if (!a || event.pointerId !== a.pointerId) return;

    const x = event.clientX;
    const y = event.clientY - a.lift;
    const target = this._hitTest(x, y, a.piece, a.cell, a.gap);

    this._end();
    if (target) this.opts.onDrop(a.slotIndex, target.row, target.col);
    else this.opts.onCancel();
  }

  _end() {
    const a = this.active;
    if (!a) return;
    a.ghost.remove();
    a.slotEl.classList.remove('dragging');
    globalThis.removeEventListener('pointermove', this._onMove);
    globalThis.removeEventListener('pointerup', this._onUp);
    globalThis.removeEventListener('pointercancel', this._onUp);
    this.active = null;
  }

  /** Abort any drag in progress — used when a run ends mid-gesture. */
  cancel() {
    if (this.active) {
      this._end();
      this.opts.onCancel();
    }
  }

  _cellSize() {
    const board = this.opts.board;
    const n = this.opts.getSize();
    const pad = parseFloat(getComputedStyle(board).paddingLeft) || 0;
    const gap = this._gap();
    return (board.clientWidth - pad * 2 - gap * (n - 1)) / n;
  }

  _gap() {
    return parseFloat(getComputedStyle(this.opts.board).gap) || 0;
  }

  /**
   * Which board cell should the piece's top-left corner sit in?
   *
   * The pointer is treated as being over the middle of the piece, so the
   * anchor is offset by half the piece's extent. Rounding rather than
   * flooring means the piece snaps to the nearest cell instead of always the
   * one up-and-left, which is what makes placement feel accurate.
   */
  _hitTest(x, y, piece, cell, gap) {
    const board = this.opts.board;
    const n = this.opts.getSize();
    const rect = board.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(board).paddingLeft) || 0;

    const step = cell + gap;
    const originX = rect.left + pad + cell / 2;
    const originY = rect.top + pad + cell / 2;

    const col = Math.round((x - originX - ((piece.w - 1) * step) / 2) / step);
    const row = Math.round((y - originY - ((piece.h - 1) * step) / 2) / step);

    if (row < 0 || col < 0 || row + piece.h > n || col + piece.w > n) return null;

    // Reject a drop that is nowhere near the board at all, so releasing off to
    // the side cancels instead of snapping to an edge the player never aimed at.
    const slack = step * 1.6;
    if (x < rect.left - slack || x > rect.right + slack) return null;
    if (y < rect.top - slack || y > rect.bottom + slack) return null;

    return { row, col };
  }
}
