// Megalobiz: user-made LRC sheets, through its free public API (the site's
// search pages that pear-desktop scraped are gone). Anonymous use allows 30
// requests a minute per IP; its fair-use terms ask apps to link back to the
// sheet, which the lyrics footer does with `url`.

import { finishLines, parseLrc } from "../lrc.ts";
import { artistSimilarity, titleSimilarity } from "../match.ts";
import type { LyricLine, LyricResult, SearchQuery } from "../types.ts";
import { getJson, type Fetch } from "./http.ts";

const BASE = "https://api.megalobiz.com/api/public/v1";
const MAX_DURATION_DIFF = 15;

export interface MegalobizResult {
  id: number;
  title: string;
  artist: string;
  duration: number;
  score?: number;
  url?: string;
}

export interface MegalobizSheet {
  id: number;
  title: string;
  artist: string;
  duration?: number;
  url?: string;
  lines?: { time_ms: number; text: string }[];
  lrc?: string;
}

export async function megalobiz(query: SearchQuery, fetch: Fetch): Promise<LyricResult | null> {
  const search = (params: Record<string, string>) =>
    getJson<{ results?: MegalobizResult[] }>(
      fetch,
      `${BASE}/search?${new URLSearchParams({ ...params, duration: String(Math.round(query.durationSeconds)), limit: "10" })}`,
    ).then((data) => (Array.isArray(data.results) ? data.results : []));

  let best = pickSheet(await search({ title: query.title, artist: query.artist }), query);
  if (!best && query.inexact) best = pickSheet(await search({ q: `${query.artist} ${query.title}` }), query);
  if (!best) return null;

  const sheet = await getJson<MegalobizSheet>(fetch, `${BASE}/lrc/${best.id}`);
  return sheetToResult(sheet, query.durationSeconds * 1000);
}

/** The sheet closest in duration by the right artist; the API's own score breaks ties. */
export function pickSheet(results: readonly MegalobizResult[], query: SearchQuery): MegalobizResult | undefined {
  const minArtist = query.inexact ? 0.8 : 0.9;
  return results
    .filter(
      (result) =>
        Math.abs(result.duration - query.durationSeconds) <= MAX_DURATION_DIFF &&
        artistSimilarity(result.artist, query.artist) >= minArtist &&
        titleSimilarity(result.title, query.title) >= (query.inexact ? 0.7 : 0.8),
    )
    .sort(
      (a, b) =>
        Math.round(Math.abs(a.duration - query.durationSeconds)) - Math.round(Math.abs(b.duration - query.durationSeconds)) ||
        (b.score ?? 0) - (a.score ?? 0),
    )[0];
}

export function sheetToResult(sheet: MegalobizSheet, durationMs?: number): LyricResult | null {
  const timed: LyricLine[] | undefined = sheet.lines?.length
    ? sheet.lines
        .filter((line) => Number.isFinite(line.time_ms))
        .map((line) => ({ startMs: line.time_ms, endMs: line.time_ms, text: line.text.trim() }))
    : undefined;
  const lines = timed?.length ? finishLines(timed, durationMs) : sheet.lrc ? parseLrc(sheet.lrc, durationMs) : [];
  if (!lines.some((line) => line.text)) return null;
  const result: LyricResult = { title: sheet.title, artists: [sheet.artist], lines };
  if (sheet.url) result.url = sheet.url;
  return result;
}
