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
 *
 * Everything is tuned to a pentatonic scale (C D E G A). Any two notes from it
 * sound consonant together, which matters because clears, combos and tier
 * chimes routinely overlap — on a chromatic scale those collisions produce
 * sour intervals, and the fix is to make wrong notes unreachable rather than
 * to sequence around them.
 */

/** C major pentatonic across two octaves, in Hz. */
const SCALE = [
  261.63, 293.66, 329.63, 392.00, 440.00,
  523.25, 587.33, 659.25, 783.99, 880.00,
  1046.50, 1174.66, 1318.51,
];

export class Sound {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
    this.bus = null;
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!on && this.ctx) {
      try { this.ctx.close(); } catch { /* already closed */ }
      this.ctx = null;
      this.bus = null;
    }
  }

  _context() {
    if (!this.enabled) return null;
    if (this.ctx) return this.ctx;
    try {
      const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();

      // One master bus with a gentle limiter. Several notes can land in the
      // same few milliseconds — a four-line clear during a combo — and without
      // this their gains simply add up and clip into a crackle.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.setValueAtTime(-14, this.ctx.currentTime);
      comp.ratio.setValueAtTime(12, this.ctx.currentTime);
      comp.attack.setValueAtTime(0.003, this.ctx.currentTime);
      comp.release.setValueAtTime(0.18, this.ctx.currentTime);

      const master = this.ctx.createGain();
      master.gain.setValueAtTime(0.9, this.ctx.currentTime);

      comp.connect(master).connect(this.ctx.destination);
      this.bus = comp;
      return this.ctx;
    } catch {
      return null;
    }
  }

  /**
   * One note.
   *
   * Two oscillators rather than one: the second, an octave up and much
   * quieter, is what gives the note a bell-like sheen instead of the hollow
   * test-tone quality a bare sine has. The detune spreads them a few cents
   * apart so they beat slightly, which reads as warmth.
   */
  _tone(freq, {
    duration = 0.09,
    gain = 0.05,
    type = 'sine',
    to = null,
    delay = 0,
    shimmer = 0.35,
    detune = 6,
  } = {}) {
    const ctx = this._context();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') {
        // resume() returns a promise, so a throw here is a REJECTION — a
        // try/catch does not see it and it surfaces as an unhandled rejection.
        // An OfflineAudioContext has nothing to resume and always rejects.
        Promise.resolve(ctx.resume()).catch(() => { /* offline or already running */ });
      }
      const t0 = ctx.currentTime + delay;

      const vol = ctx.createGain();
      // A quick fade in and a curved fade out; a raw gate would click, and a
      // linear tail sounds abrupt on short notes.
      vol.gain.setValueAtTime(0.0001, t0);
      vol.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      vol.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      vol.connect(this.bus || ctx.destination);

      const voice = (f, g, t, d) => {
        const osc = ctx.createOscillator();
        const own = ctx.createGain();
        osc.type = t;
        osc.detune.setValueAtTime(d, t0);
        osc.frequency.setValueAtTime(f, t0);
        if (to) osc.frequency.exponentialRampToValueAtTime(to * (f / freq), t0 + duration);
        own.gain.setValueAtTime(g, t0);
        osc.connect(own).connect(vol);
        osc.start(t0);
        osc.stop(t0 + duration + 0.03);
      };

      voice(freq, 1, type, -detune);
      if (shimmer > 0) voice(freq * 2, shimmer, 'sine', detune);
    } catch {
      // Audio is a garnish; never let it interrupt play.
    }
  }

  /** Snap a frequency to the nearest scale degree at or above `i`. */
  _note(i) {
    return SCALE[Math.max(0, Math.min(SCALE.length - 1, i))];
  }

  /**
   * A block landing.
   *
   * Soft, low and very short, because it fires on every single move — this is
   * the sound the player hears most, so it has to stay out of the way. The
   * pitch drops slightly, like something settling into place.
   */
  drop() {
    this._tone(196, {
      duration: 0.085,
      gain: 0.05,
      type: 'triangle',
      to: 165,
      shimmer: 0.18,
    });
  }

  /**
   * Lines clearing: an arpeggio up the pentatonic scale.
   *
   * The starting degree rises with the combo, so a run of clears climbs
   * steadily instead of replaying the same phrase — the audio equivalent of a
   * score multiplier, and the thing that makes a streak feel like it is going
   * somewhere.
   */
  clear(lineCount = 1, combo = 1) {
    const start = 2 + Math.min(combo - 1, 4) * 2;
    const steps = Math.min(lineCount, 4);
    for (let i = 0; i < steps; i++) {
      this._tone(this._note(start + i * 2), {
        duration: 0.22,
        gain: 0.055,
        type: 'triangle',
        delay: i * 0.06,
        shimmer: 0.45,
      });
    }
    // A low body note underneath, so a clear has weight as well as sparkle.
    this._tone(this._note(start) / 2, {
      duration: 0.3,
      gain: 0.04,
      type: 'sine',
      shimmer: 0,
    });
  }

  /**
   * Board swept clean: a full rising run with a sustained chord under it.
   *
   * The longest and brightest sound in the game, because it marks the rarest
   * thing a player can do.
   */
  perfect() {
    [0, 2, 4, 5, 7, 9, 10].forEach((deg, i) => {
      this._tone(this._note(deg + 3), {
        duration: 0.3,
        gain: 0.05,
        type: 'triangle',
        delay: i * 0.07,
        shimmer: 0.55,
      });
    });
    // Held chord underneath: root and fifth, quiet and long.
    this._tone(this._note(0), { duration: 1.1, gain: 0.035, type: 'sine', shimmer: 0.2 });
    this._tone(this._note(3), { duration: 1.1, gain: 0.03, type: 'sine', delay: 0.05, shimmer: 0.2 });
  }

  /**
   * A goal tier fell: a three-note flourish, starting higher for each tier.
   *
   * Shorter than perfect(), because this fires up to five times a run and a
   * full fanfare each time would wear out fast.
   */
  tier(n = 1) {
    const base = Math.min((n - 1) * 2, 6);
    [0, 2, 4].forEach((step, i) => {
      this._tone(this._note(base + step + 3), {
        duration: 0.2,
        gain: 0.05,
        type: 'triangle',
        delay: i * 0.065,
        shimmer: 0.5,
      });
    });
  }

  /**
   * End of a run: a short descending phrase.
   *
   * Deliberately not a buzzer. Losing is the normal way every run ends, and
   * punishing the player for reaching the end of the thing they were doing
   * makes starting another one less appealing.
   */
  over() {
    [6, 4, 2, 0].forEach((deg, i) => {
      this._tone(this._note(deg), {
        duration: 0.26,
        gain: 0.042,
        type: 'sine',
        delay: i * 0.1,
        shimmer: 0.15,
      });
    });
  }
}
