/**
 * DJ hand-offs, after two Spotify Mix custom transitions measured against
 * the original recordings (SexyBack into Gimme More, Did It First into
 * Ainvayi Ainvayi). Both songs play at full level the whole time; the mix is
 * done by handing the low end from one song to the other with a band kill
 * (LR4 at ~300 Hz) switched on a bar line, so there is only ever one bass,
 * and the two vocals never overlap. What makes them land is where they sit:
 * on landmarks of both songs, found here from the band levels and Apple
 * Music's vocals / phrases.
 *
 * - Outro swap: the next song's sparse intro plays under the old song's
 *   instrumental outro for 8 (or 4) bars, the basses swap half way and the
 *   old song stops on its last beat, as the next one's hook arrives.
 * - Pickup hand-off: the old song is cut at the end of one of its own
 *   breakdowns; the next song starts from its first note, so its pickup
 *   (a tag, a count-in line) fills the bar after; for one bar the old song's
 *   kick and bass carry the new song's top end; then the basses swap and the
 *   new bass lands a few dB hot, easing back over 14 bars.
 */

import { levelDb, type TrackAnalysis } from './analysis';

import type { TransitionPlan } from './planner';

const BAR_BEATS = 4;

/** A bar this much quieter (lows) than the bars before is where the beat stopped */
const BEAT_END_DROP_DB = 12;
/** ...and the rest of the song stays at least this far under them */
const BEAT_END_STAYS_DB = 9;
/** Furthest from the end a song's beat end is looked for */
const BEAT_END_SEARCH = 40;
/** Overlap of an outro swap, in bars, longest first */
const OUTRO_BARS = [8, 4];
/** Longest an outro swap's overlap may be, in seconds (8 bars at ~120 BPM) */
const OUTRO_MAX_SECONDS = 16.5;
/** The next song's intro under the old song must be this much under its body */
const SPARSE_DB = 4;

/** A breakdown's bars are this much quieter (lows) than the bars before it */
const BREAKDOWN_DB = 5;
/** Longest breakdown that is still one (in bars) */
const BREAKDOWN_MAX_BARS = 8;
/** After the breakdown the groove must be back within this of before */
const GROOVE_BACK_DB = 3;
/** Earliest a pickup hand-off may cut the old song, before its end */
const HANDOFF_MAX_EARLY = 45;
/** The next song's first bar must be within this of its body level: punchy */
const PUNCHY_DB = 3;
/** A pickup must be at least this loud (mids) against the song's body */
const PICKUP_DB = 12;
/** Bars the new bass takes to ease back to its own level */
const DECAY_BARS = 14;
const MIN_DECAY_BARS = 4;
/** The old song's bass while it carries the beat for a bar */
const LIFT_DB = 2;
/** The new bass when it lands */
const SHELF_DB = 5;

/**
 * Seconds of the next song our copy still plays after a hand-off's window:
 * the engine's 8 s glide back to the song's own tempo, then a margin for
 * the player to take over before the copy runs out
 */
const HEAD_AFTER = 14.5;

export interface HandoffContext {
  /** Outgoing song, with its end section's grid */
  from: TrackAnalysis;
  /** Incoming song, with its start section's grid */
  to: TrackAnalysis;
  /** Incoming playback rate that matches the tempos */
  rate: number;
  /** The keys clash while both songs are tonal */
  clash: boolean;
  earliestMixOut: number;
  headSeconds: number;
}

