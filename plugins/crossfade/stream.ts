// pear-desktop's crossfade: a second stream of the current track plays its end,
// fading out, while the next track starts.

import type { Ctx } from "./schema.ts";

/** Loading of the stream starts this long before the switch... */
const PRELOAD_SECONDS = 20;
/** ...seeked this far ahead of it, so the switch finds it buffered. */
const PRELOAD_LEAD_SECONDS = 1;
/** The stream's fade-out lasts at least this long, in seconds. */
const MIN_FADE_SECONDS = 0.01;

export function secondStream(ctx: Ctx, video: HTMLVideoElement, level: (position: number) => number) {
  let outgoing: { videoId: string; audio: HTMLAudioElement } | undefined;
  const playing = new Set<HTMLAudioElement>();
  ctx.onCleanup(() => {
    for (const audio of playing) audio.pause();
    playing.clear();
    outgoing = undefined;
  });

  // The level the track plays at (the element's own volume, whatever the volume plugins do).
  const volumeNow = () =>
    video.muted ? 0 : (Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume")!.get!.call(video) as number);

  /** Fades `audio` out from `base` volume over `seconds`, then unloads it. */
  const fadeOut = (audio: HTMLAudioElement, base: number, seconds: number) => {
    const started = performance.now();
    const stop = () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      playing.delete(audio);
    };
    const step = () => {
      if (!playing.has(audio)) return;
      const position = 1 - (performance.now() - started) / 1000 / seconds;
      if (position <= 0) return stop();
      audio.volume = Math.min(1, base * level(position));
      requestAnimationFrame(step);
    };
    void audio.play().then(
      () => requestAnimationFrame(step),
      (error: unknown) => {
        ctx.log.warn("the second stream didn't play", error);
        stop();
      },
    );
  };

  return {
    /** Fetches the stream of the track that just started. */
    prepare(videoId: string) {
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
    },
    /** Starts buffering once the switch at `end` (seconds into the track) is near. */
    preload(position: number, end: number) {
      if (outgoing?.audio.preload !== "none" || position < end - PRELOAD_SECONDS) return;
      outgoing.audio.preload = "auto";
      outgoing.audio.currentTime = Math.max(0, end - PRELOAD_LEAD_SECONDS);
    },
    /** The current track's stream is there and can play. */
    ready() {
      return (
        !!outgoing &&
        outgoing.videoId === ctx.player.state.track?.videoId &&
        outgoing.audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      );
    },
    /** Plays the track's end in the stream, fading out, from where the video is. */
    play() {
      const { audio } = outgoing!;
      outgoing = undefined;
      const base = volumeNow();
      audio.currentTime = video.currentTime;
      audio.playbackRate = video.playbackRate;
      audio.volume = base;
      playing.add(audio);
      fadeOut(audio, base, Math.max(MIN_FADE_SECONDS, ctx.config.fadeOutDuration / 1000));
    },
  };
}
