import { config, definePlugin, type PlayerAction } from "@pear/sdk";
import { fromInput, matchesAccelerator } from "@pear/sdk/accelerator";
import { globalShortcut } from "electron";

const ACTIONS = {
  playPause: { label: "Play / pause", action: { type: "toggle" } },
  next: { label: "Next track", action: { type: "next" } },
  previous: { label: "Previous track", action: { type: "previous" } },
  volumeUp: { label: "Volume up", action: { type: "volume", value: NaN } },
  volumeDown: { label: "Volume down", action: { type: "volume", value: NaN } },
  like: { label: "Like current track", action: { type: "like" } },
  showWindow: { label: "Show window", action: undefined },
} satisfies Record<string, { label: string; action: PlayerAction | undefined }>;

type ActionName = keyof typeof ACTIONS;

const VOLUME_STEP = 5;

// pear-desktop's in-window shortcuts (only while the window has focus).
const LOCAL = { localPlayPause: "playPause", localNext: "next", localPrevious: "previous" } as const;
// pear-desktop's "override media keys": the keyboard's media keys, taken globally.
const MEDIA_KEYS = { MediaPlayPause: "playPause", MediaNextTrack: "next", MediaPreviousTrack: "previous" } as const;

export default definePlugin({
  id: "shortcuts",
  name: "Global shortcuts",
  description: "System-wide keyboard shortcuts that work while the window is in the background.",
  config: {
    playPause: config.shortcut("", { label: ACTIONS.playPause.label }),
    next: config.shortcut("", { label: ACTIONS.next.label }),
    previous: config.shortcut("", { label: ACTIONS.previous.label }),
    volumeUp: config.shortcut("", { label: ACTIONS.volumeUp.label }),
    volumeDown: config.shortcut("", { label: ACTIONS.volumeDown.label }),
    like: config.shortcut("", { label: ACTIONS.like.label }),
    showWindow: config.shortcut("", { label: ACTIONS.showWindow.label }),
    overrideMediaKeys: config.bool(false, {
      label: "Take over the media keys",
      description: "Play/pause, next and previous keys control this app even when another player would get them.",
    }),
    localPlayPause: config.shortcut("", { label: ACTIONS.playPause.label, group: "In the window" }),
    localNext: config.shortcut("", { label: ACTIONS.next.label, group: "In the window" }),
    localPrevious: config.shortcut("", { label: ACTIONS.previous.label, group: "In the window" }),
  },
  host: {
    start(ctx) {
      const run = (name: ActionName) => {
        const { state } = ctx.player;
        switch (name) {
          case "volumeUp":
            return ctx.player.control({ type: "volume", value: state.volume + VOLUME_STEP });
          case "volumeDown":
            return ctx.player.control({ type: "volume", value: state.volume - VOLUME_STEP });
          case "showWindow":
            return ctx.focusWindow();
          default:
            return ctx.player.control(ACTIONS[name].action);
        }
      };

      const failed: string[] = [];
      const register = (accelerator: string, name: ActionName) => {
        let ok = false;
        try {
          ok = globalShortcut.register(accelerator, () => run(name));
        } catch (error) {
          ctx.log.warn(`invalid accelerator ${accelerator}`, error);
        }
        if (ok) ctx.onCleanup(() => globalShortcut.unregister(accelerator));
        else failed.push(accelerator);
      };
      for (const name of Object.keys(ACTIONS) as ActionName[]) {
        const accelerator = ctx.config[name];
        if (accelerator) register(accelerator, name);
      }
      if (ctx.config.overrideMediaKeys) {
        for (const [key, name] of Object.entries(MEDIA_KEYS)) register(key, name);
      }

      // In-window shortcuts, matched before the page sees the key (like electron-localshortcut).
      const isMac = process.platform === "darwin";
      const onInput = (event: Electron.Event, input: Electron.Input) => {
        if (input.type !== "keyDown") return;
        for (const [key, name] of Object.entries(LOCAL) as [keyof typeof LOCAL, ActionName][]) {
          if (!matchesAccelerator(fromInput(input), ctx.config[key], isMac)) continue;
          event.preventDefault();
          run(name);
          return;
        }
      };
      ctx.listen(ctx.window.webContents, "before-input-event", onInput);

      if (failed.length > 0) {
        throw new Error(`couldn't register ${failed.join(", ")} (invalid or used by another app)`);
      }
    },
  },
});
