import { definePlugin } from "@pear/sdk";

// The like status of the previous track can linger briefly after a track change.
const SETTLE_MS = 1000;

export default definePlugin({
  id: "skip-disliked-songs",
  name: "Skip disliked songs",
  description: "Skips a track as soon as you dislike it, and whenever a disliked track comes up.",
  page: (ctx) => {
    let skipped: string | undefined;
    const skipIfDisliked = () => {
      const { track, like, ad } = ctx.player.state;
      if (!track || like !== "dislike" || ad || skipped === track.videoId) return;
      skipped = track.videoId;
      ctx.log.info(`skipping disliked track ${track.videoId}`);
      ctx.player.control({ type: "next" });
    };

    let previousLike = ctx.player.state.like;
    let settling: ReturnType<typeof setTimeout> | undefined;
    ctx.player.on("change", (state) => {
      const becameDisliked = state.like === "dislike" && previousLike !== "dislike";
      previousLike = state.like;
      if (becameDisliked && settling === undefined) skipIfDisliked();
    });
    ctx.player.on("trackChange", () => {
      ctx.clearTimeout(settling);
      settling = ctx.setTimeout(() => {
        settling = undefined;
        skipIfDisliked();
      }, SETTLE_MS);
    });
    skipIfDisliked();
  },
});
