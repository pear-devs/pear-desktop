// YTM's own lyrics (mostly LyricFind), fetched straight from
// InnerTube. The mobile client returns timed lines when YTM has them.

import { finishLines } from "../lrc.ts";
import type { LyricLine, LyricResult, SearchQuery } from "../types.ts";
import { getJson, type Fetch } from "./http.ts";

const API = "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/\u0079\u006f\u0075\u0074\u0075\u0062\u0065i/v1";
const WEB_CLIENT = { clientName: "WEB_REMIX", clientVersion: "1.20250101.01.00", hl: "en" };
const MOBILE_CLIENT = { clientName: "26", clientVersion: "7.01.05", hl: "en" };

interface TimedLine {
  lyricLine?: string;
  cueRange?: { startTimeMilliseconds: string; endTimeMilliseconds: string };
}

export async function ytmusic(query: SearchQuery, fetch: Fetch): Promise<LyricResult | null> {
  const post = (endpoint: string, body: object) =>
    getJson<unknown>(fetch, `${API}/${endpoint}?prettyPrint=false`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com" },
      body: JSON.stringify(body),
    });

  const next = await post("next", { videoId: query.videoId, context: { client: WEB_CLIENT } });
  const browseId = findLyricsBrowseId(next);
  if (!browseId) return null;

  const browse = (await post("browse", { browseId, context: { client: MOBILE_CLIENT } })) as Record<string, any>;
  const result: LyricResult = { title: query.title, artists: [query.artist] };

  const timed = findDeep(browse, (node) => Array.isArray(node.timedLyricsData))?.timedLyricsData as
    | TimedLine[]
    | undefined;
  if (timed?.length) {
    if (timed.every((line) => line.cueRange)) {
      const lines: LyricLine[] = timed.map((line) => {
        const text = (line.lyricLine ?? "").trim();
        return {
          startMs: Number(line.cueRange!.startTimeMilliseconds),
          endMs: Number(line.cueRange!.endTimeMilliseconds),
          text: text === "♪" ? "" : text,
        };
      });
      result.lines = finishLines(lines, query.durationSeconds * 1000);
    } else {
      result.plain = timed.map((line) => line.lyricLine ?? "").join("\n");
    }
    return result;
  }

  const shelf = findDeep(browse, (node) => !!node.musicDescriptionShelfRenderer)?.musicDescriptionShelfRenderer;
  const text = runsText(shelf?.description);
  if (!text?.trim()) return null;
  result.plain = text;
  return result;
}

function findLyricsBrowseId(next: unknown): string | undefined {
  const endpoint = findDeep(
    next,
    (node) =>
      node.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ===
      "MUSIC_PAGE_TYPE_TRACK_LYRICS",
  );
  return endpoint?.browseEndpoint?.browseId;
}

function runsText(value: any): string | undefined {
  return Array.isArray(value?.runs) ? value.runs.map((run: { text?: string }) => run.text ?? "").join("") : undefined;
}

/** Depth-first search for the first object matching `predicate` (InnerTube shapes shift a lot). */
function findDeep(root: unknown, predicate: (node: Record<string, any>) => boolean): Record<string, any> | undefined {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (!Array.isArray(node) && predicate(node as Record<string, any>)) return node as Record<string, any>;
    const values = Object.values(node);
    for (let i = values.length - 1; i >= 0; i--) stack.push(values[i]);
  }
}
