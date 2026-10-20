/** @jsxImportSource @pear/sdk */
import { definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import butterchurnSource from "butterchurn/dist/butterchurn.min.js?raw";
import vudioSource from "vudio/umd/vudio.js?raw";
import waveSource from "@foobar404/wave/dist/bundle.js?raw";
import presetsSource from "butterchurn-presets/dist/base.min.js?raw";
import { DEFAULT_PRESET, schema, type Renderer, type Stage, type VisualizerCommands } from "./config.ts";
import { butterchurnRenderer } from "./renderers/butterchurn.ts";
import { vudioRenderer } from "./renderers/vudio.ts";
import { waveRenderer } from "./renderers/wave.ts";

const RENDERERS: Record<Stage["ctx"]["config"]["type"], (stage: Stage) => Promise<Renderer | undefined>> = {
  butterchurn: butterchurnRenderer,
  vudio: vudioRenderer,
  wave: waveRenderer,
};

export default definePlugin({
  id: "visualizer",
  name: "Visualizer",
  description: "Shows a music visualizer in place of the album art on the player page.",
  config: schema,
  style: css`
    .pear-visualizer {
      position: absolute;
      inset: 0;
      z-index: 1;
      width: 100%;
      height: 100%;
      background: #000;
      pointer-events: none;
    }
  `,
  host: {
    commands: {
      butterchurn() {
        return butterchurnSource;
      },
      preset(name: string) {
        presets ??= evaluatePresets(presetsSource);
        return presets[name] ?? presets[DEFAULT_PRESET];
      },
      vudio() {
        return vudioSource;
      },
      wave() {
        return waveSource;
      },
    },
  },
  page: async (ctx) => {
    const graph = await ctx.audio();
    const container = await ctx.waitFor("player.container");
    const canvas = (<canvas class="pear-visualizer" />) as HTMLCanvasElement;
    container.prepend(canvas);
    let frame = 0;
    ctx.onCleanup(() => {
      cancelAnimationFrame(frame);
      canvas.remove();
    });

    const size = () => {
      const ratio = window.devicePixelRatio || 1;
      return { width: Math.ceil(container.clientWidth * ratio), height: Math.ceil(container.clientHeight * ratio) };
    };
    const renderer = await RENDERERS[ctx.config.type]({ ctx, graph, canvas, size });
    // Stopped while the renderer loaded: the cleanup above already ran, so no loop.
    if (!renderer || ctx.signal.aborted) return;

    // Zero-sized while the player page is closed or in the mini player; known from here
    // rather than read every frame (reading layout each frame forces a layout).
    let shown = false;
    const observer = new ResizeObserver(() => {
      const { width, height } = size();
      shown = width > 0 && height > 0;
      if (shown) renderer.resize(width, height);
    });
    observer.observe(container);
    ctx.onCleanup(() => observer.disconnect());

    const { render } = renderer;
    if (!render) return;
    const tick = () => {
      if (shown && ctx.isWindowVisible()) render();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  },
});

// Host: the parsed preset pack, kept across restarts.
let presets: Record<string, unknown> | undefined;

/** The preset pack is a UMD bundle that expects a browser-like `self`. */
function evaluatePresets(source: string): Record<string, unknown> {
  const module: { exports: { default?: Record<string, unknown> } } = { exports: {} };
  new Function("module", "exports", "self", source)(module, module.exports, globalThis);
  return module.exports.default ?? {};
}
