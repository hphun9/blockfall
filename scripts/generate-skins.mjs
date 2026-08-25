#!/usr/bin/env node
/**
 * Compiles shared/skins.json into web/styles/skins.css.
 *
 * Colours only ever live in the JSON. That is the whole point: a tweak lands
 * everywhere in one edit, and no stylesheet can quietly drift away from the
 * source. The output is committed so a checkout runs without Node.
 *
 * The shape of the JSON is deliberately the same as Orbix's, minus the tile
 * table and plus a `blocks` palette. When the catalogue has a third game it
 * will be worth hoisting this script into a shared toolkit; two games is too
 * early to guess at the right abstraction.
 *
 * Usage: node scripts/generate-skins.mjs [--check]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(readFileSync(join(root, 'shared', 'skins.json'), 'utf8'));
const checkOnly = process.argv.includes('--check');

const BANNER = `/* GENERATED FILE — do not edit by hand.
 * Source: shared/skins.json
 * Regenerate: node scripts/generate-skins.mjs
 */`;

/** "#RRGGBB" or "#RRGGBBAA" -> "r, g, b" so CSS can compose its own alpha. */
function rgbTriplet(hex) {
  const raw = hex.replace('#', '');
  const int = parseInt(raw.slice(0, 6), 16);
  return `${(int >> 16) & 0xff}, ${(int >> 8) & 0xff}, ${int & 0xff}`;
}

/** Lighten a hex toward white — used for the top of a block's gradient. */
function lighten(hex, amount) {
  const raw = hex.replace('#', '');
  const int = parseInt(raw.slice(0, 6), 16);
  const mix = (channel) => Math.round(channel + (255 - channel) * amount);
  const r = mix((int >> 16) & 0xff);
  const g = mix((int >> 8) & 0xff);
  const b = mix(int & 0xff);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Mix toward black by `amount` (0..1). The counterpart to lighten(). */
function darken(hex, amount) {
  const raw = hex.replace('#', '');
  const int = parseInt(raw.slice(0, 6), 16);
  const mix = (channel) => Math.round(channel * (1 - amount));
  const r = mix((int >> 16) & 0xff);
  const g = mix((int >> 8) & 0xff);
  const b = mix(int & 0xff);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function skinBlock(skin) {
  const c = skin.colors;
  const g = skin.geometry;
  const lines = [];

  lines.push(`[data-skin='${skin.id}'] {`);
  lines.push(`  color-scheme: ${skin.brightness};`);
  for (const [key, value] of Object.entries(c)) {
    lines.push(`  --${key}: ${value};`);
  }
  lines.push(`  --accent-rgb: ${rgbTriplet(c.accent)};`);
  lines.push(`  --board-radius: ${g.boardRadius}px;`);
  lines.push(`  --cell-radius-ratio: ${g.tileRadiusRatio};`);
  lines.push(`  --gap-ratio: ${g.gapRatio};`);
  lines.push(`  --bounce: ${g.bounce};`);
  lines.push(`  --font: ${skin.fontStack};`);

  // The backdrop: a handful of soft radial washes behind everything.
  const washes = skin.backdrop
    .map((b) => {
      const [r, gg, bb] = rgbTriplet(b.color).split(', ');
      return `radial-gradient(circle at ${b.x * 100}% ${b.y * 100}%, ` +
        `rgba(${r}, ${gg}, ${bb}, ${b.alpha}) 0%, rgba(${r}, ${gg}, ${bb}, 0) ${b.r * 100}%)`;
    })
    .join(',\n    ');
  lines.push(`  --backdrop:\n    ${washes};`);
  lines.push('}');

  // Block colours. Each gets a gradient and an ink colour picked for contrast.
  //
  // The selector deliberately covers three places a block can appear: on the
  // board, in the tray, and under the finger while dragging. Scoping it to
  // `.cell` alone once made every tray piece invisible — the markup was right,
  // the colours simply never reached it.
  skin.blocks.forEach((hex, i) => {
    const n = i + 1;
    const where = [
      `[data-skin='${skin.id}'] .cell[data-c='${n}']`,
      `[data-skin='${skin.id}'] .piece i[data-c='${n}']`,
      `[data-skin='${skin.id}'] .drag-piece i[data-c='${n}']`,
    ].join(',\n');
    lines.push(`${where} {`);
    lines.push(`  --from: ${lighten(hex, 0.18)};`);
    lines.push(`  --to: ${hex};`);
    // A block is drawn as a solid object, not a flat swatch: a bright top
    // edge, a darker bottom edge and a soft inner sheen. Flat gradients are
    // what made the pastel skin read as stickers lying on the board rather
    // than pieces sitting on it.
    lines.push(`  --edge-hi: ${lighten(hex, 0.42)};`);
    lines.push(`  --edge-lo: ${darken(hex, 0.24)};`);
    lines.push(`  --rim: rgba(${rgbTriplet(darken(hex, 0.38))}, .55);`);
    // `none` is not a legal entry inside a comma-separated box-shadow list —
    // it invalidates the WHOLE declaration, which silently dropped the inset
    // highlight and rim on every skin with glow turned off. A fully
    // transparent shadow is the valid way to say "no glow here".
    lines.push(`  --glow: ${g.glow ? `0 0 14px rgba(${rgbTriplet(hex)}, .45)` : '0 0 0 rgba(0, 0, 0, 0)'};`);
    lines.push('}');
  });

  return lines.join('\n');
}

const css = [BANNER, '', ...source.skins.map(skinBlock), ''].join('\n');

const target = join(root, 'web', 'styles', 'skins.css');

if (checkOnly) {
  let current = '';
  try { current = readFileSync(target, 'utf8'); } catch { /* not generated yet */ }
  if (current !== css) {
    console.error('skins.css is stale — run: node scripts/generate-skins.mjs');
    process.exit(1);
  }
  console.log('skins.css is up to date');
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, css);
  console.log(`wrote ${target} (${source.skins.length} skins)`);
}
