import * as z from 'zod';

import { LRC } from '../parsers/lrc';
import { netFetch } from '../renderer';
import { config } from '../renderer/renderer';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

// How far (in seconds) the duration of a MusixMatch track may differ from the playing song.
const DURATION_TOLERANCE = 10;

// How long the signing key is cached (6 hours)
const SECRET_TTL = 6 * 3_600_000;

// MusixMatch honeypot/fallback tracks
// 115264642: Coldplay - Paradise
// 226291677: Drake - NOKIA (honeypot dummy lyrics)
const HONEYPOT_TRACKS = new Set([115264642, 226291677]);

export class MusixMatch implements LyricProvider {
  name = 'MusixMatch';
  baseUrl = 'https://www.musixmatch.com/';

  private api = new MusixMatchAPI();

  async search(info: SearchSongInfo): Promise<LyricResult | null> {
    if (!config()?.musixmatchToken) {
      throw new Error(
        'MusixMatch needs a login. Open the synced-lyrics plugin menu > MusixMatch account > Log in...',
      );
    }

    const tracks = await this.api.searchTracks({
      q_track: info.alternativeTitle || info.title,
      q_artist: info.artist,
    });

    const track = pickTrack(tracks, info.songDuration);
    if (!track) return null;

    const [subtitle, lyrics] = await Promise.all([
      track.has_subtitles
        ? this.api.getSubtitle(track.track_id)
        : Promise.resolve(undefined),
      track.has_lyrics
        ? this.api.getLyrics(track.track_id)
        : Promise.resolve(undefined),
    ]);

    if (!subtitle && !lyrics) return null;

    return {
      title: track.track_name,
      artists: [track.artist_name],
      lines: subtitle
        ? LRC.parse(subtitle).lines.map((l) => ({
            ...l,
            status: 'upcoming' as const,
          }))
        : undefined,
      lyrics,
    };
  }
}

const Track = z.object({
  track_id: z.number(),
  track_name: z.string(),
  artist_name: z.string(),
  track_length: z.number().optional(),
  instrumental: z.number().optional(),
  has_lyrics: z.number().optional(),
  has_subtitles: z.number().optional(),
});
type Track = z.infer<typeof Track>;

const pickTrack = (tracks: Track[], duration: number): Track | undefined => {
  const candidates = tracks
    .filter(
      (t) =>
        !HONEYPOT_TRACKS.has(t.track_id) &&
        !t.instrumental &&
        (t.has_lyrics || t.has_subtitles),
    )
    .map((track) => ({
      track,
      diff:
        duration > 0 && track.track_length
          ? Math.abs(track.track_length - duration)
          : 0,
    }))
    .filter(({ diff }) => diff <= DURATION_TOLERANCE)
    // synced lyrics first, then the closest duration
    .sort(
      (a, b) =>
        Number(!!b.track.has_subtitles) - Number(!!a.track.has_subtitles) ||
        a.diff - b.diff,
    );

  return candidates[0]?.track;
};

// API Implementation, based on https://github.com/Strvm/musicxmatch-api/blob/main/src/musicxmatch_api/main.py
// Requests are signed (HMAC-SHA256) with a key that is shipped inside the website's own javascript.

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT = 20_000;

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });

/**
 * Sends a request through the main process.
 *
 * An AbortSignal cannot cross the IPC bridge, so the main process aborts the request itself
 * after `REQUEST_TIMEOUT` (see `backend.ts`). The timer here is only a backstop for when the
 * main process does not answer at all: when it fires, the underlying request is NOT cancelled
 * and may keep running in the background until the main process finishes with it.
 */
const request = async (
  url: string,
  init: RequestInit,
  timeoutMessage: string,
) => {
  try {
    return await withTimeout(
      netFetch(url, { ...init, timeout: REQUEST_TIMEOUT }),
      REQUEST_TIMEOUT + 5_000,
      timeoutMessage,
    );
  } catch (error) {
    // aborted by the main process (the IPC error message contains the original one)
    if (error instanceof Error && /TimeoutError|aborted/i.test(error.message)) {
      throw new Error(timeoutMessage, { cause: error });
    }
    throw error;
  }
};

const savedSecretSchema = z.object({
  secret: z.string(),
  version: z.string().optional(),
  expires: z.number(),
});

/**
 * The key used to sign requests.
 * `refreshed` is set when it was fetched because the previous one got rejected, such a key is not
 * replaced again before the api accepted it once (see `refreshSecret`).
 */
type Secret = { secret: string; version?: string; refreshed: boolean };

class MusixMatchAPI {
  private readonly baseUrl = 'https://www.musixmatch.com/ws/1.1/';
  private readonly defaultAppId = 'mxm-com-v1.0';
  private readonly secretKey = 'ytm:synced-lyrics:mxm:secret';

  private secret: Secret | null = null;
  private secretPromise: Promise<Secret> | null = null;

  public async searchTracks(query: { q_track: string; q_artist: string }) {
    const body = await this.query(
      'track.search',
      {
        ...query,
        f_has_lyrics: 'true',
        s_track_rating: 'desc',
        page_size: '10',
        page: '1',
      },
      z.object({ track_list: z.array(z.object({ track: Track })) }),
    );

    return body?.track_list.map((t) => t.track) ?? [];
  }

  public async getSubtitle(trackId: number) {
    const body = await this.query(
      'track.subtitles.get',
      { track_id: trackId.toString(), subtitle_format: 'lrc' },
      z.object({
        subtitle_list: z.array(
          z.object({ subtitle: z.object({ subtitle_body: z.string() }) }),
        ),
      }),
    );

    return body?.subtitle_list[0]?.subtitle.subtitle_body || undefined;
  }

