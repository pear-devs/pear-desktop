// LRC parser: line timestamps (several per line allowed), the [offset:] tag and
// enhanced LRC word timing (`<mm:ss.xx>` before each word).

import type { LyricLine, LyricWord } from "./types.ts";

const LINE_TIME = /^\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const WORD_TIME = /<(\d+):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
const TAG = /^\[([a-z#]+):\s*(.*?)\s*\]$/i;
/** Lines before the first sung one are shown as a gap when singing starts later than this. */
const LEADING_GAP_MS = 300;
/** End of the last line when the track duration is unknown. */
const LAST_LINE_MS = 5000;

function toMs(minutes: string, seconds: string, fraction = "0") {
  return Number(minutes) * 60_000 + Number(seconds) * 1000 + Number(fraction.padEnd(3, "0"));
}

function parseWords(text: string, lineStart: number): { text: string; words?: LyricWord[] } {
  const tags = [...text.matchAll(WORD_TIME)];
  if (tags.length === 0) return { text: text.trim() };

  const words: LyricWord[] = [];
  const before = text.slice(0, tags[0]!.index).trim();
  if (before) words.push({ startMs: lineStart, endMs: lineStart, text: `${before} ` });
  tags.forEach((tag, i) => {
    const start = toMs(tag[1]!, tag[2]!, tag[3]);
    const next = tags[i + 1];
    const raw = text.slice(tag.index + tag[0].length, next?.index ?? text.length);
    const previous = words.at(-1);
    if (previous && previous.endMs === previous.startMs) previous.endMs = start;
    if (!raw.trim()) return;
    // Leading whitespace belongs to the previous word, so joined words read naturally.
    if (previous && /^\s/.test(raw) && !/\s$/.test(previous.text)) previous.text += " ";
    const end = next ? toMs(next[1]!, next[2]!, next[3]) : start;
    words.push({ startMs: start, endMs: end, text: raw.trimStart().replace(/\s+/g, " ") });
  });
  const last = words.at(-1);
  if (last) last.text = last.text.trimEnd();
  return { text: words.map((w) => w.text).join("").trim(), words };
}

export function parseLrc(source: string, durationMs?: number): LyricLine[] {
  const lines: LyricLine[] = [];
  let offset = 0;

  for (const rawLine of source.split(/\r?\n/)) {
    let rest = rawLine.trim();
    const starts: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = LINE_TIME.exec(rest))) {
      starts.push(toMs(match[1]!, match[2]!, match[3]));
      rest = rest.slice(match[0].length);
    }
    if (starts.length === 0) {
      const tag = TAG.exec(rest);
      if (tag?.[1]?.toLowerCase() === "offset") offset = Number.parseInt(tag[2]!, 10) || 0;
      continue;
    }
    for (const start of starts) {
      const { text, words } = parseWords(rest, start);
      const line: LyricLine = { startMs: start, endMs: start, text };
      if (words?.length) line.words = words;
      lines.push(line);
    }
  }

  return finishLines(lines, durationMs, offset);
}

/** Sorts, applies an offset (positive = earlier, as in LRC), fills in end times and adds the leading gap. */
export function finishLines(lines: LyricLine[], durationMs?: number, offset = 0): LyricLine[] {
  const shift = (ms: number) => Math.max(0, ms - offset);
  const sorted = lines
    .map((line) => ({
      ...line,
      startMs: shift(line.startMs),
      endMs: shift(line.endMs),
      ...(line.words ? { words: line.words.map((w) => ({ ...w, startMs: shift(w.startMs), endMs: shift(w.endMs) })) } : {}),
    }))
    .sort((a, b) => a.startMs - b.startMs);

  sorted.forEach((line, i) => {
    const next = sorted[i + 1];
    const fallback = next?.startMs ?? Math.max(durationMs ?? 0, line.startMs + LAST_LINE_MS);
    if (line.endMs <= line.startMs || (next && line.endMs > next.startMs && !line.words)) line.endMs = fallback;
    const lastWord = line.words?.at(-1);
    if (lastWord && lastWord.endMs <= lastWord.startMs) lastWord.endMs = Math.max(line.endMs, lastWord.startMs);
  });

  const first = sorted[0];
  if (first && first.startMs > LEADING_GAP_MS) sorted.unshift({ startMs: 0, endMs: first.startMs, text: "" });
  return sorted;
}

/** Index of the line playing at `ms`, or -1 before the first one. */
export function lineAt(lines: readonly LyricLine[], ms: number) {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid]!.startMs <= ms) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
