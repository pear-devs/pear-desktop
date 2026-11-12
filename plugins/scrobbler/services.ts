// Last.fm and ListenBrainz API calls. `fetch` is injected (Electron's net.fetch
// in the app) so this stays testable.

import { createHash } from "node:crypto";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface Listen {
  title: string;
  artist: string;
  album?: string;
  durationSeconds: number;
  url: string;
  /** Unix milliseconds the play started. */
  startedAt: number;
}

export class LastFmError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/** Last.fm error codes after which the session has to be re-authorized (authentication failed, invalid session). */
export const LASTFM_REAUTH_CODES: ReadonlySet<number> = new Set([4, 9]);

export interface LastFmCredentials {
  apiRoot: string;
  apiKey: string;
  secret: string;
}

/** api_sig: md5 of the sorted key/value pairs (except format) followed by the secret. */
export function lastFmSignature(params: Record<string, string>, secret: string) {
  const base = Object.keys(params)
    .filter((key) => key !== "format" && key !== "callback")
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");
  return createHash("md5").update(`${base}${secret}`, "utf8").digest("hex");
}

export async function lastFmCall<T>(
  fetch: Fetch,
  credentials: LastFmCredentials,
  params: Record<string, string>,
  method: "GET" | "POST" = "GET",
): Promise<T> {
  const signed = { ...params, api_key: credentials.apiKey };
  const body = new URLSearchParams({ ...signed, api_sig: lastFmSignature(signed, credentials.secret), format: "json" });
  const response =
    method === "GET"
      ? await fetch(`${credentials.apiRoot}?${body}`)
      : await fetch(credentials.apiRoot, { method: "POST", body });
  const json = (await response.json().catch(() => ({}))) as { error?: number; message?: string };
  if (json.error) throw new LastFmError(json.error, json.message ?? `Last.fm error ${json.error}`);
  if (!response.ok) throw new LastFmError(0, `Last.fm responded ${response.status}`);
  return json as T;
}

export function lastFmTrackParams(listen: Listen): Record<string, string> {
  return {
    track: listen.title,
    artist: listen.artist,
    ...(listen.album ? { album: listen.album } : {}),
    ...(listen.durationSeconds > 0 ? { duration: String(Math.round(listen.durationSeconds)) } : {}),
  };
}

export const lastFm = {
  getToken: (fetch: Fetch, c: LastFmCredentials) =>
    lastFmCall<{ token: string }>(fetch, c, { method: "auth.getToken" }).then((r) => r.token),
  getSession: (fetch: Fetch, c: LastFmCredentials, token: string) =>
    lastFmCall<{ session: { key: string; name: string } }>(fetch, c, { method: "auth.getSession", token }).then(
      (r) => r.session,
    ),
  updateNowPlaying: (fetch: Fetch, c: LastFmCredentials, sessionKey: string, listen: Listen) =>
    lastFmCall(fetch, c, { method: "track.updateNowPlaying", sk: sessionKey, ...lastFmTrackParams(listen) }, "POST"),
  scrobble: (fetch: Fetch, c: LastFmCredentials, sessionKey: string, listen: Listen) =>
    lastFmCall(
      fetch,
      c,
      {
        method: "track.scrobble",
        sk: sessionKey,
        timestamp: String(Math.floor(listen.startedAt / 1000)),
        ...lastFmTrackParams(listen),
      },
      "POST",
    ),
  authUrl: (apiKey: string, token: string) =>
    `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`,
};

export function listenBrainzBody(type: "playing_now" | "single", listen: Listen) {
  return {
    listen_type: type,
    payload: [
      {
        ...(type === "single" ? { listened_at: Math.floor(listen.startedAt / 1000) } : {}),
        track_metadata: {
          artist_name: listen.artist,
          track_name: listen.title,
          ...(listen.album ? { release_name: listen.album } : {}),
          additional_info: {
            media_player: "Pear Desktop",
            submission_client: "Pear Desktop scrobbler plugin",
            origin_url: listen.url,
            music_service: "music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com",
            ...(listen.durationSeconds > 0 ? { duration: Math.round(listen.durationSeconds) } : {}),
          },
        },
      },
    ],
  };
}

export async function listenBrainzSubmit(
  fetch: Fetch,
  apiRoot: string,
  token: string,
  type: "playing_now" | "single",
  listen: Listen,
) {
  const root = apiRoot.endsWith("/") ? apiRoot : `${apiRoot}/`;
  const response = await fetch(`${root}submit-listens`, {
    method: "POST",
    headers: { Authorization: `Token ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(listenBrainzBody(type, listen)),
  });
  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(`ListenBrainz responded ${response.status}${error ? `: ${error}` : ""}`);
  }
}
