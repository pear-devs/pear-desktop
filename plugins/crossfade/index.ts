import { config, definePlugin } from "@pear/sdk";

// Late in the shared graph: fades apply after effects, before visualizer taps.
const ORDER = 50;
const CURVE_POINTS = 256;
// Tracks shorter than this play untouched.
const MIN_TRACK_SECONDS = 30;

export default definePlugin({
  id: "crossfade",
  name: "Crossfade",
  description: "Fades out the end of a track and fades the next one in.",
  config: {
    fadeInDuration: config.number(1500, { label: "Fade-in", min: 0, max: 10000, step: 100, unit: " ms" }),
    fadeOutDuration: config.number(5000, { label: "Fade-out", min: 0, max: 20000, step: 100, unit: " ms" }),
    secondsBeforeEnd: config.number(10, {
      label: "Skip to the next track",
      description: "Seconds before the end; the fade-out finishes there.",
      min: 0,
      max: 30,
      step: 1,
      unit: " s before the end",
    }),
    fadeScaling: config.select(
      "linear",
      [
        { value: "linear", label: "Linear" },
        { value: "logarithmic", label: "Logarithmic (sounds even)" },
      ],
      { label: "Fade curve" },
    ),
    dynamicRange: config.number(60, { label: "Logarithmic range", min: 10, max: 120, step: 5, unit: " dB" }),
  },
  page: {
    async start(ctx) {
      const graph = await ctx.audio();
      const { context, video } = graph;
      const gain = context.createGain();
      graph.insert(gain, gain, ORDER);

      // Gain for a normalized fade position (0 silent → 1 full).
      const level = (x: number) => {
        if (ctx.config.fadeScaling === "linear" || x <= 0) return Math.max(0, x);
        return 10 ** (((Math.min(1, x) - 1) * ctx.config.dynamicRange) / 20);
      };
      const ramp = (from: number, to: number, seconds: number) => {
        const now = context.currentTime;
        gain.gain.cancelScheduledValues(now);
        if (seconds <= 0.01) return gain.gain.setValueAtTime(level(to), now);
        const curve = new Float32Array(CURVE_POINTS);
        for (let i = 0; i < CURVE_POINTS; i++) curve[i] = level(from + ((to - from) * i) / (CURVE_POINTS - 1));
        gain.gain.setValueCurveAtTime(curve, now, seconds);
      };
      const hold = (value: number) => {
        gain.gain.cancelScheduledValues(context.currentTime);
        gain.gain.setValueAtTime(value, context.currentTime);
      };

      let fadingOut = false;
      let skipped = false;
      let pendingFadeIn = false;

      const fadeWindow = () => {
        const duration = video.duration;
        if (!Number.isFinite(duration) || duration < MIN_TRACK_SECONDS || ctx.player.state.ad) return;
        const end = Math.max(0, duration - ctx.config.secondsBeforeEnd);
        const length = Math.min(ctx.config.fadeOutDuration / 1000, end);
        return { start: end - length, end, length };
      };
      // Schedules the rest of the fade-out from the current position, at the current rate.
      const scheduleFadeOut = () => {
        const fade = fadeWindow();
        if (!fade || video.paused) return;
        const position = video.currentTime;
        if (position < fade.start || position >= fade.end) return;
        fadingOut = true;
        const from = fade.length > 0 ? (fade.end - position) / fade.length : 0;
        ramp(from, 0, (fade.end - position) / video.playbackRate);
      };
      const onTime = () => {
        const fade = fadeWindow();
        if (!fade || video.paused) return;
        const position = video.currentTime;
        if (position >= fade.end) {
          if (skipped) return;
          skipped = true;
          fadingOut = false;
          if (ctx.player.state.repeat === "one") {
            ctx.player.control({ type: "seek", seconds: 0 });
            fadeIn();
          } else {
            // Also covers the end of the queue: the next play fades in.
            pendingFadeIn = true;
            ctx.player.control({ type: "next" });
          }
        } else if (!fadingOut && position >= fade.start) {
          scheduleFadeOut();
        }
      };
      const fadeIn = () => {
        pendingFadeIn = false;
        ramp(0, 1, ctx.config.fadeInDuration / 1000 / video.playbackRate);
      };
      // Pauses freeze the fade; seeks and rate changes recompute it.
      const resync = () => {
        if (pendingFadeIn || ctx.player.state.ad) return;
        const fade = fadeWindow();
        const position = video.currentTime;
        if (!fade || position < fade.start) {
          // Seeked back out of a fade-out (a fade-in in progress is left alone).
          if (fadingOut) hold(1);
          fadingOut = false;
          skipped = false;
        } else if (video.paused) {
          gain.gain.cancelAndHoldAtTime(context.currentTime);
        } else {
          scheduleFadeOut();
        }
      };

      ctx.player.on("trackLoading", () => {
        skipped = false;
        fadingOut = false;
        pendingFadeIn = true;
        hold(0);
      });
      ctx.listen(video, "playing", () => {
        if (pendingFadeIn && !ctx.player.state.ad) fadeIn();
        else resync();
      });
      ctx.player.on("adChange", (ad) => {
        // Ads play at full volume; the track fades in after them.
        if (ad) hold(1);
        else if (pendingFadeIn && !video.paused) fadeIn();
        else if (pendingFadeIn) hold(0);
      });
      ctx.listen(video, "timeupdate", onTime);
      ctx.listen(video, "pause", resync);
      ctx.listen(video, "seeked", resync);
      ctx.listen(video, "ratechange", resync);

      live = resync;
      return () => {
        live = undefined;
      };
    },
    onConfigChange() {
      live?.();
    },
  },
});

// The running page part's re-scheduler (one instance at a time).
let live: (() => void) | undefined;
