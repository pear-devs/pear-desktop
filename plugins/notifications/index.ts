// Native notifications when a track starts (and optionally on resume), with
// playback buttons where the OS supports notification actions. On Windows,
// pear-desktop's toast layouts (custom toast XML) and tray controls.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, definePlugin, livePosition, type HostContextOf, type NowPlaying, type Track } from "@pear/sdk";
import { embed } from "@pear/sdk/macros" with { type: "macro" };
import { isPlaying } from "@pear/sdk/util";
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

const isPaused = (state: NowPlaying) => !isPlaying(state);
const WINDOWS = process.platform === "win32";
const SUPPORTS_ACTIONS = WINDOWS || process.platform === "darwin";
// The native notification's buttons, by action index.
const PREVIOUS_ACTION = 0;
const NEXT_ACTION = 2;

type ButtonIcon = keyof typeof BUTTON_ICONS;

/** The artwork: a centered square like the original's "logo" style, or as is (banners). */
async function artwork(url: string | undefined, square = true): Promise<NativeImage | undefined> {
  if (!url) return;
  try {
    const response = await net.fetch(url);
    if (!response.ok) return;
    const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
    if (image.isEmpty()) return;
    if (!square) return image;
    const { width, height } = image.getSize();
    const side = Math.min(width, height);
    const cropped = image.crop({ x: Math.round((width - side) / 2), y: Math.round((height - side) / 2), width: side, height: side });
    return cropped.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: "best" });
  } catch {
    return;
  }
}

const schema = {
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
};

type Ctx = HostContextOf<typeof schema>;

type Notifier = ReturnType<typeof createNotifier>;

export default definePlugin({
  id: "notifications",
  name: "Notifications",
  description: "Show a desktop notification when a new song starts.",
  config: schema,
  host: {
    start(ctx) {
      if (!Notification.isSupported()) throw new Error("this system doesn't support notifications");
      const notifier = createNotifier(ctx);

      // The toast's buttons arrive through the app protocol (the core already acted on them).
      ctx.onProtocol((command) => {
        const track = ctx.player.state.track;
        if (!WINDOWS || !track || !ctx.config.interactive || !ctx.config.refreshOnPlayPause) return;
        if (command === "pause" || (command === "play" && !ctx.config.unpauseNotification)) void notifier.show(track, command === "pause");
      });

      if (WINDOWS) trayControls(ctx, notifier);

      let lastVideoId: string | undefined;
      let wasPaused = true;
      ctx.player.on("change", (state) => {
        // Ads come and go mid-track; they're neither a new song nor a resume.
        if (state.ad) return;
        const paused = isPaused(state);
        const track = state.track;
        if (track && !paused) {
          const newTrack = track.videoId !== lastVideoId;
          const resumed = wasPaused && ctx.config.unpauseNotification;
          if (newTrack || resumed) void notifier.show(track, false);
          lastVideoId = track.videoId;
        }
        wasPaused = paused;
      });

      return () => notifier.dispose();
    },
    // Options are read when a notification is shown.
    onConfigChange() {},
  },
});

