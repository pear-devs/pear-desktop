/*
 * Beat detection from two energy bands.
 *
 * The audio is split into a low band (< 150 Hz: kick, 808) and a high band
 * (> 2 kHz: snare, hi-hats), and each band's energy is measured every FRAME
 * samples. Onsets are the positive jumps in (smoothed) log energy, normalised
 * per band and mixed with the high band weighted more: in trap and similar
 * styles the kick/808 pattern often repeats every 1.5 beats, and the bass
 * band alone locks onto that (e.g. 98.6 instead of 148 BPM); the snare/hats
 * sit on the beat. Tuned on real recordings.
 *
 * Tempo: the strongest autocorrelation lag between 70 and 180 BPM (weighted
 * towards ~120 BPM to pick the right octave), refined to a fraction of a
 * frame, then normalised to 80–160 BPM. Phase: the offset where a comb at
 * that period collects the most onset strength.
 *
 * Times are in "song seconds" (the player's per-song clock), so a grid can be
 * extrapolated: beat k is at `phase + k · period`.
 *
 * NOTE: backend.ts carries a plain-JS copy of EnvelopeRecorder's measuring
 * loop for the hidden window; keep the two in step.
 */

export const FRAME = 256; // samples per energy frame
const BLOCK = 1024; // ScriptProcessor buffer (4 frames)
const LOWPASS_HZ = 150;
const HIGHPASS_HZ = 2000;
const SMOOTH_SECONDS = 0.03;
const LOW_WEIGHT = 0.5;
const HIGH_WEIGHT = 1;

export type Envelope = {
  low: number[]; // low-band energy per frame
  high: number[]; // high-band energy per frame
  t0: number; // song time of frame 0
  dt: number; // seconds per frame
};

export type BeatGrid = {
  bpm: number;
  period: number; // seconds
  phase: number; // song time of one beat
  confidence: number; // how clear the beat is; ~1 = none
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Centered moving average (no time shift). */
const smooth = (xs: number[], width: number) => {
  if (width <= 1) return xs.slice();
  const half = Math.floor(width / 2);
  const prefix = [0];
  for (const x of xs) prefix.push(prefix[prefix.length - 1] + x);
  return xs.map((_, i) => {
    const a = Math.max(0, i - half);
    const b = Math.min(xs.length, i + half + 1);
    return (prefix[b] - prefix[a]) / (b - a);
  });
};

/** Rectified rise in smoothed log energy, normalised to zero mean, unit std. */
const bandOnset = (energy: number[], dt: number) => {
  const n = energy.length;
  const out = new Float64Array(n);
  // A 256-sample frame is shorter than one cycle of a 60 Hz bass note, so
  // raw frame energy ripples with the waveform; ~30 ms smoothing removes it.
  const v = smooth(energy, Math.round(SMOOTH_SECONDS / dt));
  const max = Math.max(...v);
  if (!(max > 0)) return out;
  const floor = max * 1e-3;
  let prev = Math.log10(v[0] + floor);
  for (let i = 1; i < n; i++) {
    const e = Math.log10(v[i] + floor);
    out[i] = Math.max(0, e - prev);
    prev = e;
  }
  let mean = 0;
  for (const x of out) mean += x;
  mean /= n;
  let variance = 0;
  for (const x of out) variance += (x - mean) ** 2;
  const std = Math.sqrt(variance / n) || 1;
  return out.map((x) => (x - mean) / std);
};

const onsetStrength = (env: Envelope) => {
  const low = bandOnset(env.low, env.dt);
  const high = bandOnset(env.high, env.dt);
  return low.map((x, i) => (LOW_WEIGHT * x) + (HIGH_WEIGHT * high[i]));
};

/** Best phase for a given period, with how much it stands out. */
const combPhase = (onset: Float64Array, frames: number) => {
  const n = onset.length;
  const scores: number[] = [];
  let best = 0;
  let bestScore = -Infinity;
  for (let phi = 0; phi < frames; phi += 0.5) {
    let s = 0;
    let count = 0;
    for (let k = 0; ; k++) {
      const i = Math.round(phi + (k * frames));
      if (i >= n) break;
      s += onset[i];
      count++;
    }
    const score = count ? s / count : 0;
    scores.push(score);
    if (score > bestScore) {
      bestScore = score;
      best = phi;
    }
  }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const std =
    Math.sqrt(scores.reduce((a, b) => a + ((b - mean) ** 2), 0) / scores.length) ||
    1e-12;
  return { phi: best, clarity: (bestScore - mean) / std };
};

/** Tempo and phase. */
export const analyzeBeats = (env: Envelope): BeatGrid | null => {
  const { t0, dt } = env;
  const n = env.low.length;
  if (n * dt < 5) return null;
  const onset = onsetStrength(env);

  const minLag = Math.floor(60 / 180 / dt);
  const maxLag = Math.min(Math.ceil(60 / 70 / dt), Math.floor(n / 2));
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += onset[i] * onset[i + lag];
    ac[lag] = s / (n - lag);
  }

  let best = -1;
  let bestScore = -Infinity;
  let acSum = 0;
  let acCount = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * dt);
    const octave = Math.log2(bpm / 120) / 0.6;
    const score = ac[lag] * Math.exp(-0.5 * octave * octave);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
    acSum += Math.max(0, ac[lag]);
    acCount++;
  }
  if (best < 0 || ac[best] <= 0) return null;

  // Parabolic refinement of the peak.
  const a = ac[best - 1];
  const b = ac[best];
  const c = ac[best + 1];
  const denom = a - (2 * b) + c;
  const delta = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
  let period = (best + Math.max(-0.5, Math.min(0.5, delta))) * dt;

  // Normalise to 80–160 BPM so half/double tempo compare cleanly.
  while (60 / period < 80) period /= 2;
  while (60 / period >= 160) period *= 2;

  const { phi } = combPhase(onset, period / dt);
  return {
    bpm: 60 / period,
    period,
    phase: t0 + (phi * dt),
    confidence: ac[best] / (acSum / Math.max(1, acCount) || 1e-12),
  };
};

