/**
 * Score a skin before it ships.
 *
 * Mochi passed every contrast number I checked and still looked muddy, because
 * the problem was not contrast at all: warm beige empty cells sitting next to
 * cool blue and green blocks read as dirty no matter what the ratios said.
 *
 * So this checks two things:
 *   1. the usual contrast ratios (text, grid, blocks against empty cells)
 *   2. HUE DISTANCE — whether the empty cell's colour is warm while the blocks
 *      are cool, which is the specific failure Mochi had
 *
 * Run: node scripts/check-skins.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(readFileSync(join(root, 'shared', 'skins.json'), 'utf8'));

/** Parse #RGB, #RRGGBB or #RRGGBBAA into {r,g,b,a}. */
function parse(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a,
  };
}

/** Flatten a translucent colour over an opaque one. */
function over(fg, bg) {
  const f = parse(fg);
  const b = parse(bg);
  return {
    r: Math.round(f.r * f.a + b.r * (1 - f.a)),
    g: Math.round(f.g * f.a + b.g * (1 - f.a)),
    b: Math.round(f.b * f.a + b.b * (1 - f.a)),
    a: 1,
  };
}

function luminance({ r, g, b }) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Hue in degrees, plus saturation, from an rgb triple. */
function hsl({ r, g, b }) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

/** Warm (reds/oranges/yellows) vs cool (greens/blues/purples). */
function temperature(hueDeg) {
  return (hueDeg >= 330 || hueDeg <= 90) ? 'warm' : 'cool';
}

const MIN_BLOCK_CONTRAST = 1.5;
const MIN_TEXT = 4.5;
const MIN_MUTED = 3.0;
const MIN_GRID = 1.12;

let failures = 0;

for (const skin of source.skins) {
  const c = skin.colors;
  // Flatten translucent layers in the order the browser paints them:
  // page background -> board -> cell. Several skins use rgba boards and cells,
  // and comparing those raw would compare colours nobody can see.
  const toHex = ({ r, g, b }) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const bg = over(c.bg, '#000000');
  const boardFlat = over(c.board, toHex(bg));
  const cellFlat = over(c.cell, toHex(boardFlat));

  const problems = [];

  const textRatio = contrast(parse(c.text), bg);
  if (textRatio < MIN_TEXT) problems.push(`text ${textRatio.toFixed(2)} < ${MIN_TEXT}`);

  const mutedRatio = contrast(parse(c.textMuted), bg);
  if (mutedRatio < MIN_MUTED) problems.push(`muted text ${mutedRatio.toFixed(2)} < ${MIN_MUTED}`);

  const gridRatio = contrast(cellFlat, boardFlat);
  // Compare the rounded value, so the report never says "1.12 < 1.12".
  if (Number(gridRatio.toFixed(2)) < MIN_GRID) {
    problems.push(`empty cell vs board ${gridRatio.toFixed(2)} < ${MIN_GRID}`);
  }

  const weak = [];
  for (const [i, hex] of skin.blocks.entries()) {
    const ratio = contrast(parse(hex), cellFlat);
    if (Number(ratio.toFixed(2)) < MIN_BLOCK_CONTRAST) weak.push(`${i}:${hex} ${ratio.toFixed(2)}`);
  }
  if (weak.length) problems.push(`blocks too close to empty cell — ${weak.join(', ')}`);

  // The Mochi trap: a warm, clearly-tinted empty cell under mostly cool blocks.
  const cellHsl = hsl(cellFlat);
  if (cellHsl.s > 0.12) {
    const cellTemp = temperature(cellHsl.h);
    const blockTemps = skin.blocks.map((hex) => temperature(hsl(parse(hex)).h));
    const opposite = blockTemps.filter((t) => t !== cellTemp).length;
    if (opposite >= 5) {
      problems.push(
        `empty cell is ${cellTemp} (hue ${cellHsl.h.toFixed(0)}, sat ${(cellHsl.s * 100).toFixed(0)}%) ` +
        `under ${opposite}/8 ${cellTemp === 'warm' ? 'cool' : 'warm'} blocks — this is what made Mochi look muddy`
      );
    }
  }

  const ok = problems.length === 0;
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${skin.id.padEnd(10)} ${skin.brightness.padEnd(5)} ` +
    `text ${textRatio.toFixed(1)}  muted ${mutedRatio.toFixed(1)}  grid ${gridRatio.toFixed(2)}  ` +
    `cell sat ${(cellHsl.s * 100).toFixed(0)}%`
  );
  problems.forEach((p) => console.log(`        - ${p}`));
}

console.log(failures ? `\n${failures} skin(s) failed` : '\nall skins ok');
process.exit(failures ? 1 : 0);
