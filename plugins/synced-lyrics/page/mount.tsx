// Puts the lyrics view into YTM's Lyrics tab: a shadow-DOM element inside the
// tab panel, shown (and YTM's own lyrics hidden) while that tab is selected.

import type { PageContext } from "@pear/sdk";
import { render } from "preact";
import type { LyricResult, ProviderId, SearchQuery } from "../types.ts";
import { LyricsStore, type Options } from "./store.ts";
import { lyricsStyles } from "./styles.ts";
import { LyricsView, viewState, type GapText, type LineEffect, type ViewOptions } from "./view.tsx";

export interface LyricsConfig {
  preferredProvider: "auto" | ProviderId;
  lineEffect: LineEffect;
  gapText: GapText;
  showTimeCodes: boolean;
  offsetMs: number;
  romanization: boolean;
  convertChinese: "off" | "s2t" | "t2s";
  showLyricsEvenIfInexact: boolean;
}

interface Commands {
  [name: string]: (...args: any[]) => unknown;
  search(provider: ProviderId, query: SearchQuery): Promise<LyricResult | null>;
  romanize(lines: string[]): Promise<(string | null)[]>;
  convertChinese(lines: string[], mode: "s2t" | "t2s"): Promise<string[]>;
  openSource(url: string): Promise<void>;
}

export interface LyricsController {
  configure(config: LyricsConfig): void;
}

/** Keyed by the page context, for `onConfigChange`. */
export const pages = new WeakMap<object, LyricsController>();

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

export function mountLyrics(ctx: PageContext<LyricsConfig, Commands>): LyricsController {
  const store = new LyricsStore(
    {
      search: (provider, query) => ctx.host.invoke("search", provider, query),
      romanize: (lines) => ctx.host.invoke("romanize", lines),
      convertChinese: (lines, mode) => ctx.host.invoke("convertChinese", lines, mode),
    },
    storeOptions(ctx.config),
  );

  const element = document.createElement("pear-synced-lyrics");
  const root = element.attachShadow({ mode: "open" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(lyricsStyles);
  root.adoptedStyleSheets = [sheet];
  // Keep YTM's global shortcuts from reacting to clicks and keys in here.
  ctx.listen(element, "keydown", (event: KeyboardEvent) => event.stopPropagation());

  const now = () => {
    const video = ctx.player.video();
    return video && !ctx.player.state.ad ? video.currentTime * 1000 : null;
  };
  const seek = (ms: number) => ctx.player.control({ type: "seek", seconds: ms / 1000 });
  const scroller = () => element.parentElement;
  const openSource = (url: string) => void ctx.host.invoke("openSource", url).catch((error) => ctx.log.warn("could not open", url, error));

  const t = (key: string, fallback: string, vars?: Record<string, unknown>) => ctx.t(key, fallback, vars);
  let options = viewOptions(ctx.config);
  let open = false;
  const draw = () =>
    render(open ? <LyricsView store={store} options={options} now={now} seek={seek} scroller={scroller} openSource={openSource} t={t} /> : null, root);

  const setOpen = (next: boolean) => {
    if (next === open) return;
    open = next;
    element.toggleAttribute("open", open);
    draw();
  };

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

  let tabObserver: MutationObserver | undefined;
  let observedTab: HTMLElement | null = null;
  const attach = () => {
    const panel = ctx.$("lyrics.panel");
    if (panel && element.parentElement !== panel) {
      panel.append(element);
      element.style.setProperty("--panel-bg", backgroundOf(panel));
    }
    const tab = ctx.$("lyrics.tab");
    if (tab && tab !== observedTab) {
      tabObserver?.disconnect();
      observedTab = tab;
      tabObserver = observeTab(tab);
    }
  };
  // YTM builds the player page lazily and may re-render it; keep ourselves attached.
  const pageObserver = new MutationObserver(attach);
  void ctx.waitFor("player.page").then((page) => {
    pageObserver.observe(page, { childList: true, subtree: true });
    attach();
  });

  ctx.player.on("trackChange", (track) => store.load(track));
  store.load(ctx.player.state.track);

  const unsubscribe = store.subscribe(() => {
    element.dataset.state = viewState(store);
  });

  ctx.onCleanup(() => {
    unsubscribe();
    pageObserver.disconnect();
    tabObserver?.disconnect();
    render(null, root);
    element.remove();
  });

  return {
    configure(config) {
      options = viewOptions(config);
      store.setOptions(storeOptions(config));
      draw();
    },
  };
}

/** The first opaque background behind `element`, so sticky headers can cover scrolled lines. */
function backgroundOf(element: Element | null) {
  for (; element; element = element.parentElement) {
    const color = getComputedStyle(element).backgroundColor;
    if (color && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return "#030303";
}
