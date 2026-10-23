import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { lineAt } from "../lrc.ts";
import { PROVIDER_NAMES, PROVIDERS, resultRank, type LyricLine } from "../types.ts";
import type { LyricsStore, ProviderState } from "./store.ts";

import type { Translate } from "@pear/sdk/i18n";
import { clamp } from "@pear/sdk/util";

export type LineEffect = "fancy" | "scale" | "offset" | "focus";
export type GapText = "dots" | "bullets" | "note" | "dash" | "none";

export interface ViewOptions {
  effect: LineEffect;
  gapText: GapText;
  showTimeCodes: boolean;
  /** Added to the playback position; positive shows lines earlier. */
  offsetMs: number;
}

export interface ViewProps {
  store: LyricsStore;
  options: ViewOptions;
  /** Playback position in ms, or null while it isn't meaningful (ads). */
  now(): number | null;
  seek(ms: number): void;
  /** The element that scrolls the lyrics (YTM's tab panel). */
  scroller(): HTMLElement | null;
  /** Opens the lyrics' page at the provider in the browser. */
  openSource(url: string): void;
  t: Translate;
}

/** While the user scrolls the lyrics themselves, stop following the current line. */
const USER_SCROLL_GRACE_MS = 4000;
/** The followed line is kept this far down the panel (a share of its height). */
const FOLLOW_AT = 0.38;
const KAOMOJI_FRAME_MS = 500;
/** The current line's glow and wobble last at least this long, in seconds. */
const MIN_LINE_EFFECT_S = 0.2;

function useStore(store: LyricsStore) {
  const [, setTick] = useState(0);
  useEffect(() => store.subscribe(() => setTick((t) => t + 1)), [store]);
}

export function LyricsView(props: ViewProps) {
  const { store, options, t } = props;
  useStore(store);
  const shown = store.shown;
  const track = store.track;
  const current = store.current;

  // The selected provider's lyrics, or what it is doing (pear-desktop's kaomoji).
  let body;
  if (!track) body = <Message title={t("plugins.synced-lyrics.nothing-playing", "Nothing playing")} />;
  else if (shown?.synced) body = <SyncedLyrics {...props} key={`${track.videoId}:${shown.provider}`} />;
  else if (shown) body = <PlainLyrics texts={shown.texts} romanized={shown.romanized} />;
  else if (current.status === "loading") body = <LoadingKaomoji />;
  else if (current.status === "error")
    body = (
      <div class="error">
        <pre class="error-title">{t("plugins.synced-lyrics.errors.fetch", "An error occurred while fetching the lyrics.")}</pre>
        <pre class="error-detail">{current.message}</pre>
        <button type="button" class="retry" onClick={() => store.retry(store.selected)}>
          {t("plugins.synced-lyrics.refetch-btn.normal", "Refetch lyrics")}
        </button>
      </div>
    );
  else
    body = (
      <div class="kaomoji" role="status" aria-label={t("plugins.synced-lyrics.errors.not-found", "No lyrics found for this song.")}>
        ＼(〇_ｏ)／
      </div>
    );

  return (
    <div class={`root effect-${options.effect}`} data-state={viewState(store)}>
      {track && <Picker store={store} scroller={props.scroller} t={t} />}
      {body}
      {shown && (
        <footer class="source">
          Lyrics from{" "}
          {shown.result.url ? (
            <a
              href={shown.result.url}
              onClick={(event) => {
                event.preventDefault();
                props.openSource(shown.result.url!);
              }}
            >
              {PROVIDER_NAMES[shown.provider]}
            </a>
          ) : (
            PROVIDER_NAMES[shown.provider]
          )}
          {!shown.synced && " · not time-synced"}
        </footer>
      )}
    </div>
  );
}

export function viewState(store: LyricsStore) {
  if (store.shown) return store.shown.synced ? "synced" : "plain";
  if (!store.track) return "empty";
  return { loading: "loading", error: "error", done: "empty" }[store.current.status];
}

