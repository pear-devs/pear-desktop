export type SkipDecision = {
  videoId: string;
  generation: number;
  language: string;
  dislike: boolean;
};

// The caller ticks this controller against live player state. No asynchronous
// continuation is allowed to select a different track for either action.
export const createAutoSkip = (actions: {
  isCurrent: (decision: SkipDecision) => boolean;
  dislike: (videoId: string) => Promise<unknown>;
  skip: (decision: SkipDecision) => boolean;
  notify: (language: string) => void;
  onError: (error: unknown) => void;
}) => {
  let pending: {
    decision: SkipDecision;
    skipAt: number;
    disliked: boolean;
    skipRequested: boolean;
  } | null = null;

  return {
    update(decision: SkipDecision | null, now: number) {
      if (!decision || !actions.isCurrent(decision)) {
        pending = null;
        return;
      }
      if (!pending || pending.decision.generation !== decision.generation) {
        pending = {
          decision,
          skipAt: now + 500,
          disliked: false,
          skipRequested: false,
        };
      } else {
        pending.decision = decision;
      }

      if (
        decision.dislike &&
        !pending.disliked &&
        actions.isCurrent(decision)
      ) {
        pending.disliked = true;
        // The request explicitly targets videoId, even if playback advances
        // while the request is in flight or JavaScript is paused in a debugger.
        try {
          actions.dislike(decision.videoId).catch(actions.onError);
        } catch (error) {
          actions.onError(error);
        }
      }

      if (now < pending.skipAt || !actions.isCurrent(decision)) return;
      try {
        // Missing API is retried on the next tick, not marked as completed.
        if (!actions.skip(decision)) return;
        // Calling nextVideo is only a request. If playback hasn't advanced,
        // retry after a grace period instead of suppressing this track forever.
        pending.skipAt = now + 3000;
        if (!pending.skipRequested) {
          pending.skipRequested = true;
          actions.notify(decision.language);
        }
      } catch (error) {
        actions.onError(error);
      }
    },
    cancel() {
      pending = null;
    },
  };
};
