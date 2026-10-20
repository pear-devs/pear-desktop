import { config, definePlugin, type NowPlaying } from "@pear/sdk";
import { trayIconBitmap } from "@pear/sdk/icon";
import { Menu, nativeImage, Tray } from "electron";

export default definePlugin({
  id: "tray",
  name: "Tray icon",
  description: "Playback controls and the current track in the system tray.",
  enabledByDefault: true,
  config: {
    closeToTray: config.bool(false, {
      label: "Close to tray",
      description: "Closing the window keeps music playing in the background.",
    }),
    clickToToggle: config.bool(true, { label: "Click toggles the window" }),
    clickPlayPause: config.bool(false, {
      label: "Click plays and pauses",
      description: "Instead of toggling the window.",
    }),
  },
  host: {
    start(ctx) {
      const size = 32;
      const icon = nativeImage.createFromBitmap(trayIconBitmap(size * 2), {
        width: size * 2,
        height: size * 2,
        scaleFactor: 2,
      });
      const tray = new Tray(icon);
      const { window, app } = ctx;
      const showWindow = () => {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      };
      const toggleWindow = () => (window.isVisible() && window.isFocused() ? window.hide() : showWindow());

      const update = (state: NowPlaying) => {
        const track = state.track;
        const playing = state.status === "playing" || state.status === "buffering";
        // pear-desktop's tray texts and translations (main.tray.*).
        const appName = "\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063";
        tray.setToolTip(
          track
            ? ctx.t("main.tray.tooltip.with-song-info", "{{applicationName}}: {{artist}} - {{title}}", {
                applicationName: appName,
                artist: track.artist,
                title: track.title,
              })
            : ctx.t("main.tray.tooltip.default", "{{applicationName}}", { applicationName: appName }),
        );
        tray.setContextMenu(
          Menu.buildFromTemplate([
            ...(track
              ? [
                  { label: track.title, enabled: false },
                  { label: track.artist, enabled: false },
                  { type: "separator" as const },
                ]
              : []),
            { label: ctx.t("main.tray.play-pause", playing ? "Pause" : "Play"), click: () => ctx.player.control({ type: "toggle" }) },
            { label: ctx.t("main.tray.next", "Next"), click: () => ctx.player.control({ type: "next" }) },
            { label: ctx.t("main.tray.previous", "Previous"), click: () => ctx.player.control({ type: "previous" }) },
            { type: "separator" },
            {
              label: window.isVisible() ? ctx.t("main.tray.hide", "Hide window") : ctx.t("main.tray.show", "Show window"),
              click: toggleWindow,
            },
            { label: ctx.t("main.tray.settings", "Settings…"), click: () => ctx.openSettings() },
            { type: "separator" },
            { label: ctx.t("main.tray.quit", "Quit"), click: () => app.quit() },
          ]),
        );
      };
      update(ctx.player.state);
      // Rebuild the menu only when something it shows changes.
      ctx.player.on("change", (state, previous) => {
        const wasPlaying = previous.status === "playing" || previous.status === "buffering";
        const isPlaying = state.status === "playing" || state.status === "buffering";
        if (state.track !== previous.track || wasPlaying !== isPlaying) update(state);
      });
      const refresh = () => update(ctx.player.state);
      window.on("show", refresh);
      window.on("hide", refresh);
      ctx.onCleanup(() => {
        window.off("show", refresh);
        window.off("hide", refresh);
      });

      tray.on("click", () => {
        if (ctx.config.clickPlayPause) ctx.player.control({ type: "toggle" });
        else if (ctx.config.clickToToggle) toggleWindow();
      });

      let quitting = false;
      const onBeforeQuit = () => {
        quitting = true;
      };
      const onClose = (event: Electron.Event) => {
        if (!ctx.config.closeToTray || quitting) return;
        event.preventDefault();
        window.hide();
      };
      app.on("before-quit", onBeforeQuit);
      window.on("close", onClose);

      return () => {
        app.off("before-quit", onBeforeQuit);
        window.off("close", onClose);
        tray.destroy();
      };
    },
    // Both options are read when used; no restart needed.
    onConfigChange() {},
  },
});
