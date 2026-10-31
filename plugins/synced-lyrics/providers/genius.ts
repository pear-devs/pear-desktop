// Genius: unsynced but broad coverage. The lyrics come from the song page's
// preloaded state (Genius has no public lyrics API).

import { artistSimilarity, titleSimilarity } from "../match.ts";
import type { LyricResult, SearchQuery } from "../types.ts";
import { getJson, request, type Fetch } from "./http.ts";

const BASE = "https://genius.com";
const STATE = /__PRELOADED_STATE__ = JSON\.parse\('(.*?)'\);/;
const BODY_HTML = /body":\{"html":"(.*?)","children"/;

interface Hit {
  result: {
    title: string;
    path: string;
    instrumental?: boolean;
    primary_artist: { name: string; url: string };
    primary_artists?: { name: string }[];
  };
}

export async function genius(query: SearchQuery, fetch: Fetch): Promise<LyricResult | null> {
  const params = new URLSearchParams({ q: `${query.artist} ${query.title}`, per_page: "10" });
  const data = await getJson<{ response?: { sections?: { hits?: Hit[] }[] } }>(fetch, `${BASE}/api/search/song?${params}`);
  const hits = data.response?.sections?.[0]?.hits ?? [];

  const minArtist = query.inexact ? 0.75 : 0.85;
  const scored = hits
    .map((hit) => ({
      hit,
      title: titleSimilarity(hit.result.title, query.title),
      artist: artistSimilarity(hit.result.primary_artist.name, query.artist),
    }))
    .filter(({ hit, title, artist }) => title >= 0.85 && artist >= minArtist && !hit.result.instrumental)
    .sort((a, b) => b.title + b.artist - (a.title + a.artist));
  const best = scored[0]?.hit.result;
  if (!best || best.primary_artist.url.endsWith("/Deleted-artist")) return null;

  const html = await (await request(fetch, `${BASE}${best.path}`)).text();
  const plain = extractLyrics(html);
  if (!plain || /^\[?instrumental\]?$/i.test(plain.trim())) return null;
  return {
    title: best.title,
    artists: best.primary_artists?.map((a) => a.name) ?? [best.primary_artist.name],
    plain,
  };
}

export function extractLyrics(page: string): string | undefined {
  const state = STATE.exec(page)?.[1]?.replace(/\\"/g, '"');
  const body = state
    ? BODY_HTML.exec(state)?.[1]
        ?.replace(/\\\//g, "/")
        .replace(/\\\\/g, "\\")
        .replace(/\\n/g, "\n")
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
    : undefined;
  if (!body) return;
  return decodeEntities(body.replace(/<br\s*\/?>\n?/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(text: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}
