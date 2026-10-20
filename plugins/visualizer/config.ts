import { config, type AudioGraph, type PageContextOf } from "@pear/sdk";
import { PRESETS } from "./presets.ts";

// Presets: butterchurn's base pack, as pear-desktop.
export const DEFAULT_PRESET = "martin [shadow harlequins shape code] - fata morgana";

/** pear-desktop's default Wave animations. */
export const DEFAULT_WAVE = [
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

// Long preset names are cut to fit the dropdown.
const MAX_LABEL = 60;
const shorten = (name: string) => (name.length > MAX_LABEL ? `${name.slice(0, MAX_LABEL - 3)}…` : name);

export const schema = {
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
};

export type Ctx = PageContextOf<typeof schema, VisualizerCommands>;

export interface VisualizerCommands {
  butterchurn(): string;
  preset(name: string): unknown;
  vudio(): string;
  wave(): string;
}

/** What a renderer draws with. */
export interface Stage {
  ctx: Ctx;
  graph: AudioGraph;
  canvas: HTMLCanvasElement;
  /** The container's size in device pixels. */
  size(): { width: number; height: number };
}

/** A running visualizer (its factory gives `undefined` when the plugin stopped while it loaded). */
export interface Renderer {
  /** Called with the container's new size (never 0×0). */
  resize(width: number, height: number): void;
  /** Draws a frame; leave it out when the library animates itself. */
  render?(): void;
}
