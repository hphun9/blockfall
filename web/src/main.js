/**
 * Wiring: engine, storage, and the DOM.
 *
 * The engine never touches the page and the page never implements a rule —
 * everything here is translation between the two. That split is what let the
 * rules be covered by 27 headless tests.
 */

import { Game, SIZE } from './core/engine.js';
import { dailySeed, randomSeed, utcDateKey } from './core/rng.js';
import { Storage } from './core/storage.js';
import { I18n, detectLocale, SUPPORTED } from './i18n.js';
import { TIERS, tierFor, nextTier, tierProgress } from './core/goals.js';
import { SKINS, SKIN_NAMES } from './skins.gen.js';
import { BoardView, renderTray, trayCellSize } from './ui/board.js';
import { DragController } from './ui/drag.js';
import { Sound } from './ui/sound.js';

const $ = (sel) => document.querySelector(sel);



class App {
  constructor() {
    this.store = new Storage();
    this.settings = this.store.loadSettings();
    this.i18n = new I18n(this.settings.locale ?? detectLocale());

    this.el = {
      board: $('#board'),
      tray: $('#tray'),
      slots: [...document.querySelectorAll('.slot')],
      score: $('#score'),
      best: $('#best'),
      lines: $('#lines'),
      undo: $('#btn-undo'),
      newGame: $('#btn-new'),
      settings: $('#btn-settings'),
      howto: $('#btn-howto'),
      modeClassic: $('#mode-classic'),
      modeDaily: $('#mode-daily'),
      dragLayer: $('#drag-layer'),
      toasts: $('#toasts'),
      boardWrap: document.querySelector('.board-wrap'),
      replayCta: $('#replay-cta'),
      replay: $('#btn-replay'),
      goalName: $('#goal-name'),
      goalNum: $('#goal-num'),
      goalFill: $('#goal-fill'),
      goalPips: $('#goal-pips'),
    };

    this.view = new BoardView(this.el.board);
    this.sound = new Sound(this.settings.sound !== false);
    this.mode = this.settings.mode === 'daily' ? 'daily' : 'classic';
    this.dateKey = utcDateKey();
    this.busy = false;

    this.applySkin(this.settings.skin);
    this.applyLocale(this.i18n.locale);

    this.view.mount(SIZE);
    this.store.pruneDailies(this.dateKey);
    this.game = this.restoreOrCreate();

    this.drag = new DragController({
      layer: this.el.dragLayer,
      board: this.el.board,
      getSize: () => this.game.size,
      getPiece: (slot) => this.game.tray[slot],
      trayCellFor: (slot, slotEl) =>
        trayCellSize(this.view.metrics().cell, slotEl, this.game.tray[slot]),
      onDrop: (slot, row, col) => this.handleDrop(slot, row, col),
      onHover: (slot, row, col) => this.handleHover(slot, row, col),
      onCancel: () => this.view.clearPreview(),
    });
    this.el.slots.forEach((slotEl, i) => this.drag.attach(slotEl, i));

    this.bind();
    this.render();

    // The tray previews are measured from their slot, and on first paint the
    // slots have not been laid out yet — so measure again once they have.
    requestAnimationFrame(() => {
      // The board size must be set before anything measures against it: the
      // tray scales its previews from a board cell, so a stale board here
      // means a tray drawn at the wrong scale.
      this.measureBoard();
      this.view.refresh();
      this.view.draw(this.game.cells);
      this.drawTray();
    });

    // A resize changes the cell geometry the drag maths depends on, and the
    // tray previews are sized from their slot, so both must be redrawn.
    globalThis.addEventListener('resize', () => {
      // Re-measure first: rotating the phone changes how much height the
      // fixed furniture leaves for the board.
      this.measureBoard();
      this.view.refresh();
      this.drawTray();
    });
    // A new UTC day while the tab sits open must not leave a stale daily board.
    globalThis.addEventListener('focus', () => this.checkDateRollover());
  }

  // ------------------------------------------------------------ lifecycle

  restoreOrCreate() {
    const saved = this.store.loadGame(this.mode, this.dateKey);
    if (saved) {
      const game = Game.fromJSON(saved);
      if (game && !game.over) return game;
      if (game && game.over && this.mode === 'daily') return game;
    }
    return this.freshGame();
  }