/*
 * Aligning two songs by their rhythm pattern.
 *
 * Absolute beat placement is unreliable on syncopated music (hi-hats on every
 * half beat, trap rolls, dotted 808s all compete). Instead, each song's
 * onsets are folded over one bar (4 beats) into an average pattern, per band,
 * and the two patterns are cross-correlated: the best circular shift puts
 * kick on kick and snare on snare, the way a DJ lines songs up by ear. Bins
 * are fractions of a bar, so songs at different tempos compare directly.
 * (Checked on a recording aligned against itself: within ~10 ms, right bar.)
 */

const BINS = 384; // per bar

export type BarTemplate = {
  low: Float64Array;
  high: Float64Array;
  bar: number; // seconds (song time)
  anchor: number; // song time of bin 0
};

export const barTemplate = (
  env: Envelope,
  period: number,
  anchor = env.t0,
): BarTemplate => {
  const bar = 4 * period;
  const lowOnset = bandOnset(env.low, env.dt);
  const highOnset = bandOnset(env.high, env.dt);
  const low = new Float64Array(BINS);
  const high = new Float64Array(BINS);
  const count = new Float64Array(BINS);
  for (let i = 0; i < lowOnset.length; i++) {
    const t = env.t0 + (i * env.dt);
    let pos = ((t - anchor) / bar) % 1;
    if (pos < 0) pos += 1;
    const b = Math.floor(pos * BINS) % BINS;
    low[b] += lowOnset[i];
    high[b] += highOnset[i];
    count[b]++;
  }
  for (let b = 0; b < BINS; b++) {
    if (count[b]) {
      low[b] /= count[b];
      high[b] /= count[b];
    }
  }
  return { low, high, bar, anchor };
};

/**
 * The song time in `b` that lines up with `a.anchor` (any whole number of
 * `b.bar`s may be added).
 */
