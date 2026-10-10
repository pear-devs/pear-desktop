import { createRoute, z } from '@hono/zod-openapi';

import { getSongControls } from '@/providers/song-controls';

import { API_VERSION } from '../api-version';
import {
  BrowseSchema,
  CommentsQuerySchema,
  CommentsResponseSchema,
  HomeQuerySchema,
  LyricsResponseSchema,
  PlayPlaylistSchema,
  PlaySongSchema,
  SongDetailsQuerySchema,
  StartRadioSchema,
} from '../scheme';
import {
  getComments,
  getLyricsBrowseId,
  getRelatedBrowseId,
  getWatchNext,
  parseLyrics,
} from '../youtube';

import type { APIServerConfig } from '../../config';
import type { HonoApp } from '../types';
import type { SongInfo } from '@/providers/song-info';
import type { BackendContext } from '@/types/contexts';
import type { Context, MiddlewareHandler } from 'hono';

// A zero-byte `application/json` body would fail JSON parsing before the
// optional body's default applies, so treat it as an absent body (`{}`)
const emptyBodyAsAbsent: MiddlewareHandler = async (ctx, next) => {
  if ((await ctx.req.text()).trim() === '') {
    // bodyCache holds promises at runtime, despite its typing
    (ctx.req.bodyCache as { text?: Promise<string> }).text =
      Promise.resolve('{}');
  }
  await next();
};

// Same params YouTube Music uses for "Start radio" / "Shuffle"
const RADIO_PARAMS = 'wAEB';
const SHUFFLE_PARAMS = 'wAEB8gECKAE%3D';

const ErrorSchema = z.object({ error: z.string() });

const errorResponses = {
  400: {
    description: 'No song is playing and no videoId was given',
    content: { 'application/json': { schema: ErrorSchema } },
  },
  502: {
    description: 'YouTube Music request failed',
    content: { 'application/json': { schema: ErrorSchema } },
  },
  503: {
    description: 'YouTube Music is not ready to start playback',
    content: { 'application/json': { schema: ErrorSchema } },
  },
};

const rawResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: z.object({}),
    },
  },
});

const routes = {
  home: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/home`,
    summary: 'get home page',
    description:
      'Get the YouTube Music home page (raw response, like the search endpoint). Use the continuation token to load more shelves.',
    request: {
      query: HomeQuerySchema,
    },
    responses: {
      200: rawResponse('Success'),
      502: errorResponses[502],
    },
  }),
  browse: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/browse`,
    summary: 'browse a page',
    description:
      'Get any YouTube Music browse page: explore, charts, moods & genres, new releases, library, artists, albums, playlists… (raw response)',
    request: {
      body: {
        description: 'browse id of the page',
        content: {
          'application/json': {
            schema: BrowseSchema,
          },
        },
      },
    },
    responses: {
      200: rawResponse('Success'),
      502: errorResponses[502],
    },
  }),
  playSong: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/play-song`,
    summary: 'play a song',
    description:
      'Play a song now, replacing the current queue (like clicking a song in YouTube Music)',
    request: {
      body: {
        description: 'video id of the song to play',
        content: {
          'application/json': {
            schema: PlaySongSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
      503: errorResponses[503],
    },
  }),
  playPlaylist: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/play-playlist`,
    summary: 'play a playlist or album',
    description: 'Play (or shuffle play) a playlist or album',
    request: {
      body: {
        description: 'id of the playlist to play',
        content: {
          'application/json': {
            schema: PlayPlaylistSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
      503: errorResponses[503],
    },
  }),
  startRadio: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/start-radio`,
    summary: 'start radio',
    description:
      'Start a radio based on a song (the current song by default) or a playlist, like "Start radio" in YouTube Music',
    middleware: [emptyBodyAsAbsent] as const,
    request: {
      body: {
        description: 'song or playlist to start the radio from',
        required: false,
        content: {
          'application/json': {
            schema: StartRadioSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
      400: errorResponses[400],
      503: errorResponses[503],
    },
  }),
  lyrics: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/song/lyrics`,
    summary: 'get lyrics',
    description:
      'Get the lyrics YouTube Music provides for a song (the current song by default)',
    request: {
      query: SongDetailsQuerySchema,
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: LyricsResponseSchema,
          },
        },
      },
      ...errorResponses,
    },
  }),
  related: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/song/related`,
    summary: 'get related content',
    description:
      'Get the "Related" tab of a song (the current song by default): similar songs, artists, playlists… (raw response)',
    request: {
      query: SongDetailsQuerySchema,
    },
    responses: {
      200: rawResponse('Success'),
      204: {
        description: 'No related content',
      },
      ...errorResponses,
    },
  }),
  comments: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/song/comments`,
    summary: 'get comments',
    description:
      'Get the comments of a song (the current song by default). Pass the returned continuation token to load the next page.',
    request: {
      query: CommentsQuerySchema,
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: CommentsResponseSchema,
          },
        },
      },
      ...errorResponses,
    },
  }),
};

type PromiseOrValue<T> = T | Promise<T>;

