// pear-desktop's crossfade: a second stream of the current track plays on from where
// the track left off, fading out, while the next track starts (at its end, or on a
// manual change).

import type { Ctx } from "./schema.ts";

/** The stream buffers from the start (for a manual change), and this long before the end... */
const PRELOAD_SECONDS = 20;
/** ...seeks this far ahead of it, so the switch finds it buffered. */
const PRELOAD_LEAD_SECONDS = 1;
/** The stream's fade-out lasts at least this long, in seconds. */
const MIN_FADE_SECONDS = 0.01;

export function secondStream(ctx: Ctx, video: HTMLVideoElement, level: (position: number) => number) {
  let outgoing: { videoId: string; audio: HTMLAudioElement; seekedAhead: boolean } | undefined;
  const playing = new Set<HTMLAudioElement>();
  const unload = (audio: HTMLAudioElement) => {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  };
  // A stream that won't play (the track changed before its end) stops buffering.
  const drop = () => {
    if (outgoing) unload(outgoing.audio);
    outgoing = undefined;
  };
  ctx.onCleanup(() => {
    for (const audio of playing) audio.pause();
    playing.clear();
    drop();
  });

  // The level the track plays at (the element's own volume, whatever the volume plugins do).
  const volumeNow = () =>
    video.muted ? 0 : (Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume")!.get!.call(video) as number);

  /** Fades `audio` out from `base` volume, at fade position `from`, over `seconds`, then unloads it. */
  const fadeOut = (audio: HTMLAudioElement, base: number, from: number, seconds: number) => {
    const started = performance.now();
    const stop = () => {
      unload(audio);
      playing.delete(audio);
    };
    const step = () => {
      if (!playing.has(audio)) return;
      const position = from * (1 - (performance.now() - started) / 1000 / seconds);
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
      drop();
      ctx.host.invoke("audioUrl", videoId).then(
        (url) => {
          if (ctx.signal.aborted || ctx.player.state.track?.videoId !== videoId) return;
          drop();
          const audio = new Audio();
          audio.preload = "auto";
          audio.src = url;
          outgoing = { videoId, audio, seekedAhead: false };
        },
        (error: unknown) => ctx.log.warn("no second stream for the crossfade; fading out instead", error),
      );
    },
    /** Buffers around the switch at `end` (seconds into the track) once it is near. */
    preload(position: number, end: number) {
      if (!outgoing || outgoing.seekedAhead || position < end - PRELOAD_SECONDS) return;
      outgoing.seekedAhead = true;
      outgoing.audio.currentTime = Math.max(0, end - PRELOAD_LEAD_SECONDS);
    },
    /** The stream of `videoId` is fetched (it may still be buffering). */
    has(videoId: string) {
      return outgoing?.videoId === videoId;
    },
    /** The current track's stream is there and can play. */
    ready() {
      return (
        !!outgoing &&
        outgoing.videoId === ctx.player.state.track?.videoId &&
        outgoing.audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      );
    },
    /**
     * Plays the track on in the stream, fading out, from `position` (where the video is
     * by default) and fade position `from` (1 = full level).
     */
    play(position = video.currentTime, from = 1) {
      const { audio } = outgoing!;
      outgoing = undefined;
      const base = volumeNow();
      audio.currentTime = position;
      audio.playbackRate = video.playbackRate;
      audio.volume = Math.min(1, base * level(from));
      playing.add(audio);
      fadeOut(audio, base, from, Math.max(MIN_FADE_SECONDS, (from * ctx.config.fadeOutDuration) / 1000));
    },
  };
}
