import { config, definePlugin, type Logger } from "@pear/sdk";

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
/** Parameter changes glide over about this long (a time constant), without clicks. */
const SMOOTHING_S = 0.02;

/** Shelves at the ends, peaking filters in between. */
function bandType(index: number): BiquadFilterType {
  if (index === 0) return "lowshelf";
  if (index === BANDS.length - 1) return "highshelf";
  return "peaking";
}

const decibelsToGain = (decibels: number) => 10 ** (decibels / 20);

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
  page: async (ctx) => {
    const graph = await ctx.audio();
    const { context } = graph;
    const preamp = context.createGain();
    // Where the bands' output and the extra filters' outputs are summed.
    const mix = context.createGain();
    const bands = BANDS.map((frequency, i) => {
      const filter = context.createBiquadFilter();
      filter.type = bandType(i);
      filter.frequency.value = frequency;
      filter.Q.value = BAND_Q;
      return filter;
    });
    let extras: BiquadFilterNode[] = [];
    let extrasJson: string | undefined;
    let remove: (() => void) | undefined;
    let lastPreset = ctx.config.preset;
    const smooth = (param: AudioParam, value: number) => param.setTargetAtTime(value, context.currentTime, SMOOTHING_S);

    // Presets drive the band sliders; editing a band afterwards makes it custom.
    const syncPreset = () => {
      const config = ctx.config;
      if (config.preset !== "custom") {
        const gains = PRESETS[config.preset].gains;
        const edited = BANDS.some((hz, i) => config[`band${hz}` as BandKey] !== gains[i]);
        if (config.preset !== lastPreset) ctx.setConfig(Object.fromEntries(BANDS.map((hz, i) => [`band${hz}`, gains[i]])));
        else if (edited) ctx.setConfig({ preset: "custom" });
      }
      lastPreset = ctx.config.preset;
    };

    const rewire = () => {
      for (const node of extras) node.disconnect();
      extras = parseFilters(ctx.config.filters, ctx.log).map((filter) => {
        const node = context.createBiquadFilter();
        node.type = filter.type;
        node.frequency.value = filter.frequency;
        node.Q.value = filter.Q;
        node.gain.value = filter.gain;
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

    const apply = () => {
      syncPreset();
      const current = ctx.config;
      smooth(preamp.gain, decibelsToGain(current.preamp));
      BANDS.forEach((hz, i) => smooth(bands[i]!.gain, current[`band${hz}` as BandKey]));
      // Only a change to the extra filters needs rewiring.
      if (remove && current.filters === extrasJson) return;
      extrasJson = current.filters;
      rewire();
    };
    apply();
    // Parameters are updated in place, without rebuilding the chain.
    ctx.onConfigChange(apply);
    ctx.onCleanup(() => {
      for (const node of [preamp, ...bands, ...extras, mix]) node.disconnect();
    });
  },
});

function parseFilters(json: string, log: Logger): Filter[] {
  if (!json.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) throw new Error("expected an array");
    return parsed.flatMap((item: Partial<Filter>) => {
      const valid = item && FILTER_TYPES.includes(String(item.type)) && Number.isFinite(item.frequency);
      if (!valid) return [];
      return [{ type: item.type!, frequency: item.frequency!, Q: Number(item.Q ?? 1) || 1, gain: Number(item.gain ?? 0) || 0 }];
    });
  } catch (error) {
    log.warn("ignoring invalid extra filters", error);
    return [];
  }
}
