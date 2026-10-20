import { join } from "node:path";
import { config, definePlugin } from "@pear/sdk";
import { net } from "electron";
// The adblock plugin's engine loader: same Ghostery engine, cache and matching.
import { enableBlocking, loadEngine } from "../adblock/engine.ts";
import { cachedSources, chooseLists, fetchSources } from "./lists.ts";
import { installPruner } from "./prune.ts";

const IN_PLAYER = "In player";
const WITH_BLOCKLISTS = "With blocklists";

const stats = { active: false, blocked: 0, lists: 0 };

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
          "with pear-desktop's curated tracker lists. Works alongside the Ad blocker plugin: both can be on, each filters with its own lists.",
      },
    ),
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
      // ctx.webRequest is this plugin's own: it composes with the adblock plugin's listeners.
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
      if (ctx.config.blocker === IN_PLAYER) return installPruner();
    },
  },
});
