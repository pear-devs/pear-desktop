// Musixmatch, through the API of its desktop app, like pear-desktop did
// (after Strvm/musicxmatch-api): `token.get` for a user token, then one
// `macro.subtitles.get` call for the matched track, its lyrics and its LRC.
//
// Musixmatch no longer gives that token to anonymous apps: token.get answers
// an all-zero token, and with it every query "matches" some other song with
// made-up syllables for lyrics (see test/fixtures). So that token is refused
// here, and a token from the user's own signed-in Musixmatch app can be set
// in the settings instead. Matches are also checked against the playing
// track, as Musixmatch's matcher always answers with *some* track.

import { parseLrc } from "../lrc.ts";
import { queryArtistSimilarity, queryTitleSimilarity } from "../match.ts";
import type { LyricResult, SearchQuery } from "../types.ts";
import { getJson, type Fetch } from "./http.ts";

const BASE = "https://apic-desktop.musixmatch.com/ws/1.1";
const APP_ID = "web-desktop-app-v1.0";
const HEADERS = { Cookie: "x-mxm-user-id=" };
/** How long an anonymous token (or the refusal of one) is reused. */
const TOKEN_TTL_MS = 10 * 60_000;
/** The matcher's fallback when it finds nothing (pear-desktop's note: "Coldplay - Paradise"). */
const FALLBACK_TRACK_ID = 115264642;
/** Appended to lyrics served to API clients. */
const DISCLAIMER = /\n*\*{3,}[^*]*\*{3,}\s*(\(\d+\))?\s*$/;

import type { Translate } from "@pear/sdk/i18n";

export interface MusixmatchOptions {
  /** The user's own token; empty: ask for an anonymous one. */
  userToken: string;
  t: Translate;
}

interface Header {
  status_code: number;
  hint?: string;
}

interface Envelope<B> {
  message?: { header?: Header; body?: B | unknown[] | string };
}

export interface MacroBody {
  macro_calls?: Record<string, Envelope<Record<string, any>>>;
}

/** An all-zero (or missing) token is what Musixmatch hands out instead of a real one. */
export const isUsableToken = (token: string | undefined): token is string => Boolean(token && !/^0+$/.test(token));

let anonymous: { token: Promise<string | undefined>; at: number } | undefined;

/** Forgets the cached anonymous token (tests, and after Musixmatch rejected it). */
export function resetMusixmatchToken() {
  anonymous = undefined;
}

export async function fetchToken(fetch: Fetch): Promise<string | undefined> {
  const data = await getJson<Envelope<{ user_token?: string }>>(fetch, `${BASE}/token.get?${new URLSearchParams({ app_id: APP_ID })}`, {
    headers: HEADERS,
  });
  const body = data.message?.body;
  return body && typeof body === "object" && !Array.isArray(body) ? body.user_token : undefined;
}

function anonymousToken(fetch: Fetch) {
  if (!anonymous || Date.now() - anonymous.at > TOKEN_TTL_MS) {
    const entry = { token: fetchToken(fetch), at: Date.now() };
    entry.token.catch(() => anonymous === entry && resetMusixmatchToken());
    anonymous = entry;
  }
  return anonymous.token;
}

export async function musixmatch(query: SearchQuery, fetch: Fetch, options: MusixmatchOptions): Promise<LyricResult | null> {
  const own = options.userToken.trim();
  const token = own || (await anonymousToken(fetch));
  if (!isUsableToken(token)) {
    throw new Error(
      options.t(
        "plugins.synced-lyrics.musixmatch.no-token",
        "Musixmatch only gives lyrics to signed-in apps: set a Musixmatch user token in the settings",
      ),
    );
  }

  const params = new URLSearchParams({
    app_id: APP_ID,
    format: "json",
    usertoken: token,
    // pear-desktop asked for the title in its original language when YTM has one.
    q_track: query.alternativeTitle || query.title,
    q_artist: query.artist,
    q_duration: String(Math.round(query.durationSeconds)),
    namespace: "lyrics_richsynched",
    subtitle_format: "lrc",
  });
  if (query.album) params.set("q_album", query.album);
  const data = await getJson<Envelope<MacroBody>>(fetch, `${BASE}/macro.subtitles.get?${params}`, { headers: HEADERS });

  const status = data.message?.header?.status_code;
  if (status === 401) {
    if (!own) resetMusixmatchToken();
    throw new Error(
      options.t("plugins.synced-lyrics.musixmatch.token-rejected", "Musixmatch rejected the user token (expired, or asking for a captcha)"),
    );
  }
  if (status !== 200) throw new Error(`Musixmatch answered ${status ?? "nothing"}`);
  return parseMacro(data, query);
}

const bodyOf = (envelope: Envelope<Record<string, any>> | undefined) => {
  const body = envelope?.message?.body;
  // Calls without a result answer an empty array or string instead of an object.
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, any>) : undefined;
};

/** The track, lyrics and LRC of a macro.subtitles.get answer, if it's the track asked for. */
export function parseMacro(data: Envelope<MacroBody>, query: SearchQuery): LyricResult | null {
  const body = data.message?.body;
  const calls = body && typeof body === "object" && !Array.isArray(body) ? (body as MacroBody).macro_calls : undefined;
  if (!calls) return null;
  const track = bodyOf(calls["matcher.track.get"])?.track as
    | { track_id: number; track_name: string; artist_name: string; instrumental?: number }
    | undefined;
  if (!track || track.track_id === FALLBACK_TRACK_ID || track.instrumental === 1) return null;
  const minArtist = query.inexact ? 0.75 : 0.85;
  if (queryTitleSimilarity(track.track_name, query) < 0.8 || queryArtistSimilarity(track.artist_name, query) < minArtist) return null;

  const lyrics = bodyOf(calls["track.lyrics.get"])?.lyrics as { lyrics_body?: string; instrumental?: number } | undefined;
  if (lyrics?.instrumental === 1) return null;
  const subtitle = bodyOf(calls["track.subtitles.get"])?.subtitle_list?.[0]?.subtitle as { subtitle_body?: string } | undefined;

  const lines = subtitle?.subtitle_body ? parseLrc(subtitle.subtitle_body, query.durationSeconds * 1000) : undefined;
  const plain = lyrics?.lyrics_body?.replace(DISCLAIMER, "").trim();
  if (!lines?.length && !plain) return null;
  const result: LyricResult = { title: track.track_name, artists: [track.artist_name] };
  if (lines?.length) result.lines = lines;
  if (plain) result.plain = plain;
  return result;
}
