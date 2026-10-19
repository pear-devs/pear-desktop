import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import butterchurnSource from "butterchurn/dist/butterchurn.min.js?raw";
import presetsSource from "butterchurn-presets/dist/minimal.min.js?raw";
import { drawBars, drawWave, type Frame } from "./canvas.ts";

// butterchurn's "minimal" preset pack, bundled into the host and sent to the
// page only when used, so the page runtime stays small.
const PRESETS = [
  "martin [shadow harlequins shape code] - fata morgana",
  "_Aderrasi - Wanderer in Curved Space - mash0000 - faclempt kibitzing meshuggana schmaltz (Geiss color mix)",
  "_Mig_085",
  "$$$ Royal - Mashup (197)",
  "$$$ Royal - Mashup (431)",
  "An AdamFX n Martin Infusion 2 flexi - Why The Sky Looks Diffrent Today - AdamFx n Martin Infusion - Tack Tile Disfunction B",
  "Flexi - alien fish pond",
  "flexi - bouncing balls [double mindblob neon mix]",
  "Flexi - mindblob [shiny mix]",
  "Flexi, fishbrain, Geiss + Martin - tokamak witchery",
  "Flexi, martin + geiss - dedicated to the sherwin maxawow",
  "Geiss - Cauldron - painterly 2 (saturation remix)",
  "Geiss - Reaction Diffusion 2",
  "Geiss - Thumb Drum",
  "Halfbreak - Funny Madness",
  "Martin - acid wiring",
  "martin - chain breaker",
  "martin - extreme heat",
  "martin - mandelbox explorer - high speed demo version",
  "martin - reflections on black tiles",
  "martin - witchcraft reloaded",
  "Milk Artist At our Best - FED - SlowFast Ft AdamFX n Martin - HD CosmoFX",
  "MilkDrop2077.R002",
  "ShadowHarlequin - LovelyShinySquares [ liquid starburst rmx ] - unchained + rovaster - luckless - martin - starfield sector",
  "shifter - liquid circuitry - conjugoth",
  "suksma - uninitialized variabowl (hydroponic chronic)",
  "Unchained - Rewop",
  "yin - 191 - Temporal singularities",
  "Zylot - Paint Spill (Music Reactive Paint Mix)",
] as const;

const shorten = (name: string) => (name.length > 60 ? `${name.slice(0, 57)}…` : name);

export default definePlugin({
  id: "visualizer",
  name: "Visualizer",
  description: "Shows a music visualizer in place of the album art on the player page.",
  config: {
    type: config.select(
      "butterchurn",
      [
        { value: "butterchurn", label: "Milkdrop (butterchurn)" },
        { value: "bars", label: "Bars" },
        { value: "wave", label: "Wave" },
      ],
      { label: "Visualizer" },
    ),
    preset: config.select(PRESETS[0], PRESETS.map((value) => ({ value, label: shorten(value) })), { label: "Milkdrop preset" }),
    blendTimeInSeconds: config.number(2.7, { label: "Milkdrop preset blend time", min: 0, max: 10, step: 0.1, unit: " s" }),
    songTitle: config.bool(false, { label: "Milkdrop: show the track title on change" }),
    bars: config.number(64, { label: "Bars / wave detail", min: 16, max: 256, step: 8 }),
    primary: config.string("#49f3f7", { label: "Primary color", placeholder: "#49f3f7" }),
    secondary: config.string("#f76b1c", { label: "Secondary color", placeholder: "#f76b1c" }),
  },
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
        return presets[name] ?? presets[PRESETS[0]];
      },
    },
  },
  page: async (ctx) => {
    const graph = await ctx.audio();
    const container = await ctx.waitFor("player.container");
    const canvas = document.createElement("canvas");
    canvas.className = "pear-visualizer";
    container.prepend(canvas);
    let frame = 0;
    let observer: ResizeObserver | undefined;
    ctx.onCleanup(() => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      canvas.remove();
    });

    const size = () => {
      const ratio = window.devicePixelRatio || 1;
      return { width: Math.ceil(container.clientWidth * ratio), height: Math.ceil(container.clientHeight * ratio) };
    };
    // Hidden (mini player, another page): skip drawing.
    const visible = () => container.clientWidth > 0 && container.clientHeight > 0;
    const loop = (render: () => void) => {
      const tick = () => {
        if (visible()) render();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    if (ctx.config.type === "butterchurn") {
      butterchurn ??= ctx.host.invoke("butterchurn").then(importSource);
      const [module, preset] = await Promise.all([butterchurn, ctx.host.invoke("preset", ctx.config.preset)]);
      if (ctx.signal.aborted) return;
      const input = graph.context.createGain();
      ctx.onCleanup(() => input.disconnect());
      graph.tap(input);
      const { width, height } = size();
      const visualizer = module.default.createVisualizer(graph.context, canvas, { width, height });
      ctx.onCleanup(() => visualizer.loseGLContext());
      visualizer.connectAudio(input);
      await visualizer.loadPreset(preset, ctx.config.blendTimeInSeconds);
      observer = new ResizeObserver(() => {
        const { width, height } = size();
        if (width === 0 || height === 0) return;
        canvas.width = width;
        canvas.height = height;
        visualizer.setRendererSize(width, height);
      });
      ctx.player.on("trackChange", (track) => {
        if (ctx.config.songTitle) visualizer.launchSongTitleAnim(`${track.artist} - ${track.title}`);
      });
      loop(() => visualizer.render());
    } else {
      const analyser = graph.context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      graph.tap(analyser);
      const data: Frame = {
        frequency: new Uint8Array(analyser.frequencyBinCount),
        waveform: new Uint8Array(analyser.fftSize),
      };
      const g = canvas.getContext("2d")!;
      const draw = ctx.config.type === "wave" ? drawWave : drawBars;
      const options = { bars: ctx.config.bars, primary: ctx.config.primary, secondary: ctx.config.secondary };
      observer = new ResizeObserver(() => {
        const { width, height } = size();
        canvas.width = width;
        canvas.height = height;
      });
      loop(() => {
        analyser.getByteFrequencyData(data.frequency);
        analyser.getByteTimeDomainData(data.waveform);
        draw(g, data, options);
      });
    }
    observer.observe(container);
  },
});

// Host: parsed preset pack. Page: the loaded butterchurn module. Both kept across restarts.
let presets: Record<string, unknown> | undefined;
let butterchurn: Promise<ButterchurnModule> | undefined;

/** butterchurn ships as an ES module; the page's CSP is lifted, so a blob URL can be imported. */
async function importSource(source: string): Promise<ButterchurnModule> {
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    return (await import(/* @vite-ignore */ url)) as ButterchurnModule;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The preset pack is a UMD bundle that expects a browser-like `self`. */
function evaluatePresets(source: string): Record<string, unknown> {
  const module: { exports: { default?: Record<string, unknown> } } = { exports: {} };
  new Function("module", "exports", "self", source)(module, module.exports, globalThis);
  return module.exports.default ?? {};
}
