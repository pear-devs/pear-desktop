import { join } from "node:path";
import { definePlugin } from "@pear/sdk";
import { net } from "electron";
import { applyCosmetics } from "./cosmetics.ts";
import { cosmetics, enableBlocking, loadEngine } from "./engine.ts";
import type { CosmeticsRequest } from "./engine.ts";
import { cachedSources, chooseLists, fetchSources } from "./lists.ts";
import { installPruner } from "./prune.ts";
import { dismissPromos, hidePromoCss } from "./promo.ts";
import { IN_PLAYER, schema, WITH_BLOCKLISTS } from "./schema.ts";
import { skipAds } from "./skip-ads.ts";

const stats = { active: false, blocked: 0, lists: 0 };

export default definePlugin({
  id: "do-not-track",
  name: "Do Not Track",
  description: "Blocks tracking: strips ad and tracking data from the player, or filters requests with tracker blocklists.",
  config: schema,
  host: {
    async start(ctx) {
      if (ctx.config.blocker !== WITH_BLOCKLISTS) return;
      const fetch = (url: string) => net.fetch(url);
      const cacheDir = ctx.config.cache ? join(ctx.app.getPath("userData"), "tb_cache") : undefined;
      const listsFrom = (sources: readonly string[]) => chooseLists(sources, ctx.config);

      const sources = await initialSources(fetch, cacheDir);
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
      engines.set(ctx, () => engine);
      ctx.onCleanup(() => engines.delete(ctx));
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
      /** The blocklists' cosmetic filters for the page (null until the lists are loaded). */
      cosmetics(request: CosmeticsRequest) {
        const engine = engines.get(this)?.();
        if (!engine || this.config.cosmeticFilters === "off") return null;
        return cosmetics(engine, request, this.config.cosmeticFilters === "all");
      },
    },
  },
  page: {
    // Before YTM's scripts, so the player response inlined in the page is pruned too.
    runAt: "start",
    start(ctx) {
      if (ctx.config.blocker === IN_PLAYER) ctx.onCleanup(installPruner());
      if (ctx.config.blocker === WITH_BLOCKLISTS && ctx.config.cosmeticFilters !== "off") applyCosmetics(ctx);

      // The Premium reminder YTM shows once ads are skipped.
      const promo = ctx.sel("promo.mealbar");
      ctx.addStyle(hidePromoCss(promo));
      const onDismiss = () => ctx.log.info("dismissed a Premium reminder");
      ctx.waitFor("popup.container").then(
        (container) => ctx.onCleanup(dismissPromos(container, promo, ctx.sel("promo.dismiss"), onDismiss)),
        () => {}, // stopped before YTM's popups existed
      );

      if (ctx.config.skipAds) skipAds(ctx);
    },
  },
});

/** Per running host part: its current engine. */
const engines = new WeakMap<object, () => import("@ghostery/adblocker").FiltersEngine>();

/** Cached: start from the last known curated lists (and look for new ones afterwards). Else fetch them, or use the built-in ones. */
async function initialSources(fetch: (url: string) => Promise<Response>, cacheDir: string | undefined) {
  if (cacheDir) return cachedSources(cacheDir);
  return (await fetchSources(fetch, undefined)) ?? (await cachedSources(undefined));
}
