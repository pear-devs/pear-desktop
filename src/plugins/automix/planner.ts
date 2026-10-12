import type { TrackAnalysis } from './analysis';

export type TransitionStyle = 'blend' | 'cut' | 'smooth';
export type TransitionPreference = 'auto' | TransitionStyle;

/** Why a style was picked, so the UI can explain it */
export type TransitionReason =
  | 'tempo-match'
  | 'loud-handover'
  | 'tempo-mismatch'
  | 'no-beat'
  | 'preference'
  | 'fallback'
  | 'late-change';

export interface PlannerOptions {
  preference: TransitionPreference;
  /** Length of a beat-matched blend, in beats of the outgoing track */
  blendBeats: number;
  /** Maximum relative time-stretch applied to the incoming track (0.08 = ±8%) */
  maxStretch: number;
  /** Maximum length of a smooth fade, in seconds */
  smoothSeconds: number;
  /** Mix points before this time (outgoing timeline) can't be used */
  earliestMixOut: number;
}

export interface TransitionPlan {
  style: TransitionStyle;
  reason: TransitionReason;
  /** Outgoing track time where the incoming track enters */
  mixOut: number;
  /** Incoming track time at that same moment */
  mixIn: number;
  /** Real-time length of the blend / fade, in seconds */
  duration: number;
  /** Incoming playbackRate while mixing (time-stretch to match tempo) */
  rate: number;
  /** Seconds per beat of the outgoing track (0 when unknown) */
  beat: number;
  fromBpm: number;
  toBpm: number;
}

/**
 * How much earlier than strictly needed a mix may start (to begin at the
 * outro, or on a phrase). Starting earlier than this cuts songs short.
 */
const MAX_EARLY_SECONDS = 12;
/** Bars per musical phrase; blends prefer to start on a phrase boundary */
const PHRASE_BARS = 4;
/** How far a blend may move earlier to start on a phrase instead of a bar */
const PHRASE_SNAP_SECONDS = 5;

/** Minimum tempo confidence to trust a beat grid */
export const MIN_TEMPO_CONFIDENCE = 0.35;

const hasBeatGrid = (track: TrackAnalysis) =>
  track.tempoConfidence >= MIN_TEMPO_CONFIDENCE && track.downbeats.length > 0;

/** A track that is still loud right up to its last audible moment */
export const endsAbruptly = (track: TrackAnalysis) =>
  track.trailingSilenceStart - track.outroStart < 2;

/** A track that hits its full energy almost immediately */
export const startsPunchy = (track: TrackAnalysis) =>
  track.introEnd - track.leadingSilenceEnd < 1;

/**
 * Ratio to apply to the incoming playbackRate so it matches the outgoing
 * tempo, allowing half / double time matches (e.g. 87 ↔ 174 BPM).
 */
export const tempoRatio = (fromBpm: number, toBpm: number) => {
  if (fromBpm <= 0 || toBpm <= 0) return Number.NaN;
  let best = Number.NaN;
  for (const multiple of [0.5, 1, 2]) {
    const ratio = fromBpm / (toBpm * multiple);
    if (
      Number.isNaN(best) ||
      Math.abs(Math.log(ratio)) < Math.abs(Math.log(best))
    ) {
      best = ratio;
    }
  }
  return best;
};

/** First downbeat of the incoming track once it's audible */
const entryPoint = (track: TrackAnalysis) => {
  const audible = track.leadingSilenceEnd - 0.05;
  const grid = track.downbeats.length > 0 ? track.downbeats : track.beats;
  return grid.find((time) => time >= audible) ?? track.leadingSilenceEnd;
};

/** Downbeats that start a phrase, counted from the first bar */
const phraseStarts = (track: TrackAnalysis) =>
  track.downbeats.filter((_, i) => i % PHRASE_BARS === 0);

/** Latest grid point in [min, max] */
const latestGridPoint = (grid: number[], min: number, max: number) => {
  for (let i = grid.length - 1; i >= 0; i--) {
    if (grid[i] <= max && grid[i] >= min) return grid[i];
    if (grid[i] < min) break;
  }
  return undefined;
};

