/**
 * Pure DSP used by AutoMix to understand a track: tempo, beat grid,
 * downbeats, leading/trailing silence and where the intro/outro sit.
 *
 * Everything here works on plain Float32Arrays so it can run anywhere
 * (renderer, worker, or Node for testing).
 */

import {
  detectKey,
  tonalProfile,
  type MusicalKey,
  type TonalProfile,
} from './key';

import type { SongTraits } from './constants';

export interface AnalysisBands {
  sampleRate: number;
  /** Mono full-band signal */
  full: Float32Array;
  /** Mono low band (kick / bass, < ~150 Hz) */
  low: Float32Array;
  /** Mono mid band (~150 Hz - 2 kHz) */
  mid: Float32Array;
  /** Mono high band (> ~2 kHz, hats / snares) */
  high: Float32Array;
}

export interface TrackAnalysis {
  /** Track length in seconds */
  duration: number;
  /** Estimated tempo, 0 when no steady pulse was found */
  bpm: number;
  /** Seconds per beat (60 / bpm), 0 when unknown */
  beatPeriod: number;
  /** 0..1 - how clearly the beat grid stands out from the music */
  tempoConfidence: number;
  /** Beat times in seconds */
  beats: number[];
  /** First beat of every bar (4/4 assumed), in seconds */
  downbeats: number[];
  /** First moment the track becomes audible */
  leadingSilenceEnd: number;
  /** Last moment the track is audible */
  trailingSilenceStart: number;
  /** When the intro reaches the main body loudness */
  introEnd: number;
  /** When the track starts to fade / drop into its outro */
  outroStart: number;
  /**
   * When the ending has died away (~16 dB below the body). Apple Music
   * brings the next song in around here when a song has a real ending.
   */
  decayPoint: number;
  /** Median loudness of the body of the track, in dBFS */
  bodyLoudness: number;
  /** Tempo / grid of the start, used when this track comes in */
  start: TempoSection;
  /** Tempo / grid of the end, used when this track goes out */
  end: TempoSection;
  /** Apple Music catalog id, when its analysis was merged in (see apple-analysis) */
  appleId?: string;
  /** Downbeats that start a phrase, from Apple Music's structure marks */
  phrases?: number[];
  /**
   * Where the song's bass first settles in at its own level (many intros
   * have none), undefined when it never does
   */
  bassEntry?: number;
  /** Where the first real vocal line starts (not a tag over the intro) */
  vocalEntry?: number;
  /** Apple Music says the song fades out (so it doesn't stop on a hit) */
  fadesOut?: boolean;
  /** Stretches with clear singing (not faint ad-libs), from Apple Music */
  vocals?: { start: number; end: number }[];
  /** Apple Music's danceability / acousticness / melodicness ratings */
  traits?: SongTraits;
  /** Apple Music's main genre (e.g. "Dance"), for the effect styles */
  genre?: string;
}

const HOP = 128;
const MIN_BPM = 60;
const MAX_BPM = 200;
const PRIOR_BPM = 120;
const BEAT_TIGHTNESS = 100;
/** How far below the body an ending has to fall to count as died away */
const DECAY_DB = 16;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Mean-square energy per hop, using a 2-hop window */
const frameEnergy = (signal: Float32Array, hop: number) => {
  const blocks = Math.floor(signal.length / hop);
  const block = new Float32Array(blocks);
  for (let b = 0; b < blocks; b++) {
    let sum = 0;
    const offset = b * hop;
    for (let i = 0; i < hop; i++) {
      const v = signal[offset + i];
      sum += v * v;
    }
    block[b] = sum / hop;
  }

  const energy = new Float32Array(blocks);
  for (let b = 0; b < blocks; b++) {
    energy[b] = (block[b] + (b + 1 < blocks ? block[b + 1] : block[b])) / 2;
  }
  return energy;
};

/** Log-compressed, half-wave rectified energy flux */
const bandFlux = (energy: Float32Array) => {
  const flux = new Float32Array(energy.length);
  let previous = Math.log1p(1000 * energy[0]);
  for (let i = 1; i < energy.length; i++) {
    const current = Math.log1p(1000 * energy[i]);
    flux[i] = Math.max(0, current - previous);
    previous = current;
  }
  return flux;
};

