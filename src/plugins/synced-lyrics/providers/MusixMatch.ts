import * as z from 'zod';

import { LRC } from '../parsers/lrc';
import { electronTransport } from '../search/electron-transport';
import { lyricsHttp, LyricsError } from '../search/http';
import { variantDigest } from '../search/identity';

import type {
  LyricProvider,
  LyricCandidate,
  SearchSongInfo,
  SearchContext,
} from '../types';

export class MusixMatch implements LyricProvider {
  name = 'MusixMatch';
  baseUrl = 'https://www.musixmatch.com/';

  async search(
    info: SearchSongInfo,
    context?: SearchContext,
  ): Promise<LyricCandidate[]> {
    // Per-search initialization avoids sharing an aborted token request with a new track.
    const api = await MusixMatchAPI.new(context?.signal);

    const data = await api.query(Endpoint.getMacroSubtitles, {
      q_track: info.alternativeTitle || info.title,
      q_artist: info.artist,
      q_duration: info.songDuration.toString(),
      ...(info.album ? { q_album: info.album } : {}),
      namespace: 'lyrics_richsynched',
      subtitle_format: 'lrc',
    });

    const { macro_calls: macroCalls } = data.body;

    // prettier-ignore
    const getter = <T extends keyof typeof macroCalls>(key: T): typeof macroCalls[T]['message']['body'] => macroCalls[key].message.body;

    const track = getter('matcher.track.get')?.track;
    const lyrics = getter('track.lyrics.get')?.lyrics?.lyrics_body;
    const subtitles = getter('track.subtitles.get')?.subtitle_list ?? [];
    if (!track) return [];
    const variants = subtitles.length
      ? subtitles.map(({ subtitle }) => subtitle)
      : [undefined];
    const candidates = await Promise.all(
      variants.map(async (subtitle): Promise<LyricCandidate> => {
        const synced = subtitle
          ? LRC.parse(
              subtitle.subtitle_body,
              (track.track_length ?? info.songDuration) * 1000,
            )
          : undefined;
        const variantId = subtitle
          ? String(
              subtitle.subtitle_id ??
                (await variantDigest(
                  `${subtitle.subtitle_language ?? 'unknown'}:${subtitle.subtitle_body}`,
                )),
            )
          : 'plain';
        return {
          provider: this.name,
          sourceId: String(track.track_id),
          id: `${track.track_id}:${variantId}`,
          album: track.album_name,
          durationMs:
            track.track_length === undefined
              ? undefined
              : track.track_length * 1000,
          language: subtitle?.subtitle_language,
          result: {
            title: track.track_name,
            artists: [track.artist_name],
            syncLevel: synced?.syncLevel ?? 'plain',
            lines: synced?.lines,
            lyrics,
          },
        };
      }),
    );
    context?.signal.throwIfAborted();
    return candidates.filter(
      (candidate, index) =>
        candidates.findIndex((other) => other.id === candidate.id) === index,
    );
  }
}

// API Implementation, based on https://github.com/spicetify/cli/blob/master/CustomApps/lyrics-plus/ProviderMusixmatch.js

const Track = z.object({
  track_id: z.number(),
  track_name: z.string(),
  artist_name: z.string(),
  album_name: z.string().optional(),
  track_length: z.number().nonnegative().optional(),
});

const Lyrics = z.object({
  lyrics_body: z.string(),
});

const Subtitle = z.object({
  subtitle_body: z.string(),
  subtitle_id: z.number().optional(),
  subtitle_language: z.string().optional(),
});

enum Endpoint {
  getMacroSubtitles = 'macro.subtitles.get',
}

type Query = {
  q_track?: string;
  q_artist?: string;
  q_album?: string;
  q_duration?: string;
};

type Params = {
  [Endpoint.getMacroSubtitles]: Query & {
    namespace: 'lyrics_richsynched';
    subtitle_format: 'lrc';
  };
};

const ResponseSchema = {
  [Endpoint.getMacroSubtitles]: z.object({
    macro_calls: z.object({
      'track.lyrics.get': z.object({
        message: z.object({
          body: z
            .object({ lyrics: Lyrics })
            .or(
              z
                .instanceof(Array)
                .describe('default response for 404 status')
                .transform(() => undefined)
                .or(z.string().transform(() => undefined)),
            )
            .optional(),
        }),
      }),
      'track.subtitles.get': z.object({
        message: z.object({
          body: z
            .object({
              subtitle_list: z.array(z.object({ subtitle: Subtitle })),
            })
            .or(
              z
                .instanceof(Array)
                .describe('default response for 404 status')
                .transform(() => undefined)
                .or(z.string().transform(() => undefined)),
            )

            .optional(),
        }),
      }),
      'matcher.track.get': z.object({
        message: z.object({
          body: z
            .object({ track: Track })
            .or(
              z
                .instanceof(Array)
                .describe('default response for 404 status')
                .transform(() => undefined)
                .or(z.string().transform(() => undefined)),
            )
            .optional(),
        }),
      }),
    }),
  }),
} as const;

