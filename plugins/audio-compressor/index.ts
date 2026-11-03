import { config, definePlugin } from "@pear/sdk";

// After the equalizer, before fades and the output.
const ORDER = 20;

export default definePlugin({
  id: "audio-compressor",
  name: "Audio compressor",
  description: "Evens out loud and quiet parts with a dynamics compressor.",
  config: {
    threshold: config.number(-50, { label: "Threshold", min: -100, max: 0, step: 1, unit: " dB" }),
    ratio: config.number(12, { label: "Ratio", min: 1, max: 20, step: 0.5, unit: ":1" }),
    knee: config.number(40, { label: "Knee", min: 0, max: 40, step: 1, unit: " dB" }),
    attack: config.number(0, { label: "Attack", min: 0, max: 1000, step: 5, unit: " ms" }),
    release: config.number(250, { label: "Release", min: 0, max: 1000, step: 5, unit: " ms" }),
  },
  page: async (ctx) => {
    const graph = await ctx.audio();
    const compressor = graph.context.createDynamicsCompressor();
    const apply = () => {
      const { threshold, ratio, knee, attack, release } = ctx.config;
      compressor.threshold.value = threshold;
      compressor.ratio.value = ratio;
      compressor.knee.value = knee;
      compressor.attack.value = attack / 1000;
      compressor.release.value = release / 1000;
    };
    apply();
    graph.insert(compressor, compressor, ORDER);
    ctx.onConfigChange(apply);
  },
});