  public async getLyrics(trackId: number) {
    const body = await this.query(
      'track.lyrics.get',
      { track_id: trackId.toString() },
      z.object({ lyrics: z.object({ lyrics_body: z.string() }) }),
    );

    return body?.lyrics.lyrics_body || undefined;
  }

  private async query<S extends z.ZodType>(
    endpoint: string,
    params: Record<string, string>,
    schema: S,
    retryWith?: Secret,
  ): Promise<z.infer<S> | undefined> {
    const used = retryWith ?? (await this.getSecret());
    const { secret, version } = used;

    const token = config()?.musixmatchToken;
    const url = `${this.baseUrl}${endpoint}?${new URLSearchParams({
      app_id: config()?.musixmatchAppId || this.defaultAppId,
      ...(token ? { usertoken: token } : {}),
      format: 'json',
      ...params,
    })}`;

    const signedUrl = `${url}&signature=${encodeURIComponent(
      await sign(url, secret),
    )}&signature_protocol=sha256`;

    const [status, json] = await request(
      signedUrl,
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': this.baseUrl.replace('ws/1.1/', ''),
          ...(version ? { 'x-mxm-app-version': version } : {}),
        },
      },
      'MusixMatch request timed out',
    );

    let response: unknown;
    try {
      response = JSON.parse(json);
    } catch {
      throw new Error(
        `MusixMatch returned an invalid response (HTTP ${status})`,
      );
    }

    const parsed = z
      .object({
        message: z.object({
          header: z.object({ status_code: z.number() }),
          body: z.unknown(),
        }),
      })
      .safeParse(response);

    if (!parsed.success) {
      console.error('Malformed response', response, parsed.error);
      throw new Error('Failed to parse response from MusixMatch API');
    }

    const { header, body } = parsed.data.message;
    if (header.status_code === 401 || header.status_code === 403) {
      // The status alone does not say what was rejected: the signing key, the app id or the
      // user token could each be the cause, so the saved token is never touched here.
      const next = await this.refreshSecret(used);
      if (next) return this.query(endpoint, params, schema, next);

      throw new Error(
        `MusixMatch rejected the request (status ${header.status_code}). The signing key, app id or login token may be the cause. If this keeps happening, try logging in again from the synced-lyrics plugin menu.`,
      );
    }

    // the secret was accepted, a later rejection may be a real key rotation again
    used.refreshed = false;

    // 404 and friends: nothing found
    if (header.status_code !== 200) return undefined;

    const data = schema.safeParse(body);
    // the api answers with an empty array/string when there is no data
    if (!data.success) return undefined;
    return data.data;
  }

  /**
   * Called when `rejected` was refused by the api. Fetches a new signing key, at most once per
   * generation: a key that was itself fetched because of a rejection is not refreshed again until
   * it has been accepted at least once, so a persistent rejection does not repeat the downloads.
   * Returns the secret to retry with, or `undefined` when the request should not be retried.
   */
  private refreshSecret(rejected: Secret): Promise<Secret | undefined> {
    if (rejected.refreshed) return Promise.resolve(undefined);

    if (this.secret === rejected) {
      this.secret = null;
      this.secretPromise = null;
      localStorage.removeItem(this.secretKey);
      return this.getSecret(true);
    }

    // another request already replaced the key (or is loading a new one right now)
    return this.getSecret();
  }

  private getSecret(force = false) {
    if (this.secret) return Promise.resolve(this.secret);

    this.secretPromise ??= this.loadSecret(force).then(
      (secret) => (this.secret = secret),
      (error) => {
        this.secretPromise = null;
        throw error;
      },
    );
    return this.secretPromise;
  }

  private async loadSecret(force: boolean): Promise<Secret> {
    if (!force) {
      try {
        const saved = savedSecretSchema.parse(
          JSON.parse(localStorage.getItem(this.secretKey) ?? 'null'),
        );
        if (saved.expires > Date.now()) {
          return {
            secret: saved.secret,
            version: saved.version,
            refreshed: false,
          };
        }
      } catch {
        // nothing saved, or invalid
      }
    }
    const [, html] = await request(
      'https://www.musixmatch.com/search',
      { headers: { 'User-Agent': USER_AGENT, 'Cookie': 'mxm_bab=AB' } },
      'MusixMatch initialization timed out',
    );

    const appPath = [
      ...html.matchAll(
        /src="([^"]*\/_next\/static\/chunks\/pages\/_app-[^"]+\.js)"/g,
      ),
    ].at(-1)?.[1];
    if (!appPath) throw new Error('MusixMatch: could not find the app script');

    const appUrl = new URL(appPath, 'https://www.musixmatch.com/').toString();
    const [, js] = await request(
      appUrl,
      { headers: { 'User-Agent': USER_AGENT } },
      'MusixMatch initialization timed out',
    );

    const encoded = /from\(\s*"(.*?)"\s*\.split/.exec(js)?.[1];
    if (!encoded) throw new Error('MusixMatch: could not find the signing key');

    const secret = atob(encoded.split('').reverse().join(''));
    const version = /\/prod\/([\d.]+)\//.exec(appUrl)?.[1];

    const result = {
      secret,
      version,
      expires: Date.now() + SECRET_TTL,
    };
    localStorage.setItem(this.secretKey, JSON.stringify(result));
    return { secret, version, refreshed: force };
  }
}

const sign = async (url: string, secret: string) => {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(url + date),
  );

  return btoa(String.fromCharCode(...new Uint8Array(signature)));
};
