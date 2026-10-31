// Scrobbles to Last.fm and/or ListenBrainz: "now playing" when a track starts
// or resumes, a scrobble once it has really been listened to (see tracker.ts).

import { definePlugin } from "@pear/sdk";
import { lastFmAuthorizer } from "./auth.ts";
import { warner } from "./common.ts";
import { schema } from "./schema.ts";
import { submitter } from "./submit.ts";
import { ScrobbleTracker } from "./tracker.ts";

/** Ticks just after the scrobble threshold, so it has surely passed. */
const THRESHOLD_SLACK_MS = 50;

export default definePlugin({
  id: "scrobbler",
  name: "Scrobbler",
  description: "Scrobble what you listen to to Last.fm and ListenBrainz.",
  config: schema,
  host: {
    start(ctx) {
      const warn = warner(ctx);
      const { submit, prefetchDetails } = submitter(ctx, warn);
      const tracker = new ScrobbleTracker({
        nowPlaying: (play) => void submit("nowPlaying", play),
        scrobble: (play) => void submit("scrobble", play),
      });
      // One timer, re-armed on every player change.
      let tick: ReturnType<typeof setTimeout> | undefined;
      const schedule = () => {
        ctx.clearTimeout(tick);
        const wait = tracker.timeUntilScrobble();
        if (wait === null) return;
        tick = ctx.setTimeout(() => {
          tracker.tick();
          schedule();
        }, wait + THRESHOLD_SLACK_MS);
      };
      ctx.player.on("change", (state) => {
        if (state.track) prefetchDetails(state.track.videoId);
        tracker.update(state);
        schedule();
      });
      tracker.update(ctx.player.state);

      // Config changes keep the current play; they may ask for Last.fm authorization.
      const auth = lastFmAuthorizer(ctx, warn);
      ctx.onConfigChange(() => auth.reconfigure());
      void auth.authorize();
    },
  },
});
