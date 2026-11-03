/**
 * Lines the incoming song's kick drum up with the outgoing song's, to the
 * millisecond. A blend is planned on beat grids (Apple Music's or ours,
 * ~12 ms apart at best, each song lined up on its own), which can leave the
 * two kicks 20-30 ms apart: enough to hear them as one smeared hit. This
 * compares what the two copies actually play over the blend and nudges where
 * the incoming song comes in.
 */

import type { TransitionPlan } from './planner';

/** Envelope rate: one value per millisecond */
const ENVELOPE_RATE = 1000;
/** Kick drums live below this */
const KICK_HZ = 120;
/** Envelope smoothing, longer than a cycle of the kick's low note */
const SMOOTH_MS = 12;
/** How far before its peak a kick's attack is looked for */
const ATTACK_MS = 60;
/**
 * A kick starts where it crosses this share of its peak level on the way
 * up: steadier than its steepest rise, which the kick's low note ripples
 */
const ATTACK_LEVEL = 0.5;
/**
 * Furthest the incoming song is moved, in seconds: well short of a 16th note
 * (~120 ms at 128 BPM), so a kick is never paired with the wrong one
 */
const MAX_NUDGE = 0.08;
/**
 * Most of a blend compared, in seconds. All of it, glide or not: the two
 * songs share one tempo at every moment, so the incoming one's place stays
 * in step with the outgoing one's (and many only bring their kick in late)
 */
const MAX_SPAN = 40;
/** Kick pairs needed to trust the result */
const MIN_PAIRS = 4;
/** Most the pairs may disagree (median distance from their median), in ms */
const MAX_SPREAD_MS = 6;

const onePole = (hz: number, sampleRate: number) =>
  Math.exp((-2 * Math.PI * hz) / sampleRate);

/**
 * Kick-drum level of `seconds` of a buffer from `start`, one value per ms:
 * low-passed, rectified and smoothed over SMOOTH_MS
 */
const kickEnvelope = (buffer: AudioBuffer, start: number, seconds: number) => {
  const { sampleRate } = buffer;
  const first = Math.round(start * sampleRate);
  const length = Math.round(seconds * sampleRate);
  if (first < 0 || first + length > buffer.length) return null;

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
    buffer.getChannelData(c),
  );
  const low = onePole(KICK_HZ, sampleRate);
  // Each value covers its own share of samples (44.1 per ms at 44.1 kHz)
  const step = sampleRate / ENVELOPE_RATE;
  const raw = new Float32Array(Math.floor(length / step));
  let a = 0;
  let b = 0;
  let sum = 0;
  let count = 0;
  let out = 0;
  for (let i = 0; i < length && out < raw.length; i++) {
    let x = 0;
    for (const channel of channels) x += channel[first + i];
    a = (low * a) + ((1 - low) * x);
    b = (low * b) + ((1 - low) * a);
    sum += Math.abs(b);
    count++;
    if (i + 1 >= (out + 1) * step) {
      raw[out++] = sum / count;
      sum = 0;
      count = 0;
    }
  }
  const envelope = new Float32Array(raw.length);
  let running = 0;
  for (let i = 0; i < raw.length; i++) {
    running += raw[i] - (i >= SMOOTH_MS ? raw[i - SMOOTH_MS] : 0);
    envelope[i] = running / Math.min(i + 1, SMOOTH_MS);
  }
  return envelope;
};

/** Where each kick starts (crossing ATTACK_LEVEL of its peak), in ms */
const kickAttacks = (envelope: Float32Array, beatMs: number) => {
  let max = 0;
  for (const v of envelope) max = Math.max(max, v);
  const reach = Math.round(beatMs * 0.3);
  const attacks: number[] = [];
  for (let i = reach; i < envelope.length - reach; i++) {
    const v = envelope[i];
    if (v < max * 0.3) continue;
    let peak = true;
    for (let k = i - reach; k <= i + reach && peak; k++) {
      if (envelope[k] > v || (envelope[k] === v && k < i)) peak = false;
    }
    if (!peak) continue;
    const level = v * ATTACK_LEVEL;
    let k = i;
    while (k > i - ATTACK_MS && k > 0 && envelope[k] > level) k--;
    // Between the two values either side of the crossing
    const below = envelope[k];
    const above = envelope[k + 1];
    attacks.push(k + (above > below ? (level - below) / (above - below) : 0));
  }
  return attacks;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * The plan with its incoming entry moved so the two kicks land together,
 * and by how much (seconds of the outgoing song, + = the incoming kick was
 * late). Each kick of the old song is paired with the nearest of the new
 * one's and the shift is their median gap; the plan is returned as it was
 * when there aren't enough pairs or they disagree.
 */
export const alignKicks = (
  plan: TransitionPlan,
  tail: AudioBuffer,
  tailStart: number,
  head: AudioBuffer,
): { plan: TransitionPlan; nudge: number } => {
  const unchanged = { plan, nudge: 0 };
  if (plan.style !== 'blend' || plan.beat <= 0) return unchanged;
  const span = Math.min(plan.duration, MAX_SPAN);

  const outgoing = kickEnvelope(tail, plan.mixOut - tailStart, span);
  // The incoming copy, a little either side, mapped onto the outgoing's time
  const margin = MAX_NUDGE * plan.rate;
  const source = kickEnvelope(
    head,
    plan.mixIn - margin,
    (span * plan.rate) + (2 * margin),
  );
  if (!outgoing || !source) return unchanged;
  const incoming = new Float32Array(Math.floor(source.length / plan.rate));
  for (let i = 0; i < incoming.length; i++) {
    incoming[i] = source[Math.min(source.length - 1, Math.round(i * plan.rate))];
  }

  // incoming[k] is outgoing time k - offset (ms)
  const offset = Math.round(MAX_NUDGE * ENVELOPE_RATE);
  const beatMs = plan.beat * ENVELOPE_RATE;
  const theirs = kickAttacks(incoming, beatMs).map((k) => k - offset);
  const gaps: number[] = [];
  for (const ours of kickAttacks(outgoing, beatMs)) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const kick of theirs) {
      if (Math.abs(kick - ours) < Math.abs(nearest)) nearest = kick - ours;
    }
    if (Math.abs(nearest) <= offset) gaps.push(nearest);
  }
  if (gaps.length < MIN_PAIRS) return unchanged;
  const shift = median(gaps);
  const spread = median(gaps.map((gap) => Math.abs(gap - shift)));
  if (spread > MAX_SPREAD_MS) return unchanged;

  const nudge = shift / ENVELOPE_RATE;
  return { plan: { ...plan, mixIn: plan.mixIn + (nudge * plan.rate) }, nudge };
};