const movingAverage = (values: Float32Array, radius: number) => {
  const out = new Float32Array(values.length);
  let sum = 0;
  let count = 0;
  let left = 0;
  let right = -1;
  for (let i = 0; i < values.length; i++) {
    const wantLeft = Math.max(0, i - radius);
    const wantRight = Math.min(values.length - 1, i + radius);
    while (right < wantRight) {
      right++;
      sum += values[right];
      count++;
    }
    while (left < wantLeft) {
      sum -= values[left];
      left++;
      count--;
    }
    out[i] = sum / count;
  }
  return out;
};

const percentile = (values: ArrayLike<number>, p: number) => {
  if (values.length === 0) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[
    clamp(Math.floor(p * (sorted.length - 1)), 0, sorted.length - 1)
  ];
};

export interface OnsetEnvelope {
  /** Frames per second of the envelope */
  fps: number;
  /** Combined onset strength (all bands) */
  onset: Float32Array;
  /** Onset strength of the low band only (used for downbeats) */
  lowOnset: Float32Array;
  /** Full band energy per frame */
  energy: Float32Array;
}

export const computeOnsetEnvelope = (bands: AnalysisBands): OnsetEnvelope => {
  const fps = bands.sampleRate / HOP;
  const energy = frameEnergy(bands.full, HOP);
  const low = bandFlux(frameEnergy(bands.low, HOP));
  const mid = bandFlux(frameEnergy(bands.mid, HOP));
  const high = bandFlux(frameEnergy(bands.high, HOP));

  const length = Math.min(energy.length, low.length, mid.length, high.length);
  const raw = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    raw[i] = (1.2 * low[i]) + mid[i] + (0.8 * high[i]);
  }

  // Remove the slowly varying part so loud sections don't dominate
  const local = movingAverage(raw, Math.round(fps * 0.25));
  const onset = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    onset[i] = Math.max(0, raw[i] - local[i]);
  }

  return { fps, onset, lowOnset: low.subarray(0, length), energy };
};

export interface TempoEstimate {
  bpm: number;
  /** Beat period in frames (fractional) */
  period: number;
  /** Normalised autocorrelation at the beat period (0..1, pulse strength) */
  strength: number;
}

/**
 * Autocorrelation tempo estimate weighted by a log-normal prior around
 * 120 BPM (like librosa), with a little help from the double-period peak.
 */
export const estimateTempo = (
  onset: Float32Array,
  fps: number,
): TempoEstimate | null => {
  const minLag = Math.floor((fps * 60) / MAX_BPM);
  const maxLag = Math.ceil((fps * 60) / MIN_BPM);
  if (onset.length < maxLag * 4) return null;

  let mean = 0;
  for (const v of onset) mean += v;
  mean /= onset.length;
  const centered = new Float32Array(onset.length);
  for (let i = 0; i < onset.length; i++) centered[i] = onset[i] - mean;

  const ac = new Float32Array((maxLag * 2) + 2);
  for (let lag = 0; lag < ac.length; lag++) {
    let sum = 0;
    for (let i = lag; i < centered.length; i++) {
      sum += centered[i] * centered[i - lag];
    }
    ac[lag] = sum / (centered.length - lag);
  }
  if (ac[0] <= 0) return null;

  let bestLag = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / PRIOR_BPM) ** 2));
    const score = (ac[lag] + (0.5 * ac[lag * 2])) * prior;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || ac[bestLag] <= 0) return null;

  // Parabolic interpolation around the peak for sub-frame precision
  let period = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = ac[bestLag - 1];
    const b = ac[bestLag];
    const c = ac[bestLag + 1];
    const denominator = a - (2 * b) + c;
    if (denominator < 0) {
      period = bestLag + clamp((0.5 * (a - c)) / denominator, -0.5, 0.5);
    }
  }

  return {
    bpm: (60 * fps) / period,
    period,
    strength: clamp(ac[bestLag] / ac[0], 0, 1),
  };
};

