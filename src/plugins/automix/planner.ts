import { pickCrossfadeReverb, pickEffect, CROSSFADE_REVERB } from './effects';
import { keysClash } from './key';

import type { TempoSection, TrackAnalysis } from './analysis';

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
  /** Maximum relative time-stretch applied to a track (0.08 = ±8%) */
  maxStretch: number;
  /**
   * Both songs can be stretched half way each, so a blend can bridge twice
   * the tempo gap with each song within maxStretch
   */
  splitStretch?: boolean;
  /** Maximum length of a smooth fade, in seconds */
  smoothSeconds: number;
  /** Never segue: beat-match when tempos allow, otherwise cut on the beat */
  beatOnly?: boolean;
  /** Mix points before this time (outgoing timeline) can't be used */
  earliestMixOut: number;
  /** Dress beat-matched blends in one of Apple Music's effect styles */
  effects?: boolean;
  /**
   * Mix now (by hand): start at the first bar from earliestMixOut on (a
   * phrase if one is close) instead of waiting for the outro
   */
  asap?: boolean;
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
  /** Where the incoming song's vocal line starts, when the transition lands on it */
  landsOnVocal?: number;
  /** Apple Music's analysis of either song was used to plan this */
  appleAnalysis?: boolean;
  /** Apple effect style id the blend is dressed in (see effects.ts) */
  effect?: number;
  /**
   * How tonal both songs are at once through a blend (0..1): clashing keys
   * are only heard where both play chords, melody or vocals
   */
  tonalOverlap?: number;
  /** What the planner checked to pick the style, for AutoMix's debug log */
  checks?: Record<string, boolean | number | string>;
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

/**
 * Over clashing keys, blends where both songs are this tonal at once are
 * kept short (to these lengths); over drums the full length is fine
 */
const TONAL_CLASH = 0.12;
const CLASH_BLEND_BEATS = 8;
const CLASH_ENDING_BEATS = 4;

/** Seconds of run-up the player needs to lock a blend's incoming song */
const BLEND_RUN_UP = 2;

/**
 * Latest a vocal line may start in the incoming song for a transition to aim
 * at it. AutoMix plays the incoming side from the song's first 60 s, and a
 * blend still needs room after it to glide back to tempo and hand over.
 */
const VOCAL_ENTRY_LIMIT = 38;

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
  !track.fadesOut && track.trailingSilenceStart - track.outroStart < 2;

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

/**
 * Where the incoming song comes in so that its first vocal line lands right
 * as the transition (`span` seconds of the incoming song) finishes, instead
 * of after a long instrumental intro. The last bar that allows it, never
 * before `earliest`; undefined when the singing starts too late to reach.
 */
const vocalEntry = (track: TrackAnalysis, earliest: number, span: number) =>
  vocalGapEntry(track, earliest, span) ?? firstLineEntry(track, earliest, span);

/**
 * What Apple Music does: overlap a stretch of the incoming song where nobody
 * sings, starting on a phrase, so the two songs' vocals never clash and the
 * next line starts just as the transition finishes. The earliest such phrase
 * (or bar) from `earliest` on, if the song has one in reach.
 */
const vocalGapEntry = (track: TrackAnalysis, earliest: number, span: number) => {
  const vocals = track.vocals;
  if (!vocals?.length || track.beatPeriod <= 0) return undefined;
  const bar = track.beatPeriod * 4;
  const starts = track.phrases?.length ? track.phrases : track.downbeats;
  return starts.find((start) => {
    const end = start + span;
    if (start < earliest || end > VOCAL_ENTRY_LIMIT) return false;
    // Singing during the transition, other than the line it lands on
    const clash = vocals.some(
      (region) =>
        region.end > start + 0.25 &&
        (region.start < end - (2 * bar) || region.start < start),
    );
    // The landing line: starts in the transition's last bars or just after
    const lands = vocals.some(
      (region) =>
        region.start >= Math.max(start, end - (2 * bar)) &&
        region.start <= end + bar,
    );
    return !clash && lands;
  });
};

/**
 * How much of the incoming song a blend covers: the engine glides it from
 * `rate` back to 1x during the blend, so on average it runs in between
 */
