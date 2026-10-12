import type { TrackAnalysis } from './analysis';

export type TransitionStyle = 'blend' | 'segue' | 'cut' | 'smooth';
export type TransitionPreference = 'auto' | TransitionStyle;

/** Why a style was picked, so the UI can explain it */
export type TransitionReason =
  | 'tempo-match'
  | 'ending-blend'
  | 'natural-ending'
  | 'cold-ending'
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
  /**
   * Keep the outgoing song at full volume through the blend and let its
   * final hit ring out, instead of fading it across the blend
   */
  holdOutgoing?: boolean;
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

/** Longest a segue waits for an ending to die away before coming in */
const SEGUE_MAX_WAIT = 8;

/** Both songs need a clearly steady beat before they get a DJ-style blend */
const DJ_TEMPO_CONFIDENCE = 0.6;

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

/** The last hit of a song that stops on the beat, if the grid reaches it */
const finalHit = (track: TrackAnalysis) => {
  const last = track.beats.at(-1);
  return last !== undefined && last >= track.trailingSilenceStart - 4
    ? last
    : undefined;
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

/**
 * For a song that stops on the beat: beat-match the next song in underneath
 * its last bars, keep the old song at full volume, and land the next song's
 * downbeat exactly on the final hit. Nothing of the ending is cut.
 */
const planEndingBlend = (
  from: TrackAnalysis,
  to: TrackAnalysis,
  options: PlannerOptions,
): TransitionPlan | null => {
  const rate = tempoRatio(from.bpm, to.bpm);
  const hit = finalHit(from);
  if (!Number.isFinite(rate) || hit === undefined) return null;

  for (let beats = Math.min(options.blendBeats, 8); beats >= 4; beats /= 2) {
    const duration = beats * from.beatPeriod;
    const mixOut = hit - duration;
    if (mixOut < options.earliestMixOut) continue;
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
      holdOutgoing: true,
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

/**
 * What Apple Music does most: let the song end, and bring the next one in as
 * the ending dies away (or a beat after a song that stops on a hit). The
 * leftover tail fades out underneath; nothing is cut and nothing loud
 * overlaps.
 */
const planSegue = (
  from: TrackAnalysis,
  to: TrackAnalysis,
  options: PlannerOptions,
): TransitionPlan | null => {
  const end = from.trailingSilenceStart;
  const grid = hasBeatGrid(from);
  let mixOut: number;
  let duration: number;

  let mixIn = to.leadingSilenceEnd;

  if (endsAbruptly(from)) {
    // The song stops on a hit: the next song's first downbeat lands right on
    // that hit (its pickup, if any, plays just before), and the hit rings
    // out underneath
    const hit = finalHit(from) ?? end;
    const firstDownbeat = entryPoint(to);
    const pickup = firstDownbeat - to.leadingSilenceEnd;
    mixOut = hit;
    if (pickup > 0 && pickup <= 2) {
      mixOut = hit - pickup;
    } else {
      mixIn = firstDownbeat;
    }
    duration = 1.5;
  } else {
    // Let the ending play out and come in as it dies away, without waiting
    // forever on a long fade or a ringing last note
    mixOut = Math.min(from.decayPoint, from.outroStart + SEGUE_MAX_WAIT, end);
    if (grid) {
      const nearest = from.beats.reduce(
        (best, beat) =>
          Math.abs(beat - mixOut) < Math.abs(best - mixOut) ? beat : best,
        Number.POSITIVE_INFINITY,
      );
      if (Math.abs(nearest - mixOut) <= from.beatPeriod / 2) mixOut = nearest;
    }
    duration = Math.min(3, Math.max(0.5, end - mixOut));
  }

  if (mixOut < options.earliestMixOut) return null;

  return {
    style: 'segue',
    reason: 'fallback',
    mixOut,
    mixIn,
    duration,
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
  // DJ-style blends only when the beat keeps going until the ending has
  // died away and the next song comes in on a beat; everything else gets a
  // segue, which is what Apple Music does with songs that really end
  const lastBeat = from.beats.at(-1) ?? 0;
  const beatToTheEnd =
    !endsAbruptly(from) && lastBeat >= from.decayPoint - 1;
  const beatFromTheStart =
    (to.beats[0] ?? Number.POSITIVE_INFINITY) <= to.leadingSilenceEnd + 1.5;
  const steadyBeat =
    from.tempoConfidence >= DJ_TEMPO_CONFIDENCE &&
    to.tempoConfidence >= DJ_TEMPO_CONFIDENCE;
  const djBlend = stretchOk && steadyBeat && beatToTheEnd && beatFromTheStart;
  // Songs that stop on the beat: blend into the ending when tempos match
  const endingBlend =
    stretchOk &&
    endsAbruptly(from) &&
    finalHit(from) !== undefined &&
    beatFromTheStart;

  let order: TransitionStyle[];
  switch (options.preference) {
    case 'blend':
      order = stretchOk ? ['blend', 'segue', 'smooth'] : ['segue', 'smooth'];
      break;
    case 'cut':
      order = gridsOk ? ['cut', 'segue', 'smooth'] : ['segue', 'smooth'];
      break;
    case 'segue':
      order = ['segue', 'smooth'];
      break;
    case 'smooth':
      order = ['smooth'];
      break;
    default:
      order =
        djBlend || endingBlend
          ? ['blend', 'segue', 'smooth']
          : ['segue', 'smooth'];
  }

  const reasonFor = (style: TransitionStyle): TransitionReason => {
    if (options.preference !== 'auto') {
      return style === options.preference ? 'preference' : 'fallback';
    }
    if (style === 'blend') {
      return endsAbruptly(from) ? 'ending-blend' : 'tempo-match';
    }
    if (style === 'segue') {
      return endsAbruptly(from) ? 'cold-ending' : 'natural-ending';
    }
    if (style === 'cut') return 'loud-handover';
    if (!gridsOk) return 'no-beat';
    return stretchOk ? 'fallback' : 'tempo-mismatch';
  };

  for (const style of order) {
    const plan =
      style === 'blend'
        ? endsAbruptly(from)
          ? (planEndingBlend(from, to, options) ??
            planBlend(from, to, options))
          : planBlend(from, to, options)
        : style === 'segue'
          ? planSegue(from, to, options)
          : style === 'cut'
            ? planCut(from, to, options)
            : planSmooth(from, to, options);
    if (plan) return { ...plan, reason: reasonFor(style) };
  }
  return null;
};