export const alignBars = (a: BarTemplate, b: BarTemplate) => {
  let best = 0;
  let bestScore = -Infinity;
  for (let shift = 0; shift < BINS; shift++) {
    let s = 0;
    for (let i = 0; i < BINS; i++) {
      const j = (i + shift) % BINS;
      s += (a.low[i] * b.low[j]) + (a.high[i] * b.high[j]);
    }
    if (s > bestScore) {
      bestScore = s;
      best = shift;
    }
  }
  return b.anchor + ((best / BINS) * b.bar);
};

/**
 * Continuously measures both bands of a source, timestamped in song time.
 * `getSongTime` must return the player's per-song clock.
 */
export class EnvelopeRecorder {
  private low: number[] = [];
  private high: number[] = [];
  private ctxT0 = 0; // audio-clock time of frame 0
  private readonly dt: number;
  private offsets: number[] = [];
  private readonly nodes: AudioNode[];
  private readonly processor: ScriptProcessorNode;

  constructor(
    private readonly ctx: AudioContext,
    source: AudioNode,
    private readonly getSongTime: () => number,
    private readonly keepSeconds = 30,
  ) {
    this.dt = FRAME / ctx.sampleRate;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = LOWPASS_HZ;
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = HIGHPASS_HZ;
    const merger = ctx.createChannelMerger(2);
    // ScriptProcessor is deprecated but needs no separate module file, which
    // YouTube Music's Trusted Types policy would make awkward.
    this.processor = ctx.createScriptProcessor(BLOCK, 2, 1);
    const sink = ctx.createGain();
    sink.gain.value = 0;

    source.connect(lowpass);
    source.connect(highpass);
    lowpass.connect(merger, 0, 0);
    highpass.connect(merger, 0, 1);
    merger.connect(this.processor);
    this.processor.connect(sink);
    sink.connect(ctx.destination);
    this.nodes = [lowpass, highpass, merger, this.processor, sink];
    this.processor.onaudioprocess = this.onProcess;
  }

  private onProcess = (e: AudioProcessingEvent) => {
    const lowData = e.inputBuffer.getChannelData(0);
    const highData = e.inputBuffer.getChannelData(1);
    const offset = this.getSongTime() - this.ctx.currentTime;

    // Discontinuity (seek or new song): the song/audio clock offset jumps.
    if (this.offsets.length > 0 && Math.abs(offset - this.medianOffset) > 0.05) {
      this.reset();
    }
    if (this.low.length === 0) this.ctxT0 = e.playbackTime;

    for (let f = 0; f < BLOCK / FRAME; f++) {
      let l = 0;
      let h = 0;
      for (let i = f * FRAME; i < (f + 1) * FRAME; i++) {
        l += lowData[i] * lowData[i];
        h += highData[i] * highData[i];
      }
      this.low.push(l / FRAME);
      this.high.push(h / FRAME);
    }
    this.offsets.push(offset);
    if (this.offsets.length > 64) this.offsets.shift();

    const maxFrames = Math.ceil(this.keepSeconds / this.dt);
    if (this.low.length > maxFrames) {
      const drop = this.low.length - maxFrames;
      this.low.splice(0, drop);
      this.high.splice(0, drop);
      this.ctxT0 += drop * this.dt;
    }
  };

  reset() {
    this.low = [];
    this.high = [];
    this.offsets = [];
  }

  /** The last `seconds` of envelope, timestamped in song time. */
  window(seconds: number): Envelope {
    const count = Math.min(this.low.length, Math.ceil(seconds / this.dt));
    const start = this.low.length - count;
    return {
      low: this.low.slice(start),
      high: this.high.slice(start),
      t0: this.ctxT0 + this.medianOffset + (start * this.dt),
      dt: this.dt,
    };
  }

  /** Smoothed song-time offset estimate (less jitter than a single read). */
  get medianOffset() {
    return this.offsets.length ? median(this.offsets) : 0;
  }

  disconnect() {
    this.processor.onaudioprocess = null;
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        // already gone
      }
    }
  }
}
