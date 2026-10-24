import {
  pickCrossfadeReverb,
  pickEffect,
  pickSpotifyEffect,
  CROSSFADE_REVERB,
} from './effects';
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
   * Mix like Spotify: blends get one of its presets (bass swap at the
   * midpoint, filter sweeps) and come in where the two songs' vocals clash
   * least, when there's no vocal line to land on
   */
  spotifyStyle?: boolean;
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
  /**
   * When the basses swap, as fractions of a blend, where the next song's bass
   * only arrives after the usual swap (measured from the audio)
   */
  bassSwapAt?: [number, number];
  /** Bring the incoming song in high-passed, opening up as it fades in */
  filterIn?: boolean;
  /** Camelot keys at the mix point, when detected (e.g. "8A") */
  fromKey?: string;
  toKey?: string;
  /** Where the incoming song's vocal line starts, when the transition lands on it */
  landsOnVocal?: number;
  /** Apple Music's analysis of either song was used to plan this */
  appleAnalysis?: boolean;
  /** Effect style id the blend is dressed in (see effects.ts) */
  effect?: number;
  /** Share of the blend where both songs sing at once (Spotify's vocal score), when known */
  vocalClash?: number;
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
 * Over clashing keys, a blend where both songs are this tonal at once is
 * reported as a key clash (it's still played at full length: a long blend
 * sounds smoother than a short one, clash or not)
 */
const TONAL_CLASH = 0.12;
/** Blends shorten a bar at a time when the full length doesn't fit */
const BAR_BEATS = 4;

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
  // Singing from the moment it comes in isn't a line it lands on (a short
  // fade's last bars reach back to its start)
  return track.vocals?.find(
    (region) =>
      region.start >= Math.max(plan.mixIn + (span / 2), end - (2 * bar)) &&
      region.start <= end + bar,
  )?.start;
};

/** Spotify splits a blend into this many slices to score vocal clashes */
const VOCAL_BINS = 32;
/** A slice counts as sung when vocals cover this much of it */
const VOCAL_BIN_SHARE = 0.2;

/** How much of [start, end) a song's vocal regions cover */
const vocalShare = (track: TrackAnalysis, start: number, end: number) => {
  let covered = 0;
  for (const region of track.vocals ?? []) {
    covered += Math.max(0, Math.min(end, region.end) - Math.max(start, region.start));
  }
  return end > start ? covered / (end - start) : 0;
};

/**
 * Spotify's vocal score: the share of the blend's slices where both songs
 * sing (the incoming song runs at `rate`). Undefined without vocals for both.
 */
export const vocalClash = (
  from: TrackAnalysis,
  to: TrackAnalysis,
  mixOut: number,
  mixIn: number,
  duration: number,
  rate: number,
) => {
  if (!from.vocals || !to.vocals) return undefined;
  const slice = duration / VOCAL_BINS;
  let clashes = 0;
  for (let i = 0; i < VOCAL_BINS; i++) {
    const out = mixOut + (i * slice);
    const into = mixIn + (i * slice * rate);
    if (
      vocalShare(from, out, out + slice) >= VOCAL_BIN_SHARE &&
      vocalShare(to, into, into + (slice * rate)) >= VOCAL_BIN_SHARE
    ) {
      clashes++;
    }
  }
  return clashes / VOCAL_BINS;
};

/**
 * Furthest a blend moves into the next song to dodge a vocal clash. Apple
 * Music keeps a song's intro (it brings it in quietly under the old song's
 * vocals instead): skipping into a known song is the more noticeable of the two
 */
const MAX_CLASH_SKIP = 8;

/**
 * The incoming entry (a phrase, else a bar, a few seconds in at most) whose
 * blend has the fewest vocal clashes, if it beats `current`
 */
