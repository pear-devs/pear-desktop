import { config, definePlugin, type PlayerAction } from "@pear/sdk";
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
            ctx.window.show();
            return ctx.window.focus();
          default:
            return ctx.player.control(ACTIONS[name].action);
        }
      };

      const failed: string[] = [];
      for (const name of Object.keys(ACTIONS) as ActionName[]) {
        const accelerator = ctx.config[name];
        if (!accelerator) continue;
        let ok = false;
        try {
          ok = globalShortcut.register(accelerator, () => run(name));
        } catch (error) {
          ctx.log.warn(`invalid accelerator ${accelerator}`, error);
        }
        if (ok) ctx.onCleanup(() => globalShortcut.unregister(accelerator));
        else failed.push(accelerator);
      }
      if (failed.length > 0) {
        throw new Error(`couldn't register ${failed.join(", ")} (invalid or used by another app)`);
      }
    },
  },
});