  freshGame() {
    const seed = this.mode === 'daily' ? dailySeed(this.dateKey) : randomSeed();
    return new Game({ seed, mode: this.mode });
  }

  newGame() {
    if (this.mode === 'daily' && this.game?.over) {
      this.toast(this.i18n.t('toast.dailyDone'));
      return;
    }
    this.store.clearGame(this.mode, this.dateKey);
    this.game = this.freshGame();
    this.view.clearPreview();
    this.render();
    this.toast(this.i18n.t('toast.newGame'));
  }

  checkDateRollover() {
    const today = utcDateKey();
    if (today === this.dateKey) return;
    this.dateKey = today;
    this.store.pruneDailies(today);
    if (this.mode === 'daily') {
      this.game = this.restoreOrCreate();
      this.render();
    }
  }

  save() {
    this.store.saveGame(this.mode, this.dateKey, this.game.toJSON());
  }

  // --------------------------------------------------------------- input

  bind() {
    this.el.newGame.addEventListener('click', () => this.newGame());
    this.el.replay.addEventListener('click', () => this.newGame());
    this.el.undo.addEventListener('click', () => this.undo());
    this.el.settings.addEventListener('click', () => this.openSettings());
    this.el.howto.addEventListener('click', () => this.openHowTo());
    this.el.modeClassic.addEventListener('click', () => this.setMode('classic'));
    this.el.modeDaily.addEventListener('click', () => this.setMode('daily'));

    globalThis.addEventListener('keydown', (e) => {
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.undo(); }
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey) this.newGame();
    });
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.save();
    this.mode = mode;
    this.settings.mode = mode;
    this.store.saveSettings(this.settings);
    this.game = this.restoreOrCreate();
    this.view.clearPreview();
    this.render();
  }

  handleHover(slot, row, col) {
    if (this.busy || this.game.over) return;
    const piece = this.game.tray[slot];
    if (!piece) return;
    const valid = this.game.fits(piece, row, col);
    const clears = valid ? this.game.previewClears(piece, row, col) : null;
    this.view.preview(piece, row, col, valid, clears);
  }

  async handleDrop(slot, row, col) {
    this.view.clearPreview();
    if (this.busy || this.game.over) return;

    // Snapshot the colours before placing: the engine empties cleared cells
    // immediately, and the clear animation needs something to fade out.
    const piece = this.game.tray[slot];
    const beforeCells = this.game.cells.slice();

    const result = this.game.place(slot, row, col);
    if (!result) return;

    this.busy = true;

    if (result.cleared.length > 0) {
      // Paint the board as it looked with the piece down but before the clear.
      const withPiece = beforeCells.slice();
      for (const i of result.placed) withPiece[i] = piece.colour + 1;
      this.view.draw(withPiece, result.placed);
      // Start the celebration alongside the clear rather than after it, so the
      // board is already glowing while the last cells collapse.
      if (result.perfect) {
        this.el.board.classList.add('perfect');
        this.sound.perfect();
      } else {
        this.sound.clear(result.rows.length + result.cols.length, result.combo);
      }
      this.bumpScore();
      this.updateHud();
      this.popScore(result);
      // Sparks in the colour of the piece that caused the clear, so the
      // celebration is visibly connected to the move the player just made.
      this.view.sparks(result.cleared, this._pieceColour(piece));
      // A streak of clears is the most exciting thing in normal play, and it
      // used to be visible only as a small multiplier in the score pop.
      if (result.combo >= 2) this.showCombo(result.combo);
      // The stamped word, and a toast for a near sweep — the achievement that
      // is actually reachable (a true sweep is close to impossible here).
      this.showPow(result);
      if (result.nearSweep) this.toast(this.i18n.t('toast.near'));
      await this.view.animateClear(result.cleared);
    } else {
      this.view.draw(this.game.cells, result.placed);
      this.sound.drop();
      this.bumpScore();
    }

    this.view.draw(this.game.cells);
    this.drawTray();
    this.updateHud();
    this.save();
    this.busy = false;

    // Sweeping the board is rare enough to deserve marking. Rotating the skin
    // is the reward: the game visibly changes around the player, which keeps a
    // long session from looking the same all the way through — and it costs
    // nothing, because the skins already exist.
    if (result.perfect) await this.celebratePerfect();

    // Crossing a tier is the moment the run stops being an open-ended slide
    // and becomes something you are visibly winning at, so it gets its own
    // beat rather than passing silently inside the score.
    if (result.tierUp) this.celebrateTier(result.tierUp);

    if (this.game.over) this.finish();
  }

  /**
   * A goal tier fell.
   *
   * Deliberately lighter than the perfect-clear celebration: this happens up
   * to five times a run, so it marks the moment without interrupting play.
   */
  celebrateTier(tier) {
    const t = (k, v) => this.i18n.t(k, v);
    const info = TIERS.find((x) => x.id === tier);
    const last = tier === TIERS[TIERS.length - 1].id;

    this.toast(last ? t('tier.final') : t('tier.reached', { name: t(info.key) }));
    this.sound.tier(tier);

    const bar = document.querySelector('.goal');
    if (bar) {
      bar.classList.remove('tier-up');
      void bar.offsetWidth;
      bar.classList.add('tier-up');
      setTimeout(() => bar.classList.remove('tier-up'), 900);
    }
  }

  /**
   * Board swept clean: rotate to the next skin.
   *
   * The glow and the sound already started back in handleDrop, alongside the
   * clear itself; this finishes the moment by changing the palette.
   *
   * The rotation is deliberate rather than random — a random pick can hand
   * back the skin you already had, which makes the reward look broken.
   */
  async celebratePerfect() {
    this.toast(this.i18n.t('toast.perfect'));

    const current = SKINS.indexOf(this.settings.skin);
    const next = SKINS[(current + 1) % SKINS.length];

    await new Promise((r) => setTimeout(r, 260));
    this.applySkin(next);
    this.settings.skin = next;
    this.store.saveSettings(this.settings);
    this.view.refresh();
    this.view.draw(this.game.cells);
    this.drawTray();

    setTimeout(() => this.el.board.classList.remove('perfect'), 1200);
  }

  undo() {
    if (this.busy) return;
    if (!this.game.canUndo()) {
      this.toast(this.i18n.t('toast.noUndo'));
      return;
    }
    this.game.undo();
    this.view.clearPreview();
    this.render();
    this.save();
    this.toast(this.i18n.t('toast.undo'));
  }

  // -------------------------------------------------------------- render

  /**
   * Redraw the tray at the board's scale.
   *
   * Goes through one place so the tray can never be drawn without the board
   * metric — that mismatch is exactly what made the previews the wrong size.
   */
  drawTray() {
    renderTray(
      this.el.slots,
      this.game.tray,
      (p) => this.game.fitsAnywhere(p),
      this.view.metrics().cell
    );
  }

  /**
   * Switch the board between playable and finished.
   *
   * One place owns both halves — the greyed-out board and the replay banner —
   * so they can never disagree. They did once: the board stayed dimmed while
   * nothing on screen offered a way to start again.
   */
  setGameOverUi(over) {
    this.el.board.classList.toggle('game-over', over);
    this.el.replayCta.hidden = !over;
  }

  /**
   * Publish how much vertical space everything OTHER than the board uses.
   *
   * The board is square and sized from its width, so it needs a height cap or
   * a short screen squashes it. That cap cannot come from its parent (parent
   * and board would size each other in a loop, which Chrome resolves to a
   * 12x12 board), and it cannot be a fixed percentage either: the header,
   * stats, goal bar, tray and footer are roughly constant in pixels, so they
   * eat 45% of a 667px phone and only 33% of a 915px one.
   */
  /**
   * Work out how big the board can be, and set it in pixels.
   *
   * Done here rather than in CSS because the CSS-only versions relied on how a
   * browser resolves aspect-ratio inside a flex column, and browsers disagree:
   * rules that gave square cells in Chrome stretched the board vertically in
   * Safari on iOS until it covered the tray and the game became unplayable.
   * One measured number applied to both axes cannot differ by engine.
   */
  measureBoard() {
    const app = document.querySelector('.app');
    const wrap = this.el.boardWrap;
    if (!app || !wrap) return;

    // Two passes.
    //
    // The wrapper shrinks to fit the board, so its height is downstream of the
    // answer we are trying to compute — measuring against it means measuring
    // against the PREVIOUS board size, and the two then chase each other. On a
    // 500px screen that left the board 8px taller than its row, covering the
    // tray so the game could not be played at all.
    //
    // Collapsing the wrapper to zero first makes the leftover height a real
    // measurement of everything else, with nothing circular in it. The second
    // pass applies the result.
    const previous = wrap.style.height;
    wrap.style.height = '0px';

    const style = getComputedStyle(app);
    const gap = parseFloat(style.rowGap) || 0;

    let used = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    let items = 0;
    for (const child of app.children) {
      items++;
      if (child === wrap) continue;
      used += child.getBoundingClientRect().height;
    }
    used += gap * Math.max(0, items - 1);

    // The app box rather than the viewport: on iOS the visible area is shorter
    // than window.innerHeight while the address bar is showing, and sizing to
    // the viewport is what pushed the board over the tray there.
    const appBox = app.getBoundingClientRect();
    const availableHeight = appBox.height - used;

    const innerWidth = appBox.width
      - parseFloat(style.paddingLeft)
      - parseFloat(style.paddingRight);

    // Square: the smaller of the two, floored so a fractional pixel cannot
    // round upward into an overlap.
    const size = Math.floor(Math.min(innerWidth, availableHeight) - 2);
    if (!Number.isFinite(size) || size < 80) {
      wrap.style.height = previous;
      return;
    }

    document.documentElement.style.setProperty('--board-size', `${size}px`);
    wrap.style.height = `${size}px`;
  }

  render() {
    this.view.mount(this.game.size);
    this.setGameOverUi(this.game.over);
    this.view.draw(this.game.cells);
    this.drawTray();
    this.updateHud();
    this.el.modeClassic.setAttribute('aria-pressed', String(this.mode === 'classic'));
    this.el.modeDaily.setAttribute('aria-pressed', String(this.mode === 'daily'));
    if (this.game.over) this.finish();
  }

  updateHud() {
    const stats = this.store.loadStats();
    this.el.score.textContent = String(this.game.score);
    this.el.best.textContent = String(Math.max(stats.best, this.game.score));
    this.el.lines.textContent = String(this.game.lines);
    this.el.undo.disabled = !this.game.canUndo();
    this.updateGoal();
  }

  /**
   * Redraw the goal bar.
   *
   * Shows the tier being worked toward and how close it is, plus a pip per
   * tier so the whole ladder is visible at once — knowing there are five rungs
   * and you are on the third is the part that makes a run feel winnable.
   */
  updateGoal() {
    const t = (k, v) => this.i18n.t(k, v);
    const score = this.game.score;
    const next = nextTier(score);
    const done = tierFor(score);

    if (next) {
      this.el.goalName.textContent = t(next.key);
      this.el.goalNum.textContent = `${score} / ${next.score}`;
      this.el.goalFill.style.width = `${Math.round(tierProgress(score) * 100)}%`;
    } else {
      // Past the last rung the bar stops being a target and becomes a badge.
      this.el.goalName.textContent = t('tier.done');
      this.el.goalNum.textContent = String(score);
      this.el.goalFill.style.width = '100%';
    }

    // Pips are rebuilt only when the count of lit ones changes, so the CSS
    // transition on each pip actually gets to run instead of being reset.
    if (this._pipsLit !== done) {
      this._pipsLit = done;
      this.el.goalPips.replaceChildren(...TIERS.map((tier) => {
        const pip = document.createElement('i');
        pip.className = 'goal-pip' + (score >= tier.score ? ' on' : '');
        pip.title = `${this.i18n.t(tier.key)} · ${tier.score}`;
        return pip;
      }));
    }
  }

  bumpScore() {
    const el = this.el.score;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  /**
   * The palette colour a piece is drawn in, read from the live stylesheet.
   *
   * Read rather than duplicated in JS: the colours live in skins.json and are
   * compiled into CSS, so any copy kept here would be a second source of truth
   * that silently goes stale the moment a skin changes.
   */
  _pieceColour(piece) {
    if (!piece) return null;
    const probe = this.el.board.querySelector(`.cell[data-c='${piece.colour + 1}']`);
    if (!probe) return null;
    const value = getComputedStyle(probe).getPropertyValue('--to').trim();
    return value || null;
  }

  /**
   * The stamped word that lands on a big clear.
   *
   * Reserved for moments that deserve it — two or more lines, a near sweep, a
   * full sweep. Firing on every single clear would make it wallpaper, and the
   * whole point is that it marks something out of the ordinary.
   */
  showPow(result) {
    const lines = result.rows.length + result.cols.length;
    let key = null;
    if (result.perfect) key = 'pow.perfect';
    else if (result.nearSweep) key = 'pow.near';
    else if (lines >= 4) key = 'pow.4';
    else if (lines === 3) key = 'pow.3';
    else if (lines === 2) key = 'pow.2';
    if (!key) return;

    const wrap = this.el.boardWrap;
    const ring = document.createElement('div');
    ring.className = 'pow-ring';
    wrap.appendChild(ring);
    setTimeout(() => ring.remove(), 700);

    const el = document.createElement('div');
    el.className = 'pow';
    el.textContent = this.i18n.t(key);
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 1100);

    // The board takes the hit too, so the word feels like an impact rather
    // than a label drawn on top of a calm grid.
    this.el.board.classList.add('pow-hit');
    setTimeout(() => this.el.board.classList.remove('pow-hit'), 420);
  }

  /**
   * Announce a combo over the board.
   *
   * Only from x2 up: a "combo" on every single clear would make the word
   * meaningless and the animation constant.
   */
  showCombo(combo) {
    const el = document.createElement('div');
    el.className = 'combo-banner';
    el.textContent = this.i18n.t('combo.banner', { n: combo });
    this.el.boardWrap.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  popScore(result) {
    const first = result.cleared[0];
    const at = this.view.cellCentre(first);
    if (!at) return;
    const pop = document.createElement('div');
    pop.className = 'pop';
    const lineCount = result.rows.length + result.cols.length;
    // A bigger clear gets bigger type: the reward should look different, not
    // just say a larger number in the same voice.
    if (lineCount >= 2) pop.classList.add('big');
    const label = lineCount >= 4 ? 'clear.quad'
      : lineCount === 3 ? 'clear.triple'
      : lineCount === 2 ? 'clear.double'
      : 'clear.single';
    pop.textContent = `+${result.gained}  ${this.i18n.t(label)}`;
    pop.style.left = `${at.x}px`;
    pop.style.top = `${at.y}px`;
    this.el.boardWrap.appendChild(pop);
    setTimeout(() => pop.remove(), 850);
  }

  toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.el.toasts.appendChild(el);
    setTimeout(() => el.remove(), 1900);
  }

  // --------------------------------------------------------------- sheets

  /**
   * The run is over.
   *
   * Deliberately unhurried: the sheet does not appear the instant the last
   * piece lands. The player needs a moment to see the board that beat them,
   * and the tray is marked first so it is obvious WHY it ended — three pieces
   * with nowhere to go, rather than a dialog appearing out of nowhere.
   */
  async finish() {
    this.drag.cancel();
    if (this._finishing) return;
    this._finishing = true;

    // Every remaining piece is unplayable by definition; say so on the tray.
    for (const slotEl of this.el.slots) {
      if (!slotEl.classList.contains('empty')) slotEl.classList.add('dead');
    }
    this.el.board.classList.add('game-over');
    this.el.replayCta.hidden = false;
    this.sound.over();

    const { isBest } = this.store.recordRun({
      score: this.game.score,
      lines: this.game.lines,
      drops: this.game.drops,
      bestCombo: this.game.bestCombo,
      mode: this.mode,
      dateKey: this.dateKey,
    });
    this.save();
    this.updateHud();

    await new Promise((r) => setTimeout(r, 900));
    this.openSheet(this.buildOverSheet(isBest));
    this._finishing = false;
  }

  buildOverSheet(isBest) {
    const t = (k, v) => this.i18n.t(k, v);
    const reached = tierFor(this.game.score);
    const tierInfo = TIERS.find((x) => x.id === reached);
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <h2>${t('over.title')}${isBest ? `<span class="badge-new">${t('over.newBest')}</span>` : ''}</h2>
      <p>${t('over.why')}</p>
      <p class="over-tier">${reached ? t('over.tierGot', { name: t(tierInfo.key) }) : t('over.tierNone')}</p>
      <div class="final">
        <div><div class="k">${t('hud.score')}</div><div class="v">${this.game.score}</div></div>
        <div><div class="k">${t('hud.lines')}</div><div class="v">${this.game.lines}</div></div>
        <div><div class="k">${t('hud.combo')}</div><div class="v">${this.game.bestCombo}</div></div>
      </div>
      <button class="btn" data-act="again">${t('btn.playAgain')}</button>
      <button class="btn ghost" data-act="close">${t('btn.close')}</button>
    `;
    wrap.querySelector('[data-act="again"]').addEventListener('click', () => {
      this.closeSheet();
      this.newGame();
    });
    wrap.querySelector('[data-act="close"]').addEventListener('click', () => this.closeSheet());
    return wrap;
  }

  openSettings() {
    const t = (k) => this.i18n.t(k);
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <h2>${t('settings.title')}</h2>
      <div class="sheet-row">
        <span>${t('settings.skin')}</span>
        <div class="chips" data-group="skin"></div>
      </div>
      <div class="sheet-row">
        <span>${t('settings.language')}</span>
        <div class="chips" data-group="locale"></div>
      </div>
      <div class="sheet-row">
        <span>${t('settings.sound')}</span>
        <div class="chips" data-group="sound"></div>
      </div>
      <p style="margin-top:14px">${t('settings.privacy')}</p>
      <button class="btn" data-act="close">${t('btn.close')}</button>
    `;

    const skinBox = wrap.querySelector('[data-group="skin"]');
    for (const id of SKINS) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = SKIN_NAMES[id][this.i18n.locale] ?? id;
      b.setAttribute('aria-pressed', String(this.settings.skin === id));
      b.addEventListener('click', () => {
        this.applySkin(id);
        this.settings.skin = id;
        this.store.saveSettings(this.settings);
        for (const other of skinBox.children) other.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
        this.view.refresh();
        this.view.draw(this.game.cells);
      });
      skinBox.appendChild(b);
    }

    const localeBox = wrap.querySelector('[data-group="locale"]');
    for (const code of SUPPORTED) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = code === 'vi' ? 'Tiếng Việt' : 'English';
      b.setAttribute('aria-pressed', String(this.i18n.locale === code));
      b.addEventListener('click', () => {
        this.applyLocale(code);
        this.settings.locale = code;
        this.store.saveSettings(this.settings);
        this.closeSheet();
        this.openSettings();
      });
      localeBox.appendChild(b);
    }

    const soundBox = wrap.querySelector('[data-group="sound"]');
    for (const on of [true, false]) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = this.i18n.t(on ? 'settings.on' : 'settings.off');
      b.setAttribute('aria-pressed', String((this.settings.sound !== false) === on));
      b.addEventListener('click', () => {
        this.settings.sound = on;
        this.sound.setEnabled(on);
        this.store.saveSettings(this.settings);
        for (const other of soundBox.children) other.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
        if (on) this.sound.drop(); // let the player hear what they just enabled
      });
      soundBox.appendChild(b);
    }

    wrap.querySelector('[data-act="close"]').addEventListener('click', () => this.closeSheet());
    this.openSheet(wrap);
  }

  openHowTo() {
    const t = (k) => this.i18n.t(k);
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <h2>${t('howto.title')}</h2>
      <ol class="howto-list">
        <li>${t('howto.1')}</li>
        <li>${t('howto.2')}</li>
        <li>${t('howto.3')}</li>
        <li>${t('howto.4')}</li>
        <li>${t('howto.5')}</li>
      </ol>
      <button class="btn" data-act="close">${t('btn.close')}</button>
    `;
    wrap.querySelector('[data-act="close"]').addEventListener('click', () => this.closeSheet());
    this.openSheet(wrap);
  }

  openSheet(content) {
    this.closeSheet();
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.appendChild(content);
    scrim.appendChild(sheet);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) this.closeSheet(); });
    document.body.appendChild(scrim);
    this._scrim = scrim;
  }

  closeSheet() {
    this._scrim?.remove();
    this._scrim = null;
  }

  // -------------------------------------------------------------- theming

  applySkin(id) {
    const skin = SKINS.includes(id) ? id : SKINS[0];
    document.documentElement.dataset.skin = skin;
    const meta = document.querySelector('meta[name="theme-color"]');
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (meta && bg) meta.setAttribute('content', bg);
  }

  applyLocale(code) {
    this.i18n.setLocale(code);
    document.documentElement.lang = this.i18n.locale;
    for (const el of document.querySelectorAll('[data-i18n]')) {
      el.textContent = this.i18n.t(el.dataset.i18n);
    }
  }
}

globalThis.app = new App();

// Offline support. Registered after the game is up so a failure here can never
// stop someone playing — the service worker is a bonus, not a dependency.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  globalThis.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