/** Shows one notification at a time: a newer one replaces it, also while its artwork loads. */
function createNotifier(ctx: Ctx) {
  let current: Notification | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const files = notificationFiles(ctx);

  const close = () => {
    ctx.clearTimeout(closeTimer);
    current?.close();
    current = undefined;
  };
  const present = (notification: Notification) => {
    notification.on("close", () => {
      if (current === notification) current = undefined;
    });
    current = notification;
    notification.show();
  };

  /** pear-desktop's interactive Windows toast. */
  const showToast = async (track: Track, paused: boolean, id: number) => {
    const style = ctx.config.toastStyle;
    const image = await artwork(track.artworkUrl, usesLogo(style));
    if (id !== generation) return;
    const imagePath = image ? files.saveArtwork(image, usesLogo(style)) : "";
    close();
    const title = track.title || ctx.t("plugins.notifications.playing", "Playing");
    const notification = new Notification({
      title,
      body: track.artist,
      silent: true,
      toastXml: toastXml({
        style,
        title,
        artist: track.artist,
        ...(track.album ? { album: track.album } : {}),
        elapsedSeconds: livePosition(ctx.player.state),
        durationSeconds: track.durationSeconds,
        paused,
        image: imagePath,
        icons: files.buttonIcons(),
        protocol: APP_PROTOCOL,
      }),
    });
    present(notification);
    closeTimer = ctx.setTimeout(() => {
      if (current === notification) close();
    }, TOAST_CLOSE_MS);
  };

  const showNative = async (track: Track, paused: boolean, id: number) => {
    const icon = await artwork(track.artworkUrl);
    if (id !== generation) return;
    close();
    const interactive = SUPPORTS_ACTIONS && ctx.config.interactive;
    const notification = new Notification({
      title: track.title || ctx.t("plugins.notifications.playing", "Playing"),
      body: track.artist,
      ...(icon ? { icon } : {}),
      silent: true,
      urgency: ctx.config.urgency,
      ...(interactive ? { actions: actionButtons(ctx, paused) } : {}),
    });
    notification.on("click", () => ctx.focusWindow());
    notification.on("action", (event) => {
      const index = event.actionIndex;
      if (index === PREVIOUS_ACTION) return ctx.player.control({ type: "previous" });
      if (index === NEXT_ACTION) return ctx.player.control({ type: "next" });
      ctx.player.control({ type: paused ? "play" : "pause" });
      // A resume shows its own notification when that option is on.
      const resumeNotifies = paused && ctx.config.unpauseNotification;
      if (ctx.config.refreshOnPlayPause && !resumeNotifies) void show(track, !paused);
    });
    present(notification);
  };

  const show = (track: Track, paused: boolean) => {
    const id = ++generation;
    if (WINDOWS && ctx.config.interactive) return showToast(track, paused, id);
    return showNative(track, paused, id);
  };

  return {
    show,
    close,
    get showing() {
      return current !== undefined;
    },
    dispose() {
      generation++;
      close();
    },
  };
}

function actionButtons(ctx: Ctx, paused: boolean): Electron.NotificationAction[] {
  const playPause = paused ? ctx.t("plugins.notifications.buttons.play", "Play") : ctx.t("plugins.notifications.buttons.pause", "Pause");
  return [
    { type: "button", text: ctx.t("plugins.notifications.buttons.previous", "Previous") },
    { type: "button", text: playPause },
    { type: "button", text: ctx.t("plugins.notifications.buttons.next", "Next") },
  ];
}

/** Toast XML refers to images by path: the artwork and button icons go to userData. */
function notificationFiles(ctx: Ctx) {
  const folder = join(ctx.app.getPath("userData"), "notifications");
  let iconPaths: Record<ButtonIcon, string> | undefined;
  return {
    buttonIcons() {
      if (iconPaths) return iconPaths;
      mkdirSync(folder, { recursive: true });
      const paths = {} as Record<ButtonIcon, string>;
      for (const [name, base64] of Object.entries(BUTTON_ICONS) as [ButtonIcon, string][]) {
        paths[name] = join(folder, `${name}.png`);
        writeFileSync(paths[name], Buffer.from(base64, "base64"));
      }
      iconPaths = paths;
      return paths;
    },
    saveArtwork(image: NativeImage, logo: boolean) {
      mkdirSync(folder, { recursive: true });
      const path = join(folder, logo ? "art-logo.png" : "art-banner.png");
      writeFileSync(path, image.toPNG());
      return path;
    },
  };
}

// pear-desktop's tray controls (Windows): the tray plugin hands its clicks over.
function trayControls(ctx: Ctx, notifier: Notifier) {
  const enabled = () => ctx.config.trayControls && ctx.config.interactive;
  ctx.listen(ctx.app, "pear:tray-click", (claim: { claimed: boolean }) => {
    if (!enabled()) return;
    claim.claimed = true;
    const track = ctx.player.state.track;
    if (notifier.showing) notifier.close();
    else if (track) void notifier.show(track, isPaused(ctx.player.state));
  });
  ctx.listen(ctx.app, "pear:tray-double-click", (claim: { claimed: boolean }) => {
    if (!enabled()) return;
    claim.claimed = true;
    if (ctx.window.isVisible()) ctx.window.hide();
    else ctx.window.show();
  });
}