/**
 * Dynamic programming beat tracker (Ellis, 2007).
 * Returns beat positions in (fractional) frames.
 */
export const trackBeats = (onset: Float32Array, period: number): number[] => {
  const length = onset.length;
  if (length === 0 || period <= 0) return [];

  // Smooth the onset envelope with a gaussian ~1/32 of a beat wide
  const radius = Math.max(1, Math.ceil((4 * period) / 32));
  const kernel = new Float32Array((radius * 2) + 1);
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp(-0.5 * (((i * 32) / period) ** 2));
  }
  let std = 0;
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= length;
  for (const v of onset) std += (v - mean) ** 2;
  std = Math.sqrt(std / length) || 1;

  const local = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < length) sum += kernel[k + radius] * onset[j];
    }
    local[i] = sum / std;
  }

  const cumulative = new Float32Array(length);
  const backlink = new Int32Array(length).fill(-1);
  const minBack = Math.round(period / 2);
  const maxBack = Math.round(period * 2);

  const transitionCost = new Float32Array(maxBack + 1);
  for (let gap = minBack; gap <= maxBack; gap++) {
    transitionCost[gap] = -BEAT_TIGHTNESS * (Math.log(gap / period) ** 2);
  }

  for (let i = 0; i < length; i++) {
    let best = 0;
    let bestIndex = -1;
    for (let j = Math.max(0, i - maxBack); j <= i - minBack; j++) {
      const score = cumulative[j] + transitionCost[i - j];
      if (bestIndex < 0 || score > best) {
        best = score;
        bestIndex = j;
      }
    }
    cumulative[i] = local[i] + (bestIndex >= 0 ? best : 0);
    backlink[i] = bestIndex;
  }

  // The last beat is the strongest cumulative score in the final beat period
  let last = length - 1;
  let lastScore = Number.NEGATIVE_INFINITY;
  for (let i = Math.max(0, length - Math.round(period)); i < length; i++) {
    if (cumulative[i] > lastScore) {
      lastScore = cumulative[i];
      last = i;
    }
  }

  const beats: number[] = [];
  for (let i = last; i >= 0; i = backlink[i]) {
    beats.push(i);
    if (backlink[i] < 0) break;
  }
  beats.reverse();

  // Trim weak beats at both ends (silence / fades)
  const threshold =
    0.5 * Math.sqrt(local.reduce((s, v) => s + (v * v), 0) / length);
  let start = 0;
  let end = beats.length;
  while (start < end && local[beats[start]] < threshold) start++;
  while (end > start && local[beats[end - 1]] < threshold) end--;

  return beats.slice(start, end);
};

/**
 * Picks which beat (mod 4) is most likely the bar's "one": the one where the
 * low end (kick drum / bass) hits hardest on average.
 */
export const findDownbeatPhase = (
  beatFrames: number[],
  lowOnset: Float32Array,
) => {
  if (beatFrames.length < 8) return 0;
  const scores = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < beatFrames.length; i++) {
    const frame = Math.round(beatFrames[i]);
    let peak = 0;
    for (let k = frame - 2; k <= frame + 2; k++) {
      if (k >= 0 && k < lowOnset.length) peak = Math.max(peak, lowOnset[k]);
    }
    scores[i % 4] += peak;
    counts[i % 4]++;
  }
  let best = 0;
  for (let phase = 1; phase < 4; phase++) {
    if (scores[phase] / counts[phase] > scores[best] / counts[best])
      best = phase;
  }
  return best;
};

export interface LoudnessProfile {
  leadingSilenceEnd: number;
  trailingSilenceStart: number;
  introEnd: number;
  outroStart: number;
  decayPoint: number;
  bodyLoudness: number;
}

