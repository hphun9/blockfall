/**
 * Layout check across real phone sizes.
 *
 * Catches the failure mode unit tests cannot see: elements overlapping. A
 * board that keeps its width on a short screen does not error — it just draws
 * on top of the tray, and every assertion about "does it fit on screen" still
 * passes. Run it after touching any layout CSS.
 *
 *   node scripts/check-layout.cjs [baseUrl]
 *
 * Requires a dev server (npm run serve) and Playwright's chromium.
 */

const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM
  || '/root/Eranin/etask/eTask-frontend/node_modules/playwright';
const { chromium } = require(CHROMIUM);

const BASE = process.argv[2] || 'http://127.0.0.1:8080/';

const DEVICES = [
  ['iPhone SE', 375, 667],
  ['iPhone 12', 390, 844],
  ['iPhone 14 Pro', 393, 852],
  ['Pixel 7', 412, 915],
  ['Galaxy S20', 360, 800],
  ['iPad mini', 768, 1024],
  // Same phones with the Safari address bar showing. The visible area is
  // ~145px shorter than the device height, and the board covering the tray was
  // first reported from a real phone in exactly this state — the full-height
  // sizes above all passed while the game was unplayable.
  ['iPhone SE + bar', 375, 553],
  ['iPhone 12 + bar', 390, 700],
  ['iPhone 14P + bar', 393, 709],
  // Deliberately short, to catch sizing that only works when there is plenty
  // of room to spare.
  ['very short', 390, 500],
];

/** Pairs that must never overlap vertically. */
const MUST_NOT_OVERLAP = [
  ['board', '#board', 'tray', '.tray'],
  ['tray', '.tray', 'footer', '.foot'],
  ['goal bar', '.goal', 'board', '#board'],
  ['hud', '.hud', 'goal bar', '.goal'],
];

/**
 * A cell smaller than this is too fiddly to tap accurately.
 *
 * Scaled to the viewport rather than fixed: a 500px-tall window physically
 * cannot show eight rows at 26px plus a tray and a footer, so a flat figure
 * would report an impossibility as a bug and train us to ignore the check.
 * What matters at those sizes is that nothing OVERLAPS — which is asserted
 * separately and unconditionally.
 */
const minCell = (height) => (height < 620 ? 15 : 26);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  let failures = 0;

  for (const [name, width, height] of DEVICES) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      locale: 'vi-VN',
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 90)));

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);

    const m = await page.evaluate((pairs) => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, width: b.width, height: b.height };
      };
      const overlaps = [];
      for (const [n1, s1, n2, s2] of pairs) {
        const a = box(s1);
        const b = box(s2);
        if (!a || !b) continue;
        const over = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (over > 1) overlaps.push(`${n1}/${n2} overlap ${Math.round(over)}px`);
      }
      const cell = document.querySelector('.cell');
      const cellBox = cell ? cell.getBoundingClientRect() : null;
      const board = box('#board');
      const tray = box('.tray');
      const foot = box('.foot');
      // Measure a SMALL piece only. Long bars are deliberately scaled down to
      // fit their slot, so measuring whichever piece happens to be dealt
      // reports a false failure roughly a third of the time.
      let trayI = null;
      for (const piece of document.querySelectorAll('.piece')) {
        const cells = piece.querySelectorAll('i:not(.gap)');
        const cols = getComputedStyle(piece).gridTemplateColumns.split(' ').length;
        const rows = getComputedStyle(piece).gridTemplateRows.split(' ').length;
        if (cells.length && cols <= 3 && rows <= 3) { trayI = cells[0]; break; }
      }
      return {
        cell: cell ? Math.round(cell.getBoundingClientRect().width) : 0,
        cellW: cellBox ? Math.round(cellBox.width * 10) / 10 : 0,
        cellH: cellBox ? Math.round(cellBox.height * 10) / 10 : 0,
        boardW: board ? Math.round(board.width) : 0,
        boardH: board ? Math.round(board.height) : 0,
        trayCell: trayI ? Math.round(trayI.getBoundingClientRect().width * 10) / 10 : 0,
        board: board ? Math.round(board.width) : 0,
        tray: tray ? Math.round(tray.height) : 0,
        footBottom: foot ? Math.round(foot.bottom) : 0,
        viewport: window.innerHeight,
        scrolls: document.documentElement.scrollHeight > window.innerHeight + 2,
        overflows: foot ? foot.bottom > window.innerHeight + 1 : false,
        overlaps,
      };
    }, MUST_NOT_OVERLAP);

    const problems = [];
    // Cells MUST be square. A stretched grid is invisible to an overlap check
    // and to a width-only cell check, but it puts every drop slightly off the
    // spot the player aimed at — the whole game becomes harder to control.
    if (Math.abs(m.cellW - m.cellH) > 1.5) {
      problems.push(`cells not square: ${m.cellW}x${m.cellH}`);
    }
    if (Math.abs(m.boardW - m.boardH) > 3) {
      problems.push(`board not square: ${m.boardW}x${m.boardH}`);
    }
    // The tray draws at TRAY_SCALE of a board cell so the player can judge
    // how much room a piece needs. If that ratio drifts the tray lies.
    if (m.cellW > 0 && m.trayCell > 0) {
      const ratio = m.trayCell / m.cellW;
      if (ratio < 0.52 || ratio > 0.72) {
        problems.push(`tray/board cell ratio ${(ratio * 100).toFixed(0)}% (want ~62%)`);
      }
    }
    if (m.scrolls) problems.push('page scrolls');
    if (m.overflows) problems.push('footer past the viewport');
    const cellFloor = minCell(height);
    if (m.cell < cellFloor) problems.push(`cell ${m.cell}px < ${cellFloor}px`);
    if (m.overlaps.length) problems.push(...m.overlaps);
    if (errors.length) problems.push(`${errors.length} JS errors`);

    const ok = problems.length === 0;
    if (!ok) failures++;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(14)} ${width}x${height}  ` +
      `cell ${m.cellW}x${m.cellH}  board ${m.boardW}x${m.boardH}  tray ${m.tray}px  ` +
      `footer ${m.footBottom}/${m.viewport}`
    );
    if (!ok) problems.forEach((p) => console.log(`        - ${p}`));

    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} device(s) failed` : '\nall devices ok');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('run error: ' + e.message);
  process.exit(1);
});
