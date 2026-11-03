/**
 * When a blend swaps the basslines over. Swapping half way only works if the
 * next song has its bass by then: many come in on an intro without it, and
 * taking the old bass out first leaves seconds with no bass at all before
 * the new one drops. So the old bass makes way where the new one arrives
 * (the song isn't entered later for it: Apple Music keeps a song's intro,
 * and skipping into a song is far more noticeable than a light intro).
 */

import type { TrackAnalysis } from './analysis';
import type { TransitionPlan } from './planner';

/** The usual swap ends here; a bass that's there by then needs no move */
const USUAL_SWAP_END = 0.625;

/**
 * Where the basses should swap, as fractions of the blend, when the next
 * song's bass arrives after the usual swap; undefined to keep the usual one
 */
export const bassSwapWindow = (
  plan: TransitionPlan,
  to: TrackAnalysis,
): [number, number] | undefined => {
  if (
    plan.style !== 'blend' ||
    plan.holdOutgoing ||
    plan.beat <= 0 ||
    to.bassEntry === undefined
  ) {
    return undefined;
  }
  const at = (to.bassEntry - plan.mixIn) / (plan.duration * plan.rate);
  if (at <= USUAL_SWAP_END) return undefined;
  // The old bass makes way over the bar before the new one comes in (or
  // over the blend's last bar, when it only comes in after)
  const end = Math.min(1, at);
  return [Math.max(0, end - ((plan.beat * 4) / plan.duration)), end];
};
