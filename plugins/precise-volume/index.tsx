/** @jsxImportSource @pear/sdk */
import { config, definePlugin, type PageContextOf } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { clamp, debounce } from "@pear/sdk/util";
import { globalShortcut } from "electron";

const HUD_MS = 1500;
const SLIDER_MS = 2500;

const schema = {
  steps: config.number(1, { label: "Step", min: 1, max: 100, step: 1, unit: "%" }),
  wheel: config.bool(true, { label: "Scroll over the player to change volume" }),
  arrowsShortcut: config.bool(true, { label: "Arrow up / down change volume" }),
  showHud: config.bool(true, { label: "Show the volume while changing it" }),
  volumeUp: config.shortcut("", { label: "Global shortcut: volume up" }),
  volumeDown: config.shortcut("", { label: "Global shortcut: volume down" }),
};

type Ctx = PageContextOf<typeof schema>;

const TOOLTIP_TARGETS = ["player_bar.volume_sliders", "player_bar.volume_button", "player_bar.expand_volume"] as const;

export default definePlugin({
  id: "precise-volume",
  name: "Precise volume",
  description: "Change the volume in fine steps with the scroll wheel or arrow keys, with a volume readout.",
  config: schema,
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
    sel(player_bar.volume_popup).pear-volume-reveal {
      display: flex !important;
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
      const showHud = volumeHud(ctx);
      const showSlider = sliderReveal(ctx);

      const setTooltips = (volume: number) => {
        for (const name of TOOLTIP_TARGETS) {
          for (const element of ctx.$$(name)) element.title = `${volume}%`;
        }
      };
      // The slider position is the volume users see; YTM may map it onto a
      // different player volume (a loudness curve), so steps follow the slider.
      const position = () => {
        // A number on the classic bar's paper-slider, a string on the new bar's range input.
        const value = Number(ctx.$<HTMLElement & { value?: number | string }>("player_bar.volume_slider")?.value);
        return Number.isFinite(value) ? value : api.getVolume();
      };
      const change = (direction: number) => {
        const volume = clamp(Math.round(position()) + direction * ctx.config.steps, 0, 100);
        if (api.isMuted() && direction > 0) ctx.player.control({ type: "mute", muted: false });
        ctx.player.control({ type: "volume", value: volume });
        setTooltips(volume);
        showHud(volume);
        showSlider();
      };

      listenForWheel(ctx, change);
      listenForArrows(ctx, change);
      ctx.host.on("step", (direction) => change(Number(direction)));
      ctx.player.on("volumeChange", () => setTooltips(position()));
      setTooltips(position());
    },
    // Every option is read when used.
    onConfigChange() {},
  },
});

/** The big "42%" readout; returns a function showing a volume for a moment. */
function volumeHud(ctx: Ctx) {
  const hud = <div class="pear-volume-hud" aria-live="polite" />;
  document.body.append(hud);
  const hide = debounce(() => hud.removeAttribute("data-visible"), HUD_MS);
  ctx.onCleanup(() => {
    hide.cancel();
    hud.remove();
  });
  return (volume: number) => {
    if (!ctx.config.showHud) return;
    hud.textContent = `${volume}%`;
    hud.toggleAttribute("data-visible", true);
    hide();
  };
}

// YTM shows the slider only while hovered; keep it out while scrolling. The
// classic bar shows it with its own "on-hover" class, the new one shows a popup.
function sliderReveal(ctx: Ctx) {
  const hide = debounce((element: HTMLElement, name: string) => element.classList.remove(name), SLIDER_MS);
  ctx.onCleanup(hide.cancel);
  return () => {
    const popup = ctx.$("player_bar.volume_popup");
    const element = popup ?? ctx.$("player_bar.volume_slider");
    if (!element) return;
    const name = popup ? "pear-volume-reveal" : "on-hover";
    element.classList.add(name);
    hide(element, name);
  };
}

function listenForWheel(ctx: Ctx, change: (direction: number) => void) {
  // Capture, and stop it there, so YTM's slider doesn't also step by 5.
  const onWheel = (event: WheelEvent) => {
    if (!ctx.config.wheel || event.deltaY === 0) return;
    event.preventDefault();
    event.stopPropagation();
    change(event.deltaY < 0 ? 1 : -1);
  };
  void ctx.waitFor("player_bar").then((bar) => ctx.listen(bar, "wheel", onWheel, { capture: true, passive: false }));
  void ctx.waitFor("player.main_panel").then((panel) => ctx.listen(panel, "wheel", onWheel, { passive: false }));
}

function listenForArrows(ctx: Ctx, change: (direction: number) => void) {
  const onKeydown = (event: KeyboardEvent) => {
    if (!ctx.config.arrowsShortcut || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code !== "ArrowUp" && event.code !== "ArrowDown") return;
    if (isTyping(ctx, event)) return;
    event.preventDefault();
    event.stopPropagation();
    change(event.code === "ArrowUp" ? 1 : -1);
  };
  ctx.listen(window, "keydown", onKeydown, { capture: true });
}

/** Arrow keys in a text field or the open search box move the caret, not the volume. */
function isTyping(ctx: Ctx, event: KeyboardEvent) {
  const searchOpen = ctx.$<HTMLElement & { opened?: boolean }>("nav_bar.search_box")?.opened;
  return isEditable(event.composedPath()[0]) || !!searchOpen;
}
function isEditable(target: EventTarget | undefined) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
