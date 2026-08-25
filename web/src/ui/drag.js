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

    // Two nested elements on purpose: the outer one is moved by the pointer,
    // the inner one carries the grid and the lift scale. Keeping the two
    // transforms on separate elements is what lets both run at once.
    const ghost = document.createElement('div');
    ghost.className = 'drag-piece';

    const inner = document.createElement('div');
    inner.className = 'drag-piece-inner';
    inner.style.setProperty('--dgap', `${gap}px`);
    inner.style.gridTemplateColumns = `repeat(${piece.w}, ${cell}px)`;
    inner.style.gridTemplateRows = `repeat(${piece.h}, ${cell}px)`;
    ghost.appendChild(inner);

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
        inner.appendChild(i);
      }
    }

    this.opts.layer.appendChild(ghost);

    // The lift scales an INNER wrapper, not the ghost itself.
    //
    // The ghost's own transform is owned by _onMove (translate3d follows the
    // pointer). Animating transform on the same element would fight that: for
    // the 150ms of the lift the animation wins and the piece sits wherever the
    // keyframes put it instead of under the finger.
    const fromScale = Math.min(1, trayCell / cell);
    ghost.style.transition = 'none';
    inner.animate(
      [{ transform: `scale(${fromScale})` }, { transform: 'scale(1)' }],
      { duration: 150, easing: 'cubic-bezier(.2, 1.2, .4, 1)', fill: 'backwards' }
    );
    slotEl.classList.add('dragging');

    const floor = this._dragFloor();
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
      // Measured once here rather than on every move: see _measureBoard.
      metrics: this._measureBoard(cell, gap),
      floor,
      halfHeight: (piece.h * cell + (piece.h - 1) * gap) / 2,
      frame: null,
      wantX: 0,
      wantY: 0,
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

  /**
   * Measure the board once per drag.
   *
   * _hitTest used to call getBoundingClientRect() and getComputedStyle() on
   * every pointermove. Both force style/layout work, and on a phone that is
   * the difference between a piece that glides and one that stutters. Nothing
   * here can change mid-drag except through a resize, which cancels the drag.
   */
  _measureBoard(cell, gap) {
    const board = this.opts.board;
    const rect = board.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(board).paddingLeft) || 0;
    const step = cell + gap;
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      step,
      originX: rect.left + pad + cell / 2,
      originY: rect.top + pad + cell / 2,
      n: this.opts.getSize(),
    };
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
    if (a.floor != null) {
      y = Math.min(y, a.floor - a.halfHeight);
    }

    a.wantX = x;
    a.wantY = y;

    // Coalesce to one write per frame. Pointer events fire faster than the
    // screen refreshes — on a 120Hz phone with a high-rate digitiser there can
    // be several per frame — and writing style on each one is wasted work that
    // shows up as jitter.
    if (a.frame == null) {
      a.frame = requestAnimationFrame(() => {
        a.frame = null;
        const cur = this.active;
        if (!cur) return;
        // translate3d rather than left/top: the former is a compositor-only
        // change, the latter re-runs layout for the whole page every frame.
        cur.ghost.style.transform =
          `translate3d(${cur.wantX}px, ${cur.wantY}px, 0) translate(-50%, -50%)`;
      });
    }

    const target = this._hitTest(x, y, a.piece, a.metrics);
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
    const target = this._hitTest(x, y, a.piece, a.metrics);

    this._end();
    if (target) this.opts.onDrop(a.slotIndex, target.row, target.col);
    else this.opts.onCancel();
  }

  _end() {
    const a = this.active;
    if (!a) return;
    // Drop any frame still queued, or it fires after the ghost is gone.
    if (a.frame != null) cancelAnimationFrame(a.frame);
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
  _hitTest(x, y, piece, m) {
    if (!m) return null;
    const { step, originX, originY, n } = m;

    const col = Math.round((x - originX - ((piece.w - 1) * step) / 2) / step);
    const row = Math.round((y - originY - ((piece.h - 1) * step) / 2) / step);

    if (row < 0 || col < 0 || row + piece.h > n || col + piece.w > n) return null;

    // Reject a drop that is nowhere near the board at all, so releasing off to
    // the side cancels instead of snapping to an edge the player never aimed at.
    const slack = step * 1.6;
    if (x < m.left - slack || x > m.right + slack) return null;
    if (y < m.top - slack || y > m.bottom + slack) return null;

    return { row, col };
  }
}
