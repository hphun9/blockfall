/**
 * Goals: something to reach for inside a run.
 *
 * The game had no win condition and no milestones, so a run was just an
 * unbounded slide toward an eventual loss — you could never tell whether 340
 * points was good. Measured over 400 heuristic-played runs the score spread
 * was min 36 / median 349 / max 3661, which is a hundredfold range with no
 * marker anywhere in it.
 *
 * These tiers are pinned to that measured distribution rather than to taste.
 * They were re-measured after the diagonal pieces landed, which cost roughly a
 * quarter off the top end — the first draft put the last tier at 1500, which
 * only 1% of runs reached. A ladder whose top rung is unreachable is just a
 * longer way to lose:
 *
 *   Tier      Score   Share of runs reaching it
 *   ------------------------------------------
 *   1  Warm up   150   ~78%   almost everyone, early, so the ladder starts
 *   2  Steady    300   ~56%   a normal decent run
 *   3  Sharp     500   ~35%   requires actually playing well
 *   4  Expert    800   ~17%   a good run
 *   5  Master   1200    ~4%   rare, but it happens
 *
 * Tier 5 is deliberately reachable — "you cleared it" has to be a real
 * outcome, not a theoretical one. Past it the run continues and is scored as
 * an endless streak, so there is still a reason to keep placing.
 */

export const TIERS = [
  { id: 1, score: 150, key: 'tier.1' },
  { id: 2, score: 300, key: 'tier.2' },
  { id: 3, score: 500, key: 'tier.3' },
  { id: 4, score: 800, key: 'tier.4' },
  { id: 5, score: 1200, key: 'tier.5' },
];

/** Highest tier reached at this score (0 = none yet). */
export function tierFor(score) {
  let n = 0;
  for (const t of TIERS) if (score >= t.score) n = t.id;
  return n;
}

/** The tier being worked toward, or null once they are all cleared. */
export function nextTier(score) {
  return TIERS.find((t) => score < t.score) || null;
}

/**
 * Progress toward the next tier, 0..1.
 *
 * Measured from the previous tier rather than from zero, so the bar fills
 * across each band instead of crawling once the numbers get large.
 */
export function tierProgress(score) {
  const next = nextTier(score);
  if (!next) return 1;
  const prev = TIERS.filter((t) => t.score <= score).pop();
  const floor = prev ? prev.score : 0;
  const span = next.score - floor;
  return span > 0 ? Math.min(1, Math.max(0, (score - floor) / span)) : 0;
}