const planBlend = (
  from: TrackAnalysis,
  to: TrackAnalysis,
  options: PlannerOptions,
): TransitionPlan | null => {
  const rate = tempoRatio(from.bpm, to.bpm);
  if (!Number.isFinite(rate)) return null;

  // Try the requested length first, then shorter blends if we're out of room
  for (let beats = options.blendBeats; beats >= 4; beats /= 2) {
    const duration = beats * from.beatPeriod;
    const latestStart = from.trailingSilenceStart - duration;
    // Start in the outro, but never so late that the blend runs past the end
    // and never so early that the song feels cut short
    const target = Math.max(
      Math.min(from.outroStart, latestStart),
      latestStart - MAX_EARLY_SECONDS,
    );
    // Allow up to a bar earlier than the target to land on a bar start
    const earliest = Math.max(
      options.earliestMixOut,
      target - (from.beatPeriod * 4) - 0.01,
    );
    const slack = from.beatPeriod / 2;
    // Prefer a phrase boundary close to the target, then any bar, then a beat
    const mixOut =
      latestGridPoint(
        phraseStarts(from),
        Math.max(earliest, target - PHRASE_SNAP_SECONDS),
        target + slack,
      ) ??
      latestGridPoint(from.downbeats, earliest, target + slack) ??
      latestGridPoint(from.beats, options.earliestMixOut, target);
    if (
      mixOut === undefined ||
      mixOut + duration > from.trailingSilenceStart + from.beatPeriod
    ) {
      continue;
    }

    return {
      style: 'blend',
      reason: 'fallback',
      mixOut,
      mixIn: entryPoint(to),
      duration,
      rate,
      beat: from.beatPeriod,
      fromBpm: from.bpm,
      toBpm: to.bpm,
    };
  }

  return null;
};

const planCut = (
  from: TrackAnalysis,
  to: TrackAnalysis,
  options: PlannerOptions,
): TransitionPlan | null => {
  // Cut on the last bar before the outro fades away, without throwing away
  // more than a few seconds of the song
  const end = from.trailingSilenceStart - 0.1;
  const limit = Math.max(
    Math.min(from.outroStart + from.beatPeriod, end),
    end - MAX_EARLY_SECONDS,
  );
  const mixOut =
    latestGridPoint(
      from.downbeats,
      Math.max(options.earliestMixOut, limit - (from.beatPeriod * 4) - 0.01),
      limit,
    ) ?? latestGridPoint(from.beats, options.earliestMixOut, limit);
  if (mixOut === undefined) return null;

  return {
    style: 'cut',
    reason: 'fallback',
    mixOut,
    mixIn: entryPoint(to),
    duration: from.beatPeriod,
    rate: 1,
    beat: from.beatPeriod,
    fromBpm: from.bpm,
    toBpm: to.bpm,
  };
};

const planSmooth = (
  from: TrackAnalysis,
  to: TrackAnalysis,
  options: PlannerOptions,
): TransitionPlan | null => {
  const end = from.trailingSilenceStart;
  let duration = Math.min(
    Math.max(end - from.outroStart, 4),
    options.smoothSeconds,
  );
  let mixOut = end - duration;
  if (mixOut < options.earliestMixOut) {
    mixOut = options.earliestMixOut;
    duration = end - mixOut;
  }
  if (duration < 1.5) return null;

  return {
    style: 'smooth',
    reason: 'fallback',
    mixOut,
    mixIn: to.leadingSilenceEnd,
    duration,
    rate: 1,
    beat: from.beatPeriod,
    fromBpm: from.bpm,
    toBpm: to.bpm,
  };
};

export const planTransition = (
  from: TrackAnalysis,
  to: TrackAnalysis,
  options: PlannerOptions,
): TransitionPlan | null => {
  const gridsOk = hasBeatGrid(from) && hasBeatGrid(to);
  const stretchOk =
    gridsOk && Math.abs(tempoRatio(from.bpm, to.bpm) - 1) <= options.maxStretch;
  const punchy = endsAbruptly(from) && startsPunchy(to);

  let order: TransitionStyle[];
  switch (options.preference) {
    case 'blend':
      order = stretchOk ? ['blend', 'smooth'] : ['smooth'];
      break;
    case 'cut':
      order = gridsOk ? ['cut', 'smooth'] : ['smooth'];
      break;
    case 'smooth':
      order = ['smooth'];
      break;
    default:
      if (stretchOk)
        order = punchy ? ['cut', 'blend', 'smooth'] : ['blend', 'smooth'];
      else if (gridsOk && punchy) order = ['cut', 'smooth'];
      else order = ['smooth'];
  }

  const reasonFor = (style: TransitionStyle): TransitionReason => {
    if (options.preference !== 'auto') {
      return style === options.preference ? 'preference' : 'fallback';
    }
    if (style === 'cut') return 'loud-handover';
    if (style === 'blend') return 'tempo-match';
    if (!gridsOk) return 'no-beat';
    return stretchOk ? 'fallback' : 'tempo-mismatch';
  };

  for (const style of order) {
    const plan =
      style === 'blend'
        ? planBlend(from, to, options)
        : style === 'cut'
          ? planCut(from, to, options)
          : planSmooth(from, to, options);
    if (plan) return { ...plan, reason: reasonFor(style) };
  }
  return null;
};
