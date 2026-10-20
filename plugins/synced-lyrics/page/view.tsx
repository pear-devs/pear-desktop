import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { lineAt } from "../lrc.ts";
import { PROVIDER_NAMES, PROVIDERS, resultRank, type LyricLine, type ProviderId } from "../types.ts";
import type { LyricsStore, ProviderState } from "./store.ts";

export type LineEffect = "fancy" | "scale" | "offset" | "focus";
export type GapText = "dots" | "note" | "dash" | "none";

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
}

/** While the user scrolls the lyrics themselves, stop following the current line. */
const USER_SCROLL_GRACE_MS = 4000;

function useStore(store: LyricsStore) {
  const [, setTick] = useState(0);
  useEffect(() => store.subscribe(() => setTick((t) => t + 1)), [store]);
}

export function LyricsView(props: ViewProps) {
  const { store, options } = props;
  useStore(store);
  const shown = store.shown;
  const track = store.track;

  let body;
  if (!track) body = <Message title="Nothing playing" />;
  else if (shown?.synced) body = <SyncedLyrics {...props} key={`${track.videoId}:${shown.provider}`} />;
  else if (shown) body = <PlainLyrics texts={shown.texts} romanized={shown.romanized} />;
  else if (store.loading) body = <Skeleton />;
  else
    body = (
      <Message title="No lyrics found" detail={`${track.title} · ${track.artist}`}>
        {PROVIDERS.some((id) => store.providers[id].status === "error") && (
          <p class="hint">Some providers could not be reached. Retry them above.</p>
        )}
      </Message>
    );

  return (
    <div class={`root effect-${options.effect}`} data-state={shown ? (shown.synced ? "synced" : "plain") : store.loading ? "loading" : "empty"}>
      {track && <Picker store={store} />}
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

function Picker({ store }: { store: LyricsStore }) {
  const current = store.shown?.provider;
  return (
    <div class="picker" role="radiogroup" aria-label="Lyrics provider">
      {PROVIDERS.map((id) => {
        const state = store.providers[id];
        const usable = state.status === "done" && resultRank(state.result) > 0;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            class="chip"
            aria-checked={current === id}
            data-provider={id}
            data-status={state.status === "done" ? (usable ? "found" : "none") : state.status}
            disabled={state.status === "loading" || (state.status === "done" && !usable)}
            title={describe(state)}
            onClick={() => (state.status === "error" ? store.retry(id) : store.pick(id))}
          >
            <span class="dot" aria-hidden="true" />
            {PROVIDER_NAMES[id]}
            {usable && current === id && <span class="kind">{kind(state)}</span>}
            {state.status === "error" && <span class="kind">retry</span>}
          </button>
        );
      })}
    </div>
  );
}

function kind(state: ProviderState) {
  if (state.status !== "done") return "";
  return ["", "plain", "synced", "words"][resultRank(state.result)];
}

function describe(state: ProviderState) {
  switch (state.status) {
    case "loading":
      return "Searching…";
    case "error":
      return `Failed: ${state.message}. Click to retry.`;
    case "done":
      return resultRank(state.result) ? `Found ${kind(state)} lyrics` : "No lyrics for this track";
  }
}

function SyncedLyrics({ store, options, now, seek, scroller }: ViewProps) {
  const shown = store.shown!;
  const lines = shown.lines;
  const [active, setActive] = useState(-1);
  const [following, setFollowing] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);

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
      const index = lineAt(lines, ms);
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
    const element = listRef.current?.children[Math.max(0, active)] as HTMLElement | undefined;
    const container = scroller();
    if (!element || !container || !following) return;
    const box = container.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const top = container.scrollTop + rect.top - box.top - box.height * 0.38 + rect.height / 2;
    container.scrollTo({ top, behavior: "smooth" });
  }, [active, following]);

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
            state={i === active ? "active" : i < active ? "past" : "future"}
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
      onClick={onSeek}
    >
      {options.showTimeCodes && <span class="time">{formatTime(line.startMs)}</span>}
      {gap ? (
        <GapMark kind={options.gapText} />
      ) : (
        <span class="text" dir="auto">
          {words ? words.map((word, i) => <span key={i} class="word">{word.text}</span>) : text}
        </span>
      )}
      {romanized && !gap && <span class="romanized">{romanized}</span>}
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

function Skeleton() {
  return (
    <div class="skeleton" aria-busy="true" aria-label="Searching for lyrics">
      {[78, 62, 88, 54, 70, 46].map((width, i) => (
        <span key={i} style={{ width: `${width}%`, animationDelay: `${i * 90}ms` }} />
      ))}
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
  return Math.min(1, Math.max(0, (ms - start) / (end - start)));
}

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
