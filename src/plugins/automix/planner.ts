import { keysClash } from './key';

import type { TrackAnalysis } from './analysis';

export type TransitionStyle = 'blend' | 'segue' | 'cut' | 'smooth';
export type TransitionPreference = 'auto' | TransitionStyle;

/** Why a style was picked, so the UI can explain it */
export type TransitionReason =
  | 'tempo-match'
  | 'ending-blend'
  | 'natural-ending'
  | 'cold-ending'
  | 'natural-fade'
  | 'cold-lead-in'
  | 'loud-handover'
  | 'tempo-mismatch'
  | 'no-beat'
  | 'preference'
  | 'fallback'
  | 'late-change'
  | 'key-clash'
  | 'beat-only-cut';

export interface PlannerOptions {
  preference: TransitionPreference;
  /** Length of a beat-matched blend, in beats of the outgoing track */
  blendBeats: number;
  /** Maximum relative time-stretch applied to the incoming track (0.08 = ±8%) */
  maxStretch: number;
  /** Maximum length of a smooth fade, in seconds */
  smoothSeconds: number;
  /** Never segue: beat-match when tempos allow, otherwise cut on the beat */
  beatOnly?: boolean;
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
  /** Bring the incoming song in high-passed, opening up as it fades in */
  filterIn?: boolean;
  /** Camelot keys at the mix point, when detected (e.g. "8A") */
  fromKey?: string;
  toKey?: string;
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

/** Seconds of run-up the player needs to lock a blend's incoming song */
const BLEND_RUN_UP = 2;

/** Longest a segue waits for an ending to die away before coming in */
const SEGUE_MAX_WAIT = 8;
/** How long the next song's intro may rise in under a song's final hit */
const LEAD_IN_MIN = 1.5;
const LEAD_IN_MAX = 5;
const LEAD_IN_DEFAULT = 3;

/** Both songs need a clearly steady beat before they get a DJ-style blend */
export const DJ_TEMPO_CONFIDENCE = 0.45;

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

/**
 * Where a beat-matched incoming song comes in: a downbeat a couple of
 * seconds in (usually its second bar), so the player has time to lock onto
 * the beat silently before it's heard. A song can't be started before its
 * own beginning, so entering on its very first beat leaves no run-up and
 * it would come in off the beat. In a blend that first bar would be almost
 * silent anyway.
 */
const blendEntry = (track: TrackAnalysis) =>
  track.downbeats.find(
    (time) => time >= track.leadingSilenceEnd + BLEND_RUN_UP,
  ) ?? entryPoint(track);

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

/**
 * Downbeats that start a phrase. Outros are counted back from the song's
 * last bar, since phrases end where the song ends.
 */
const phraseStarts = (track: TrackAnalysis) =>
  track.downbeats.filter(
    (_, i) => (track.downbeats.length - 1 - i) % PHRASE_BARS === 0,
  );

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
  clash = false,
): TransitionPlan | null => {
  const rate = tempoRatio(from.bpm, to.bpm);
  if (!Number.isFinite(rate)) return null;

  // Try the requested length first, then shorter blends if we're out of
  // room. Clashing keys get a short overlap
  const longest = clash ? Math.min(options.blendBeats, 8) : options.blendBeats;
  for (let beats = longest; beats >= 4; beats /= 2) {
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
      mixIn: blendEntry(to),
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
  clash = false,
): TransitionPlan | null => {
  const rate = tempoRatio(from.bpm, to.bpm);
  const hit = finalHit(from);
  if (!Number.isFinite(rate) || hit === undefined) return null;

  const longest = Math.min(options.blendBeats, clash ? 4 : 8);
  for (let beats = longest; beats >= 4; beats /= 2) {
    const duration = beats * from.beatPeriod;
    const mixOut = hit - duration;
    if (mixOut < options.earliestMixOut) continue;
    return {
      style: 'blend',
      reason: 'fallback',
      mixOut,
      mixIn: blendEntry(to),
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

/**
 * An audible transition that doesn't need matching tempos. The next song
 * comes in filtered (no bass) and quiet, then opens up:
 * - a song that fades out: the next one fades in underneath the fade
 * - a song that stops on a hit: the next one's intro rises in under its
 *   last moments, timed so one of its downbeats lands on that hit
 */
const planSmooth = (
  from: TrackAnalysis,
  to: TrackAnalysis,
  options: PlannerOptions,
): TransitionPlan | null => {
  const base = {
    style: 'smooth' as const,
    reason: 'fallback' as const,
    mixIn: to.leadingSilenceEnd,
    rate: 1,
    beat: from.beatPeriod,
    fromBpm: from.bpm,
    toBpm: to.bpm,
    filterIn: true,
  };

  if (endsAbruptly(from)) {
    const hit = finalHit(from) ?? from.trailingSilenceStart - 0.1;
    const downbeat = to.downbeats.find(
      (time) =>
        time - to.leadingSilenceEnd >= LEAD_IN_MIN &&
        time - to.leadingSilenceEnd <= LEAD_IN_MAX,
    );
    const leadIn = downbeat
      ? downbeat - to.leadingSilenceEnd
      : LEAD_IN_DEFAULT;
    const mixOut = hit - leadIn;
    if (mixOut < options.earliestMixOut) return null;
    return { ...base, mixOut, duration: leadIn, holdOutgoing: true };
  }

  // Fade in under the outro, finishing as the ending dies away
  const end = Math.min(from.decayPoint + 1, from.trailingSilenceStart);
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
  return { ...base, mixOut, duration };
};

/** Most a song may speed up / slow down at the edge we beat-match on */
const MAX_EDGE_DRIFT = 0.04;

export const planTransition = (
  outgoing: TrackAnalysis,
  incoming: TrackAnalysis,
  options: PlannerOptions,
): TransitionPlan | null => {
  // Songs change tempo along the way: mix on the outgoing song's tempo and
  // grid at its end, and the incoming song's at its start
  const from: TrackAnalysis = { ...outgoing, ...outgoing.end };
  const to: TrackAnalysis = { ...incoming, ...incoming.start };
  const steadyEdges =
    Math.abs(outgoing.end.drift) <= MAX_EDGE_DRIFT &&
    Math.abs(incoming.start.drift) <= MAX_EDGE_DRIFT;
  // Overlapping clashing keys sounds wrong however good the beat match is
  const clash = keysClash(outgoing.end.key, incoming.start.key);

  const gridsOk = hasBeatGrid(from) && hasBeatGrid(to);
  const stretchOk =
    gridsOk &&
    steadyEdges &&
    Math.abs(tempoRatio(from.bpm, to.bpm) - 1) <= options.maxStretch;
  // DJ-style blends only when the beat keeps going until the ending has
  // died away and the next song comes in on a beat; everything else gets a
  // segue, which is what Apple Music does with songs that really end
  const lastBeat = from.beats.at(-1) ?? 0;
  const beatToTheEnd =
    !endsAbruptly(from) && lastBeat >= from.decayPoint - 1;
  const beatFromTheStart =
    (to.beats[0] ?? Number.POSITIVE_INFINITY) <= to.leadingSilenceEnd + 3;
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
      if (options.beatOnly) {
        // Beat-matched whenever the tempos allow, otherwise a cut on the
        // downbeat; a filtered fade only if there's no beat to cut on
        order = stretchOk ? ['blend', 'cut', 'smooth'] : ['cut', 'smooth'];
        break;
      }
      // Something audible every time: beat-matched when the beats allow,
      // otherwise a filtered fade / lead-in. A plain segue is the last resort
      order =
        djBlend || endingBlend
          ? ['blend', 'smooth', 'segue']
          : ['smooth', 'segue'];
  }
  if (options.beatOnly && options.preference !== 'segue') {
    order = order.filter((style) => style !== 'segue');
  }

  const reasonFor = (style: TransitionStyle): TransitionReason => {
    if (options.preference !== 'auto') {
      return style === options.preference ? 'preference' : 'fallback';
    }
    if (style === 'blend') {
      if (clash) return 'key-clash';
      return endsAbruptly(from) ? 'ending-blend' : 'tempo-match';
    }
    if (style === 'segue') {
      return endsAbruptly(from) ? 'cold-ending' : 'natural-ending';
    }
    if (style === 'cut') {
      return options.beatOnly ? 'beat-only-cut' : 'loud-handover';
    }
    return endsAbruptly(from) ? 'cold-lead-in' : 'natural-fade';
  };

  for (const style of order) {
    const plan =
      style === 'blend'
        ? endsAbruptly(from)
          ? (planEndingBlend(from, to, options, clash) ??
            planBlend(from, to, options, clash))
          : planBlend(from, to, options, clash)
        : style === 'segue'
          ? planSegue(from, to, options)
          : style === 'cut'
            ? planCut(from, to, options)
            : planSmooth(from, to, options);
    if (plan) {
      return {
        ...plan,
        reason: reasonFor(style),
        fromKey: outgoing.end.key?.camelot,
        toKey: incoming.start.key?.camelot,
      };
    }
  }
  return null;
};
