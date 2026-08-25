/**
 * Translation lookup.
 *
 * The catalogue is Vietnamese-first: `vi` is the fallback, not English, because
 * that is the audience this is built for. A missing key returns the key itself
 * rather than an empty string — a visible `hud.score` in the UI is a bug report
 * you cannot miss, whereas a blank label just looks like a rendering glitch.
 */

import { LOCALES, STRINGS } from './strings.gen.js';

export const SUPPORTED = LOCALES;

/** Pick a locale from the browser, falling back to Vietnamese. */
export function detectLocale() {
  const wanted = globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? 'vi'];
  for (const tag of wanted) {
    if (!tag) continue;
    const base = String(tag).toLowerCase().split('-')[0];
    if (SUPPORTED.includes(base)) return base;
  }
  return 'vi';
}

export class I18n {
  constructor(locale = detectLocale()) {
    this.locale = SUPPORTED.includes(locale) ? locale : 'vi';
  }

  setLocale(locale) {
    if (SUPPORTED.includes(locale)) this.locale = locale;
    return this.locale;
  }

  /**
   * Look up `key`, substituting `{name}` placeholders from `vars`.
   *
   * Substitution is deliberately dumb — no plural rules, no dates. Vietnamese
   * has no plural inflection, so pluralisation machinery would earn its
   * complexity in exactly one language out of two.
   */
  t(key, vars) {
    const table = STRINGS[this.locale] ?? STRINGS.vi;
    let text = table[key] ?? STRINGS.vi[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  }
}
