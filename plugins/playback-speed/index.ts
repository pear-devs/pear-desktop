import { config, definePlugin } from "@pear/sdk";
import { picker } from "@pear/sdk/dom";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { debounce } from "@pear/sdk/util";
import { speedPanel } from "./panel.tsx";
import { format, MAX_SPEED, MIN_SPEED, normalize, WHEEL_STEP } from "./speed.ts";

const SAVE_DELAY_MS = 500;

export default definePlugin({
  id: "playback-speed",
  name: "Playback speed",
  description: "Adds a speed control to the player bar (scroll over it for fine steps).",
  config: {
    speed: config.number(1, { label: "Speed", min: MIN_SPEED, max: MAX_SPEED, step: 0.01, unit: "×" }),
    preservePitch: config.bool(true, { label: "Preserve pitch", description: "Off: faster sounds higher, like a record." }),
  },
  // What differs from the shared picker: a text button and a panel instead of a list.
  // Both classes, since the picker's sheet comes after this one.
  style: css`
    .pear-picker-button.pear-speed-button {
      width: auto;
      min-width: 40px;
      padding: 0 6px;
      border-radius: 20px;
      font: 500 13px/1 Roboto, sans-serif;
    }
    .pear-picker-popover.pear-speed-popover {
      position-try-fallbacks: flip-block;
      width: 240px;
      max-height: none;
      overflow: visible;
      padding: 12px 14px;
      font: 400 13px Roboto, sans-serif;
    }
    .pear-speed-popover header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .pear-speed-popover input {
      width: 100%;
      accent-color: #fff;
    }
    .pear-speed-presets {
      display: flex;
      gap: 4px;
      margin-top: 8px;
    }
    .pear-speed-presets button {
      flex: 1;
      padding: 4px 0;
      border: 0;
      border-radius: 12px;
      background: rgb(255 255 255 / 0.1);
      color: inherit;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .pear-speed-presets button[aria-pressed="true"] {
      background: #fff;
      color: #000;
    }
  `,
  page: async (ctx) => {
    let speed = normalize(ctx.config.speed);
    const title = ctx.t("plugins.playback-speed.title", "Playback speed");

    const { button, popover } = picker(ctx, { name: "speed", label: title, position: "top" });
    // The speed it shows is its name, and the panel isn't a list of menu items.
    button.removeAttribute("aria-label");
    popover.removeAttribute("role");
    const panel = speedPanel(title, (next) => setSpeed(next));
    popover.append(...panel.body);

    const enforce = () => {
      const video = ctx.player.video();
      if (!video) return;
      if (video.playbackRate !== speed) video.playbackRate = speed;
      if (video.preservesPitch !== ctx.config.preservePitch) video.preservesPitch = ctx.config.preservePitch;
    };
    const render = () => {
      button.textContent = format(speed);
      panel.render(speed);
    };
    const save = debounce(() => ctx.setConfig({ speed }), SAVE_DELAY_MS);
    const setSpeed = (next: number) => {
      speed = normalize(next);
      render();
      enforce();
      save();
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const wheelUp = event.deltaY < 0;
      setSpeed(speed + (wheelUp ? WHEEL_STEP : -WHEEL_STEP));
    };
    ctx.listen(button, "wheel", onWheel, { passive: false });
    ctx.listen(popover, "wheel", onWheel, { passive: false });

    ctx.onConfigChange((config) => {
      speed = normalize(config.speed);
      render();
      enforce();
    });
    ctx.onCleanup(() => {
      save.cancel();
      const video = ctx.player.video();
      if (video) {
        video.playbackRate = 1;
        video.preservesPitch = true;
      }
    });

    render();
    ctx.mount(button, "player_bar.right_controls_buttons", "prepend");

    const video = await ctx.player.videoReady();
    // YTM resets the rate when it loads a track.
    ctx.listen(video, "ratechange", enforce);
    ctx.listen(video, "loadeddata", enforce);
    enforce();
  },
});
