// The fade engine: one gain node in the shared graph, ramped along the configured curve.

import type { AudioGraph } from "@pear/sdk";
import type { Ctx } from "./schema.ts";

// Late in the shared graph: fades apply after effects, before visualizer taps.
const ORDER = 50;
const CURVE_POINTS = 256;
/** Ramps shorter than this jump straight to their end. */
const MIN_RAMP_S = 0.01;

export type Fader = ReturnType<typeof createFader>;

export function createFader(ctx: Ctx, graph: AudioGraph) {
  const { context } = graph;
  const gain = context.createGain();
  graph.insert(gain, gain, ORDER);

  // Gain for a normalized fade position (0 silent → 1 full).
  const level = (position: number) => {
    if (ctx.config.fadeScaling === "linear" || position <= 0) return Math.max(0, position);
    const decibels = (Math.min(1, position) - 1) * ctx.config.dynamicRange;
    return 10 ** (decibels / 20);
  };

  return {
    level,
    /** Fades from one position to another over `seconds` of real time. */
    ramp(from: number, to: number, seconds: number) {
      const now = context.currentTime;
      gain.gain.cancelScheduledValues(now);
      if (seconds <= MIN_RAMP_S) return gain.gain.setValueAtTime(level(to), now);
      const curve = new Float32Array(CURVE_POINTS);
      for (let i = 0; i < CURVE_POINTS; i++) curve[i] = level(from + ((to - from) * i) / (CURVE_POINTS - 1));
      gain.gain.setValueCurveAtTime(curve, now, seconds);
    },
    /** Stops any fade at a fixed gain. */
    hold(value: number) {
      gain.gain.cancelScheduledValues(context.currentTime);
      gain.gain.setValueAtTime(value, context.currentTime);
    },
    /** Stops any fade where it is. */
    freeze() {
      gain.gain.cancelAndHoldAtTime(context.currentTime);
    },
  };
}
