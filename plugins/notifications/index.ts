// Native notifications when a track starts (and optionally on resume), with
// playback buttons where the OS supports notification actions. On Windows,
// pear-desktop's toast layouts (custom toast XML) and tray controls.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, definePlugin, livePosition, type NowPlaying, type Track } from "@pear/sdk";
import { embed } from "@pear/sdk/macros" with { type: "macro" };
import { type NativeImage, nativeImage, net, Notification } from "electron";
import { TOAST_STYLES, type ToastStyle, toastXml, usesLogo } from "./toast.ts";

const ICON_SIZE = 256;
// pear-desktop's Windows workaround: toasts otherwise linger in the corner.
const TOAST_CLOSE_MS = 5000;
/** pear-desktop's app protocol (see the core's protocol.ts). */
const APP_PROTOCOL = "\u0079\u006f\u0075\u0074\u0075\u0062\u0065music";
// pear-desktop's button icons for toasts.
const BUTTON_ICONS = {
  previous: embed("media-icons-black/previous.png"),
  play: embed("media-icons-black/play.png"),
  pause: embed("media-icons-black/pause.png"),
  next: embed("media-icons-black/next.png"),
};
const STYLE_LABELS: Record<ToastStyle, string> = {
  logo: "Logo",
  banner_centered_top: "Banner centered top",
  hero: "Hero",
  banner_top_custom: "Banner top custom",
  banner_centered_bottom: "Banner centered bottom",
  banner_bottom: "Banner bottom",
  legacy: "Legacy",
};

const isPaused = (state: NowPlaying) => state.status !== "playing" && state.status !== "buffering";

/** The artwork: a centered square like the original's "logo" style, or as is (banners). */
async function artwork(url: string | undefined, square = true): Promise<NativeImage | undefined> {
  if (!url) return;
  try {
    const response = await net.fetch(url);
    if (!response.ok) return;
    const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
    if (image.isEmpty() || !square) return image.isEmpty() ? undefined : image;
    const { width, height } = image.getSize();
    const side = Math.min(width, height);
    const cropped = image.crop({ x: Math.round((width - side) / 2), y: Math.round((height - side) / 2), width: side, height: side });
    return cropped.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: "best" });
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
    toastStyle: config.select(
      "logo",
      TOAST_STYLES.map((value) => ({ value, label: STYLE_LABELS[value] })),
      { label: "Toast style", description: "How the notification with buttons looks.", platforms: ["win32"], variant: "dropdown" },
    ),
    trayControls: config.bool(true, {
      label: "Open and close it from the tray",
      description: "Clicking the tray icon shows or hides the notification; double-clicking shows or hides the window.",
      platforms: ["win32"],
    }),
  },
  host: {
    start(ctx) {
      if (!Notification.isSupported()) throw new Error("this system doesn't support notifications");
      const supportsActions = process.platform === "win32" || process.platform === "darwin";

      const windows = process.platform === "win32";

      let current: Notification | undefined;
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      let generation = 0;
      const close = () => {
        clearTimeout(closeTimer);
        current?.close();
        current = undefined;
      };

      // Toast XML refers to images by path: the artwork and button icons go to userData.
      const files = join(ctx.app.getPath("userData"), "notifications");
      let iconPaths: Record<keyof typeof BUTTON_ICONS, string> | undefined;
      const buttonIcons = () => {
        if (iconPaths) return iconPaths;
        mkdirSync(files, { recursive: true });
        const paths = {} as Record<keyof typeof BUTTON_ICONS, string>;
        for (const [name, base64] of Object.entries(BUTTON_ICONS) as [keyof typeof BUTTON_ICONS, string][]) {
          paths[name] = join(files, `${name}.png`);
          writeFileSync(paths[name], Buffer.from(base64, "base64"));
        }
        return (iconPaths = paths);
      };

      /** pear-desktop's interactive Windows toast. */
      const showToast = async (track: Track, paused: boolean, id: number) => {
        const style = ctx.config.toastStyle;
        const image = await artwork(track.artworkUrl, usesLogo(style));
        if (id !== generation) return;
        let imagePath = "";
        if (image) {
          mkdirSync(files, { recursive: true });
          imagePath = join(files, usesLogo(style) ? "art-logo.png" : "art-banner.png");
          writeFileSync(imagePath, image.toPNG());
        }
        close();
        const notification = new Notification({
          title: track.title || ctx.t("plugins.notifications.playing", "Playing"),
          body: track.artist,
          silent: true,
          toastXml: toastXml({
            style,
            title: track.title || ctx.t("plugins.notifications.playing", "Playing"),
            artist: track.artist,
            ...(track.album ? { album: track.album } : {}),
            elapsedSeconds: livePosition(ctx.player.state),
            durationSeconds: track.durationSeconds,
            paused,
            image: imagePath,
            icons: buttonIcons(),
            protocol: APP_PROTOCOL,
          }),
        });
        notification.on("close", () => {
          if (current === notification) current = undefined;
        });
        current = notification;
        notification.show();
        closeTimer = setTimeout(() => {
          if (current === notification) close();
        }, TOAST_CLOSE_MS);
      };

      const show = async (track: Track, paused: boolean) => {
        const id = ++generation;
        if (windows && ctx.config.interactive) return showToast(track, paused, id);
        const icon = await artwork(track.artworkUrl);
        if (id !== generation) return;
        close();
        const interactive = supportsActions && ctx.config.interactive;
        const notification = new Notification({
          title: track.title || ctx.t("plugins.notifications.playing", "Playing"),
          body: track.artist,
          ...(icon ? { icon } : {}),
          silent: true,
          urgency: ctx.config.urgency,
          ...(interactive
            ? {
                actions: [
                  { type: "button", text: ctx.t("plugins.notifications.buttons.previous", "Previous") },
                  {
                    type: "button",
                    text: paused ? ctx.t("plugins.notifications.buttons.play", "Play") : ctx.t("plugins.notifications.buttons.pause", "Pause"),
                  },
                  { type: "button", text: ctx.t("plugins.notifications.buttons.next", "Next") },
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

      // The toast's buttons arrive through the app protocol (the core already acted on them).
      ctx.onProtocol((command) => {
        const track = ctx.player.state.track;
        if (!windows || !track || !ctx.config.interactive || !ctx.config.refreshOnPlayPause) return;
        if (command === "pause" || (command === "play" && !ctx.config.unpauseNotification)) void show(track, command === "pause");
      });

      // pear-desktop's tray controls (Windows): the tray plugin hands its clicks over.
      if (windows) {
        const events = ctx.app as unknown as NodeJS.EventEmitter;
        const onTrayClick = (claim: { claimed: boolean }) => {
          if (!ctx.config.trayControls || !ctx.config.interactive) return;
          claim.claimed = true;
          const track = ctx.player.state.track;
          if (current) close();
          else if (track) void show(track, isPaused(ctx.player.state));
        };
        const onTrayDoubleClick = (claim: { claimed: boolean }) => {
          if (!ctx.config.trayControls || !ctx.config.interactive) return;
          claim.claimed = true;
          if (ctx.window.isVisible()) ctx.window.hide();
          else ctx.window.show();
        };
        events.on("pear:tray-click", onTrayClick);
        events.on("pear:tray-double-click", onTrayDoubleClick);
        ctx.onCleanup(() => {
          events.off("pear:tray-click", onTrayClick);
          events.off("pear:tray-double-click", onTrayDoubleClick);
        });
      }

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
