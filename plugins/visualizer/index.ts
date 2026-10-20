import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import butterchurnSource from "butterchurn/dist/butterchurn.min.js?raw";
import vudioSource from "vudio/umd/vudio.js?raw";
import waveSource from "@foobar404/wave/dist/bundle.js?raw";
import presetsSource from "butterchurn-presets/dist/base.min.js?raw";
import { PRESETS } from "./presets.ts";

// The libraries are bundled into the host and sent to the page only when used,
// so the page runtime stays small. Presets: butterchurn's base pack, as pear-desktop.
const DEFAULT_PRESET = "martin [shadow harlequins shape code] - fata morgana";

/** pear-desktop's default Wave animations. */
const DEFAULT_WAVE = [
  {
    type: "Cubes",
    config: { bottom: true, count: 30, cubeHeight: 5, fillColor: { gradient: ["#FAD961", "#F76B1C"] }, lineColor: "rgba(0,0,0,0)", radius: 20 },
  },
  {
    type: "Cubes",
    config: { top: true, count: 12, cubeHeight: 5, fillColor: { gradient: ["#FAD961", "#F76B1C"] }, lineColor: "rgba(0,0,0,0)", radius: 10 },
  },
  {
    type: "Circles",
    config: { lineColor: { gradient: ["#FAD961", "#FAD961", "#F76B1C"], rotate: 90 }, lineWidth: 4, diameter: 20, count: 10, frequencyBand: "base" },
  },
];

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
        { value: "vudio", label: "Vudio" },
        { value: "wave", label: "Wave" },
      ],
      { label: "Visualizer" },
    ),
    // pear-desktop's options for each visualizer.
    preset: config.select(DEFAULT_PRESET, PRESETS.map((value) => ({ value, label: shorten(value) })), {
      label: "Preset",
      group: "Milkdrop",
      variant: "dropdown",
    }),
    blendTimeInSeconds: config.number(2.7, { label: "Preset blend time", min: 0, max: 10, step: 0.1, unit: " s", group: "Milkdrop" }),
    songTitle: config.bool(false, { label: "Show the track title on change", group: "Milkdrop" }),
    vudioEffect: config.select(
      "lighting",
      [
        { value: "lighting", label: "Lighting" },
        { value: "waveform", label: "Waveform" },
        { value: "circlewave", label: "Circle wave" },
        { value: "circlebar", label: "Circle bars" },
      ],
      { label: "Effect", group: "Vudio" },
    ),
    vudioAccuracy: config.select(
      "128",
      [
        { value: "16", label: "16" },
        { value: "32", label: "32" },
        { value: "64", label: "64" },
        { value: "128", label: "128" },
        { value: "256", label: "256" },
        { value: "512", label: "512" },
      ],
      { label: "Accuracy", group: "Vudio" },
    ),
    vudioMaxHeight: config.number(160, { label: "Maximum height", min: 1, max: 1000, step: 1, group: "Vudio", variant: "stepper" }),
    vudioMaxSize: config.number(12, { label: "Maximum size", min: 1, max: 100, step: 1, group: "Vudio" }),
    vudioLineWidth: config.number(1, { label: "Line width", min: 1, max: 20, step: 1, group: "Vudio" }),
    vudioColor: config.string("#49f3f7", { label: "Color", placeholder: "#49f3f7", group: "Vudio" }),
    vudioShadowBlur: config.number(2, { label: "Shadow blur", min: 0, max: 50, step: 1, group: "Vudio" }),
    vudioShadowColor: config.string("rgba(244,244,244,.5)", { label: "Shadow color", placeholder: "rgba(244,244,244,.5)", group: "Vudio" }),
    vudioFadeSide: config.bool(true, { label: "Fade the sides", group: "Vudio" }),
    vudioPrettify: config.bool(false, { label: "Prettify", group: "Vudio" }),
    vudioDottify: config.bool(true, { label: "Dots", group: "Vudio" }),
    vudioHorizontalAlign: config.select(
      "center",
      [
        { value: "left", label: "Left" },
        { value: "center", label: "Center" },
        { value: "right", label: "Right" },
      ],
      { label: "Horizontal alignment", group: "Vudio" },
    ),
    vudioVerticalAlign: config.select(
      "middle",
      [
        { value: "top", label: "Top" },
        { value: "middle", label: "Middle" },
        { value: "bottom", label: "Bottom" },
      ],
      { label: "Vertical alignment", group: "Vudio" },
    ),
    waveAnimations: config.string(JSON.stringify(DEFAULT_WAVE), {
      label: "Animations",
      description: "JSON list of Wave animations ({ type, config }), as in pear-desktop: Cubes, Circles, Lines, Glob, Arcs, Flower, Square, Turntable, Wave, Shine.",
      group: "Wave",
    }),
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
      // Both libraries connect their analyser to the context's output; give them a silent one
      // so the track isn't played twice.
      const tap = graph.context.createGain();
      graph.tap(tap);
      const silent = graph.context.createGain();
      silent.gain.value = 0;
      silent.connect(graph.context.destination);
      ctx.onCleanup(() => {
        tap.disconnect();
        silent.disconnect();
      });
      const quietContext = new Proxy(graph.context, {
        get(target, key) {
          if (key === "destination") return silent;
          // Vudio builds its source from a MediaStream; hand it the tap instead.
          if (key === "createMediaStreamSource") return () => tap;
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      observer = new ResizeObserver(() => {
        const { width, height } = size();
        if (width === 0 || height === 0) return;
        canvas.width = width;
        canvas.height = height;
      });

      if (ctx.config.type === "vudio") {
        const Vudio = (await loadUmd(ctx.host.invoke("vudio"))) as VudioConstructor;
        if (ctx.signal.aborted) return;
        const effect = ctx.config.vudioEffect;
        const option = {
          effect,
          accuracy: Number(ctx.config.vudioAccuracy),
          [effect]: {
            maxHeight: ctx.config.vudioMaxHeight,
            maxSize: ctx.config.vudioMaxSize,
            lineWidth: ctx.config.vudioLineWidth,
            color: ctx.config.vudioColor,
            shadowBlur: ctx.config.vudioShadowBlur,
            shadowColor: ctx.config.vudioShadowColor,
            fadeSide: ctx.config.vudioFadeSide,
            prettify: ctx.config.vudioPrettify,
            dottify: ctx.config.vudioDottify,
            horizontalAlign: ctx.config.vudioHorizontalAlign,
            verticalAlign: ctx.config.vudioVerticalAlign,
          },
        };
        // Vudio creates its own AudioContext and takes over window.onresize.
        const OriginalContext = window.AudioContext;
        const onresize = window.onresize;
        window.AudioContext = function () {
          return quietContext;
        } as unknown as typeof AudioContext;
        let vudio: VudioInstance;
        try {
          vudio = new Vudio(new MediaStream(), canvas, { width: canvas.width, height: canvas.height, ...option });
        } finally {
          window.AudioContext = OriginalContext;
          window.onresize = onresize;
        }
        vudio.dance();
        ctx.onCleanup(() => vudio.pause());
        observer.disconnect();
        observer = new ResizeObserver(() => {
          const { width, height } = size();
          if (width > 0 && height > 0) vudio.setOption({ width, height });
        });
      } else {
        const { Wave } = (await loadUmd(ctx.host.invoke("wave"))) as WaveModule;
        if (ctx.signal.aborted) return;
        const wave = new Wave({ context: quietContext, source: tap }, canvas);
        for (const animation of parseAnimations(ctx.config.waveAnimations, ctx.log)) {
          const Animation = wave.animations[animation.type];
          if (Animation) wave.addAnimation(new Animation(animation.config));
          else ctx.log.warn(`unknown Wave animation ${animation.type}`);
        }
        ctx.onCleanup(() => wave.clearAnimations());
      }
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

/** Runs a UMD bundle (sent by the host) in the page and returns its exports. */
async function loadUmd(source: Promise<string>): Promise<unknown> {
  const wrapped = `const module = { exports: {} }; const exports = module.exports;\n${await source}\nexport default module.exports;`;
  return ((await importSource(wrapped)) as unknown as { default: unknown }).default;
}

function parseAnimations(json: string, log: { warn(...args: unknown[]): void }): { type: string; config: unknown }[] {
  try {
    const parsed: unknown = JSON.parse(json || "[]");
    if (!Array.isArray(parsed)) throw new Error("expected an array");
    return parsed.filter((item): item is { type: string; config: unknown } => typeof item?.type === "string");
  } catch (error) {
    log.warn("ignoring invalid Wave animations", error);
    return DEFAULT_WAVE;
  }
}

/** The preset pack is a UMD bundle that expects a browser-like `self`. */
function evaluatePresets(source: string): Record<string, unknown> {
  const module: { exports: { default?: Record<string, unknown> } } = { exports: {} };
  new Function("module", "exports", "self", source)(module, module.exports, globalThis);
  return module.exports.default ?? {};
}
