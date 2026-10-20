import { config, definePlugin } from "@pear/sdk";

// A 10-band graphic EQ (shelves at the ends, peaking filters in between) plus
// optional free-form biquad filters, pear-desktop's `filters` option. Those are
// mixed in as pear-desktop did: each filter's output is added to the signal
// (its bass booster is such a filter, and sounds the same this way).
const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
type BandKey = `band${(typeof BANDS)[number]}`;
type Gains = readonly [number, number, number, number, number, number, number, number, number, number];

const PRESETS = {
  flat: { label: "Flat", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  "bass-booster": { label: "Bass booster", gains: [12, 10, 7, 3, 0, 0, 0, 0, 0, 0] },
  "treble-booster": { label: "Treble booster", gains: [0, 0, 0, 0, 0, 1, 3, 6, 9, 10] },
  "vocal-booster": { label: "Vocal booster", gains: [-2, -2, -1, 1, 3, 4, 4, 2, 0, -1] },
  rock: { label: "Rock", gains: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5] },
  pop: { label: "Pop", gains: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2] },
  electronic: { label: "Electronic", gains: [6, 5, 2, 0, -2, 1, 0, 2, 5, 6] },
  acoustic: { label: "Acoustic", gains: [4, 3, 2, 1, 1, 1, 2, 3, 3, 2] },
  loudness: { label: "Loudness", gains: [6, 4, 0, 0, -2, 0, -1, -4, 4, 1] },
} satisfies Record<string, { label: string; gains: Gains }>;
type PresetName = keyof typeof PRESETS;

const bandField = (hz: number) =>
  config.number(0, { label: hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`, min: -12, max: 12, step: 0.5, unit: " dB" });

interface Filter {
  type: BiquadFilterType;
  frequency: number;
  Q: number;
  gain: number;
}

const FILTER_TYPES: readonly string[] = ["lowpass", "highpass", "bandpass", "lowshelf", "highshelf", "peaking", "notch", "allpass"];

// Order in the shared audio graph: after analysis taps, before the compressor.
const ORDER = 10;
// Roughly one octave per band.
const BAND_Q = 1.41;

export default definePlugin({
  id: "equalizer",
  name: "Equalizer",
  description: "A 10-band equalizer with presets.",
  config: {
    preset: config.select(
      "flat",
      [...Object.entries(PRESETS).map(([value, p]) => ({ value: value as PresetName, label: p.label })), { value: "custom", label: "Custom" }],
      { label: "Preset", description: "Choosing a preset moves the bands; moving a band switches to Custom." },
    ),
    preamp: config.number(0, { label: "Preamp", min: -12, max: 12, step: 0.5, unit: " dB", description: "Lower it to avoid clipping when boosting." }),
    band32: bandField(32),
    band64: bandField(64),
    band125: bandField(125),
    band250: bandField(250),
    band500: bandField(500),
    band1000: bandField(1000),
    band2000: bandField(2000),
    band4000: bandField(4000),
    band8000: bandField(8000),
    band16000: bandField(16000),
    filters: config.string("", {
      label: "Extra filters (advanced)",
      description:
        'JSON list of biquad filters, each added on top of the signal as in pear-desktop, e.g. [{"type":"lowshelf","frequency":80,"Q":100,"gain":12}] (its bass booster)',
      placeholder: "[]",
    }),
  },
  page: {
    async start(ctx) {
      const graph = await ctx.audio();
      const { context } = graph;
      const preamp = context.createGain();
      // Where the bands' output and the extra filters' outputs are summed.
      const mix = context.createGain();
      const bands = BANDS.map((frequency, i) => {
        const filter = context.createBiquadFilter();
        filter.type = i === 0 ? "lowshelf" : i === BANDS.length - 1 ? "highshelf" : "peaking";
        filter.frequency.value = frequency;
        filter.Q.value = BAND_Q;
        return filter;
      });
      let extras: BiquadFilterNode[] = [];
      let extrasJson: string | undefined;
      let remove: (() => void) | undefined;
      let lastPreset = ctx.config.preset;
      const smooth = (param: AudioParam, value: number) => param.setTargetAtTime(value, context.currentTime, 0.02);

      const apply = () => {
        const config = ctx.config;
        // Presets drive the band sliders; editing a band afterwards makes it custom.
        if (config.preset !== "custom") {
          const gains = PRESETS[config.preset].gains;
          if (config.preset !== lastPreset) {
            ctx.setConfig(Object.fromEntries(BANDS.map((hz, i) => [`band${hz}`, gains[i]])));
          } else if (BANDS.some((hz, i) => config[`band${hz}` as BandKey] !== gains[i])) {
            ctx.setConfig({ preset: "custom" });
          }
        }
        lastPreset = ctx.config.preset;

        const current = ctx.config;
        smooth(preamp.gain, 10 ** (current.preamp / 20));
        BANDS.forEach((hz, i) => smooth(bands[i]!.gain, current[`band${hz}` as BandKey]));

        // Only a change to the extra filters needs rewiring.
        if (remove && current.filters === extrasJson) return;
        extrasJson = current.filters;
        for (const node of extras) node.disconnect();
        extras = parseFilters(current.filters, ctx.log).map((f) => {
          const node = context.createBiquadFilter();
          node.type = f.type;
          node.frequency.value = f.frequency;
          node.Q.value = f.Q;
          node.gain.value = f.gain;
          return node;
        });
        // Removing the old stage disconnects its output, so rewire after that.
        remove?.();
        const chain = [preamp, ...bands];
        for (const node of [...chain, mix]) node.disconnect();
        for (let i = 1; i < chain.length; i++) chain[i - 1]!.connect(chain[i]!);
        const last = chain.at(-1)!;
        last.connect(mix);
        for (const extra of extras) {
          last.connect(extra);
          extra.connect(mix);
        }
        remove = graph.insert(preamp, mix, ORDER);
      };
      apply();
      live = apply;
      return () => {
        live = undefined;
        for (const node of [preamp, ...bands, ...extras, mix]) node.disconnect();
      };
    },
    // Parameters are updated in place, without rebuilding the chain.
    onConfigChange() {
      live?.();
    },
  },
});

// The running page part's updater (one instance at a time).
let live: (() => void) | undefined;

function parseFilters(json: string, log: { warn(...args: unknown[]): void }): Filter[] {
  if (!json.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) throw new Error("expected an array");
    return parsed.flatMap((item: Partial<Filter>) => {
      if (!item || !FILTER_TYPES.includes(String(item.type)) || !Number.isFinite(item.frequency)) return [];
      return [{ type: item.type!, frequency: item.frequency!, Q: Number(item.Q ?? 1) || 1, gain: Number(item.gain ?? 0) || 0 }];
    });
  } catch (error) {
    log.warn("ignoring invalid extra filters", error);
    return [];
  }
}