export const computeLoudnessProfile = (
  energy: Float32Array,
  fps: number,
  duration: number,
): LoudnessProfile => {
  const windowFrames = Math.max(1, Math.round(fps * 0.25));
  const windowSeconds = windowFrames / fps;
  const windows = Math.floor(energy.length / windowFrames);
  if (windows < 4) {
    return {
      leadingSilenceEnd: 0,
      trailingSilenceStart: duration,
      introEnd: 0,
      outroStart: duration,
      decayPoint: duration,
      bodyLoudness: -20,
    };
  }

  const power = new Float32Array(windows);
  for (let w = 0; w < windows; w++) {
    let sum = 0;
    for (let i = 0; i < windowFrames; i++) sum += energy[(w * windowFrames) + i];
    power[w] = sum / windowFrames;
  }
  const db = power.map((p) => 10 * Math.log10(p + 1e-12));

  const loud = percentile(db, 0.95);
  const silence = Math.max(-60, loud - 40);

  let first = 0;
  while (first < windows - 1 && db[first] < silence) first++;
  let last = windows - 1;
  while (last > first && db[last] < silence) last--;

  const leadingSilenceEnd = first * windowSeconds;
  const trailingSilenceStart = Math.min(duration, (last + 1) * windowSeconds);

  // ~2 s smoothing to follow the musical energy rather than single hits
  const smoothPower = movingAverage(power, Math.round(1 / windowSeconds));
  const smoothDb = smoothPower.map((p) => 10 * Math.log10(p + 1e-12));

  const bodyStart = Math.floor(first + ((last - first) * 0.1));
  const bodyEnd = Math.ceil(first + ((last - first) * 0.9));
  const bodyLoudness = percentile(
    smoothDb.subarray(bodyStart, bodyEnd + 1),
    0.5,
  );
  const bodyThreshold = bodyLoudness - 6;

  let introWindow = first;
  while (introWindow < last && smoothDb[introWindow] < bodyThreshold)
    introWindow++;
  let outroWindow = last;
  while (outroWindow > first && smoothDb[outroWindow] < bodyThreshold)
    outroWindow--;

  let decayWindow = outroWindow;
  while (decayWindow < last && smoothDb[decayWindow] >= bodyLoudness - DECAY_DB)
    decayWindow++;

  const introEnd = Math.min(introWindow * windowSeconds, duration / 2);
  const outroStart = Math.min(
    Math.max((outroWindow + 1) * windowSeconds, duration / 2),
    trailingSilenceStart,
  );

  return {
    leadingSilenceEnd,
    trailingSilenceStart,
    introEnd: Math.max(introEnd, leadingSilenceEnd),
    outroStart,
    decayPoint: Math.min(
      Math.max(decayWindow * windowSeconds, outroStart),
      trailingSilenceStart,
    ),
    bodyLoudness,
  };
};

/** Tempo, beat grid and key of one stretch of a track */
export interface TempoSection {
  /** Musical key, when it's clear enough to detect */
  key: MusicalKey | null;
  /** How tonal (not just drums) each part of the section is */
  tonal: TonalProfile | null;
  bpm: number;
  beatPeriod: number;
  tempoConfidence: number;
  beats: number[];
  downbeats: number[];
  /**
   * How much the tempo of the last (or first) 8 beats differs from the
   * section's tempo, e.g. -0.06 for a song slowing down 6% into its end
   */
  drift: number;
}

export const emptySection: TempoSection = {
  key: null,
  tonal: null,
  bpm: 0,
  beatPeriod: 0,
  tempoConfidence: 0,
  beats: [],
  downbeats: [],
  drift: 0,
};

/** Seconds analysed at each end of a track for the mixing tempo / grid */
const SECTION_SECONDS = 45;
/** Beats per window when judging whether the steady beat has started */
const GROOVE_WINDOW = 8;
/**
 * Pulse strength a window needs to count as the steady beat: half the
 * song's typical pulse, within these bounds. Beatless intros measure
 * ~0-0.08, a clear groove 0.3+, and some songs' soft beat ~0.2 throughout
 */
const GROOVE_MIN_STRENGTH = 0.1;
const GROOVE_MAX_STRENGTH = 0.2;
/** Longest beatless intro skipped to come in where the beat starts */
const MAX_INTRO_SKIP = 20;

/**
 * How strongly the onsets repeat at the beat period over a stretch of
 * frames (normalised autocorrelation, like the tempo estimate). A steady
 * groove scores high; speech, ambience or a free-time intro scores low,
 * even where the beat tracker has laid evenly spaced beats over it.
 */
