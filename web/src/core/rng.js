/**
 * Deterministic pseudo-random number generation.
 *
 * Shared with Orbix, unchanged in substance — the only edits are the seed
 * prefix and the doc comments. Keeping the algorithm bit-identical across the
 * catalogue means one audited generator instead of one per game, and it leaves
 * the door open for a Flutter port that must deal the same daily board.
 *
 * Algorithm: mulberry32 (public domain, by Tommy Ettinger) — 32 bits of state,
 * a full 2^32 period. Chosen over an LCG because the low bits of an LCG are
 * badly non-random, and piece dealing reads exactly those bits.
 */

const U32 = 0x100000000;

/** FNV-1a, 32-bit. Turns a seed phrase such as "2026-08-25" into a seed. */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i) & 0xff;
    // hash *= 16777619, kept inside 32 bits the way Dart's toSigned(32) will.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class Rng {
  /** @param {number} seed unsigned 32-bit */
  constructor(seed) {
    this.state = seed >>> 0;
  }

  /** Uniform unsigned 32-bit integer. */
  nextU32() {
    let a = (this.state + 0x6d2b79f5) | 0;
    this.state = a >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform double in [0, 1). */
  nextFloat() {
    return this.nextU32() / U32;
  }

  /**
   * Uniform integer in [0, bound). Plain scaling rather than rejection
   * sampling: the bias is under 1 part in 2^32 for the board sizes we use,
   * and it keeps the Dart port trivially identical.
   */
  nextInt(bound) {
    return Math.floor(this.nextFloat() * bound);
  }

  clone() {
    return new Rng(this.state);
  }
}

/** Seed for a daily board. `isoDate` is a UTC "YYYY-MM-DD" string. */
export function dailySeed(isoDate) {
  return fnv1a(`blockfall/daily/${isoDate}`);
}

/** Seed for a casual game — entropy where available, clock otherwise. */
export function randomSeed() {
  const g = globalThis;
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
    return g.crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
  }
  return (Math.floor(Math.random() * U32) ^ Date.now()) >>> 0;
}

/** UTC date key, so a Daily board flips at the same instant worldwide. */
export function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
