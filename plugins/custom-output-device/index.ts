import { config, definePlugin } from "@pear/sdk";
import { picker } from "@pear/sdk/dom";
import { css } from "@pear/sdk/macros" with { type: "macro" };

type SinkTarget = { setSinkId(id: string): Promise<void> };

const ICON =
  "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z";
// Device names run long.
const PICKER_WIDTH = 220;

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
  // Only what differs from the shared picker; both classes, since the picker's sheet comes after this one.
  style: css`
    .pear-picker-popover.pear-output-popover {
      position-try-fallbacks: flip-block;
      max-width: 420px;
    }
  `,
  page: async (ctx) => {
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

    const choose = (output: string) => {
      ctx.setConfig({ output });
      void apply();
    };
    const choices = async () => {
      const current = ctx.config.output;
      const systemDefault = {
        label: ctx.t("plugins.custom-output-device.system-default", "System default"),
        checked: !current,
        select: () => choose(""),
      };
      const devices = (await outputs()).map((device, i) => ({
        label: device.label || ctx.t("plugins.custom-output-device.unnamed-output", "Output {{number}}", { number: i + 1 }),
        checked: current === device.label || current === device.deviceId,
        select: () => choose(device.label || device.deviceId),
      }));
      return [systemDefault, ...devices];
    };

    ctx.listen(navigator.mediaDevices, "devicechange", () => void apply());
    const showPicker = ctx.config.showPicker;
    // Showing or hiding the picker restarts; a new device is just applied.
    ctx.onConfigChange((config) => {
      if (config.showPicker !== showPicker) return "restart";
      void apply();
    });
    ctx.onCleanup(() => {
      if (applied) void setSink("");
    });

    // The picker doesn't depend on resolving the device, so mount it first.
    if (showPicker) {
      const { button } = picker(ctx, {
        name: "output",
        label: ctx.t("plugins.custom-output-device.menu.device-selector", "Select Device"),
        icon: ICON,
        heading: ctx.t("plugins.custom-output-device.heading", "Play on"),
        items: choices,
        width: PICKER_WIDTH,
      });
      ctx.mount(button, "player_bar.right_controls_buttons", "prepend");
    }
    await ctx.player.ready();
    await apply();
  },
});
