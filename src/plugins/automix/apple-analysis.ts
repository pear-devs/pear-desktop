/**
 * Merges Apple Music's analysis of a song into AutoMix's own. Apple's beat
 * grid comes from the master and is steadier than ours, and it marks what
 * our DSP can't see: phrases, sections and where the singing starts.
 *
 * Apple's times are for Apple's file, which can start a little earlier or
 * later than the copy YouTube Music streams, so they're lined up first.
 */

import { camelotFor, type MusicalKey } from './key';

import type { TempoSection, TrackAnalysis } from './analysis';
import type { AppleAnalysis, VocalStrength } from './constants';

/** Furthest the two files may be shifted from each other, in seconds */
const MAX_SHIFT = 3;
/** Loudness floor when comparing curves, so silence doesn't dominate */
const SILENCE_DB = -60;
/** How alike the two loudness curves must be to trust the coarse shift */
const MIN_LOUDNESS_MATCH = 0.75;
/** Share of our beats that must sit on Apple's grid to use Apple's grid */
const MIN_BEATS_ON_GRID = 0.6;
/** How close one of our beats must be to Apple's to count as the same beat */
const BEAT_TOLERANCE = 0.035;
/** The fine search: 5 ms steps up to 0.4 s either side of the coarse shift */
const FINE_STEP = 0.005;
const FINE_STEPS = 80;
/**
 * How much better the best shift must fit than one a beat away (fit = share
 * of our beats plus share of our downbeats on Apple's grid, 0..2)
 */
const MIN_FIT_MARGIN = 0.25;
/** How far off the loudness-based shift can be and still pick between beats */
const MAX_COARSE_ERROR = 0.15;
/**
 * How far our tempo may be from Apple's (or from twice / half of it) and
 * still be the same pulse. Further off, our tracker has locked onto another
 * layer of the rhythm (e.g. a 4:3 one over a hip-hop beat) and Apple's grid,
 * taken from the master, is the song's beat
 */
const SAME_PULSE = 0.04;
/** Apple's structure scores: 600+ starts a 4-bar phrase */
const PHRASE_SCORE = 600;
/** Shortest fade-out that counts as the song fading rather than stopping */
const MIN_FADE_OUT = 2;
/** Vocal strengths that count as someone singing a line */
const LINE_STRENGTHS: VocalStrength[] = ['medium', 'high', 'very-high'];

export interface AppleAlignment {
  /** Our time = Apple's time + offset */
  offset: number;
  /** Apple's beats land on ours, so its grid can replace ours */
  gridOk: boolean;
  /** Why the grid was or wasn't used (shown in AutoMix's debug log) */
  detail?: string;
}

/** Share of `times` within BEAT_TOLERANCE of one of `grid`'s, both sorted */
const onGridShare = (times: number[], grid: number[], offset: number) => {
  if (times.length === 0 || grid.length === 0) return 0;
  let hits = 0;
  let j = 0;
  for (const value of times) {
    const time = value - offset;
    while (j + 1 < grid.length && grid[j + 1] <= time) j++;
    const distance = Math.min(
      Math.abs(time - grid[j]),
      j + 1 < grid.length ? Math.abs(grid[j + 1] - time) : Infinity,
    );
    if (distance <= BEAT_TOLERANCE) hits++;
  }
  return hits / times.length;
};

/**
 * How far our copy is shifted from Apple's file, from the loudness curves:
 * Apple's values (1 s windows every 0.5 s) against ours (the same windows
 * every `hop` seconds)
 */
const loudnessShift = (
  apple: AppleAnalysis,
  loudness: ArrayLike<number>,
  hop: number,
) => {
  // Silence reads anywhere down to -100 dB; it shouldn't outweigh the music
  const floor = (value: number) => Math.max(value, SILENCE_DB);
  const theirs = apple.loudness.map(floor);
  const ours = Array.from(loudness, floor);
  const stride = Math.round(0.5 / hop);
  const maxLag = Math.round(MAX_SHIFT / hop);
  // Pearson correlation of the overlapping part at each shift
  const correlation = (lag: number) => {
    let n = 0;
    let sumA = 0;
    let sumB = 0;
    let sumAA = 0;
    let sumBB = 0;
    let sumAB = 0;
    for (let i = 0; i < theirs.length; i++) {
      const j = (i * stride) + lag;
      if (j < 0 || j >= ours.length) continue;
      const a = theirs[i];
      const b = ours[j];
      n++;
      sumA += a;
      sumB += b;
      sumAA += a * a;
      sumBB += b * b;
      sumAB += a * b;
    }
    if (n < 20) return 0;
    const covariance = sumAB - ((sumA * sumB) / n);
    const variance = (sumAA - ((sumA * sumA) / n)) * (sumBB - ((sumB * sumB) / n));
    return variance > 0 ? covariance / Math.sqrt(variance) : 0;
  };
  let best = { lag: 0, score: Number.NEGATIVE_INFINITY };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const score = correlation(lag);
    if (score > best.score) best = { lag, score };
  }
  return best.score < MIN_LOUDNESS_MATCH ? null : best.lag * hop;
};

