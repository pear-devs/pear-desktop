// Puts the lyrics view into YTM's Lyrics tab: a shadow-DOM element inside the
// tab panel, shown (and YTM's own lyrics hidden) while that tab is selected.

import type { PageContextOf } from "@pear/sdk";
import { isolateKeys, shadowHost } from "@pear/sdk/dom";
import { readSongDetails } from "@pear/sdk/song-details";
import { render } from "preact";
import type { LyricsConfig, schema } from "../schema.ts";
import type { LyricResult, ProviderId, SearchQuery } from "../types.ts";
import { LyricsStore, type Options } from "./store.ts";
import { lyricsStyles } from "./styles.ts";
import { LyricsView, viewState, type ViewOptions } from "./view.tsx";

interface Commands {
  search(provider: ProviderId, query: SearchQuery): Promise<LyricResult | null>;
  romanize(lines: string[]): Promise<(string | null)[]>;
  convertChinese(lines: string[], mode: "s2t" | "t2s"): Promise<string[]>;
  openSource(url: string): Promise<void>;
}

type Ctx = PageContextOf<typeof schema, Commands>;

const storeOptions = (config: LyricsConfig): Options => ({
  preferred: config.preferredProvider,
  inexact: config.showLyricsEvenIfInexact,
  romanize: config.romanization,
  chinese: config.convertChinese,
});

const viewOptions = (config: LyricsConfig): ViewOptions => ({
  effect: config.lineEffect,
  gapText: config.gapText,
  showTimeCodes: config.showTimeCodes,
  offsetMs: config.offsetMs,
});

export function mountLyrics(ctx: Ctx) {
  const store = createStore(ctx);
  const { host: element, root } = shadowHost("pear-synced-lyrics", lyricsStyles);
  // Keep YTM's global shortcuts from reacting to keys in here.
  isolateKeys(element, ctx.signal);

  // null pauses the view's per-frame work: during ads, and while the window is off screen.
  const now = () => {
    const video = ctx.player.video();
    if (!video || ctx.player.state.ad || !ctx.isWindowVisible()) return null;
    return video.currentTime * 1000;
  };
  const seek = (ms: number) => ctx.player.control({ type: "seek", seconds: ms / 1000 });
  const scroller = () => element.parentElement;
  const openSource = (url: string) => void ctx.host.invoke("openSource", url).catch((error) => ctx.log.warn("could not open", url, error));

  let options = viewOptions(ctx.config);
  let open = false;
  const draw = () =>
    render(open ? <LyricsView store={store} options={options} now={now} seek={seek} scroller={scroller} openSource={openSource} t={ctx.t} /> : null, root);

  const setOpen = (next: boolean) => {
    if (next === open) return;
    open = next;
    element.toggleAttribute("open", open);
    store.setActive(open);
    draw();
  };
  attachToLyricsTab(ctx, element, setOpen);

  ctx.player.on("trackChange", (track) => store.load(track));
  store.load(ctx.player.state.track);

  const unsubscribe = store.subscribe(() => {
    element.dataset.state = viewState(store);
  });

  ctx.onCleanup(() => {
    unsubscribe();
    render(null, root);
    element.remove();
  });

  ctx.onConfigChange((config) => {
    options = viewOptions(config);
    store.setOptions(storeOptions(config));
    draw();
  });
}

function createStore(ctx: Ctx) {
  return new LyricsStore(
    {
      search: (provider, query) => ctx.host.invoke("search", provider, query),
      romanize: (lines) => ctx.host.invoke("romanize", lines),
      convertChinese: (lines, mode) => ctx.host.invoke("convertChinese", lines, mode),
      details(videoId) {
        const details = ctx.player.api ? readSongDetails(ctx.player.api) : null;
        return details?.videoId === videoId ? details : null;
      },
    },
    storeOptions(ctx.config),
    // Nothing is looked up until the Lyrics tab opens (and then only for the tracks shown).
    false,
  );
}

/**
 * Keeps `element` in the Lyrics tab's panel and reports whether that tab is selected.
 * YTM builds the player page lazily and may re-render it, so both are re-found on changes.
 */
function attachToLyricsTab(ctx: Ctx, element: HTMLElement, setOpen: (open: boolean) => void) {
  let tabObserver: MutationObserver | undefined;
  let observedTab: HTMLElement | null = null;
  ctx.onCleanup(() => tabObserver?.disconnect());

  // The tab header: YTM disables it for tracks without its own lyrics; ours may still have some.
  const observeTab = (tab: HTMLElement) => {
    const sync = () => {
      if (tab.hasAttribute("disabled")) tab.removeAttribute("disabled");
      setOpen(tab.getAttribute("aria-selected") === "true");
    };
    const observer = new MutationObserver(sync);
    observer.observe(tab, { attributes: true, attributeFilter: ["disabled", "aria-selected"] });
    sync();
    return observer;
  };

  const attach = () => {
    const panel = ctx.$("lyrics.panel");
    if (panel && element.parentElement !== panel) {
      panel.append(element);
    }
    const tab = ctx.$("lyrics.tab");
    if (tab && tab !== observedTab) {
      tabObserver?.disconnect();
      observedTab = tab;
      tabObserver = observeTab(tab);
    }
  };
  ctx.observe("player.page", { childList: true, subtree: true }, attach);
  void ctx.waitFor("player.page").then(attach, () => {});
}
