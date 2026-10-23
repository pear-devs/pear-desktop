import { definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { shell } from "electron";
import { hostOf, hosts, LyricsHost } from "./host.ts";
import { mountLyrics } from "./page/mount.tsx";
import { schema } from "./schema.ts";
import type { LyricResult, ProviderId, SearchQuery } from "./types.ts";

export default definePlugin({
  id: "synced-lyrics",
  name: "Synced lyrics",
  description: "Time-synced lyrics in the Lyrics tab, with word-by-word highlighting, click-to-seek and romanization.",
  authors: ["Non0reo", "ArjixWasTaken", "KimJammer", "Strvm"],
  config: schema,
  host: {
    start(ctx) {
      hosts.set(ctx, new LyricsHost(ctx.app.getPath("userData")));
      return () => void hosts.delete(ctx);
    },
    // Keep the cache; config only matters to the page.
    onConfigChange() {},
    commands: {
      search(provider: ProviderId, query: SearchQuery): Promise<LyricResult | null> {
        return hostOf(this).search(provider, query, { musixmatch: { userToken: this.config.musixmatchToken, t: this.t } });
      },
      /** Opens a lyrics page at its provider (Megalobiz asks to be linked). */
      openSource(url: string) {
        if (!/^https:\/\/(www\.)?megalobiz\.com\//.test(url)) throw new Error("not a lyrics page");
        return shell.openExternal(url);
      },
      romanize(lines: string[]) {
        return hostOf(this).romanize(lines);
      },
      convertChinese(lines: string[], mode: "s2t" | "t2s") {
        return hostOf(this).convertChinese(lines, mode);
      },
    },
  },
  page: mountLyrics,
  style: css`
    sel(lyrics.panel):has(> pear-synced-lyrics[open]) > :not(pear-synced-lyrics) {
      display: none !important;
    }
    sel(lyrics.panel):has(> pear-synced-lyrics[open]) {
      scrollbar-width: none;
    }
    pear-synced-lyrics:not([open]) {
      display: none;
    }
  `,
});