/**
 * Coarse shift from the loudness curves, then the shift near it at which our
 * tracked beats and bars sit on Apple's. A beat grid looks the same shifted
 * by a whole beat, and the loudness can't always tell those apart, so the
 * bars decide; if it's still a toss-up, Apple's grid isn't used.
 */
export const alignApple = (
  apple: AppleAnalysis,
  loudness: ArrayLike<number>,
  hop: number,
  beats: number[],
  downbeats: number[],
): AppleAlignment | null => {
  const coarse = loudnessShift(apple, loudness, hop);
  if (coarse === null) return null;

  const candidates: { offset: number; fit: number }[] = [];
  let bestBeatShare = { offset: coarse, share: 0 };
  for (let step = -FINE_STEPS; step <= FINE_STEPS; step++) {
    const offset = coarse + (step * FINE_STEP);
    const beatShare = onGridShare(beats, apple.beats, offset);
    if (beatShare > bestBeatShare.share) bestBeatShare = { offset, share: beatShare };
    if (beatShare < MIN_BEATS_ON_GRID) continue;
    const barShare = onGridShare(downbeats, apple.bars, offset);
    candidates.push({ offset, fit: beatShare + barShare });
  }
  if (candidates.length === 0) {
    const ours = periodOf(beats) > 0 ? 60 / periodOf(beats) : 0;
    const ratio = apple.bpm.main > 0 ? ours / apple.bpm.main : 0;
    const samePulse = [0.5, 1, 2].some(
      (k) => Math.abs(ratio - k) <= k * SAME_PULSE,
    );
    if (ours > 0 && ratio > 0 && !samePulse) {
      // Our beats sit on another pulse: Apple's grid, placed by the loudness
      // (or the beats the two pulses share, when they agree with it)
      const shared = Math.abs(bestBeatShare.offset - coarse) <= MAX_COARSE_ERROR;
      return {
        offset: shared ? bestBeatShare.offset : coarse,
        gridOk: true,
        detail: `our ${ours.toFixed(1)} BPM is another pulse than Apple's ${apple.bpm.main}: Apple's grid at ${(shared ? bestBeatShare.offset : coarse).toFixed(3)}s`,
      };
    }
    return {
      offset: coarse,
      gridOk: false,
      detail: `beats on grid ${bestBeatShare.share.toFixed(2)} at ${bestBeatShare.offset.toFixed(3)}s (coarse ${coarse.toFixed(2)}s, ${beats.length} beats)`,
    };
  }

  // The best fit of each distinct shift (shifts a beat apart are separate)
  const peaks: typeof candidates = [];
  for (const candidate of [...candidates].sort((a, b) => b.fit - a.fit)) {
    if (!peaks.some((peak) => Math.abs(peak.offset - candidate.offset) <= 0.1)) {
      peaks.push(candidate);
    }
  }
  // Shifts that fit about as well as the best one; the loudness decides
  // between them only when it clearly points at one
  const contenders = peaks
    .filter((peak) => peak.fit > peaks[0].fit - MIN_FIT_MARGIN)
    .sort((a, b) => Math.abs(a.offset - coarse) - Math.abs(b.offset - coarse));
  const [best, rival] = contenders;
  if (
    rival &&
    (Math.abs(best.offset - coarse) > MAX_COARSE_ERROR ||
      Math.abs(rival.offset - coarse) < 2 * MAX_COARSE_ERROR)
  ) {
    return {
      offset: coarse,
      gridOk: false,
      detail: `ambiguous: fit ${best.fit.toFixed(2)} at ${best.offset.toFixed(3)}s vs ${rival.fit.toFixed(2)} at ${rival.offset.toFixed(3)}s (coarse ${coarse.toFixed(2)}s)`,
    };
  }

  // Centre on the beats it matched: the median of their distances
  const deltas = beats
    .map((beat) => {
      const time = beat - best.offset;
      const nearest = apple.beats.reduce((p, q) =>
        Math.abs(q - time) < Math.abs(p - time) ? q : p,
      );
      return time - nearest;
    })
    .filter((delta) => Math.abs(delta) <= BEAT_TOLERANCE)
    .sort((x, y) => x - y);
  return {
    offset: best.offset + (deltas[Math.floor(deltas.length / 2)] ?? 0),
    gridOk: true,
  };
};

const PITCH_CLASSES: Record<string, number> = {
  'C': 0,
  'C#': 1,
  'Db': 1,
  'D': 2,
  'D#': 3,
  'Eb': 3,
  'E': 4,
  'F': 5,
  'F#': 6,
  'Gb': 6,
  'G': 7,
  'G#': 8,
  'Ab': 8,
  'A': 9,
  'A#': 10,
  'Bb': 10,
  'B': 11,
};

const keyOf = (key?: { tonic: string; mode: string }): MusicalKey | null => {
  const pitchClass = key ? PITCH_CLASSES[key.tonic] : undefined;
  if (!key || pitchClass === undefined) return null;
  const mode = key.mode === 'minor' ? 'minor' : 'major';
  return {
    pitchClass,
    mode,
    camelot: camelotFor(pitchClass, mode),
    confidence: 1,
  };
};