export const localPulse = (
  onset: Float32Array,
  period: number,
  from: number,
  to: number,
) => {
  const lag = Math.round(period);
  const start = Math.max(0, Math.floor(from));
  const end = Math.min(onset.length, Math.ceil(to));
  if (end - start <= lag * 2) return 0;
  let mean = 0;
  for (let i = start; i < end; i++) mean += onset[i];
  mean /= end - start;
  let zero = 0;
  let atLag = 0;
  for (let i = start; i < end; i++) {
    const v = onset[i] - mean;
    zero += v * v;
    if (i - lag >= start) atLag += v * (onset[i - lag] - mean);
  }
  if (zero <= 0) return 0;
  return clamp(
    (atLag / (end - start - lag)) / (zero / (end - start)),
    0,
    1,
  );
};

/**
 * Index of the first beat from which the steady beat has really started:
 * two overlapping windows in a row with a clear pulse for this song. Null
 * if it doesn't start within MAX_INTRO_SKIP of the section's start; 0 if
 * there are too few beats to tell.
 */
const grooveStart = (
  beatFrames: number[],
  onset: Float32Array,
  period: number,
  fps: number,
) => {
  const pulseAt = (i: number) =>
    i + GROOVE_WINDOW < beatFrames.length
      ? localPulse(
          onset,
          period,
          beatFrames[i],
          beatFrames[i + GROOVE_WINDOW],
        )
      : 0;
  // Too few beats to judge two windows: keep them all, as before
  if (beatFrames.length <= GROOVE_WINDOW + 4) return 0;
  const levels: number[] = [];
  for (let i = 0; i + GROOVE_WINDOW < beatFrames.length; i += 4) {
    levels.push(pulseAt(i));
  }
  const threshold = clamp(
    percentile(levels, 0.5) / 2,
    GROOVE_MIN_STRENGTH,
    GROOVE_MAX_STRENGTH,
  );
  for (let i = 0; i + GROOVE_WINDOW + 4 < beatFrames.length; i++) {
    if (beatFrames[i] / fps > MAX_INTRO_SKIP) return null;
    if (pulseAt(i) >= threshold && pulseAt(i + 4) >= threshold) return i;
  }
  return null;
};

const analyzeSection = (
  bands: AnalysisBands,
  envelope: OnsetEnvelope,
  fromSeconds: number,
  toSeconds: number,
  edge: 'start' | 'end',
): TempoSection => {
  const { fps } = envelope;
  const key = detectKey(bands.full, bands.sampleRate, fromSeconds, toSeconds);
  const tonal = tonalProfile(
    bands.full,
    bands.sampleRate,
    fromSeconds,
    toSeconds,
  );
  const first = Math.max(0, Math.floor(fromSeconds * fps));
  const last = Math.min(envelope.onset.length, Math.ceil(toSeconds * fps));
  const onset = envelope.onset.subarray(first, last);
  const lowOnset = envelope.lowOnset.subarray(first, last);

  const tempo = estimateTempo(onset, fps);
  if (!tempo) return { ...emptySection, key, tonal };

  let beatFrames = trackBeats(onset, tempo.period);
  // At a song's start, skip a beatless intro (speech, ambience, a free-time
  // build): the beat tracker lays evenly spaced beats over it anyway, and
  // coming in there would match or cut to beats that aren't there
  if (edge === 'start') {
    const groove = grooveStart(beatFrames, onset, tempo.period, fps);
    beatFrames = groove === null ? [] : beatFrames.slice(groove);
  }
  if (beatFrames.length < 8) {
    return {
      ...emptySection,
      key,
      tonal,
      bpm: tempo.bpm,
      beatPeriod: 60 / tempo.bpm,
    };
  }

  // Refine the tempo from the tracked beats: the AC period tells how many
  // beats the tracked span holds, the span itself gives the precise period
  const span = beatFrames[beatFrames.length - 1] - beatFrames[0];
  let steps = 0;
  for (let i = 1; i < beatFrames.length; i++) {
    steps += Math.max(
      1,
      Math.round((beatFrames[i] - beatFrames[i - 1]) / tempo.period),
    );
  }
  const period = span / steps;

  // Tempo right at the edge we mix on (a ritardando shows up here)
  const edgeFrames =
    edge === 'end' ? beatFrames.slice(-9) : beatFrames.slice(0, 9);
  const edgeIntervals = edgeFrames
    .slice(1)
    .map((frame, i) => frame - edgeFrames[i]);
  const drift = (period / percentile(edgeIntervals, 0.5)) - 1;

  const phase = findDownbeatPhase(beatFrames, lowOnset);
  const beats = beatFrames.map((frame) => (frame + first) / fps);

  return {
    key,
    tonal,
    bpm: (60 * fps) / period,
    beatPeriod: period / fps,
    tempoConfidence: clamp(tempo.strength / 0.3, 0, 1),
    beats,
    downbeats: beats.filter((_, i) => i % 4 === phase),
    drift: Number.isFinite(drift) ? drift : 0,
  };
};