class MusixMatchAPI {
  private token: string | null = null;

  private constructor(private signal?: AbortSignal) {}

  public static async new(signal?: AbortSignal) {
    const api = new MusixMatchAPI(signal);
    await api.init();
    return api;
  }

  // god I love typescript generics, they're so useful
  public async query<
    T extends Endpoint,
    R = {
      header: { status_code: number };
      body: T extends keyof typeof ResponseSchema
        ? z.infer<(typeof ResponseSchema)[T]>
        : unknown;
    },
  >(endpoint: T, params: Params[T], refreshed = false): Promise<R> {
    this.signal?.throwIfAborted();
    if (!this.token) throw new LyricsError('auth', 'Token not initialized');

    const url = `${this.baseUrl}${endpoint}`;

    const clonedParams = new URLSearchParams(
      Object.assign(
        {
          app_id: this.app_id,
          format: 'json',
          usertoken: this.token,
        },
        <Record<string, string>>params,
      ),
    );

    const response = await lyricsHttp.json<unknown>(`${url}?${clonedParams}`, {
      headers: this.headers,
      signal: this.signal,
      transport: electronTransport,
    });
    // prettier-ignore
    if (
      response && typeof response === 'object' &&
      'message' in response && response.message && typeof response.message === 'object' &&
      'header' in response.message && response.message.header && typeof response.message.header === 'object' &&
      'status_code' in response.message.header && typeof response.message.header.status_code === 'number' &&
      response.message.header.status_code === 401
    ) {
      if (refreshed) throw new LyricsError('auth', 'MusixMatch rejected refreshed token');
      localStorage.removeItem(this.key);
      await this.init();
      return this.query(endpoint, params, true);
    }

    const parsed = z
      .object({
        message: z.object({ body: ResponseSchema[endpoint] }),
      })
      .safeParse(response);

    if (!parsed.success) {
      throw new LyricsError(
        'parse/schema',
        'Failed to parse response from MusixMatch API',
      );
    }

    return parsed.data.message as R;
  }

  private savedTokenSchema = z.union([
    z.object({
      token: z.literal(null),
      expires: z.number().optional(),
    }),
    z.object({
      token: z.string(),
      expires: z.number(),
    }),
  ]);

  private key = 'ytm:synced-lyrics:mxm:token';
  private async init() {
    this.signal?.throwIfAborted();
    let saved: unknown;
    try {
      saved = JSON.parse(localStorage.getItem(this.key) ?? '{ "token": null }');
    } catch {
      saved = null;
    }
    const parsed = this.savedTokenSchema.safeParse(saved);
    const { token, expires } = parsed.success
      ? parsed.data
      : { token: null, expires: undefined };
    if (token && expires > Date.now()) {
      this.token = token;
      return;
    }

    localStorage.removeItem(this.key);

    this.token = await this.getToken();
    this.signal?.throwIfAborted();
    if (!this.token) throw new LyricsError('auth', 'Failed to get token');

    localStorage.setItem(
      this.key,
      JSON.stringify({ token: this.token, expires: Date.now() + 60_000 }),
    );
  }

  private tokenSchema = z.object({
    message: z.object({
      body: z
        .object({
          user_token: z.string(),
        })
        .optional(),
    }),
  });
  private async getToken() {
    const endpoint = 'token.get';
    const params = new URLSearchParams({ app_id: this.app_id });
    const {
      message: { body },
    } = await lyricsHttp.json(
      `${this.baseUrl}${endpoint}?${params}`,
      {
        headers: this.headers,
        signal: this.signal,
        transport: electronTransport,
      },
      (value) => this.tokenSchema.parse(value),
    );
    return body?.user_token ?? '';
  }

  private readonly baseUrl = 'https://apic-appmobile.musixmatch.com/ws/1.1/';
  private readonly app_id = 'mac-ios-v2.0';
  private readonly headers = {
    'authority': 'apic-appmobile.musixmatch.com',
    'X-Cookie': 'x-mxm-token-guid=',
    'x-mxm-app-version': '10.1.1',
    'X-User-Agent': 'Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'application/json',
  } as const;
}