// Material icons, as pear-desktop's picker uses.
const ICONS = {
  left: "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  right: "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
  found: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  error: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z",
  none: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  star: "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
  starBorder:
    "M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z",
};

const Icon = ({ path }: { path: string }) => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d={path} fill="currentColor" />
  </svg>
);

function status(state: ProviderState) {
  if (state.status !== "done") return state.status;
  return resultRank(state.result) > 0 ? "found" : "none";
}

function describe(state: ProviderState, t: Translate) {
  switch (state.status) {
    case "loading":
      return t("plugins.synced-lyrics.refetch-btn.fetching", "Fetching...");
    case "error":
      return state.message;
    case "done":
      switch (resultRank(state.result)) {
        case 3:
          return t("plugins.synced-lyrics.found.words", "Word-synced lyrics");
        case 2:
          return t("plugins.synced-lyrics.found.synced", "Synced lyrics");
        case 1:
          return t("plugins.synced-lyrics.found.plain", "Lyrics, not time-synced");
        default:
          return t("plugins.synced-lyrics.errors.not-found", "No lyrics found for this song.");
      }
  }
}

/**
 * pear-desktop's lyrics picker: arrows either side of the provider's name (with
 * what it found, sliding from one to the next), a star to always show that
 * provider for this track, and a dot per provider. Slides away while the
 * lyrics are scrolled, and back when the pointer comes near.
 */
function Picker({ store, scroller, t }: { store: LyricsStore; scroller(): HTMLElement | null; t: Translate }) {
  const index = PROVIDERS.indexOf(store.selected);
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const container = scroller();
    const picker = ref.current;
    if (!container || !picker) return;
    let pointerY = Number.POSITIVE_INFINITY;
    const sync = () => {
      const height = picker.offsetHeight;
      const top = container.getBoundingClientRect().top;
      setHidden(container.scrollTop > height && pointerY - top - 5 > height);
    };
    const onPointer = (event: PointerEvent) => {
      pointerY = event.clientY;
      sync();
    };
    const onLeave = () => {
      pointerY = Number.POSITIVE_INFINITY;
      sync();
    };
    container.addEventListener("scroll", sync, { passive: true });
    container.addEventListener("pointermove", onPointer, { passive: true });
    container.addEventListener("pointerleave", onLeave);
    sync();
    return () => {
      container.removeEventListener("scroll", sync);
      container.removeEventListener("pointermove", onPointer);
      container.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  const starred = store.starred === store.selected;
  return (
    <div
      class="picker"
      ref={ref}
      data-hidden={hidden || undefined}
      data-selected={store.selected}
      role="group"
      aria-label={t("plugins.synced-lyrics.picker", "Lyrics provider")}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") store.step(event.key === "ArrowLeft" ? -1 : 1);
      }}
    >
      <button type="button" class="arrow previous" aria-label={t("plugins.synced-lyrics.previous", "Previous provider")} onClick={() => store.step(-1)}>
        <Icon path={ICONS.left} />
      </button>
      <div class="picker-content">
        <div class="picker-track">
          {PROVIDERS.map((id, i) => {
            const state = store.providers[id];
            const current = i === index;
            return (
              <div
                key={id}
                class="picker-item"
                data-provider={id}
                data-status={status(state)}
                aria-hidden={!current}
                title={describe(state, t)}
                style={{ transform: `translateX(${index * -100}%)` }}
              >
                {state.status === "loading" ? <span class="spinner" aria-hidden="true" /> : <Icon path={ICONS[status(state) as "found" | "none" | "error"]} />}
                <span class="name">{PROVIDER_NAMES[id]}</span>
                <button
                  type="button"
                  class="star"
                  tabIndex={current ? 0 : -1}
                  aria-pressed={current && starred}
                  aria-label={t("plugins.synced-lyrics.star", "Always use {{provider}} for this song", { provider: PROVIDER_NAMES[id] })}
                  onClick={() => store.toggleStar()}
                >
                  <Icon path={store.starred === id ? ICONS.star : ICONS.starBorder} />
                </button>
              </div>
            );
          })}
        </div>
        <ul class="dots">
          {PROVIDERS.map((id, i) => (
            <li key={id}>
              <button
                type="button"
                class="dot"
                aria-current={i === index || undefined}
                aria-label={PROVIDER_NAMES[id]}
                tabIndex={-1}
                onClick={() => store.select(id)}
              />
            </li>
          ))}
        </ul>
      </div>
      <button type="button" class="arrow next" aria-label={t("plugins.synced-lyrics.next", "Next provider")} onClick={() => store.step(1)}>
        <Icon path={ICONS.right} />
      </button>
    </div>
  );
}

