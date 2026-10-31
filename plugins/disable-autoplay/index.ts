import { config, definePlugin } from "@pear/sdk";

export default definePlugin({
  id: "disable-autoplay",
  name: "Disable autoplay",
  description: "Starts every track paused instead of playing it automatically.",
  config: {
    applyOnce: config.bool(false, {
      label: "Only after launch",
      description: "Pause just the first track after the app starts, then play normally.",
    }),
  },
  page: (ctx) => {
    let applied = false;
    // Set while a track is loading and the user hasn't started it yet.
    let guard = false;
    ctx.player.on("trackLoading", () => {
      if (ctx.config.applyOnce && applied) return;
      applied = true;
      guard = true;
      ctx.player.control({ type: "pause" });
    });
    // YTM starts playback after "dataloaded" (or after a pre-roll ad): stop the
    // first tick of actual track playback.
    ctx.player.on("timeUpdate", () => {
      if (!guard || ctx.player.state.status !== "playing") return;
      guard = false;
      ctx.player.control({ type: "pause" });
    });
  },
});
