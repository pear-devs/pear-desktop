// Ads that still play: get through them without touching the track (see ads.ts).

import type { YTPlayerApi } from "@pear/sdk";
import { adStrategy, FAST_FORWARD_RATE, rewindTarget } from "./ads.ts";
import type { Ctx } from "./schema.ts";

/** How often an ad is pushed along while it plays. */
const AD_TICK_MS = 250;
/** A standalone ad is seeked to its end unless it is this close already. */
const END_MARGIN_S = 0.25;
/** YTM settles on the track's position a moment after the ad. */
const REWIND_DELAY_MS = 500;

interface AdBreak {
  videoId: string;
  /** Track position when the ad started, to rewind to if the track ran on underneath. */
  anchor: number;
  rate: number;
  muted: boolean;
  fastForwarded: boolean;
  timer: ReturnType<typeof setInterval>;
}

export function skipAds(ctx: Ctx) {
  let content = { videoId: "", seconds: 0 };
  let adBreak: AdBreak | undefined;
  ctx.player.on("trackLoading", (videoId) => {
    content = { videoId, seconds: 0 };
  });
  ctx.player.on("timeUpdate", (seconds) => {
    const videoId = ctx.player.api?.getVideoData().video_id;
    if (videoId) content = { videoId, seconds };
  });

  const tick = () => {
    const video = ctx.player.video();
    const api = ctx.player.api;
    if (!adBreak || !video || !api) return;
    const contentDuration = Number(api.getPlayerResponse()?.videoDetails?.lengthSeconds) || 0;
    if (adStrategy(video.duration, contentDuration) === "seek") {
      if (video.currentTime < video.duration - END_MARGIN_S) video.currentTime = video.duration;
    } else {
      adBreak.fastForwarded = true;
      if (video.playbackRate !== FAST_FORWARD_RATE) video.playbackRate = FAST_FORWARD_RATE;
    }
    if (!video.muted) video.muted = true;
  };

  const begin = () => {
    const video = ctx.player.video();
    const api = ctx.player.api;
    if (adBreak || !video || !api) return;
    const videoId = api.getVideoData().video_id;
    adBreak = {
      videoId,
      anchor: videoId === content.videoId ? content.seconds : 0,
      rate: api.getPlaybackRate() || 1,
      muted: video.muted,
      fastForwarded: false,
      timer: ctx.setInterval(tick, AD_TICK_MS),
    };
    ctx.log.info("ad started, skipping it");
    tick();
  };

  const end = () => {
    const ended = adBreak;
    if (!ended) return;
    adBreak = undefined;
    ctx.clearInterval(ended.timer);
    const video = ctx.player.video();
    const api = ctx.player.api;
    if (!video || !api) return;
    video.playbackRate = ended.rate;
    video.muted = ended.muted;
    if (ended.fastForwarded) ctx.setTimeout(() => rewind(ctx, api, ended), REWIND_DELAY_MS);
  };

  ctx.player.on("adChange", (ad) => {
    if (ad) begin();
    else end();
  });
  if (ctx.player.state.ad) begin();
  ctx.onCleanup(end);
}

/** Takes back the track time that played at ad speed. */
function rewind(ctx: Ctx, api: YTPlayerApi, ended: AdBreak) {
  if (ctx.signal.aborted || ctx.player.state.ad || api.getVideoData().video_id !== ended.videoId) return;
  const target = rewindTarget(ended.anchor, api.getCurrentTime());
  if (target === undefined) return;
  ctx.log.info(`rewinding ${(api.getCurrentTime() - target).toFixed(1)}s of track played at ad speed`);
  api.seekTo(target, true);
}
