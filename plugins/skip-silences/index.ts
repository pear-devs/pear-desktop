import { config, definePlugin } from "@pear/sdk";

// Voice-activity detection in the style of hark (https://github.com/otalk/hark).
const THRESHOLD_DB = -100; // -100 is absolute silence, 0 the loudest
const INTERVAL_MS = 5;
const HISTORY = 10;
const SKIP_SECONDS = 0.2;
// First in the shared graph, so the analysis sees the track before any fades or effects.
const ORDER = -100;

export default definePlugin({
  id: "skip-silences",
  name: "Skip silences",
  description: "Skips over silent parts of tracks.",
  config: {
    onlySkipBeginning: config.bool(false, { label: "Only skip silence at the start of a track" }),
  },
  page: {
    async start(ctx) {
      const graph = await ctx.audio();
      const { context, video } = graph;
      // `input` feeds both the chain (through `output`) and the analyser; the
      // graph only rewires the stage's output, so the analyser stays connected.
      const input = context.createGain();
      const output = context.createGain();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.1;
      input.connect(output);
      input.connect(analyser);
      graph.insert(input, output, ORDER);

      const bins = new Float32Array(analyser.frequencyBinCount);
      const history: number[] = Array.from({ length: HISTORY }, () => 0);
      let silent = false;
      let audioStarted = false;

      const loudness = () => {
        analyser.getFloatFrequencyData(bins);
        let max = Number.NEGATIVE_INFINITY;
        for (let i = 4; i < bins.length; i++) if (bins[i]! > max && bins[i]! < 0) max = bins[i]!;
        return max;
      };
      const skip = () => {
        if (ctx.config.onlySkipBeginning && audioStarted) return;
        if (silent && !video.paused && !ctx.player.state.ad) video.currentTime += SKIP_SECONDS;
      };
      const tick = () => {
        if (video.paused || ctx.player.state.ad) return;
        const volume = loudness();
        const loud = volume > THRESHOLD_DB;
        if (loud) {
          // Trigger quickly on a short history.
          if (history.slice(-3).reduce((a, b) => a + b, 0) >= 2) {
            silent = false;
            audioStarted = true;
          }
        } else if (!silent) {
          const muted = video.seeking || video.ended || video.muted || video.volume === 0;
          if (history.every((h) => h === 0) && !muted) {
            silent = true;
            skip();
          }
        }
        history.shift();
        history.push(Number(loud));
      };
      const timer = setInterval(tick, INTERVAL_MS);

      // Each seek (including our own skips) re-checks, so a long silence is crossed in steps.
      const onPlayOrSeek = () => {
        audioStarted = false;
        skip();
      };
      ctx.listen(video, "play", onPlayOrSeek);
      ctx.listen(video, "seeked", onPlayOrSeek);

      return () => {
        clearInterval(timer);
        input.disconnect();
      };
    },
    onConfigChange() {},
  },
});