const LOADING_FRAMES = ["(>_<)", "{ (>_<) }", "{{ (>_<) }}", "{{{ (>_<) }}}", "{{ (>_<) }}", "{ (>_<) }"];

function LoadingKaomoji() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((n) => n + 1), KAOMOJI_FRAME_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <div class="kaomoji" role="status" aria-busy="true">
      {LOADING_FRAMES[frame % LOADING_FRAMES.length]}
    </div>
  );
}

function SyncedLyrics({ store, options, now, seek, scroller }: ViewProps) {
  const shown = store.shown!;
  const lines = shown.lines;
  const [active, setActive] = useState(-1);
  const [following, setFollowing] = useState(true);
  // The last line that started: what the view follows, also between lines.
  const [anchor, setAnchor] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const anchorRef = useRef(anchor);

  // Per-frame: find the current line; animate word fill and gap dots directly on the DOM.
  useEffect(() => {
    let frame = 0;
    let last = Number.NaN;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const position = now();
      // Nothing to do while paused or during ads.
      if (position === null || position === last) return;
      last = position;
      const ms = position + options.offsetMs;
      // As pear-desktop: a line is current for its duration, then becomes past even if
      // the next one hasn't started (lines with their own end time).
      const started = lineAt(lines, ms);
      const index = started >= 0 && ms < lines[started]!.endMs ? started : -1;
      if (started !== anchorRef.current) {
        anchorRef.current = started;
        setAnchor(started);
      }
      if (index !== activeRef.current) {
        activeRef.current = index;
        setActive(index);
      }
      const element = listRef.current?.children[index] as HTMLElement | undefined;
      const line = lines[index];
      if (!element || !line) return;
      element.style.setProperty("--p", progress(ms, line.startMs, line.endMs).toFixed(3));
      if (line.words) {
        const words = element.querySelectorAll<HTMLElement>(".word");
        line.words.forEach((word, i) => words[i]?.style.setProperty("--p", progress(ms, word.startMs, word.endMs).toFixed(3)));
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [lines, now, options.offsetMs]);

  // Keep the current line in view, unless the user is reading elsewhere.
  useLayoutEffect(() => {
    const element = listRef.current?.children[Math.max(0, anchor)] as HTMLElement | undefined;
    const container = scroller();
    if (!element || !container || !following) return;
    const box = container.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const top = container.scrollTop + rect.top - box.top - box.height * FOLLOW_AT + rect.height / 2;
    container.scrollTo({ top, behavior: "smooth" });
  }, [anchor, following]);

  // Follow again once the user has stopped scrolling for a while.
  useEffect(() => {
    const container = scroller();
    if (!container) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onUser = () => {
      setFollowing(false);
      clearTimeout(timer);
      timer = setTimeout(() => setFollowing(true), USER_SCROLL_GRACE_MS);
    };
    container.addEventListener("wheel", onUser, { passive: true });
    container.addEventListener("touchmove", onUser, { passive: true });
    return () => {
      clearTimeout(timer);
      container.removeEventListener("wheel", onUser);
      container.removeEventListener("touchmove", onUser);
    };
  }, []);

  return (
    <>
      <div class="lines" ref={listRef}>
        {lines.map((line, i) => (
          <Line
            key={i}
            line={line}
            text={shown.texts[i] ?? line.text}
            romanized={shown.romanized[i] ?? null}
            state={i === active ? "active" : i <= anchor ? "past" : "future"}
            options={options}
            onSeek={() => {
              seek(line.startMs);
              setFollowing(true);
            }}
          />
        ))}
      </div>
      {!following && (
        <button type="button" class="resume" onClick={() => setFollowing(true)}>
          Back to current line
        </button>
      )}
    </>
  );
}

interface LineProps {
  line: LyricLine;
  text: string;
  romanized: string | null;
  state: "past" | "active" | "future";
  options: ViewOptions;
  onSeek(): void;
}

/** Words as separate spans, staggered like pear-desktop's (each gets its index as --i). */
function staggered(text: string) {
  return text.split(" ").map((word, i) => (
    <span key={i} class="w" style={{ "--i": i }}>
      {`${word} `}
    </span>
  ));
}

function Line({ line, text, romanized, state, options, onSeek }: LineProps) {
  const gap = !text;
  // Word timing only applies to the original script.
  const words = line.words && text === line.text ? line.words : undefined;
  return (
    <div
      class={`line${gap ? " gap" : ""}${words ? " has-words" : ""}`}
      data-state={state}
      role="button"
      tabIndex={-1}
      // The glow and wobble last as long as the line, as in pear-desktop.
      style={{ "--line-duration": `${Math.max(MIN_LINE_EFFECT_S, (line.endMs - line.startMs) / 1000)}s` }}
      onClick={onSeek}
    >
      {options.showTimeCodes && <span class="time">{formatTime(line.startMs)}</span>}
      {gap ? (
        <GapMark kind={options.gapText} />
      ) : (
        <span class="text" dir="auto">
          {words
            ? words.map((word, i) => (
                <span key={i} class="word w" style={{ "--i": i }}>
                  {word.text}
                </span>
              ))
            : staggered(text)}
        </span>
      )}
      {romanized && !gap && (
        <span class="romanized" dir="auto">
          {staggered(romanized)}
        </span>
      )}
    </div>
  );
}

function GapMark({ kind }: { kind: GapText }) {
  switch (kind) {
    case "dots":
      return (
        <span class="text gap-dots" aria-label="Instrumental">
          <i />
          <i />
          <i />
        </span>
      );
    case "bullets":
      // pear-desktop's "•••": the bullets appear one by one through the break.
      return (
        <span class="text gap-bullets" aria-label="Instrumental">
          <i>•</i>
          <i>•</i>
          <i>•</i>
        </span>
      );
    case "note":
      return <span class="text">♪</span>;
    case "dash":
      return <span class="text">———</span>;
    case "none":
      return <span class="text" />;
  }
}

function PlainLyrics({ texts, romanized }: { texts: string[]; romanized: (string | null)[] }) {
  return (
    <div class="lines plain">
      {texts.map((text, i) =>
        text ? (
          <div key={i} class={`line${/^\[.*\]$/.test(text) ? " section" : ""}`}>
            <span class="text" dir="auto">
              {text}
            </span>
            {romanized[i] && <span class="romanized">{romanized[i]}</span>}
          </div>
        ) : (
          <div key={i} class="spacer" />
        ),
      )}
    </div>
  );
}

function Message({ title, detail, children }: { title: string; detail?: string; children?: ComponentChildren }) {
  return (
    <div class="message">
      <div class="glyph" aria-hidden="true">
        ♪
      </div>
      <h2>{title}</h2>
      {detail && <p>{detail}</p>}
      {children}
    </div>
  );
}

function progress(ms: number, start: number, end: number) {
  if (end <= start) return ms >= start ? 1 : 0;
  return clamp((ms - start) / (end - start), 0, 1);
}

/** pear-desktop's LRC-style time code, "[01:23.45]". */
function formatTime(ms: number) {
  const centiseconds = Math.floor(ms / 10);
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor(centiseconds / 100) % 60;
  return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}]`;
}
