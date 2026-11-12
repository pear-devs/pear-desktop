// How to get through an ad without touching the track.
//
// Client-side ads replace the <video> source, so seeking that element to its end
// finishes the ad and YTM loads the track from its start. Server-stitched ads
// share one stream with the track, so seeking there would skip the track itself
// (pear-desktop#4576); those are only fast-forwarded, and any track time that
// slipped by before YTM noticed the ad ended is rewound afterwards.

export type AdStrategy = "seek" | "fast-forward";

export const FAST_FORWARD_RATE = 16;
// Margin between a standalone ad's length and the track's.
const DURATION_MARGIN_S = 2;
// At 16× and YTM's ~250 ms ad bookkeeping, overshoot stays well below this.
const MAX_OVERSHOOT_S = 12;
const OVERSHOOT_TOLERANCE_S = 1.5;

/** `mediaDuration` is the <video>'s; `contentDuration` the track's (0 = unknown). */
export function adStrategy(mediaDuration: number, contentDuration: number): AdStrategy {
  const standalone =
    Number.isFinite(mediaDuration) &&
    mediaDuration > 0 &&
    contentDuration > 0 &&
    mediaDuration + DURATION_MARGIN_S < contentDuration;
  return standalone ? "seek" : "fast-forward";
}

/** Where to rewind the track to after an ad, or undefined when it resumed where it was. */
export function rewindTarget(anchor: number, resumedAt: number): number | undefined {
  const overshoot = resumedAt - anchor;
  return overshoot > OVERSHOOT_TOLERANCE_S && overshoot < MAX_OVERSHOOT_S ? anchor : undefined;
}