/**
 * How much the tempo at a song's edge differs from its main tempo, from
 * Apple's own tempo per part of the song (its first few beats can be uneven)
 */
const edgeDrift = (edge: number, main: number) =>
  edge > 0 && main > 0 ? (edge / main) - 1 : 0;

/** Median beat period of a run of beats, in seconds */
const periodOf = (beats: number[]) => {
  const gaps = beats.slice(1).map((beat, i) => beat - beats[i]);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? 0;
};

/**
 * Apple's grid over the stretch of a section where we found a steady beat.
 * Where we found none (a beatless intro or ending), there's still none.
 */
const sectionGrid = (
  section: TempoSection,
  beats: number[],
  bars: number[],
  key: MusicalKey | null,
  /** Apple's tempo at this edge over its main tempo, minus 1 */
  drift: number,
  /**
   * Keep Apple's beats up to here even past ours: our tracker drops the
   * quiet beats of a fade-out, Apple's grid runs through it
   */
  until?: number,
): TempoSection => {
  const first = section.beats[0];
  const last = section.beats.at(-1);
  if (first === undefined || last === undefined) {
    return { ...section, key: key ?? section.key };
  }
  const slack = section.beatPeriod / 2;
  const end = Math.max(last + slack, until ?? 0);
  const inRange = (time: number) => time >= first - slack && time <= end;
  const sectionBeats = beats.filter(inRange);
  const beatPeriod = periodOf(sectionBeats);
  if (sectionBeats.length < 8 || beatPeriod <= 0) {
    return { ...section, key: key ?? section.key };
  }
  return {
    ...section,
    key: key ?? section.key,
    beats: sectionBeats,
    downbeats: bars.filter(inRange),
    beatPeriod,
    bpm: 60 / beatPeriod,
    drift,
  };
};

/** The first vocal line once the song has reached its body (not a tag over the intro) */
const firstVocalLine = (
  apple: AppleAnalysis,
  offset: number,
  introEnd: number,
) =>
  apple.vocals
    .filter((region) => LINE_STRENGTHS.includes(region.strength))
    .map((region) => region.start + offset)
    .find((start) => start >= introEnd - 1);

export const withApple = (
  analysis: TrackAnalysis,
  apple: AppleAnalysis,
  alignment: AppleAlignment,
): TrackAnalysis => {
  const { offset } = alignment;
  const shift = (times: number[]) =>
    times
      .map((time) => time + offset)
      .filter((time) => time >= 0 && time <= analysis.duration);

  // Apple's key comes from the master, so it's trusted over ours whether or
  // not its beat grid lines up
  const startKey = keyOf(apple.key.beginning);
  const endKey = keyOf(apple.key.ending);
  // A song that fades out doesn't stop on a hit, even if the end of its
  // fade is too quiet for our loudness profile to notice
  const fadeOut = apple.fadeOut && apple.fadeOut.start + offset;
  const merged: TrackAnalysis = {
    ...analysis,
    fadesOut:
      apple.fadeOut !== undefined &&
      apple.fadeOut.end - apple.fadeOut.start >= MIN_FADE_OUT,
    outroStart:
      fadeOut !== undefined && fadeOut >= analysis.duration / 2
        ? Math.min(analysis.outroStart, fadeOut)
        : analysis.outroStart,
    start: { ...analysis.start, key: startKey ?? analysis.start.key },
    end: { ...analysis.end, key: endKey ?? analysis.end.key },
    appleId: apple.id,
    traits: apple.traits,
    genre: apple.genres[0],
    vocalEntry: firstVocalLine(apple, offset, analysis.introEnd),
    vocals: apple.vocals
      .filter((region) => LINE_STRENGTHS.includes(region.strength))
      .map((region) => ({ start: region.start + offset, end: region.end + offset })),
  };
  if (!alignment.gridOk) return merged;

  const beats = shift(apple.beats);
  const bars = shift(apple.bars);
  const beatPeriod = periodOf(beats);
  // Phrase marks sit on Apple's beats; keep the ones that start a bar
  const phrases = shift(
    apple.events
      .filter((event) => event.score >= PHRASE_SCORE)
      .map((e) => e.time),
  )
    .map((time) => bars.find((bar) => Math.abs(bar - time) < beatPeriod / 2))
    .filter((bar): bar is number => bar !== undefined);

  const uniquePhrases = [...new Set(phrases)];
  return {
    ...merged,
    beats,
    downbeats: bars,
    beatPeriod,
    bpm: beatPeriod > 0 ? 60 / beatPeriod : analysis.bpm,
    // Free-tempo music rarely lines up; then phrases are counted as before
    phrases: uniquePhrases.length >= bars.length / 8 ? uniquePhrases : undefined,
    start: sectionGrid(
      analysis.start,
      beats,
      bars,
      keyOf(apple.key.beginning),
      edgeDrift(apple.bpm.beginning, apple.bpm.main),
    ),
    end: sectionGrid(
      analysis.end,
      beats,
      bars,
      keyOf(apple.key.ending),
      edgeDrift(apple.bpm.ending, apple.bpm.main),
      analysis.trailingSilenceStart,
    ),
  };
};
