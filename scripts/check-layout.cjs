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
];

/** Pairs that must never overlap vertically. */
const MUST_NOT_OVERLAP = [
  ['board', '#board', 'tray', '.tray'],
  ['tray', '.tray', 'footer', '.foot'],
  ['goal bar', '.goal', 'board', '#board'],
  ['hud', '.hud', 'goal bar', '.goal'],
];

/** A cell smaller than this is too fiddly to tap accurately. */
const MIN_CELL = 26;

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
      const board = box('#board');
      const tray = box('.tray');
      const foot = box('.foot');
      return {
        cell: cell ? Math.round(cell.getBoundingClientRect().width) : 0,
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
    if (m.scrolls) problems.push('page scrolls');
    if (m.overflows) problems.push('footer past the viewport');
    if (m.cell < MIN_CELL) problems.push(`cell ${m.cell}px < ${MIN_CELL}px`);
    if (m.overlaps.length) problems.push(...m.overlaps);
    if (errors.length) problems.push(`${errors.length} JS errors`);

    const ok = problems.length === 0;
    if (!ok) failures++;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(14)} ${width}x${height}  ` +
      `cell ${String(m.cell).padStart(2)}px  board ${m.board}px  tray ${m.tray}px  ` +
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
