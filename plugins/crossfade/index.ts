import { config, definePlugin } from "@pear/sdk";
import { net } from "electron";
import { Innertube } from "\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js";

// Late in the shared graph: fades apply after effects, before visualizer taps.
const ORDER = 50;
const CURVE_POINTS = 256;
// Tracks shorter than this play untouched.
const MIN_TRACK_SECONDS = 30;
// The second stream starts loading this long before the switch.
const PRELOAD_SECONDS = 20;

export default definePlugin({
  id: "crossfade",
  name: "Crossfade",
  description: "Fades out the end of a track while the next one fades in.",
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
  host: {
    commands: {
      /**
       * A direct audio stream of a track, as pear-desktop fetched one to play the
       * end of the track while the next one starts.
       */
      async audioUrl(videoId: string) {
        innertube ??= Innertube.create({ retrieve_player: true, fetch: (input, init) => net.fetch(input as string, init) }).catch(
          (error: unknown) => {
            innertube = undefined;
            throw error;
          },
        );
        const yt = await innertube;
        let lastError: unknown;
        // The iOS client's streams play without extra tokens; the web client's as a fallback.
        for (const client of ["IOS", undefined] as const) {
          try {
            const info = await yt.getBasicInfo(videoId, client ? { client } : undefined);
            const format = info.chooseFormat({ type: "audio", quality: "best" });
            return await format.decipher(yt.session.player);
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError;
      },
    },
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

      // pear-desktop's crossfade: a second stream of the current track plays its end,
      // fading out, while the next track starts. Without one (not fetched yet, or not
      // available), the track fades out before the next one fades in.
      let outgoing: { videoId: string; audio: HTMLAudioElement } | undefined;
      const playing = new Set<HTMLAudioElement>();
      const prepare = (videoId: string) => {
        if (outgoing?.videoId === videoId) return;
        outgoing = undefined;
        ctx.host.invoke("audioUrl", videoId).then(
          (url) => {
            if (ctx.signal.aborted || ctx.player.state.track?.videoId !== videoId) return;
            const audio = new Audio();
            audio.preload = "none";
            audio.src = url;
            outgoing = { videoId, audio };
          },
          (error: unknown) => ctx.log.warn("no second stream for the crossfade; fading out instead", error),
        );
      };
      const ready = () => !!outgoing && outgoing.videoId === ctx.player.state.track?.videoId && outgoing.audio.readyState >= 2;
      // The level the track plays at (the element's own volume, whatever the volume plugins do).
      const volumeNow = () =>
        video.muted ? 0 : (Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume")!.get!.call(video) as number);
      const playOutgoing = () => {
        const { audio } = outgoing!;
        outgoing = undefined;
        const base = volumeNow();
        const length = Math.max(0.01, ctx.config.fadeOutDuration / 1000);
        audio.currentTime = video.currentTime;
        audio.playbackRate = video.playbackRate;
        audio.volume = base;
        playing.add(audio);
        const started = performance.now();
        const stop = () => {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
          playing.delete(audio);
        };
        void audio.play().then(
          () => {
            const step = () => {
              if (!playing.has(audio)) return;
              const x = 1 - (performance.now() - started) / 1000 / length;
              if (x <= 0) return stop();
              audio.volume = Math.min(1, base * level(x));
              requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          },
          (error: unknown) => {
            ctx.log.warn("the second stream didn't play", error);
            stop();
          },
        );
      };
      ctx.onCleanup(() => {
        for (const audio of playing) audio.pause();
        playing.clear();
        outgoing = undefined;
      });

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
        if (!fade || video.paused || ready()) return;
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
        // Load the second stream ahead of the switch.
        if (outgoing?.audio.preload === "none" && position >= fade.end - PRELOAD_SECONDS) {
          outgoing.audio.preload = "auto";
          outgoing.audio.currentTime = Math.max(0, fade.end - 1);
        }
        if (position >= fade.end) {
          if (skipped) return;
          skipped = true;
          fadingOut = false;
          if (ctx.player.state.repeat === "one") {
            ctx.player.control({ type: "seek", seconds: 0 });
            fadeIn();
          } else {
            // The track's end goes on in the second stream while the next one fades in.
            if (ready()) {
              playOutgoing();
              hold(0);
            }
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

      ctx.player.on("trackChange", (track) => prepare(track.videoId));
      if (ctx.player.state.track) prepare(ctx.player.state.track.videoId);
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
// Host: the InnerTube client for audio URLs, created on first use.
let innertube: Promise<Innertube> | undefined;
