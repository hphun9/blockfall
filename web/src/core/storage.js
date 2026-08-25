/**
 * Everything Block Fall remembers, and the only place that touches localStorage.
 *
 * Nothing here leaves the device: no accounts, no sync, no analytics. That is a
 * product promise, so it is also an architectural one — this module has no
 * network code and nothing else in the app writes to storage.
 *
 * Storage can throw (Safari private browsing, quota, cookies disabled), so the
 * whole surface degrades to an in-memory map rather than taking the game down.
 * A player in private mode still gets to play; they just lose their record when
 * the tab closes, which is the right trade.
 */

const NAMESPACE = 'blockfall.v1.';

export const DEFAULT_SETTINGS = {
  skin: 'nebula',
  sound: true,
  locale: null, // null = follow the device
  mode: 'classic',
};

/** Unlock rules live next to the badge so adding one is a single edit. */
export const BADGES = [
  { id: 'first', icon: 'play', test: (s) => s.played >= 1 },
  { id: 's500', icon: 'spark', test: (s) => s.best >= 500 },
  { id: 's2000', icon: 'star', test: (s) => s.best >= 2000 },
  { id: 's5000', icon: 'crown', test: (s) => s.best >= 5000 },
  { id: 'combo3', icon: 'chain', test: (s) => s.bestCombo >= 3 },
  { id: 'combo4', icon: 'bolt', test: (s) => s.bestCombo >= 4 },
  { id: 'lines100', icon: 'grid', test: (s) => s.lines >= 100 },
  { id: 'daily3', icon: 'calendar', test: (s) => (s.daily?.bestStreak ?? 0) >= 3 },
  { id: 'daily7', icon: 'trophy', test: (s) => (s.daily?.bestStreak ?? 0) >= 7 },
];

function makeMemoryBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()],
  };
}

function pickBackend() {
  try {
    const probe = `${NAMESPACE}__probe`;
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    const ls = globalThis.localStorage;
    return {
      getItem: (k) => ls.getItem(k),
      setItem: (k, v) => ls.setItem(k, v),
      removeItem: (k) => ls.removeItem(k),
      keys: () => Object.keys(ls),
      persistent: true,
    };
  } catch {
    return { ...makeMemoryBackend(), persistent: false };
  }
}

const EMPTY_STATS = {
  played: 0,
  best: 0,
  bestCombo: 0,
  lines: 0,
  drops: 0,
  totalScore: 0,
  daily: { lastDate: null, streak: 0, bestStreak: 0, bestScore: 0 },
};

export class Storage {
  constructor(backend = pickBackend()) {
    this.backend = backend;
    this.persistent = backend.persistent !== false;
  }

  _read(key, fallback) {
    try {
      const raw = this.backend.getItem(NAMESPACE + key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  _write(key, value) {
    try {
      this.backend.setItem(NAMESPACE + key, JSON.stringify(value));
      return true;
    } catch {
      // Quota or a locked-down browser. Losing a save beats crashing mid-run.
      return false;
    }
  }

  // ------------------------------------------------------------- settings

  loadSettings() {
    return { ...DEFAULT_SETTINGS, ...this._read('settings', {}) };
  }

  saveSettings(settings) {
    return this._write('settings', settings);
  }

  // ---------------------------------------------------------------- stats

  loadStats() {
    const raw = this._read('stats', {});
    return {
      ...EMPTY_STATS,
      ...raw,
      daily: { ...EMPTY_STATS.daily, ...(raw.daily ?? {}) },
    };
  }

  saveStats(stats) {
    return this._write('stats', stats);
  }

  /**
   * Fold a finished run into the lifetime record.
   *
   * Returns the updated stats plus whether this run set a new record, because
   * the end-of-run screen wants to say so and should not have to diff by hand.
   */
  recordRun({ score, lines, drops, bestCombo, mode, dateKey }) {
    const stats = this.loadStats();
    stats.played += 1;
    stats.lines += lines;
    stats.drops += drops;
    stats.totalScore += score;

    const isBest = score > stats.best;
    if (isBest) stats.best = score;
    if (bestCombo > stats.bestCombo) stats.bestCombo = bestCombo;

    let streakGrew = false;
    if (mode === 'daily' && dateKey) {
      const d = stats.daily;
      if (d.lastDate !== dateKey) {
        // Yesterday in UTC, computed from the key itself so no clock is trusted.
        const prev = new Date(`${dateKey}T00:00:00Z`);
        prev.setUTCDate(prev.getUTCDate() - 1);
        const yesterday = prev.toISOString().slice(0, 10);
        d.streak = d.lastDate === yesterday ? d.streak + 1 : 1;
        d.lastDate = dateKey;
        if (d.streak > d.bestStreak) d.bestStreak = d.streak;
        streakGrew = true;
      }
      if (score > d.bestScore) d.bestScore = score;
    }

    this.saveStats(stats);
    return { stats, isBest, streakGrew };
  }

  earnedBadges(stats = this.loadStats()) {
    return BADGES.filter((b) => {
      try { return b.test(stats); } catch { return false; }
    }).map((b) => b.id);
  }

  // ------------------------------------------------------- game in progress

  _gameKey(mode, dateKey) {
    return mode === 'daily' ? `game.daily.${dateKey}` : 'game.classic';
  }

  loadGame(mode, dateKey) {
    return this._read(this._gameKey(mode, dateKey), null);
  }

  saveGame(mode, dateKey, snapshot) {
    return this._write(this._gameKey(mode, dateKey), snapshot);
  }

  clearGame(mode, dateKey) {
    try {
      this.backend.removeItem(NAMESPACE + this._gameKey(mode, dateKey));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Drop yesterday's daily saves.
   *
   * Without this, a daily player accumulates one dead entry per day forever and
   * eventually hits the quota — a slow leak that only shows up after months.
   */
  pruneDailies(keepDateKey) {
    const prefix = `${NAMESPACE}game.daily.`;
    try {
      for (const key of this.backend.keys()) {
        if (key.startsWith(prefix) && key !== `${prefix}${keepDateKey}`) {
          this.backend.removeItem(key);
        }
      }
    } catch {
      // Nothing to do; a failed prune is not worth interrupting play for.
    }
  }
}
