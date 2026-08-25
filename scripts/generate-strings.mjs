#!/usr/bin/env node
/**
 * Compiles shared/strings.json into web/src/strings.gen.js.
 *
 * Every visible string lives in the JSON so a translation is one edit in one
 * file, and so a missing Vietnamese string is a build error rather than an
 * English word leaking into the UI.
 *
 * Usage: node scripts/generate-strings.mjs [--check]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(readFileSync(join(root, 'shared', 'strings.json'), 'utf8'));
const checkOnly = process.argv.includes('--check');

const { locales, strings } = source;

// A missing translation must fail the build, not ship half-translated.
const missing = [];
for (const [key, value] of Object.entries(strings)) {
  for (const locale of locales) {
    if (typeof value[locale] !== 'string' || value[locale].length === 0) {
      missing.push(`${key} [${locale}]`);
    }
  }
}
if (missing.length > 0) {
  console.error(`strings.json is missing ${missing.length} translation(s):`);
  for (const m of missing.slice(0, 20)) console.error(`  ${m}`);
  process.exit(1);
}

const byLocale = {};
for (const locale of locales) {
  byLocale[locale] = {};
  for (const [key, value] of Object.entries(strings)) {
    byLocale[locale][key] = value[locale];
  }
}

const js = `/* GENERATED FILE — do not edit by hand.
 * Source: shared/strings.json
 * Regenerate: node scripts/generate-strings.mjs
 */

export const LOCALES = ${JSON.stringify(locales)};

export const STRINGS = ${JSON.stringify(byLocale, null, 2)};
`;

const target = join(root, 'web', 'src', 'strings.gen.js');

if (checkOnly) {
  let current = '';
  try { current = readFileSync(target, 'utf8'); } catch { /* not generated yet */ }
  if (current !== js) {
    console.error('strings.gen.js is stale — run: node scripts/generate-strings.mjs');
    process.exit(1);
  }
  console.log('strings.gen.js is up to date');
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, js);
  console.log(`wrote ${target} (${Object.keys(strings).length} keys x ${locales.length} locales)`);
}