type Handoff = Omit<TransitionPlan, 'reason'> & {
  /** How strong the landmark is, to choose between recipes */
  score: number;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** First downbeat once the song is audible */
const entryPoint = (track: TrackAnalysis) => {
  const audible = track.leadingSilenceEnd - 0.05;
  const grid = track.downbeats.length > 0 ? track.downbeats : track.beats;
  return grid.find((time) => time >= audible) ?? track.leadingSilenceEnd;
};

/**
 * Whether nobody sings from `from` to `to`: lines shorter than a beat (a
 * tag, an ad-lib) are let through as long as they add up to under two
 * beats. Undefined when the song's vocals aren't known.
 */
const vocalFree = (
  track: TrackAnalysis,
  from: number,
  to: number,
  beat: number,
) => {
  if (!track.vocals) return undefined;
  let total = 0;
  for (const region of track.vocals) {
    const overlap = Math.min(region.end, to) - Math.max(region.start, from);
    if (overlap <= 0) continue;
    if (overlap >= beat) return false;
    total += overlap;
  }
  return total < 2 * beat;
};

const lowBar = (track: TrackAnalysis, at: number, bar: number) =>
  levelDb(track, 'low', at, at + bar);

/**
 * Where the old song's beat stops for good: the first downbeat whose bar is
 * far quieter in the lows than the bars before, with the beat never coming
 * back after it. Did It First: −23 dB, then only its last hit ringing out.
 */
const beatEnd = (from: TrackAnalysis) => {
  const bar = from.beatPeriod * BAR_BEATS;
  const end = from.trailingSilenceStart;
  // The grid can stop short of the last bar: carry it on to the end
  const grid = [...from.downbeats];
  const last = grid.at(-1);
  if (last !== undefined && bar > 0) {
    for (let time = last + bar; time <= end; time += bar) grid.push(time);
  }
  const downbeats = grid.filter(
    (time) => time >= end - BEAT_END_SEARCH && time <= end,
  );
  // The first such bar: the rest of the song staying quiet makes it the end
  for (const at of downbeats) {
    const before = [1, 2, 3, 4]
      .map((k) => lowBar(from, at - (k * bar), bar))
      .filter((db): db is number => db !== undefined);
    // From its second beat: a last hit on the downbeat may still ring
    const here = levelDb(from, 'low', at + from.beatPeriod, at + bar);
    if (before.length < 4 || here === undefined) continue;
    const reference = median(before);
    if (here > reference - BEAT_END_DROP_DB) continue;
    const after = levelDb(from, 'low', at + from.beatPeriod, end);
    if (after === undefined || after > reference - BEAT_END_STAYS_DB) continue;
    return at;
  }
  return undefined;
};

/** Downbeats that start a phrase (Apple's marks, else every 4th from the end) */
const phraseStarts = (track: TrackAnalysis) =>
  track.phrases?.length
    ? track.phrases
    : track.downbeats.filter((_, i) => (track.downbeats.length - 1 - i) % 4 === 0);

/**
 * Where the old song should stop for an outro swap: where its beat ends,
 * or on a song that fades out, the phrase its fade starts at (the fade is
 * cut, like a DJ would)
 */
const outroExit = (from: TrackAnalysis) => {
  const end = beatEnd(from);
  if (end !== undefined) return end;
  const bar = from.beatPeriod * BAR_BEATS;
  const last = (grid: number[]) =>
    grid.filter((time) => time <= from.outroStart + (bar / 2)).at(-1);
  const phrase = last(phraseStarts(from));
  if (phrase !== undefined && phrase >= from.outroStart - (4 * bar)) return phrase;
  return last(from.downbeats);
};

/**
 * Outro swap: the next song's intro under the old song's outro at full
 * level, bass swapped half way, the old song stopping on its last beat as
 * the next one's hook (or bass) arrives
 */
export const planOutroSwap = (c: HandoffContext): Handoff | null => {
  const { from, to, rate } = c;
  const bar = from.beatPeriod * BAR_BEATS;
  const barIn = to.beatPeriod * BAR_BEATS;
  // Two vocals must never overlap, so both songs' vocals must be known
  if (
    !(bar > 0 && barIn > 0) ||
    !from.levels ||
    !to.levels ||
    !from.vocals ||
    !to.vocals ||
    c.clash
  ) {
    return null;
  }
  const exit = outroExit(from);
  if (exit === undefined) return null;

  const entry = entryPoint(to);
  // Where the next song really arrives: its first line (else its bass)
  const target = to.vocalEntry ?? to.bassEntry ?? to.introEnd;
  const grid = to.phrases?.length ? to.phrases : to.downbeats;
  const arrival =
    grid.find((time) => time >= target - (barIn / 2)) ??
    to.downbeats.find((time) => time >= target - (barIn / 2));

  for (const bars of OUTRO_BARS) {
    const start = exit - (bars * bar);
    if (start < c.earliestMixOut || bars * bar > OUTRO_MAX_SECONDS) continue;
    if (!vocalFree(from, start, exit - 0.1, from.beatPeriod)) continue;

    const span = bars * bar * rate;
    let mixIn = arrival === undefined ? entry : arrival - span;
    // An intro shorter than the overlap: the overlap is the song's first bars
    if (mixIn < entry - 0.05) mixIn = entry;
    const lands = mixIn + span;
    if (mixIn < 0 || lands + HEAD_AFTER > c.headSeconds) continue;
    // A pickup line just before the arrival is fine (reel 2 has one)
    if (!vocalFree(to, mixIn, lands - (3 * to.beatPeriod), to.beatPeriod)) continue;
    // Two dense songs at full level would be mud: the intro must be sparse
    const level = levelDb(to, 'full', mixIn, lands);
    if (level === undefined || level > to.bodyLoudness - SPARSE_DB) continue;

    const landsOnVocal =
      to.vocalEntry !== undefined && Math.abs(to.vocalEntry - lands) <= barIn
        ? to.vocalEntry
        : undefined;
    return {
      style: 'blend',
      mixOut: start,
      mixIn,
      duration: bars * bar,
      rate,
      beat: from.beatPeriod,
      fromBpm: from.bpm,
      toBpm: to.bpm,
      landsOnVocal,
      recipe: { kind: 'outro', bars },
      score: (bars / 4) + (landsOnVocal === undefined ? 0 : 1),
    };
  }
  return null;
};

/**
 * Longest run of quiet bars (lows) that ends at `at`, against the four bars
 * before the run: its length and how much quieter it is (0 when none)
 */
const breakdownBefore = (from: TrackAnalysis, at: number, bar: number) => {
  let best = { bars: 0, depth: 0, reference: 0 };
  for (let n = 1; n <= BREAKDOWN_MAX_BARS; n++) {
    const reference = [1, 2, 3, 4]
      .map((k) => lowBar(from, at - ((n + k) * bar), bar))
      .filter((db): db is number => db !== undefined);
    const run = Array.from({ length: n }, (_, k) =>
      lowBar(from, at - ((k + 1) * bar), bar),
    );
    if (reference.length < 4 || run.some((db) => db === undefined)) break;
    const ref = median(reference);
    const levels = run as number[];
    if (levels.some((db) => db > ref - BREAKDOWN_DB)) continue;
    const depth = ref - (levels.reduce((a, b) => a + b, 0) / n);
    best = { bars: n, depth, reference: ref };
  }
  return best;
};

/**
 * Pickup hand-off: cut the old song as one of its breakdowns ends, the next
 * song's pickup in the bar after, then its top end over the old song's beat
 * for a bar, then the basses swap and the new one lands hot
 */
export const planPickupHandoff = (c: HandoffContext): Handoff | null => {
  const { from, to, rate } = c;
  const bar = from.beatPeriod * BAR_BEATS;
  const barIn = to.beatPeriod * BAR_BEATS;
  if (!(bar > 0 && barIn > 0) || !from.levels || !to.levels) return null;

  // The next song must hit straight away on its first downbeat
  const first = entryPoint(to);
  const punch = levelDb(to, 'full', first, first + barIn);
  if (punch === undefined || punch < to.bodyLoudness - PUNCHY_DB) return null;

  // A real pickup before it (a line, a riff), half a bar to a bar long
  const pickup = first - to.leadingSilenceEnd;
  const pickupLevel = levelDb(to, 'mid', to.leadingSilenceEnd, first);
  const sung = to.vocals?.some(
    (region) => region.end > to.leadingSilenceEnd && region.start < first,
  );
  const gapBars =
    pickup >= barIn / 2 &&
    pickup <= barIn + 0.05 &&
    (sung ||
      (pickupLevel !== undefined && pickupLevel >= to.bodyLoudness - PICKUP_DB))
      ? 1
      : 0;
  // Keys that clash: no bar of the old beat under the new song's chords
  const overlapBars = c.clash ? 0 : 1;

  const end = from.trailingSilenceStart;
  const lo = Math.max(c.earliestMixOut + bar, end - HANDOFF_MAX_EARLY);
  const hi = Math.min(end - (3 * bar), from.decayPoint);
  const phrases = new Set(phraseStarts(from));
  let best: { at: number; score: number; depth: number } | undefined;
  for (const at of from.downbeats) {
    if (at < lo || at > hi) continue;
    const breakdown = breakdownBefore(from, at, bar);
    if (breakdown.bars === 0) continue;
    // ...and the groove is back after it, where the old beat is heard
    const back = lowBar(from, at + (gapBars * bar), bar);
    if (back === undefined || back < breakdown.reference - GROOVE_BACK_DB) {
      continue;
    }
    // Never cut a line off
    if (
      from.vocals?.some(
        (region) => region.start < at - 0.1 && region.end > at + 0.1,
      )
    ) {
      continue;
    }
    const score =
      breakdown.depth +
      (phrases.has(at) ? 2 : 0) -
      ((end - at) / 30);
    if (!best || score > best.score) {
      best = { at, score, depth: breakdown.depth };
    }
  }
  if (!best) return null;

  // The new song's copy plays until its bass has eased back: fit the head
  const mixIn = first - (gapBars * bar * rate);
  let decayBars = DECAY_BARS;
  const fits = (k: number) =>
    mixIn + ((gapBars + overlapBars + k) * bar * rate) + HEAD_AFTER <= c.headSeconds;
  while (decayBars > MIN_DECAY_BARS && !fits(decayBars)) decayBars--;
  if (!fits(decayBars)) return null;

  return {
    style: 'blend',
    mixOut: best.at,
    mixIn,
    duration: (gapBars + overlapBars + decayBars) * bar,
    rate,
    beat: from.beatPeriod,
    fromBpm: from.bpm,
    toBpm: to.bpm,
    landsOnVocal: undefined,
    recipe: {
      kind: 'pickup',
      gapBars,
      overlapBars,
      decayBars,
      liftDb: LIFT_DB,
      shelfDb: SHELF_DB,
    },
    score: best.depth + (gapBars ? 3 : 0),
  };
};

/**
 * The hand-off for a pair, if one fits: a pickup hand-off when the next song
 * has a pickup to drop on, otherwise an outro swap, otherwise whichever fits
 */
export const planHandoff = (
  c: HandoffContext,
  prefer: 'any' | 'pickup',
): Handoff | null => {
  const pickup = planPickupHandoff(c);
  if (prefer === 'pickup') return pickup;
  const outro = planOutroSwap(c);
  if (pickup?.recipe?.kind === 'pickup' && pickup.recipe.gapBars > 0) {
    return pickup;
  }
  return outro ?? pickup;
};