const glidedSpan = (duration: number, rate: number) =>
  Math.abs(rate - 1) < 0.001
    ? duration
    : (duration * (rate - 1)) / Math.log(rate);

/** The vocal line that starts as the transition finishes, if there is one */
const vocalLanding = (track: TrackAnalysis, plan: TransitionPlan) => {
  const span =
    plan.style === 'blend' && !plan.holdOutgoing
      ? glidedSpan(plan.duration, plan.rate)
      : plan.duration * plan.rate;
  const end = plan.mixIn + span;
  const bar = track.beatPeriod > 0 ? track.beatPeriod * 4 : 2;
  return track.vocals?.find(
    (region) =>
      region.start >= Math.max(plan.mixIn, end - (2 * bar)) &&
      region.start <= end + bar,
  )?.start;
};

/** Lands the first vocal line once the song is in full swing on the transition's end */
const firstLineEntry = (track: TrackAnalysis, earliest: number, span: number) => {
  if (track.vocalEntry === undefined) return undefined;
  const target = track.vocalEntry - span;
  if (target <= earliest || track.vocalEntry > VOCAL_ENTRY_LIMIT) {
    return undefined;
  }
  return latestGridPoint(track.downbeats, earliest, target);
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

/**
 * Downbeats that start a phrase. Outros are counted back from the song's
 * last bar, since phrases end where the song ends.
 */
const phraseStarts = (track: TrackAnalysis) =>
  track.phrases?.length
    ? track.phrases
    : track.downbeats.filter(
        (_, i) => (track.downbeats.length - 1 - i) % PHRASE_BARS === 0,
      );

/** How far a mix-now may wait for a phrase instead of the next bar, in bars */
const ASAP_PHRASE_BARS = 2;

/**
 * Mix now: the first phrase start within a couple of bars of `earliest`,
 * else the first bar (else beat) from it on
 */
const asapPoint = (track: TrackAnalysis, earliest: number) => {
  const bar = track.beatPeriod * 4;
  return (
    phraseStarts(track).find(
      (time) => time >= earliest && time <= earliest + (ASAP_PHRASE_BARS * bar),
    ) ??
    track.downbeats.find((time) => time >= earliest) ??
    track.beats.find((time) => time >= earliest)
  );
};

/** Latest grid point in [min, max] */
const latestGridPoint = (grid: number[], min: number, max: number) => {
  for (let i = grid.length - 1; i >= 0; i--) {
    if (grid[i] <= max && grid[i] >= min) return grid[i];
    if (grid[i] < min) break;
  }
  return undefined;
};

/**
 * How tonal a song is at a track time: 1 where Apple Music hears clear
 * singing, otherwise our own measure; unknown counts as tonal
 */
const tonalAt = (track: TrackAnalysis, section: TempoSection, time: number) => {
  if (track.vocals?.some((region) => time >= region.start && time < region.end)) {
    return 1;
  }
  const profile = section.tonal;
  if (!profile) return 1;
  return profile.values[Math.floor((time - profile.start) / profile.step)] ?? 1;
};

/**
 * How tonal both songs are at once through a blend: the less tonal of the
 * two at each moment, weighted by how loud both are then
 */
const tonalOverlap = (
  outgoing: TrackAnalysis,
  incoming: TrackAnalysis,
  plan: TransitionPlan,
) => {
  const steps = Math.max(1, Math.ceil(plan.duration / 0.25));
  let sum = 0;
  let weights = 0;
  for (let i = 0; i < steps; i++) {
    const x = (i + 0.5) / steps;
    const time = x * plan.duration;
    const weight = Math.min(
      Math.sin((x * Math.PI) / 2),
      plan.holdOutgoing ? 1 : Math.cos((x * Math.PI) / 2),
    );
    sum +=
      weight *
      Math.min(
        tonalAt(outgoing, outgoing.end, plan.mixOut + time),
        tonalAt(incoming, incoming.start, plan.mixIn + (time * plan.rate)),
      );
    weights += weight;
  }
  return weights > 0 ? sum / weights : 0;
};

/** Whether a blend would be heard clashing, if the keys clash */
type ClashCheck = (plan: TransitionPlan) => boolean;

const planBlend = (
  from: TrackAnalysis,
  to: TrackAnalysis,
  options: PlannerOptions,
  clashes: ClashCheck = () => false,
): TransitionPlan | null => {
  const rate = tempoRatio(from.bpm, to.bpm);
  if (!Number.isFinite(rate)) return null;

  // Try the requested length first, then shorter blends if we're out of
  // room. Clashing keys get a short overlap, unless one side is just drums
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
    const mixOut = options.asap
      ? asapPoint(from, options.earliestMixOut)
      : (latestGridPoint(
          phraseStarts(from),
          // Apple Music's phrase marks are reliable enough to move the whole
          // snap window earlier, so the blend covers whole phrases like Apple's
          Math.max(
            from.phrases?.length
              ? options.earliestMixOut
              : earliest,
            target - PHRASE_SNAP_SECONDS,
          ),
          target + slack,
        ) ??
        latestGridPoint(from.downbeats, earliest, target + slack) ??
        latestGridPoint(from.beats, options.earliestMixOut, target));
    if (
      mixOut === undefined ||
      mixOut + duration > from.trailingSilenceStart + from.beatPeriod
    ) {
      continue;
    }

    const plan: TransitionPlan = {
      style: 'blend',
      reason: 'fallback',
      mixOut,
      mixIn: vocalEntry(to, blendEntry(to), glidedSpan(duration, rate)) ?? blendEntry(to),
      duration,
      rate,
      beat: from.beatPeriod,
      fromBpm: from.bpm,
      toBpm: to.bpm,
    };
    if (beats > CLASH_BLEND_BEATS && clashes(plan)) continue;
    return plan;
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
  clashes: ClashCheck = () => false,
): TransitionPlan | null => {
  const rate = tempoRatio(from.bpm, to.bpm);
  const hit = finalHit(from);
  if (!Number.isFinite(rate) || hit === undefined) return null;

  for (let beats = options.blendBeats; beats >= 4; beats /= 2) {
    const duration = beats * from.beatPeriod;
    const mixOut = hit - duration;
    if (mixOut < options.earliestMixOut) continue;
    const plan: TransitionPlan = {
      style: 'blend',
      reason: 'fallback',
      mixOut,
      mixIn: vocalEntry(to, blendEntry(to), duration * rate) ?? blendEntry(to),
      duration,
      rate,
      beat: from.beatPeriod,
      fromBpm: from.bpm,
      toBpm: to.bpm,
      holdOutgoing: true,
    };
    if (beats > CLASH_ENDING_BEATS && clashes(plan)) continue;
    return plan;
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
  const mixOut = options.asap
    ? asapPoint(from, options.earliestMixOut)
    : (latestGridPoint(
        from.downbeats,
        Math.max(options.earliestMixOut, limit - (from.beatPeriod * 4) - 0.01),
        limit,
      ) ?? latestGridPoint(from.beats, options.earliestMixOut, limit));
  if (mixOut === undefined) return null;

  return {
    style: 'cut',
    reason: 'fallback',
    mixOut,
    mixIn: vocalEntry(to, entryPoint(to), 0) ?? entryPoint(to),
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

  if (options.asap) {
    // Mix now: fade over from the first bar we can, at full length
    const mixOut =
      from.downbeats.find((time) => time >= options.earliestMixOut) ??
      options.earliestMixOut;
    const duration = Math.min(
      options.smoothSeconds,
      from.trailingSilenceStart - mixOut,
    );
    return duration < 1.5 ? null : { ...base, mixOut, duration };
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

// Apple's planner gates on its own song ratings (decompiled thresholds):
// beat-matched styles need danceability >= 0.3 and acousticness < 0.85 on
// both songs, and keys stop mattering when neither song is melodic (< 0.25)
const MIN_DANCEABILITY = 0.3;
const MAX_ACOUSTICNESS = 0.85;
const MIN_MELODICNESS = 0.25;

/** Apple rates both songs as ones a beat-matched mix suits (true if unrated) */
const suitsBeatMatch = (a: TrackAnalysis, b: TrackAnalysis) =>
  [a.traits, b.traits].every(
    (traits) =>
      (traits?.danceability ?? 1) >= MIN_DANCEABILITY &&
      (traits?.acousticness ?? 0) < MAX_ACOUSTICNESS,
  );

const unmelodic = (track: TrackAnalysis) =>
  (track.traits?.melodicness ?? 1) < MIN_MELODICNESS;

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
  // Overlapping clashing keys sounds wrong however good the beat match is,
  // but only where both songs are tonal: over drums alone it's fine
  const clash =
    keysClash(outgoing.end.key, incoming.start.key) &&
    !(unmelodic(outgoing) && unmelodic(incoming));
  const overlap = (plan: TransitionPlan) =>
    tonalOverlap(outgoing, incoming, plan);
  const clashes = (plan: TransitionPlan) =>
    clash && overlap(plan) >= TONAL_CLASH;

  const gridsOk = hasBeatGrid(from) && hasBeatGrid(to);
  const stretchOk =
    gridsOk &&
    steadyEdges &&
    (options.splitStretch
      ? Math.abs(Math.log(tempoRatio(from.bpm, to.bpm))) <=
        2 * Math.log(1 + options.maxStretch)
      : Math.abs(tempoRatio(from.bpm, to.bpm) - 1) <= options.maxStretch);
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
  const danceable = suitsBeatMatch(outgoing, incoming);
  const djBlend =
    stretchOk && steadyBeat && danceable && beatToTheEnd && beatFromTheStart;
  // Songs that stop on the beat: blend into the ending when tempos match
  const endingBlend =
    stretchOk &&
    danceable &&
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
  // Mix now leaves the song mid-way: there's no ending to play out
  if (options.asap) {
    order = order.filter((style) => style !== 'segue');
    if (order.length === 0) order = ['smooth'];
  }

  const reasonFor = (plan: TransitionPlan): TransitionReason => {
    const { style } = plan;
    if (options.preference !== 'auto') {
      return style === options.preference ? 'preference' : 'fallback';
    }
    if (style === 'blend') {
      if (clashes(plan)) return 'key-clash';
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
          ? (planEndingBlend(from, to, options, clashes) ??
            planBlend(from, to, options, clashes))
          : planBlend(from, to, options, clashes)
        : style === 'segue'
          ? planSegue(from, to, options)
          : style === 'cut'
            ? planCut(from, to, options)
            : planSmooth(from, to, options);
    if (plan) {
      const seed = `${outgoing.appleId ?? outgoing.duration}|${incoming.appleId ?? incoming.duration}`;
      let effect: number | undefined;
      if (options.effects && plan.style === 'blend' && !plan.holdOutgoing) {
        effect = pickEffect(
          outgoing.genre,
          incoming.genre,
          plan.duration / ((plan.beat || 0.5) * 4),
          seed,
        ).id;
      } else if (
        options.effects &&
        plan.style === 'smooth' &&
        pickCrossfadeReverb(seed)
      ) {
        effect = CROSSFADE_REVERB.id;
      }
      return {
        ...plan,
        effect,
        reason: reasonFor(plan),
        tonalOverlap: style === 'blend' ? overlap(plan) : undefined,
        fromKey: outgoing.end.key?.camelot,
        toKey: incoming.start.key?.camelot,
        landsOnVocal: vocalLanding(to, plan),
        appleAnalysis: Boolean(outgoing.appleId ?? incoming.appleId),
        checks: {
          tried: order.join('>'),
          tempoGap: Math.round(
            (tempoRatio(from.bpm, to.bpm) - 1) * 1000,
          ) / 10,
          fromBpm: Math.round(from.bpm * 10) / 10,
          toBpm: Math.round(to.bpm * 10) / 10,
          gridsOk,
          steadyEdges,
          stretchOk,
          clash,
          tonalOverlap:
            style === 'blend' ? Math.round(overlap(plan) * 100) / 100 : '-',
          steadyBeat,
          danceable,
          beatToTheEnd,
          beatFromTheStart,
          endsAbruptly: endsAbruptly(from),
        },
      };
    }
  }
  return null;
};
