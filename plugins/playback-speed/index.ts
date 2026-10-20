import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

const MIN_SPEED = 0.07;
const MAX_SPEED = 16;
const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const clamp = (speed: number) => Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100));
const format = (speed: number) => `${speed.toFixed(2).replace(/\.?0+$/, "")}×`;

export default definePlugin({
  id: "playback-speed",
  name: "Playback speed",
  description: "Adds a speed control to the player bar (scroll over it for fine steps).",
  config: {
    speed: config.number(1, { label: "Speed", min: MIN_SPEED, max: MAX_SPEED, step: 0.01, unit: "×" }),
    preservePitch: config.bool(true, { label: "Preserve pitch", description: "Off: faster sounds higher, like a record." }),
  },
  style: css`
    .pear-speed-button {
      anchor-name: --pear-speed;
      min-width: 40px;
      height: 40px;
      padding: 0 6px;
      border: 0;
      border-radius: 20px;
      background: none;
      color: var(--ytmusic-text-secondary, #aaa);
      font: 500 13px/1 Roboto, sans-serif;
      cursor: pointer;
    }
    .pear-speed-button:hover,
    .pear-speed-button[aria-expanded="true"] {
      background: rgb(255 255 255 / 0.1);
      color: #fff;
    }
    .pear-speed-popover {
      position-anchor: --pear-speed;
      position-area: top;
      position-try-fallbacks: flip-block;
      inset: auto;
      margin: 8px 0;
      width: 240px;
      padding: 12px 14px;
      border: 0;
      border-radius: 8px;
      background: #212121;
      color: #fff;
      font: 400 13px Roboto, sans-serif;
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.5);
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
  page: {
    async start(ctx) {
      let speed = clamp(ctx.config.speed);
      let saveTimer: ReturnType<typeof setTimeout> | undefined;
      const title = ctx.t("plugins.playback-speed.title", "Playback speed");

      const button = document.createElement("button");
      button.className = "pear-speed-button";
      button.title = title;
      const popover = document.createElement("div");
      popover.className = "pear-speed-popover";
      popover.popover = "auto";
      button.popoverTargetElement = popover;

      const label = document.createElement("span");
      const header = document.createElement("header");
      header.append(title, label);
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0.25";
      slider.max = "2";
      slider.step = "0.05";
      slider.setAttribute("aria-label", title);
      const presets = document.createElement("div");
      presets.className = "pear-speed-presets";
      const presetButtons = PRESETS.map((value) => {
        const preset = document.createElement("button");
        preset.textContent = format(value);
        preset.addEventListener("click", () => setSpeed(value));
        return preset;
      });
      presets.append(...presetButtons);
      popover.append(header, slider, presets);
      popover.addEventListener("toggle", (event) => {
        button.setAttribute("aria-expanded", String((event as ToggleEvent).newState === "open"));
      });

      const enforce = () => {
        const video = ctx.player.video();
        if (!video) return;
        if (video.playbackRate !== speed) video.playbackRate = speed;
        if (video.preservesPitch !== ctx.config.preservePitch) video.preservesPitch = ctx.config.preservePitch;
      };
      const render = () => {
        button.textContent = format(speed);
        label.textContent = format(speed);
        slider.value = String(speed);
        for (const [i, preset] of presetButtons.entries()) preset.setAttribute("aria-pressed", String(PRESETS[i] === speed));
      };
      const setSpeed = (next: number) => {
        speed = clamp(next);
        render();
        enforce();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => ctx.setConfig({ speed }), 500);
      };
      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        // deltaY < 0 is wheel-up.
        setSpeed(speed + (event.deltaY < 0 ? 0.01 : -0.01));
      };

      slider.addEventListener("input", () => setSpeed(slider.valueAsNumber));
      ctx.listen(button, "wheel", onWheel, { passive: false });
      ctx.listen(popover, "wheel", onWheel, { passive: false });

      live = {
        update() {
          speed = clamp(ctx.config.speed);
          render();
          enforce();
        },
      };
      ctx.onCleanup(() => {
        live = undefined;
        clearTimeout(saveTimer);
        button.remove();
        popover.remove();
        const video = ctx.player.video();
        if (video) {
          video.playbackRate = 1;
          video.preservesPitch = true;
        }
      });

      render();
      document.body.append(popover);
      const container = await ctx.waitFor("player_bar.right_controls_buttons");
      container.prepend(button);

      await ctx.player.ready();
      const video = ctx.player.video();
      // YTM resets the rate when it loads a track.
      if (video) {
        ctx.listen(video, "ratechange", enforce);
        ctx.listen(video, "loadeddata", enforce);
      }
      enforce();
    },
    onConfigChange() {
      live?.update();
    },
  },
});

// The running page part (one instance at a time).
let live: { update(): void } | undefined;
