// The crossfade's wiring: when to fade out, skip, and fade in, following the video.
// Any track change (the end of a track, or next/previous/another song) fades the old
// track out on a second stream while the next one fades in; so does every resume.
// Without a second stream (not fetched yet, or not available), the track fades
// out before the next one fades in at its end, and a manual change cuts.

import { createFader } from "./fade.ts";
import type { Ctx } from "./schema.ts";
import { secondStream } from "./stream.ts";

// The last position heard is where a manual change left the track only this soon after.
const HEARD_FRESH_MS = 1000;
// A pause this soon before a track change is taken as part of the change (the player's own).
const PAUSE_GRACE_MS = 300;

export async function startCrossfade(ctx: Ctx) {
  const graph = await ctx.audio();
  const { video } = graph;
  const fader = createFader(ctx, graph);
  const stream = secondStream(ctx, video, fader.level);

  let fadingOut = false;
  let skipped = false;
  let pendingFadeIn = false;
  // Where the playing track was last heard (not during ads), for a manual change.
  // `from` is how far through its fade-out it was (1 = not fading).
  let heard: { position: number; at: number; from: number } | undefined;
  let pausedAt: number | undefined;

  const fadeWindow = () => {
    const duration = video.duration;
    // A track no longer than the lead would be skipped as soon as it starts.
    if (!Number.isFinite(duration) || duration <= ctx.config.secondsBeforeEnd || ctx.player.state.ad) return;
    const end = Math.max(0, duration - ctx.config.secondsBeforeEnd);
    const length = Math.min(ctx.config.fadeOutDuration / 1000, end);
    return { start: end - length, end, length };
  };
  // Schedules the rest of the fade-out from the current position, at the current rate.
  const scheduleFadeOut = () => {
    const fade = fadeWindow();
    if (!fade || video.paused || stream.ready()) return;
    const position = video.currentTime;
    if (position < fade.start || position >= fade.end) return;
    fadingOut = true;
    const from = fade.length > 0 ? (fade.end - position) / fade.length : 0;
    fader.ramp(from, 0, (fade.end - position) / video.playbackRate);
  };
  const fadeIn = () => {
    pendingFadeIn = false;
    fader.ramp(0, 1, ctx.config.fadeInDuration / 1000 / video.playbackRate);
  };
  const skip = () => {
    skipped = true;
    fadingOut = false;
    if (ctx.player.state.repeat === "one") {
      ctx.player.control({ type: "seek", seconds: 0 });
      fadeIn();
      return;
    }
    // The track's end goes on in the second stream while the next one fades in.
    if (stream.ready()) {
      stream.play();
      fader.hold(0);
    }
    // Also covers the end of the queue: the next play fades in.
    pendingFadeIn = true;
    ctx.player.control({ type: "next" });
  };
  const onTime = () => {
    if (ctx.player.state.ad || video.paused) return;
    const position = video.currentTime;
    const fade = fadeWindow();
    heard = {
      position,
      at: performance.now(),
      from: fade && fadingOut && fade.length > 0 ? Math.min(1, Math.max(0, (fade.end - position) / fade.length)) : 1,
    };
    if (!fade) return;
    stream.preload(position, fade.end);
    if (position >= fade.end) {
      if (!skipped) skip();
    } else if (!fadingOut && position >= fade.start) {
      scheduleFadeOut();
    }
  };
  // Pauses freeze the fade; seeks and rate changes recompute it.
  const resync = () => {
    if (pendingFadeIn || ctx.player.state.ad) return;
    const fade = fadeWindow();
    if (!fade || video.currentTime < fade.start) {
      // Seeked back out of a fade-out (a fade-in in progress is left alone).
      if (fadingOut) fader.hold(1);
      fadingOut = false;
      skipped = false;
    } else if (video.paused) {
      fader.freeze();
    } else {
      scheduleFadeOut();
    }
  };

  ctx.player.on("trackChange", (track) => stream.prepare(track.videoId));
  if (ctx.player.state.track) stream.prepare(ctx.player.state.track.videoId);
  ctx.player.on("trackLoading", (videoId) => {
    // A manual change: the old track plays on in the second stream, fading out from
    // where it was (and from where its own fade-out was).
    const old = ctx.player.state.track?.videoId;
    const now = performance.now();
    const stoppedAt = pausedAt ?? now;
    if (
      !skipped &&
      heard &&
      now - stoppedAt < PAUSE_GRACE_MS &&
      stoppedAt - heard.at < HEARD_FRESH_MS &&
      old &&
      old !== videoId &&
      !ctx.player.state.ad &&
      stream.has(old)
    ) {
      const position = heard.position + ((stoppedAt - heard.at) / 1000) * video.playbackRate;
      if (heard.from > 0) stream.play(position, heard.from);
    }
    heard = undefined;
    skipped = false;
    fadingOut = false;
    pendingFadeIn = true;
    fader.hold(0);
  });
  // A resume fades in again; inside the fade-out window, the fade-out goes on instead.
  ctx.listen(video, "play", () => {
    pausedAt = undefined;
    if (pendingFadeIn || ctx.player.state.ad) return;
    const fade = fadeWindow();
    if (fade && video.currentTime >= fade.start) return;
    pendingFadeIn = true;
  });
  ctx.listen(video, "playing", () => {
    if (pendingFadeIn && !ctx.player.state.ad) fadeIn();
    else resync();
  });
  ctx.player.on("adChange", (ad) => {
    // Ads play at full volume; the track fades in after them.
    if (ad) fader.hold(1);
    else if (pendingFadeIn && !video.paused) fadeIn();
    else if (pendingFadeIn) fader.hold(0);
  });
  ctx.listen(video, "timeupdate", onTime);
  ctx.listen(video, "pause", () => {
    pausedAt = performance.now();
    resync();
  });
  ctx.listen(video, "seeking", () => {
    heard = undefined;
  });
  ctx.listen(video, "seeked", resync);
  ctx.listen(video, "ratechange", resync);
  // Every option is read when used; re-schedule a fade in progress.
  ctx.onConfigChange(resync);
}
