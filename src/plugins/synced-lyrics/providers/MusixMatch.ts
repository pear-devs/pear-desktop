import * as z from 'zod';

import { LRC } from '../parsers/lrc';
import { netFetch } from '../renderer';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

export class MusixMatch implements LyricProvider {
  name = 'MusixMatch';
  baseUrl = 'https://www.musixmatch.com/';

  private api: MusixMatchAPI | undefined;

  async search(info: SearchSongInfo): Promise<LyricResult | null> {
    // late-init the API, to avoid an electron IPC issue
    // an added benefit is that if it has an error during init, the user can hit the retry button
    this.api ??= await MusixMatchAPI.new();
    await this.api.reinit();

    const data = await this.api.query(Endpoint.getMacroSubtitles, {
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
    const subtitle = getter('track.subtitles.get')?.subtitle_list?.[0];

    // either no track found, or musixmatch's algorithm returned "Coldplay - Paradise" for no reason whatsoever
    if (!track || track.track_id === 115264642) return null;

    const synced = subtitle
      ? LRC.parse(subtitle.subtitle.subtitle_body, info.songDuration * 1000)
      : undefined;
    return {
      title: track.track_name,
      artists: [track.artist_name],
      syncLevel: synced?.syncLevel ?? 'plain',
      lines: synced?.lines,
      lyrics: lyrics,
    };
  }
}

// API Implementation, based on https://github.com/spicetify/cli/blob/master/CustomApps/lyrics-plus/ProviderMusixmatch.js

const Track = z.object({
  track_id: z.number(),
  track_name: z.string(),
  artist_name: z.string(),
});

const Lyrics = z.object({
  lyrics_body: z.string(),
});

const Subtitle = z.object({
  subtitle_body: z.string(),
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
  private initPromise: Promise<void>;
  private token: string | null = null;

  private constructor() {
    this.initPromise = this.init();
  }

  public static async new() {
    const api = new MusixMatchAPI();
    await api.initPromise;
    return api;
  }

  public async reinit() {
    const [{ status }] = await Promise.allSettled([this.initPromise]);
    if (status === 'rejected') {
      localStorage.removeItem(this.key);
      this.initPromise = this.init();
      await this.initPromise;
    }
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
  >(endpoint: T, params: Params[T]): Promise<R> {
    await this.initPromise;
    if (!this.token) throw new Error('Token not initialized');

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

    const [, json] = await netFetch(`${url}?${clonedParams}`, {
      headers: this.headers,
    });

    const response = JSON.parse(json);
    // prettier-ignore
    if (
      response && typeof response === 'object' &&
      'message' in response && response.message && typeof response.message === 'object' &&
      'header' in response.message && response.message.header && typeof response.message.header === 'object' &&
      'status_code' in response.message.header && typeof response.message.header.status_code === 'number' &&
      response.message.header.status_code === 401
    ) {
      await this.reinit();
      return this.query(endpoint, params);
    }

    const parsed = z
      .object({
        message: z.object({ body: ResponseSchema[endpoint] }),
      })
      .safeParse(response);

    if (!parsed.success) {
      console.error('Malformed response', response, parsed.error);
      throw new Error('Failed to parse response from MusixMatch API');
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
    const { token, expires } = this.savedTokenSchema.parse(
      JSON.parse(localStorage.getItem(this.key) ?? '{ "token": null }'),
    );
    if (token && expires > Date.now()) {
      this.token = token;
      return;
    }

    localStorage.removeItem(this.key);

    this.token = await this.getToken();
    if (!this.token) throw new Error('Failed to get token');

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
    const [, json] = await netFetch(`${this.baseUrl}${endpoint}?${params}`, {
      headers: this.headers,
    });

    const {
      message: { body },
    } = this.tokenSchema.parse(JSON.parse(json));
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
