import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { shell } from "electron";
import { hostOf, hosts, LyricsHost } from "./host.ts";
import { mountLyrics, pages } from "./page/mount.tsx";
import type { LyricResult, ProviderId, SearchQuery } from "./types.ts";

export default definePlugin({
  id: "synced-lyrics",
  name: "Synced lyrics",
  description: "Time-synced lyrics in the Lyrics tab, with word-by-word highlighting, click-to-seek and romanization.",
  authors: ["Non0reo", "ArjixWasTaken", "KimJammer", "Strvm"],
  config: {
    preferredProvider: config.select(
      "auto",
      [
        // pear-desktop's provider names, so its setting carries over.
        { value: "auto", label: "Best available" },
        { value: "LRCLib", label: "LRCLIB" },
        { value: "YTMusic", label: "\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music" },
        { value: "MusixMatch", label: "Musixmatch" },
        { value: "Megalobiz", label: "Megalobiz" },
        { value: "LyricsGenius", label: "Genius" },
      ],
      { label: "Preferred provider", description: "Used whenever it has lyrics; otherwise word-synced beats line-synced beats plain." },
    ),
    lineEffect: config.select(
      "fancy",
      [
        { value: "fancy", label: "Fancy (glow)" },
        { value: "scale", label: "Scale" },
        { value: "offset", label: "Offset" },
        { value: "focus", label: "Focus (blur others)" },
      ],
      { label: "Current line effect" },
    ),
    gapText: config.select(
      "dots",
      [
        { value: "dots", label: "Animated dots" },
        { value: "note", label: "♪" },
        { value: "dash", label: "———" },
        { value: "none", label: "Nothing" },
      ],
      { label: "Instrumental breaks" },
    ),
    showTimeCodes: config.bool(false, { label: "Show time codes" }),
    offsetMs: config.number(0, {
      label: "Timing offset",
      description: "Positive values show lines earlier.",
      min: -2000,
      max: 2000,
      step: 50,
      unit: "ms",
    }),
    romanization: config.bool(true, {
      label: "Romanize lyrics",
      description: "Japanese, Korean and Chinese. The Japanese dictionary (about 17 MB) downloads on first use.",
    }),
    convertChinese: config.select(
      "off",
      [
        { value: "off", label: "Keep as is" },
        { value: "s2t", label: "Simplified → Traditional" },
        { value: "t2s", label: "Traditional → Simplified" },
      ],
      { label: "Chinese characters" },
    ),
    showLyricsEvenIfInexact: config.bool(true, {
      label: "Show lyrics even if inexact",
      description: "Also try looser searches; may occasionally match a different version of the song.",
    }),
    musixmatchToken: config.string("", {
      label: "Musixmatch user token",
      description:
        "Musixmatch only serves lyrics to signed-in apps: the usertoken of your own Musixmatch desktop app session. Without one, Musixmatch reports that it needs it.",
      secret: true,
    }),
  },
  host: {
    start(ctx) {
      hosts.set(ctx, new LyricsHost(ctx.app.getPath("userData")));
      return () => void hosts.delete(ctx);
    },
    // Keep the cache; config only matters to the page.
    onConfigChange() {},
    commands: {
      search(provider: ProviderId, query: SearchQuery): Promise<LyricResult | null> {
        const t = (key: string, fallback: string) => this.t(key, fallback);
        return hostOf(this).search(provider, query, { musixmatch: { userToken: this.config.musixmatchToken, t } });
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
  page: {
    start(ctx) {
      pages.set(ctx, mountLyrics(ctx));
    },
    onConfigChange(config, ctx) {
      pages.get(ctx)?.configure(config);
    },
  },
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
