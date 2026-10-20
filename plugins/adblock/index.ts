import { join } from "node:path";
import { config, definePlugin } from "@pear/sdk";
import { adStrategy, FAST_FORWARD_RATE, rewindTarget } from "./ads.ts";
import { DEFAULT_LISTS, enableBlocking, loadEngine, parseListUrls } from "./engine.ts";

const stats = { active: false, blocked: 0 };

interface AdBreak {
  videoId: string;
  /** Track position when the ad started, to rewind to if the track ran on underneath. */
  anchor: number;
  rate: number;
  muted: boolean;
  fastForwarded: boolean;
  timer: ReturnType<typeof setInterval>;
}

export default definePlugin({
  id: "adblock",
  name: "Ad blocker",
  description: "Blocks ad and tracker requests, and gets through player ads in a blink without cutting into the track.",
  config: {
    blockRequests: config.bool(true, {
      label: "Block ads and trackers",
      description: "Network filtering with Ghostery's engine and EasyList, EasyPrivacy and uBlock Origin lists.",
    }),
    skipAds: config.bool(true, {
      label: "Skip player ads",
      description: "Gets through the ads \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music still plays in a blink, muted.",
    }),
    defaultLists: config.bool(true, { label: "Use the default filter lists" }),
    additionalLists: config.string("", {
      label: "Additional filter lists",
      placeholder: "https://…/filters.txt",
      description: "URLs of extra lists in Adblock Plus / uBlock syntax, separated by spaces or commas.",
    }),
    cache: config.bool(true, {
      label: "Cache the filter engine",
      description: "Starts blocking instantly on launch; lists refresh in the background once a week.",
    }),
  },
  host: {
    async start(ctx) {
      if (!ctx.config.blockRequests) return;
      const started = performance.now();
      const loaded = await loadEngine({
        lists: [...(ctx.config.defaultLists ? DEFAULT_LISTS : []), ...parseListUrls(ctx.config.additionalLists)],
        cacheDir: ctx.config.cache ? join(ctx.app.getPath("userData"), "adblock") : undefined,
      });
      let engine = loaded.engine;
      ctx.log.info(`filter engine ready in ${Math.round(performance.now() - started)}ms`);
      // ctx.webRequest is this plugin's own: composes with core CSP stripping and other plugins.
      enableBlocking(ctx.webRequest, () => engine, () => void stats.blocked++);
      stats.active = true;

      let stopped = false;
      loaded.refreshed
        .then((fresh) => {
          if (fresh && !stopped) engine = fresh;
        })
        .catch((error: unknown) => ctx.log.warn("could not refresh filter lists", error));
      return () => {
        stopped = true;
        stats.active = false;
      };
    },
    commands: {
      stats() {
        return { ...stats };
      },
    },
  },
  page: (ctx) => {
    if (!ctx.config.skipAds) return;
    let content = { videoId: "", seconds: 0 };
    let adBreak: AdBreak | undefined;

    ctx.player.on("trackLoading", (videoId) => (content = { videoId, seconds: 0 }));
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
        if (video.currentTime < video.duration - 0.25) video.currentTime = video.duration;
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
        timer: setInterval(tick, 250),
      };
      ctx.log.info("ad started, skipping it");
      tick();
    };

    const end = () => {
      const ended = adBreak;
      if (!ended) return;
      adBreak = undefined;
      clearInterval(ended.timer);
      const video = ctx.player.video();
      const api = ctx.player.api;
      if (!video || !api) return;
      video.playbackRate = ended.rate;
      video.muted = ended.muted;
      if (!ended.fastForwarded) return;
      setTimeout(() => {
        if (ctx.signal.aborted || ctx.player.state.ad || api.getVideoData().video_id !== ended.videoId) return;
        const target = rewindTarget(ended.anchor, api.getCurrentTime());
        if (target === undefined) return;
        ctx.log.info(`rewinding ${(api.getCurrentTime() - target).toFixed(1)}s of track played at ad speed`);
        api.seekTo(target, true);
      }, 500);
    };

    ctx.player.on("adChange", (ad) => (ad ? begin() : end()));
    if (ctx.player.state.ad) begin();
    ctx.onCleanup(end);
  },
});
