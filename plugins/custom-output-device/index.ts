import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

type SinkTarget = { setSinkId(id: string): Promise<void> };

const ICON =
  "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z";

export default definePlugin({
  id: "custom-output-device",
  name: "Custom output device",
  description: "Play through a chosen audio device instead of the system default.",
  config: {
    output: config.string("", {
      label: "Output device",
      description: "The device's name; pick one from the speaker button in the player bar. Empty uses the system default.",
      placeholder: "System default",
    }),
    showPicker: config.bool(true, { label: "Device picker in the player bar" }),
  },
  style: css`
    .pear-output-button {
      anchor-name: --pear-output;
      width: 40px;
      height: 40px;
      padding: 8px;
      border: 0;
      border-radius: 50%;
      background: none;
      color: var(--ytmusic-text-secondary, #aaa);
      cursor: pointer;
    }
    .pear-output-button:hover,
    .pear-output-button[aria-expanded="true"] {
      background: rgb(255 255 255 / 0.1);
      color: #fff;
    }
    .pear-output-button svg {
      display: block;
      width: 24px;
      height: 24px;
      fill: currentColor;
    }
    .pear-output-popover {
      position-anchor: --pear-output;
      position-area: top span-left;
      position-try-fallbacks: flip-block;
      inset: auto;
      margin: 8px 0;
      min-width: 220px;
      max-width: 420px;
      max-height: 50vh;
      overflow-y: auto;
      padding: 8px 0;
      border: 0;
      border-radius: 8px;
      background: #212121;
      color: #fff;
      font: 400 14px Roboto, sans-serif;
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.5);
    }
    .pear-output-popover h2 {
      margin: 0;
      padding: 4px 16px 8px;
      color: #aaa;
      font: inherit;
      font-size: 12px;
    }
    .pear-output-popover button {
      display: block;
      width: 100%;
      padding: 8px 16px 8px 36px;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .pear-output-popover button:hover {
      background: rgb(255 255 255 / 0.1);
    }
    .pear-output-popover button[aria-checked="true"]::before {
      content: "✓";
      position: absolute;
      margin-left: -22px;
    }
  `,
  page: {
    async start(ctx) {
      const outputs = async () =>
        (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput" && d.deviceId !== "default");

      // Labels are stable across sessions and readable in settings; ids also work.
      const resolve = async (wanted: string) => {
        if (!wanted) return "";
        const devices = await outputs();
        return devices.find((d) => d.label === wanted || d.deviceId === wanted)?.deviceId;
      };

      let applied: string | undefined;
      const apply = async () => {
        const id = await resolve(ctx.config.output);
        // An unplugged device: stay on the current output until it's back.
        if (id === undefined || id === (applied ?? "") || ctx.signal.aborted) return;
        applied = id;
        await setSink(id);
      };
      // Once any plugin creates the shared graph, the <video> plays through its
      // AudioContext and the element's own sink can no longer change (Chromium
      // aborts the call). So the device is set on the graph, created here, which
      // also covers audio plugins enabled later; the element is the fallback
      // where AudioContext.setSinkId is missing.
      const setSink = async (id: string) => {
        const graph = await ctx.audio();
        const context = graph.context as AudioContext & Partial<SinkTarget>;
        const target = context.setSinkId ? (context as SinkTarget) : (graph.video as HTMLVideoElement & SinkTarget);
        await target.setSinkId(id).catch((error) => ctx.log.warn("couldn't set the output device", error));
      };

      const button = document.createElement("button");
      button.className = "pear-output-button";
      const buttonLabel = ctx.t("plugins.custom-output-device.menu.device-selector", "Select Device");
      button.title = buttonLabel;
      button.setAttribute("aria-label", buttonLabel);
      button.append(icon(ICON));
      const popover = document.createElement("div");
      popover.className = "pear-output-popover";
      popover.popover = "auto";
      popover.setAttribute("role", "menu");
      button.popoverTargetElement = popover;

      const render = async () => {
        const devices = await outputs();
        const heading = document.createElement("h2");
        heading.textContent = ctx.t("plugins.custom-output-device.heading", "Play on");
        const current = ctx.config.output;
        const item = (label: string, value: string, checked: boolean) => {
          const element = document.createElement("button");
          element.setAttribute("role", "menuitemradio");
          element.setAttribute("aria-checked", String(checked));
          element.textContent = label;
          element.addEventListener("click", () => {
            ctx.setConfig({ output: value });
            void apply();
            popover.hidePopover();
          });
          return element;
        };
        popover.replaceChildren(
          heading,
          item(ctx.t("plugins.custom-output-device.system-default", "System default"), "", !current),
          ...devices.map((d, i) => {
            const label = d.label || ctx.t("plugins.custom-output-device.unnamed-output", "Output {{number}}", { number: i + 1 });
            return item(label, d.label || d.deviceId, current === d.label || current === d.deviceId);
          }),
        );
      };
      popover.addEventListener("beforetoggle", (event) => {
        const open = (event as ToggleEvent).newState === "open";
        if (open) void render();
        button.setAttribute("aria-expanded", String(open));
      });

      ctx.listen(navigator.mediaDevices, "devicechange", () => void apply());
      live = { apply, picker: ctx.config.showPicker };
      ctx.onCleanup(() => {
        live = undefined;
        button.remove();
        popover.remove();
        if (applied) void setSink("");
      });

      // The picker doesn't depend on resolving the device, so mount it first.
      if (ctx.config.showPicker) {
        document.body.append(popover);
        void ctx.waitFor("player_bar.right_controls_buttons").then((container) => container.prepend(button), () => {});
      }
      await ctx.player.ready();
      await apply();
    },
    onConfigChange(config) {
      if (!live || config.showPicker !== live.picker) return "restart";
      void live.apply();
    },
  },
});

// The running page part (one instance at a time).
let live: { apply(): Promise<void>; picker: boolean } | undefined;

function icon(path: string) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  svg.append(shape);
  return svg;
}
