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

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });

const savedSecretSchema = z.object({
  secret: z.string(),
  version: z.string().optional(),
  expires: z.number(),
});

class MusixMatchAPI {
  private readonly baseUrl = 'https://www.musixmatch.com/ws/1.1/';
  private readonly defaultAppId = 'mxm-com-v1.0';
  private readonly secretKey = 'ytm:synced-lyrics:mxm:secret';

  private secret: { secret: string; version?: string } | null = null;
  private secretPromise: Promise<{ secret: string; version?: string }> | null =
    null;

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
    retry = true,
  ): Promise<z.infer<S> | undefined> {
    const { secret, version } = await this.getSecret();

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

    const [status, json] = await withTimeout(
      netFetch(signedUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': this.baseUrl.replace('ws/1.1/', ''),
          ...(version ? { 'x-mxm-app-version': version } : {}),
        },
      }),
      20_000,
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
      if (retry) {
        // the signing key might have been rotated, fetch it again once
        this.secret = null;
        this.secretPromise = null;
        localStorage.removeItem(this.secretKey);
        return this.query(endpoint, params, schema, false);
      }

      throw new Error(
        `MusixMatch rejected the request (status ${header.status_code}). If this keeps happening, log in again from the synced-lyrics plugin menu.`,
      );
    }

    // 404 and friends: nothing found
    if (header.status_code !== 200) return undefined;

    const data = schema.safeParse(body);
    // the api answers with an empty array/string when there is no data
    if (!data.success) return undefined;
    return data.data;
  }

  private getSecret() {
    if (this.secret) return Promise.resolve(this.secret);

    this.secretPromise ??= this.loadSecret().then(
      (secret) => (this.secret = secret),
      (error) => {
        this.secretPromise = null;
        throw error;
      },
    );
    return this.secretPromise;
  }

  private async loadSecret() {
    try {
      const saved = savedSecretSchema.parse(
        JSON.parse(localStorage.getItem(this.secretKey) ?? 'null'),
      );
      if (saved.expires > Date.now()) return saved;
    } catch {
      // nothing saved, or invalid
    }

    const [, html] = await withTimeout(
      netFetch('https://www.musixmatch.com/search', {
        headers: { 'User-Agent': USER_AGENT, 'Cookie': 'mxm_bab=AB' },
      }),
      20_000,
      'MusixMatch initialization timed out',
    );

    const appPath = [
      ...html.matchAll(
        /src="([^"]*\/_next\/static\/chunks\/pages\/_app-[^"]+\.js)"/g,
      ),
    ].at(-1)?.[1];
    if (!appPath) throw new Error('MusixMatch: could not find the app script');

    const appUrl = new URL(appPath, 'https://www.musixmatch.com/').toString();
    const [, js] = await withTimeout(
      netFetch(appUrl, { headers: { 'User-Agent': USER_AGENT } }),
      20_000,
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
    return result;
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
