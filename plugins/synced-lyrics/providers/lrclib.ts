import { parse as parseYaml } from "yaml";
import { finishLines, parseLrc } from "../lrc.ts";
import { queryArtistSimilarity, queryTitleSimilarity } from "../match.ts";
import type { LyricLine, LyricResult, LyricWord, SearchQuery } from "../types.ts";
import { getJson, type Fetch } from "./http.ts";

const BASE = "https://lrclib.net/api";
const MAX_DURATION_DIFF = 15;

interface Entry {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration: number;
  instrumental: boolean;
  hasWordSync?: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  lyricsfile?: string | null;
}

export async function lrclib(query: SearchQuery, fetch: Fetch): Promise<LyricResult | null> {
  const search = (params: Record<string, string>) =>
    getJson<Entry[]>(fetch, `${BASE}/search?${new URLSearchParams(params)}`).then((data) =>
      Array.isArray(data) ? data : [],
    );

  const exact: Record<string, string> = { track_name: query.title, artist_name: query.artist };
  if (query.album) exact.album_name = query.album;
  let entries = await search(exact);
  if (entries.length === 0 && query.album) entries = await search({ track_name: query.title, artist_name: query.artist });
  if (entries.length === 0 && query.inexact) entries = await search({ q: `${query.title} ${query.artist}` });
  // As pear-desktop: the title in its original language, then the title alone.
  if (entries.length === 0 && query.inexact && query.alternativeTitle) entries = await search({ q: query.alternativeTitle });
  if (entries.length === 0 && query.inexact) entries = await search({ q: query.title });

  const best = pick(entries, query);
  if (!best || best.instrumental) return null;

  const durationMs = best.duration * 1000;
  const lines =
    (best.hasWordSync && best.lyricsfile ? parseLyricsfile(best.lyricsfile, durationMs) : undefined) ??
    (best.syncedLyrics ? parseLrc(best.syncedLyrics, durationMs) : undefined);
  const plain = best.plainLyrics ?? undefined;
  if (!lines?.length && !plain?.trim()) return null;

  const result: LyricResult = { title: best.trackName, artists: [best.artistName] };
  if (lines?.length) result.lines = lines;
  if (plain) result.plain = plain;
  return result;
}

/** Closest duration among entries by the right artist; word sync and synced lyrics win ties. */
export function pick(entries: readonly Entry[], query: SearchQuery): Entry | undefined {
  const minArtist = query.inexact ? 0.8 : 0.9;
  const candidates = entries.filter(
    (entry) =>
      Math.abs(entry.duration - query.durationSeconds) <= MAX_DURATION_DIFF &&
      queryArtistSimilarity(entry.artistName, query) >= minArtist &&
      (query.inexact || queryTitleSimilarity(entry.trackName, query) >= 0.8),
  );
  const score = (entry: Entry) =>
    // Seconds off, rounded so that richer lyrics win between near-identical durations.
    Math.round(Math.abs(entry.duration - query.durationSeconds) / 2) * 10 -
    (entry.hasWordSync ? 4 : 0) -
    (entry.syncedLyrics ? 2 : 0) -
    (entry.plainLyrics ? 1 : 0);
  return candidates.sort((a, b) => score(a) - score(b))[0];
}

/** LRCLIB's structured format; the only place it exposes word timing. */
export function parseLyricsfile(source: string, durationMs?: number): LyricLine[] | undefined {
  let document: unknown;
  try {
    document = parseYaml(source);
  } catch {
    return;
  }
  const rawLines = (document as { lines?: unknown })?.lines;
  if (!Array.isArray(rawLines) || rawLines.length === 0) return;

  const lines: LyricLine[] = [];
  for (const raw of rawLines as Record<string, unknown>[]) {
    const start = num(raw.start_ms ?? raw.startMs ?? raw.time_ms);
    if (start === undefined) continue;
    const end = num(raw.end_ms ?? raw.endMs) ?? start;
    const rawWords = Array.isArray(raw.words) ? (raw.words as Record<string, unknown>[]) : [];
    const words: LyricWord[] = [];
    rawWords.forEach((word, i) => {
      const text = String(word.text ?? word.word ?? "");
      const wordStart = num(word.start_ms ?? word.startMs ?? word.time_ms);
      if (!text || wordStart === undefined) return;
      const next = rawWords[i + 1];
      const wordEnd = num(word.end_ms ?? word.endMs) ?? num(next?.start_ms ?? next?.startMs) ?? end;
      words.push({ startMs: wordStart, endMs: wordEnd, text });
    });
    const text = typeof raw.text === "string" ? raw.text : words.map((w) => w.text).join("");
    if (words.length) spaceWords(words, text);
    lines.push({ startMs: start, endMs: end, text: text.trim(), ...(words.length ? { words } : {}) });
  }
  return lines.length ? finishLines(lines, durationMs) : undefined;
}

/** Words may come without their separators; restore them from the line text. */
function spaceWords(words: LyricWord[], text: string) {
  let cursor = 0;
  for (const word of words) {
    const at = text.indexOf(word.text.trim(), cursor);
    if (at < 0) return;
    cursor = at + word.text.trim().length;
    const gap = /^\s+/.exec(text.slice(cursor))?.[0];
    word.text = word.text.trim() + (gap ? " " : "");
  }
}

function num(value: unknown) {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}
