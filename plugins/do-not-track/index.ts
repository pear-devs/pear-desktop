import { join } from "node:path";
import { config, definePlugin } from "@pear/sdk";
import { net } from "electron";
import { adStrategy, FAST_FORWARD_RATE, rewindTarget } from "./ads.ts";
import { enableBlocking, loadEngine } from "./engine.ts";
import { cachedSources, chooseLists, fetchSources } from "./lists.ts";
import { installPruner } from "./prune.ts";
import { dismissPromos, hidePromoCss } from "./promo.ts";

const IN_PLAYER = "In player";
const WITH_BLOCKLISTS = "With blocklists";

const stats = { active: false, blocked: 0, lists: 0 };

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
  id: "do-not-track",
  name: "Do Not Track",
  description: "Blocks tracking: strips ad and tracking data from the player, or filters requests with tracker blocklists.",
  config: {
    // Values are pear-desktop's, so its settings keep working.
    blocker: config.select(
      IN_PLAYER,
      [
        { value: IN_PLAYER, label: "In the player" },
        { value: WITH_BLOCKLISTS, label: "With blocklists" },
      ],
      {
        label: "Blocker",
        description:
          "In the player removes ad and tracking placements from \u0059\u006f\u0075\u0054\u0075\u0062\u0065's player data; with blocklists filters network requests " +
          "with pear-desktop's curated lists.",
      },
    ),
    skipAds: config.bool(true, {
      label: "Skip ads that still play",
      description: "Gets through them in a blink, muted, without cutting into the track.",
    }),
    cache: config.bool(true, {
      label: "Cache the blocklists",
      description: "Starts blocking instantly on launch; lists refresh in the background.",
      group: "Blocklists",
    }),
    additionalBlockLists: config.list([], {
      label: "Additional blocklists",
      placeholder: "https://…/filters.txt",
      description: "URLs of extra lists in Adblock Plus / uBlock syntax.",
      group: "Blocklists",
    }),
    disableDefaultLists: config.bool(false, {
      label: "Disable the default blocklists",
      description: "Only use the additional blocklists.",
      group: "Blocklists",
    }),
  },
  host: {
    async start(ctx) {
      if (ctx.config.blocker !== WITH_BLOCKLISTS) return;
      const fetch = (url: string) => net.fetch(url);
      const cacheDir = ctx.config.cache ? join(ctx.app.getPath("userData"), "tb_cache") : undefined;
      const listsFrom = (sources: readonly string[]) => chooseLists(sources, ctx.config);

      // Cached: start from the last known curated lists and look for new ones afterwards.
      const sources = cacheDir ? await cachedSources(cacheDir) : ((await fetchSources(fetch, undefined)) ?? (await cachedSources(undefined)));
      let lists = listsFrom(sources);
      if (lists.length === 0) {
        throw new Error(ctx.t("plugins.do-not-track.no-lists", "No blocklists: enable the default ones or add your own."));
      }

      const started = performance.now();
      const loaded = await loadEngine({ lists, cacheDir });
      let engine = loaded.engine;
      ctx.log.info(`${lists.length} blocklist(s) ready in ${Math.round(performance.now() - started)}ms`);
      // ctx.webRequest is this plugin's own: it composes with the core's and other plugins' listeners.
      enableBlocking(ctx.webRequest, () => engine, () => void stats.blocked++);
      Object.assign(stats, { active: true, lists: lists.length });

      let stopped = false;
      const swap = (fresh: typeof engine | undefined) => {
        if (fresh && !stopped) engine = fresh;
      };
      const refresh = async () => {
        swap(await loaded.refreshed);
        if (!cacheDir) return;
        const latest = await fetchSources(fetch, cacheDir);
        const next = latest && listsFrom(latest);
        if (!next?.length || next.join("\n") === lists.join("\n") || stopped) return;
        swap((await loadEngine({ lists: next, cacheDir })).engine);
        lists = next;
        stats.lists = next.length;
        ctx.log.info(`blocklists updated (${next.length})`);
      };
      refresh().catch((error: unknown) => ctx.log.warn("could not refresh the blocklists", error));
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
  page: {
    // Before YTM's scripts, so the player response inlined in the page is pruned too.
    runAt: "start",
    start(ctx) {
      if (ctx.config.blocker === IN_PLAYER) ctx.onCleanup(installPruner());

      // The Premium reminder YTM shows once ads are skipped.
      ctx.addStyle(hidePromoCss(ctx.sel("promo.mealbar")));
      ctx.waitFor("popup.container").then(
        (container) =>
          ctx.onCleanup(dismissPromos(container, ctx.sel("promo.mealbar"), ctx.sel("promo.dismiss"), () => ctx.log.info("dismissed a Premium reminder"))),
        () => {}, // stopped before YTM's popups existed
      );

      if (!ctx.config.skipAds) return;

      // Ads that still play: get through them without touching the track (see ads.ts).
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
  },
});