/**
 * Tempo, grid, key and tonal profile of a stretch of a song, from the bands
 * of just that stretch, in song time (`offset` is where the stretch starts)
 */
export const analyzeWindow = (
  bands: AnalysisBands,
  offset: number,
): TempoSection => {
  const envelope = computeOnsetEnvelope(bands);
  const section = analyzeSection(
    bands,
    envelope,
    0,
    bands.full.length / bands.sampleRate,
    'end',
  );
  const shift = (times: number[]) => times.map((time) => time + offset);
  return {
    ...section,
    beats: shift(section.beats),
    downbeats: shift(section.downbeats),
    tonal: section.tonal && {
      ...section.tonal,
      start: section.tonal.start + offset,
    },
  };
};

/** Bass within this much of the song's usual bass level counts as in */
const BASS_PRESENT_DB = 8;
/** ...for at least this long */
const BASS_SUSTAIN = 2;

/** Where the low band first holds near the song's usual bass level */
const findBassEntry = (low: Float32Array, sampleRate: number, from: number) => {
  const frame = Math.round(sampleRate / 4);
  const levels: number[] = [];
  for (let i = 0; i + frame <= low.length; i += frame) {
    let sum = 0;
    for (let k = i; k < i + frame; k++) sum += low[k] * low[k];
    levels.push(sum / frame);
  }
  const sorted = [...levels].sort((x, y) => x - y);
  const usual = sorted[Math.floor(sorted.length * 0.7)];
  if (!(usual > 0)) return undefined;
  const present = usual * (10 ** (-BASS_PRESENT_DB / 10));
  const need = Math.round(BASS_SUSTAIN * 4);
  let run = 0;
  for (let i = Math.floor(from * 4); i < levels.length; i++) {
    run = levels[i] >= present ? run + 1 : 0;
    if (run >= need) return (i - need + 1) / 4;
  }
  return undefined;
};

export const analyzeTrack = (bands: AnalysisBands): TrackAnalysis => {
  const duration = bands.full.length / bands.sampleRate;
  const envelope = computeOnsetEnvelope(bands);
  const loudness = computeLoudnessProfile(
    envelope.energy,
    envelope.fps,
    duration,
  );

  // Tempo can change through a song: mix on the tempo where we actually mix
  const start = analyzeSection(
    bands,
    envelope,
    loudness.leadingSilenceEnd,
    loudness.leadingSilenceEnd + SECTION_SECONDS,
    'start',
  );
  const end = analyzeSection(
    bands,
    envelope,
    loudness.trailingSilenceStart - SECTION_SECONDS,
    loudness.trailingSilenceStart + 0.5,
    'end',
  );
  // Whole-song tempo only (the key and tonal profile are per section)
  const whole = analyzeSection(
    { ...bands, full: new Float32Array(0) },
    envelope,
    0,
    duration,
    'end',
  );

  return {
    duration,
    bpm: whole.bpm,
    beatPeriod: whole.beatPeriod,
    tempoConfidence: whole.tempoConfidence,
    beats: whole.beats,
    downbeats: whole.downbeats,
    ...loudness,
    bassEntry: findBassEntry(
      bands.low,
      bands.sampleRate,
      loudness.leadingSilenceEnd,
    ),
    start,
    end,
  };
};
