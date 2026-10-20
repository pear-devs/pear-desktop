import { config, definePlugin, type HostContextOf, type NowPlaying } from "@pear/sdk";
import { trayIconBitmap } from "@pear/sdk/icon";
import { isPlaying, YTM_NAME } from "@pear/sdk/util";
import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from "electron";

/** The tray icon's size in px; drawn at twice that for high-DPI screens. */
const ICON_SIZE = 32;

const schema = {
  closeToTray: config.bool(false, {
    label: "Close to tray",
    description: "Closing the window keeps music playing in the background.",
  }),
  clickToToggle: config.bool(true, { label: "Click toggles the window" }),
  clickPlayPause: config.bool(false, {
    label: "Click plays and pauses",
    description: "Instead of toggling the window.",
  }),
};

type Ctx = HostContextOf<typeof schema>;

export default definePlugin({
  id: "tray",
  name: "Tray icon",
  description: "Playback controls and the current track in the system tray.",
  enabledByDefault: true,
  config: schema,
  host: {
    start(ctx) {
      // pear-desktop's icons: a paused variant while a track is paused.
      const icons = { playing: trayImage(false), paused: trayImage(true) };
      const tray = new Tray(icons.playing);
      let shownIcon: keyof typeof icons = "playing";
      const { window, app } = ctx;
      const showWindow = () => {
        ctx.focusWindow();
        app.dock?.show();
      };
      // As pear-desktop: on macOS a window hidden to the tray leaves the Dock too.
      const hideWindow = () => {
        window.hide();
        app.dock?.hide();
      };
      const toggleWindow = () => {
        if (window.isVisible() && window.isFocused()) hideWindow();
        else showWindow();
      };

      const update = (state: NowPlaying) => {
        const icon = state.track && state.status === "paused" ? "paused" : "playing";
        if (icon !== shownIcon) {
          tray.setImage(icons[icon]);
          shownIcon = icon;
        }
        tray.setToolTip(tooltip(ctx, state));
        tray.setContextMenu(Menu.buildFromTemplate(menu(ctx, state, toggleWindow)));
      };
      update(ctx.player.state);
      // Rebuild the menu only when something it shows changes.
      ctx.player.on("change", (state, previous) => {
        if (state.track !== previous.track || state.status !== previous.status) update(state);
      });
      const refresh = () => update(ctx.player.state);
      ctx.listen(window, "show", refresh);
      ctx.listen(window, "hide", refresh);

      // Another plugin may claim clicks (notifications' tray controls on Windows, as in pear-desktop).
      const claimed = (event: string) => {
        const claim = { claimed: false };
        (app as unknown as NodeJS.EventEmitter).emit(event, claim);
        return claim.claimed;
      };
      tray.on("click", () => {
        if (claimed("pear:tray-click")) return;
        if (ctx.config.clickPlayPause) ctx.player.control({ type: "toggle" });
        else if (ctx.config.clickToToggle) toggleWindow();
      });
      tray.on("double-click", () => void claimed("pear:tray-double-click"));

      closeToTray(ctx, hideWindow);
      return () => tray.destroy();
    },
    // Both options are read when used; no restart needed.
    onConfigChange() {},
  },
});

function trayImage(paused: boolean) {
  const pixels = ICON_SIZE * 2;
  return nativeImage.createFromBitmap(trayIconBitmap(pixels, paused), { width: pixels, height: pixels, scaleFactor: 2 });
}

// pear-desktop's tray texts and translations (main.tray.*).
function tooltip(ctx: Ctx, { track }: NowPlaying) {
  if (!track) return ctx.t("main.tray.tooltip.default", "{{applicationName}}", { applicationName: YTM_NAME });
  return ctx.t("main.tray.tooltip.with-song-info", "{{applicationName}}: {{artist}} - {{title}}", {
    applicationName: YTM_NAME,
    artist: track.artist,
    title: track.title,
  });
}

function menu(ctx: Ctx, state: NowPlaying, toggleWindow: () => void): MenuItemConstructorOptions[] {
  const { track } = state;
  const { app, window } = ctx;
  const trackInfo: MenuItemConstructorOptions[] = track
    ? [{ label: track.title, enabled: false }, { label: track.artist, enabled: false }, { type: "separator" }]
    : [];
  const playPause = isPlaying(state) ? "Pause" : "Play";
  return [
    ...trackInfo,
    { label: ctx.t("main.tray.play-pause", playPause), click: () => ctx.player.control({ type: "toggle" }) },
    { label: ctx.t("main.tray.next", "Next"), click: () => ctx.player.control({ type: "next" }) },
    { label: ctx.t("main.tray.previous", "Previous"), click: () => ctx.player.control({ type: "previous" }) },
    { type: "separator" },
    {
      label: window.isVisible() ? ctx.t("main.tray.hide", "Hide window") : ctx.t("main.tray.show", "Show window"),
      click: toggleWindow,
    },
    { label: ctx.t("main.tray.settings", "Settings…"), click: () => ctx.openSettings() },
    { type: "separator" },
    {
      label: ctx.t("main.tray.restart", "Restart App"),
      click: () => {
        app.relaunch();
        app.quit();
      },
    },
    { label: ctx.t("main.tray.quit", "Quit"), click: () => app.quit() },
  ];
}

/** With closeToTray, closing the window hides it instead (quitting still closes it). */
function closeToTray(ctx: Ctx, hideWindow: () => void) {
  let quitting = false;
  ctx.listen(ctx.app, "before-quit", () => {
    quitting = true;
  });
  ctx.listen(ctx.window, "close", (event: Electron.Event) => {
    if (!ctx.config.closeToTray || quitting) return;
    event.preventDefault();
    hideWindow();
  });
}