export const register = (
  app: HonoApp,
  { window }: BackendContext<APIServerConfig>,
  songInfoGetter: () => PromiseOrValue<SongInfo | undefined>,
) => {
  const controller = getSongControls(window);

  const resolveVideoId = async (videoId?: string) =>
    videoId ?? (await songInfoGetter())?.videoId;

  const noSongError = (ctx: Context) =>
    ctx.json({ error: 'No song is playing and no videoId was given' }, 400);
  const notReadyError = (ctx: Context) =>
    ctx.json({ error: 'YouTube Music is not ready to start playback' }, 503);
  const requestError = (ctx: Context, error: unknown) =>
    ctx.json(
      { error: error instanceof Error ? error.message : String(error) },
      502,
    );

  app.openapi(routes.home, async (ctx) => {
    const { continuation } = ctx.req.valid('query');
    try {
      const response = await controller.innertubeRequest('/browse', {
        browseId: 'FEmusic_home',
        continuation,
      });

      ctx.status(200);
      return ctx.json(response as object);
    } catch (error) {
      return requestError(ctx, error);
    }
  });

  app.openapi(routes.browse, async (ctx) => {
    const { browseId, params, continuation } = ctx.req.valid('json');
    try {
      const response = await controller.innertubeRequest('/browse', {
        browseId,
        params,
        continuation,
      });

      ctx.status(200);
      return ctx.json(response as object);
    } catch (error) {
      return requestError(ctx, error);
    }
  });

  app.openapi(routes.playSong, async (ctx) => {
    const { videoId, playlistId } = ctx.req.valid('json');
    const dispatched = await controller.playEndpoint({
      watchEndpoint: { videoId, playlistId },
    });
    if (!dispatched) return notReadyError(ctx);

    ctx.status(204);
    return ctx.body(null);
  });

  app.openapi(routes.playPlaylist, async (ctx) => {
    const { playlistId, videoId, shuffle } = ctx.req.valid('json');
    const params = shuffle ? SHUFFLE_PARAMS : undefined;
    const dispatched = await controller.playEndpoint(
      videoId
        ? { watchEndpoint: { videoId, playlistId, params } }
        : { watchPlaylistEndpoint: { playlistId, params } },
    );
    if (!dispatched) return notReadyError(ctx);

    ctx.status(204);
    return ctx.body(null);
  });

  app.openapi(routes.startRadio, async (ctx) => {
    const { videoId, playlistId } = ctx.req.valid('json') ?? {};

    let dispatched: boolean;
    if (playlistId && !videoId) {
      dispatched = await controller.playEndpoint({
        watchPlaylistEndpoint: {
          playlistId: `RDAMPL${playlistId}`,
          params: RADIO_PARAMS,
        },
      });
    } else {
      const radioVideoId = await resolveVideoId(videoId);
      if (!radioVideoId) return noSongError(ctx);

      dispatched = await controller.playEndpoint({
        watchEndpoint: {
          videoId: radioVideoId,
          playlistId: `RDAMVM${radioVideoId}`,
          params: RADIO_PARAMS,
        },
      });
    }
    if (!dispatched) return notReadyError(ctx);

    ctx.status(204);
    return ctx.body(null);
  });

  app.openapi(routes.lyrics, async (ctx) => {
    const videoId = await resolveVideoId(ctx.req.valid('query').videoId);
    if (!videoId) return noSongError(ctx);

    try {
      const watchNext = await getWatchNext(
        controller.innertubeRequest,
        videoId,
      );
      const browseId = getLyricsBrowseId(watchNext);
      const lyrics = browseId
        ? parseLyrics(
            await controller.innertubeRequest('/browse', { browseId }),
          )
        : null;

      return ctx.json(
        {
          videoId,
          lyrics: lyrics?.lyrics ?? null,
          source: lyrics?.source ?? null,
        },
        200,
      );
    } catch (error) {
      return requestError(ctx, error);
    }
  });

  app.openapi(routes.related, async (ctx) => {
    const videoId = await resolveVideoId(ctx.req.valid('query').videoId);
    if (!videoId) return noSongError(ctx);

    try {
      const watchNext = await getWatchNext(
        controller.innertubeRequest,
        videoId,
      );
      const browseId = getRelatedBrowseId(watchNext);
      if (!browseId) {
        ctx.status(204);
        return ctx.body(null);
      }

      const response = await controller.innertubeRequest('/browse', {
        browseId,
      });

      ctx.status(200);
      return ctx.json(response as object);
    } catch (error) {
      return requestError(ctx, error);
    }
  });

  app.openapi(routes.comments, async (ctx) => {
    const { continuation, sort } = ctx.req.valid('query');
    const videoId = await resolveVideoId(ctx.req.valid('query').videoId);
    if (!videoId) return noSongError(ctx);

    try {
      const comments = await getComments(controller.innertubeRequest, videoId, {
        continuation,
        sort,
      });

      return ctx.json(comments, 200);
    } catch (error) {
      return requestError(ctx, error);
    }
  });
};
