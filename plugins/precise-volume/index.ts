import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { globalShortcut } from "electron";

const HUD_MS = 1500;
const SLIDER_MS = 2500;

export default definePlugin({
  id: "precise-volume",
  name: "Precise volume",
  description: "Change the volume in fine steps with the scroll wheel or arrow keys, with a volume readout.",
  config: {
    steps: config.number(1, { label: "Step", min: 1, max: 100, step: 1, unit: "%" }),
    wheel: config.bool(true, { label: "Scroll over the player to change volume" }),
    arrowsShortcut: config.bool(true, { label: "Arrow up / down change volume" }),
    showHud: config.bool(true, { label: "Show the volume while changing it" }),
    volumeUp: config.shortcut("", { label: "Global shortcut: volume up" }),
    volumeDown: config.shortcut("", { label: "Global shortcut: volume down" }),
  },
  style: css`
    .pear-volume-hud {
      position: fixed;
      top: 80px;
      left: 50%;
      z-index: 2200;
      translate: -50%;
      padding: 8px 18px;
      border-radius: 20px;
      background: rgb(0 0 0 / 0.65);
      color: #fff;
      font: 600 28px Roboto, sans-serif;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.4s;
    }
    .pear-volume-hud[data-visible] {
      opacity: 1;
      transition-duration: 0.1s;
    }
  `,
  host: {
    start(ctx) {
      const failed: string[] = [];
      for (const [key, direction] of [["volumeUp", 1], ["volumeDown", -1]] as const) {
        const accelerator = ctx.config[key];
        if (!accelerator) continue;
        let ok = false;
        try {
          ok = globalShortcut.register(accelerator, () => ctx.emit("step", direction));
        } catch (error) {
          ctx.log.warn(`invalid accelerator ${accelerator}`, error);
        }
        if (ok) ctx.onCleanup(() => globalShortcut.unregister(accelerator));
        else failed.push(accelerator);
      }
      if (failed.length > 0) throw new Error(`couldn't register ${failed.join(", ")} (invalid or used by another app)`);
    },
  },
  page: {
    async start(ctx) {
      const api = await ctx.player.ready();
      const hud = document.createElement("div");
      hud.className = "pear-volume-hud";
      hud.setAttribute("aria-live", "polite");
      document.body.append(hud);
      let hudTimer: ReturnType<typeof setTimeout> | undefined;
      let sliderTimer: ReturnType<typeof setTimeout> | undefined;

      const setTooltips = (volume: number) => {
        for (const name of ["player_bar.volume_sliders", "player_bar.volume_button", "player_bar.expand_volume"] as const) {
          for (const element of ctx.$$(name)) element.title = `${volume}%`;
        }
      };
      const showHud = (volume: number) => {
        if (!ctx.config.showHud) return;
        hud.textContent = `${volume}%`;
        hud.toggleAttribute("data-visible", true);
        clearTimeout(hudTimer);
        hudTimer = setTimeout(() => hud.removeAttribute("data-visible"), HUD_MS);
      };
      // YTM shows the slider only while hovered; keep it out while scrolling.
      const showSlider = () => {
        const slider = ctx.$("player_bar.volume_slider");
        if (!slider) return;
        slider.classList.add("on-hover");
        clearTimeout(sliderTimer);
        sliderTimer = setTimeout(() => slider.classList.remove("on-hover"), SLIDER_MS);
      };
      // The slider position is the volume users see; YTM may map it onto a
      // different player volume (a loudness curve), so steps follow the slider.
      const position = () => {
        const value = Number(ctx.$<HTMLElement & { value?: number }>("player_bar.volume_slider")?.value);
        return Number.isFinite(value) ? value : api.getVolume();
      };
      const change = (direction: number) => {
        const volume = Math.min(100, Math.max(0, Math.round(position()) + direction * ctx.config.steps));
        if (api.isMuted() && direction > 0) ctx.player.control({ type: "mute", muted: false });
        ctx.player.control({ type: "volume", value: volume });
        setTooltips(volume);
        showHud(volume);
        showSlider();
      };

      // Capture, and stop it there, so YTM's slider doesn't also step by 5.
      const onWheel = (event: WheelEvent) => {
        if (!ctx.config.wheel || event.deltaY === 0) return;
        event.preventDefault();
        event.stopPropagation();
        change(event.deltaY < 0 ? 1 : -1);
      };
      void ctx.waitFor("player_bar").then((bar) => ctx.listen(bar, "wheel", onWheel, { capture: true, passive: false }));
      void ctx.waitFor("player.main_panel").then((panel) => ctx.listen(panel, "wheel", onWheel, { passive: false }));

      ctx.listen(
        window,
        "keydown",
        (event: KeyboardEvent) => {
          if (!ctx.config.arrowsShortcut || event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.code !== "ArrowUp" && event.code !== "ArrowDown") return;
          if (isEditable(event.composedPath()[0]) || ctx.$<HTMLElement & { opened?: boolean }>("nav_bar.search_box")?.opened) return;
          event.preventDefault();
          event.stopPropagation();
          change(event.code === "ArrowUp" ? 1 : -1);
        },
        { capture: true },
      );

      ctx.host.on("step", (direction) => change(Number(direction)));
      ctx.player.on("volumeChange", () => setTooltips(position()));
      setTooltips(position());

      return () => {
        clearTimeout(hudTimer);
        clearTimeout(sliderTimer);
        hud.remove();
      };
    },
    // Every option is read when used.
    onConfigChange() {},
  },
});

function isEditable(target: EventTarget | undefined) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
