// Native notifications when a track starts (and optionally on resume), with
// playback buttons where the OS supports notification actions.

import { config, definePlugin, type NowPlaying, type Track } from "@pear/sdk";
import { type NativeImage, nativeImage, net, Notification } from "electron";

const ICON_SIZE = 256;

const isPaused = (state: NowPlaying) => state.status !== "playing" && state.status !== "buffering";

/** The artwork as a centered square, like the original's "logo" style. */
async function artwork(url: string | undefined): Promise<NativeImage | undefined> {
  if (!url) return;
  try {
    const response = await net.fetch(url);
    if (!response.ok) return;
    const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
    if (image.isEmpty()) return;
    const { width, height } = image.getSize();
    const side = Math.min(width, height);
    const square = image.crop({ x: Math.round((width - side) / 2), y: Math.round((height - side) / 2), width: side, height: side });
    return square.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: "best" });
  } catch {
    return;
  }
}

export default definePlugin({
  id: "notifications",
  name: "Notifications",
  description: "Show a desktop notification when a new song starts.",
  config: {
    unpauseNotification: config.bool(false, { label: "Also notify when resuming" }),
    urgency: config.select(
      "normal",
      [
        { value: "low", label: "Low" },
        { value: "normal", label: "Normal" },
        { value: "critical", label: "High" },
      ],
      { label: "Priority", description: "Linux only: how prominently the desktop shows it." },
    ),
    interactive: config.bool(true, {
      label: "Playback buttons",
      description: "Windows and macOS: previous, play/pause and next buttons in the notification.",
    }),
    refreshOnPlayPause: config.bool(false, {
      label: "Update after play/pause from the notification",
      description: "Show it again with the opposite button after using its play/pause button.",
    }),
  },
  host: {
    start(ctx) {
      if (!Notification.isSupported()) throw new Error("this system doesn't support notifications");
      const supportsActions = process.platform === "win32" || process.platform === "darwin";

      let current: Notification | undefined;
      let generation = 0;
      const close = () => {
        current?.close();
        current = undefined;
      };

      const show = async (track: Track, paused: boolean) => {
        const id = ++generation;
        const icon = await artwork(track.artworkUrl);
        if (id !== generation) return;
        close();
        const interactive = supportsActions && ctx.config.interactive;
        const notification = new Notification({
          title: track.title || "Playing",
          body: track.artist,
          ...(icon ? { icon } : {}),
          silent: true,
          urgency: ctx.config.urgency,
          ...(interactive
            ? {
                actions: [
                  { type: "button", text: "Previous" },
                  { type: "button", text: paused ? "Play" : "Pause" },
                  { type: "button", text: "Next" },
                ],
              }
            : {}),
        });
        notification.on("click", () => {
          if (ctx.window.isMinimized()) ctx.window.restore();
          ctx.window.show();
          ctx.window.focus();
        });
        notification.on("action", (event) => {
          const index = event.actionIndex;
          if (index === 0) return ctx.player.control({ type: "previous" });
          if (index === 2) return ctx.player.control({ type: "next" });
          ctx.player.control({ type: paused ? "play" : "pause" });
          // A resume shows its own notification when that option is on.
          if (ctx.config.refreshOnPlayPause && (!paused || !ctx.config.unpauseNotification)) void show(track, !paused);
        });
        notification.on("close", () => {
          if (current === notification) current = undefined;
        });
        current = notification;
        notification.show();
      };

      let lastVideoId: string | undefined;
      let wasPaused = true;
      ctx.player.on("change", (state) => {
        // Ads come and go mid-track; they're neither a new song nor a resume.
        if (state.ad) return;
        const paused = isPaused(state);
        const track = state.track;
        if (track && !paused && (track.videoId !== lastVideoId || (wasPaused && ctx.config.unpauseNotification))) {
          void show(track, false);
        }
        if (track && !paused) lastVideoId = track.videoId;
        wasPaused = paused;
      });

      return () => {
        generation++;
        close();
      };
    },
    // Options are read when a notification is shown.
    onConfigChange() {},
  },
});