const leastClashingEntry = (
  from: TrackAnalysis,
  to: TrackAnalysis,
  mixOut: number,
  current: number,
  duration: number,
  rate: number,
) => {
  const span = glidedSpan(duration, rate);
  const score = (mixIn: number) =>
    vocalClash(from, to, mixOut, mixIn, duration, rate) ?? 0;
  let best = current;
  let bestScore = score(current);
  const starts = to.phrases?.length ? to.phrases : to.downbeats;
  for (const start of starts) {
    if (
      start < current ||
      start > current + MAX_CLASH_SKIP ||
      start + span > VOCAL_ENTRY_LIMIT
    ) {
      continue;
    }
    const value = score(start);
    if (value < bestScore) {
      best = start;
      bestScore = value;
    }
  }
  return best;
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

const planBlend = (
  from: TrackAnalysis,
  to: TrackAnalysis,
  options: PlannerOptions,
): TransitionPlan | null => {
  const rate = tempoRatio(from.bpm, to.bpm);
  if (!Number.isFinite(rate)) return null;

  // The requested length if it fits, else the longest that does
  for (let beats = options.blendBeats; beats >= 4; beats -= BAR_BEATS) {
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

    const landing = vocalEntry(to, blendEntry(to), glidedSpan(duration, rate));
    const plan: TransitionPlan = {
      style: 'blend',
      reason: 'fallback',
      mixOut,
      mixIn:
        landing ??
        (options.spotifyStyle
          ? leastClashingEntry(from, to, mixOut, blendEntry(to), duration, rate)
          : blendEntry(to)),
      duration,
      rate,
      beat: from.beatPeriod,
      fromBpm: from.bpm,
      toBpm: to.bpm,
    };
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
): TransitionPlan | null => {
  const rate = tempoRatio(from.bpm, to.bpm);
  const hit = finalHit(from);
  if (!Number.isFinite(rate) || hit === undefined) return null;

  for (let beats = options.blendBeats; beats >= 4; beats -= BAR_BEATS) {
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
  let mixOut = options.asap
    ? asapPoint(from, options.earliestMixOut)
    : (latestGridPoint(
        from.downbeats,
        Math.max(options.earliestMixOut, limit - (from.beatPeriod * 4) - 0.01),
        limit,
      ) ?? latestGridPoint(from.beats, options.earliestMixOut, limit));
  if (mixOut === undefined) return null;
  // Never cut a line off mid-way: wait for the first downbeat (else beat)
  // after it, as long as that's still before the song ends
  const cutAt = mixOut;
  const line = from.vocals?.find(
    (region) => region.start < cutAt && region.end > cutAt + 0.1,
  );
  const after = (grid: number[]) =>
    line && grid.find((time) => time >= line.end && time <= end);
  const afterLine = after(from.downbeats) ?? after(from.beats) ?? undefined;
  if (afterLine !== undefined) mixOut = afterLine;

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

  // The tempos don't match, but the next song's beat can still come in on
  // the one: its first downbeat on one of this song's, not anywhere in the
  // bar (a couple of beats either way)
  if (hasBeatGrid(from) && hasBeatGrid(to)) {
    const lead = entryPoint(to) - base.mixIn;
    const target = mixOut + lead;
    const one = from.downbeats.reduce(
      (best, time) =>
        Math.abs(time - target) < Math.abs(best - target) ? time : best,
      Number.POSITIVE_INFINITY,
    );
    const shifted = one - lead;
    const room = from.trailingSilenceStart - shifted;
    if (
      Math.abs(one - target) <= from.beatPeriod * 2 &&
      shifted >= options.earliestMixOut &&
      room >= 1.5
    ) {
      mixOut = shifted;
      duration = Math.min(duration, room);
    }
  }
  return { ...base, mixOut, duration };
};

/**
 * Shortest blend that gets a Spotify preset. Spotify's moves (fade in, bass
 * swap, fade out) bunch up into a couple of seconds on shorter blends and
 * sound abrupt; those keep AutoMix's own blend.
 */
const SPOTIFY_MIN_BARS = 4;

/** Most a song may speed up / slow down at the edge we beat-match on */
const MAX_EDGE_DRIFT = 0.04;

// Apple's planner gates on its own song ratings (decompiled thresholds):
// beat-matched styles need danceability >= 0.3 and acousticness < 0.85 on
// both songs, and keys stop mattering when neither song is melodic (< 0.25)
const MIN_DANCEABILITY = 0.3;
const MAX_ACOUSTICNESS = 0.85;
const MIN_MELODICNESS = 0.25;

/** Apple rates the song as one a beat-matched mix suits (true if unrated) */
const danceable = (track: TrackAnalysis) =>
  (track.traits?.danceability ?? 1) >= MIN_DANCEABILITY &&
  (track.traits?.acousticness ?? 0) < MAX_ACOUSTICNESS;

/** The beat keeps going until the ending has died away */
const beatToTheEnd = (from: TrackAnalysis) =>
  !endsAbruptly(from) && (from.beats.at(-1) ?? 0) >= from.decayPoint - 1;

/**
 * Longest beatless intro a blend still goes into. A blend comes in on a
 * downbeat a couple of seconds in anyway, and a few bars of intro over the
 * old song's beat are what a DJ would play (dance songs often open with a
 * riff or a vocal before the drums); a long one means a song that isn't
 * built to be mixed into
 */
const MAX_BEATLESS_INTRO = 16;

/** The song's beat starts soon enough to blend into */
const beatFromTheStart = (to: TrackAnalysis) =>
  (to.beats[0] ?? Number.POSITIVE_INFINITY) <=
  to.leadingSilenceEnd + MAX_BEATLESS_INTRO;

/**
 * Whether a song's ending can be blended out of, whatever comes next: the
 * same checks planTransition makes on its side of a beat-matched blend
 */
export const canBlendOut = (track: TrackAnalysis) => {
  const from: TrackAnalysis = { ...track, ...track.end };
  return (
    hasBeatGrid(from) &&
    Math.abs(track.end.drift) <= MAX_EDGE_DRIFT &&
    danceable(track) &&
    ((beatToTheEnd(from) && from.tempoConfidence >= DJ_TEMPO_CONFIDENCE) ||
      (endsAbruptly(from) && finalHit(from) !== undefined))
  );
};

/** Whether a song's start can be blended into, whatever comes before */
export const canBlendIn = (track: TrackAnalysis) => {
  const to: TrackAnalysis = { ...track, ...track.start };
  return (
    hasBeatGrid(to) &&
    Math.abs(track.start.drift) <= MAX_EDGE_DRIFT &&
    danceable(track) &&
    beatFromTheStart(to)
  );
};

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
  const beatToEnd = beatToTheEnd(from);
  const beatFromStart = beatFromTheStart(to);
  const steadyBeat =
    from.tempoConfidence >= DJ_TEMPO_CONFIDENCE &&
    to.tempoConfidence >= DJ_TEMPO_CONFIDENCE;
  const suits = danceable(outgoing) && danceable(incoming);
  const djBlend = stretchOk && steadyBeat && suits && beatToEnd && beatFromStart;
  // Songs that stop on the beat: blend into the ending when tempos match
  const endingBlend =
    stretchOk &&
    suits &&
    endsAbruptly(from) &&
    finalHit(from) !== undefined &&
    beatFromStart;

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
      // Beat-matched when the beats allow. Otherwise, two clear beats at
      // different tempos clash however they're faded, so (like Apple Music,
      // e.g. luther -> NOKIA) the song plays its ending and the next comes in
      // as it dies away; songs without a clear beat get a filtered fade
      order =
        djBlend || endingBlend
          ? ['blend', 'smooth', 'segue']
          : gridsOk && steadyBeat
            ? ['segue', 'smooth']
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
          ? (planEndingBlend(from, to, options) ?? planBlend(from, to, options))
          : planBlend(from, to, options)
        : style === 'segue'
          ? planSegue(from, to, options)
          : style === 'cut'
            ? planCut(from, to, options)
            : planSmooth(from, to, options);
    if (plan) {
      const seed = `${outgoing.appleId ?? outgoing.duration}|${incoming.appleId ?? incoming.duration}`;
      let effect: number | undefined;
      const bars = plan.duration / ((plan.beat || 0.5) * 4);
      if (
        options.spotifyStyle &&
        plan.style === 'blend' &&
        !plan.holdOutgoing &&
        bars >= SPOTIFY_MIN_BARS - 0.05
      ) {
        effect = pickSpotifyEffect(bars, seed).id;
      } else if (options.effects && plan.style === 'blend' && !plan.holdOutgoing) {
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
        vocalClash:
          style === 'blend'
            ? vocalClash(from, to, plan.mixOut, plan.mixIn, plan.duration, plan.rate)
            : undefined,
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
          danceable: suits,
          beatToTheEnd: beatToEnd,
          beatFromTheStart: beatFromStart,
          toFirstBeat: Math.round((to.beats[0] ?? -1) * 10) / 10,
          toIntroEnd: Math.round(to.introEnd * 10) / 10,
          toBassEntry:
            to.bassEntry === undefined
              ? '-'
              : Math.round(to.bassEntry * 10) / 10,
          toVocalEntry:
            to.vocalEntry === undefined
              ? '-'
              : Math.round(to.vocalEntry * 10) / 10,
          endsAbruptly: endsAbruptly(from),
        },
      };
    }
  }
  return null;
};
