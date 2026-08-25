/**
 * Sound.
 *
 * Synthesised with WebAudio rather than shipped as files: a handful of short
 * tones cost nothing to download, cannot be blocked by a CDN, and keep the
 * promise that the page makes no third-party request at all.
 *
 * Browsers refuse to start audio before a gesture, so the context is created
 * lazily on the first drop and stays silent until then. Nothing here throws
 * into the game loop — if audio is unavailable the game simply plays quietly.
 */

export class Sound {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!on && this.ctx) {
      try { this.ctx.close(); } catch { /* already closed */ }
      this.ctx = null;
    }
  }

  _context() {
    if (!this.enabled) return null;
    if (this.ctx) return this.ctx;
    try {
      const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** One short tone. `type` shapes the timbre; `to` lets a note glide. */
  _tone(freq, { duration = 0.09, gain = 0.05, type = 'sine', to = null, delay = 0 } = {}) {
    const ctx = this._context();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);

      // A quick fade in and out; a raw gate would click.
      vol.gain.setValueAtTime(0.0001, t0);
      vol.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      vol.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

      osc.connect(vol).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    } catch {
      // Audio is a garnish; never let it interrupt play.
    }
  }

  /** A block landing: soft and low, because it happens constantly. */
  drop() {
    this._tone(220, { duration: 0.07, gain: 0.035, type: 'triangle', to: 180 });
  }

  /**
   * Lines clearing. The chord climbs with the number of lines, so a big clear
   * sounds like a bigger reward without needing a separate sample.
   */
  clear(lineCount = 1, combo = 1) {
    const base = 440 * Math.pow(1.06, Math.min(combo, 4) - 1);
    const steps = Math.min(lineCount, 4);
    for (let i = 0; i < steps; i++) {
      this._tone(base * Math.pow(1.26, i), {
        duration: 0.16,
        gain: 0.05,
        type: 'sine',
        delay: i * 0.055,
      });
    }
  }

  /** End of a run: a short descending pair, not a punishment. */
  over() {
    this._tone(330, { duration: 0.18, gain: 0.045, type: 'sine', to: 246 });
    this._tone(196, { duration: 0.3, gain: 0.04, type: 'triangle', delay: 0.16 });
  }
}
