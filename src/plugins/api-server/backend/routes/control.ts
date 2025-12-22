import { createRoute, z } from '@hono/zod-openapi';
import { ipcMain } from 'electron';

import { getSongControls } from '@/providers/song-controls';
import {
  LikeType,
  type RepeatMode,
  type VolumeState,
} from '@/types/datahost-get-state';

import {
  AddSongToQueueSchema,
  GoBackSchema,
  GoForwardScheme,
  MoveSongInQueueSchema,
  QueueParamsSchema,
  SearchSchema,
  SeekSchema,
  SetFullscreenSchema,
  SetQueueIndexSchema,
  SetVolumeSchema,
  SongInfoSchema,
  SwitchRepeatSchema,
  type ResponseSongInfo,
} from '../scheme';
import { API_VERSION } from '../api-version';

import type { SongInfo } from '@/providers/song-info';
import type { BackendContext } from '@/types/contexts';
import type { APIServerConfig } from '../../config';
import type { HonoApp } from '../types';
import type { QueueResponse } from '@/types/music-player-desktop-internal';
import type { Context } from 'hono';

const routes = {
  previous: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/previous`,
    summary: 'play previous song',
    description: 'Plays the previous song in the queue',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  next: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/next`,
    summary: 'play next song',
    description: 'Plays the next song in the queue',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  play: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/play`,
    summary: 'Play',
    description: 'Change the state of the player to play',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  pause: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/pause`,
    summary: 'Pause',
    description: 'Change the state of the player to pause',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  togglePlay: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/toggle-play`,
    summary: 'Toggle play/pause',
    description:
      'Change the state of the player to play if paused, or pause if playing',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  getLikeState: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/like-state`,
    summary: 'get like state',
    description: 'Get the current like state',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              state: z.enum(LikeType).nullable(),
            }),
          },
        },
      },
    },
  }),
  like: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/like`,
    summary: 'like song',
    description: 'Set the current song as liked',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  dislike: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/dislike`,
    summary: 'dislike song',
    description: 'Set the current song as disliked',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  seekTo: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/seek-to`,
    summary: 'seek',
    description: 'Seek to a specific time in the current song',
    request: {
      body: {
        description: 'seconds to seek to',
        content: {
          'application/json': {
            schema: SeekSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  goBack: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/go-back`,
    summary: 'go back',
    description: 'Move the current song back by a number of seconds',
    request: {
      body: {
        description: 'seconds to go back',
        content: {
          'application/json': {
            schema: GoBackSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),

  goForward: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/go-forward`,
    summary: 'go forward',
    description: 'Move the current song forward by a number of seconds',
    request: {
      body: {
        description: 'seconds to go forward',
        content: {
          'application/json': {
            schema: GoForwardScheme,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  getShuffleState: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/shuffle`,
    summary: 'get shuffle state',
    description: 'Get the current shuffle state',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              state: z.boolean().nullable(),
            }),
          },
        },
      },
    },
  }),
  shuffle: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/shuffle`,
    summary: 'shuffle',
    description: 'Shuffle the queue',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  repeatMode: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/repeat-mode`,
    summary: 'get current repeat mode',
    description: 'Get the current repeat mode (NONE, ALL, ONE)',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              mode: z.enum(['ONE', 'NONE', 'ALL']).nullable(),
            }),
          },
        },
      },
    },
  }),
  switchRepeat: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/switch-repeat`,
    summary: 'switch repeat',
    description: 'Switch the repeat mode',
    request: {
      body: {
        description: 'number of times to click the repeat button',
        content: {
          'application/json': {
            schema: SwitchRepeatSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  setVolume: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/volume`,
    summary: 'set volume',
    description: 'Set the volume of the player',
    request: {
      body: {
        description: 'volume to set',
        content: {
          'application/json': {
            schema: SetVolumeSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  getVolumeState: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/volume`,
    summary: 'get volume state',
    description: 'Get the current volume state of the player',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              state: z.number(),
              isMuted: z.boolean(),
            }),
          },
        },
      },
    },
  }),
  setFullscreen: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/fullscreen`,
    summary: 'set fullscreen',
    description: 'Set the fullscreen state of the player',
    request: {
      body: {
        description: 'fullscreen state',
        content: {
          'application/json': {
            schema: SetFullscreenSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  toggleMute: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/toggle-mute`,
    summary: 'toggle mute',
    description: 'Toggle the mute state of the player',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),

  getFullscreenState: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/fullscreen`,
    summary: 'get fullscreen state',
    description: 'Get the current fullscreen state',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              state: z.boolean(),
            }),
          },
        },
      },
    },
  }),
  oldQueueInfo: createRoute({
    deprecated: true,
    method: 'get',
    path: `/api/${API_VERSION}/queue-info`,
    summary: 'get current queue info',
    description: 'Get the current queue info',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({}),
          },
        },
      },
      204: {
        description: 'No queue info',
      },
    },
  }),
  oldSongInfo: createRoute({
    deprecated: true,
    method: 'get',
    path: `/api/${API_VERSION}/song-info`,
    summary: 'get current song info',
    description: 'Get the current song info',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: SongInfoSchema,
          },
        },
      },
      204: {
        description: 'No song info',
      },
    },
  }),
  songInfo: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/song`,
    summary: 'get current song info',
    description: 'Get the current song info',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: SongInfoSchema,
          },
        },
      },
      204: {
        description: 'No song info',
      },
    },
  }),
  nextSongInfo: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/queue/next`,
    summary: 'get next song info',
    description:
      'Get information about the next song in the queue (relative index +1)',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: SongInfoSchema,
          },
        },
      },
      204: {
        description: 'No next song in queue',
      },
    },
  }),
  queueInfo: createRoute({
    method: 'get',
    path: `/api/${API_VERSION}/queue`,
    summary: 'get current queue info',
    description: 'Get the current queue info',
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({}),
          },
        },
      },
      204: {
        description: 'No queue info',
      },
    },
  }),
  addSongToQueue: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/queue`,
    summary: 'add song to queue',
    description: 'Add a song to the queue',
    request: {
      body: {
        description: 'video id of the song to add',
        content: {
          'application/json': {
            schema: AddSongToQueueSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  moveSongInQueue: createRoute({
    method: 'patch',
    path: `/api/${API_VERSION}/queue/{index}`,
    summary: 'move song in queue',
    description: 'Move a song in the queue',
    request: {
      params: QueueParamsSchema,
      body: {
        description: 'index to move the song to',
        content: {
          'application/json': {
            schema: MoveSongInQueueSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  removeSongFromQueue: createRoute({
    method: 'delete',
    path: `/api/${API_VERSION}/queue/{index}`,
    summary: 'remove song from queue',
    description: 'Remove a song from the queue',
    request: {
      params: QueueParamsSchema,
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  setQueueIndex: createRoute({
    method: 'patch',
    path: `/api/${API_VERSION}/queue`,
    summary: 'set queue index',
    description: 'Set the current index of the queue',
    request: {
      body: {
        description: 'index to move the song to',
        content: {
          'application/json': {
            schema: SetQueueIndexSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  clearQueue: createRoute({
    method: 'delete',
    path: `/api/${API_VERSION}/queue`,
    summary: 'clear queue',
    description: 'Clear the queue',
    responses: {
      204: {
        description: 'Success',
      },
    },
  }),
  search: createRoute({
    method: 'post',
    path: `/api/${API_VERSION}/search`,
    summary: 'search for a song',
    description: 'search for a song',
    request: {
      body: {
        description: 'search query',
        content: {
          'application/json': {
            schema: SearchSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({}),
          },
        },
      },
    },
  }),
};

type PromiseOrValue<T> = T | Promise<T>;

export const register = (
  app: HonoApp,
  { window }: BackendContext<APIServerConfig>,
  songInfoGetter: () => PromiseOrValue<SongInfo | undefined>,
  repeatModeGetter: () => PromiseOrValue<RepeatMode | undefined>,
  likeTypeGetter: () => PromiseOrValue<LikeType | undefined>,
  volumeStateGetter: () => PromiseOrValue<VolumeState | undefined>,
) => {
  const controller = getSongControls(window);

  app.openapi(routes.previous, (ctx) => {
    controller.previous();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.next, (ctx) => {
    controller.next();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.play, (ctx) => {
    controller.play();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.pause, (ctx) => {
    controller.pause();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.togglePlay, (ctx) => {
    controller.playPause();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.getLikeState, async (ctx) => {
    ctx.status(200);
    return ctx.json({ state: (await likeTypeGetter()) ?? null });
  });
  app.openapi(routes.like, (ctx) => {
    controller.like();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.dislike, (ctx) => {
    controller.dislike();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.seekTo, (ctx) => {
    const { seconds } = ctx.req.valid('json');
    controller.seekTo(seconds);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.goBack, (ctx) => {
    const { seconds } = ctx.req.valid('json');
    controller.goBack(seconds);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.goForward, (ctx) => {
    const { seconds } = ctx.req.valid('json');
    controller.goForward(seconds);

    ctx.status(204);
    return ctx.body(null);
  });

  app.openapi(routes.getShuffleState, async (ctx) => {
    const stateResponsePromise = new Promise<boolean>((resolve) => {
      ipcMain.once(
        'peard:get-shuffle-response',
        (_, isShuffled: boolean | undefined) => {
          return resolve(!!isShuffled);
        },
      );

      controller.requestShuffleInformation();
    });

    const isShuffled = await stateResponsePromise;

    ctx.status(200);
    return ctx.json({ state: isShuffled });
  });

  app.openapi(routes.shuffle, (ctx) => {
    controller.shuffle();

    ctx.status(204);
    return ctx.body(null);
  });

  app.openapi(routes.repeatMode, async (ctx) => {
    ctx.status(200);
    return ctx.json({ mode: (await repeatModeGetter()) ?? null });
  });
  app.openapi(routes.switchRepeat, (ctx) => {
    const { iteration } = ctx.req.valid('json');
    controller.switchRepeat(iteration);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.setVolume, (ctx) => {
    const { volume } = ctx.req.valid('json');
    controller.setVolume(volume);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.getVolumeState, async (ctx) => {
    ctx.status(200);
    return ctx.json(
      (await volumeStateGetter()) ?? { state: 0, isMuted: false },
    );
  });
  app.openapi(routes.setFullscreen, (ctx) => {
    const { state } = ctx.req.valid('json');
    controller.setFullscreen(state);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.toggleMute, (ctx) => {
    controller.muteUnmute();

    ctx.status(204);
    return ctx.body(null);
  });

  app.openapi(routes.getFullscreenState, async (ctx) => {
    const stateResponsePromise = new Promise<boolean>((resolve) => {
      ipcMain.once(
        'peard:set-fullscreen',
        (_, isFullscreen: boolean | undefined) => {
          return resolve(!!isFullscreen);
        },
      );

      controller.requestFullscreenInformation();
    });

    const fullscreen = await stateResponsePromise;

    ctx.status(200);
    return ctx.json({ state: fullscreen });
  });

  const songInfo = async (ctx: Context) => {
    const info = await songInfoGetter();

    if (!info) {
      ctx.status(204);
      return ctx.body(null);
    }

    const body = { ...info };
    delete body.image;

    ctx.status(200);
    return ctx.json(body satisfies ResponseSongInfo);
  };
  app.openapi(routes.oldSongInfo, songInfo);
  app.openapi(routes.songInfo, songInfo);

  // Queue
  const queueInfo = async (ctx: Context) => {
    const queueResponsePromise = new Promise<QueueResponse>((resolve) => {
      ipcMain.once('peard:get-queue-response', (_, queue: QueueResponse) => {
        return resolve(queue);
      });

      controller.requestQueueInformation();
    });

    const info = await queueResponsePromise;

    if (!info) {
      ctx.status(204);
      return ctx.body(null);
    }

    ctx.status(200);
    return ctx.json(info);
  };
  app.openapi(routes.oldQueueInfo, queueInfo);
  app.openapi(routes.queueInfo, queueInfo);

  app.openapi(routes.nextSongInfo, async (ctx) => {
    const queueResponsePromise = new Promise<QueueResponse>((resolve) => {
      ipcMain.once('peard:get-queue-response', (_, queue: QueueResponse) => {
        return resolve(queue);
      });

      controller.requestQueueInformation();
    });

    const queue = await queueResponsePromise;

    if (!queue?.items || queue.items.length === 0) {
      ctx.status(204);
      return ctx.body(null);
    }

    // Find the currently selected song
    const currentIndex = queue.items.findIndex((item) => {
      const renderer =
        item.playlistPanelVideoRenderer ||
        item.playlistPanelVideoWrapperRenderer?.primaryRenderer
          ?.playlistPanelVideoRenderer;
      return renderer?.selected === true;
    });

    // Get the next song (currentIndex + 1)
    const nextIndex = currentIndex + 1;
    if (nextIndex >= queue.items.length) {
      // No next song available
      ctx.status(204);
      return ctx.body(null);
    }

    const nextItem = queue.items[nextIndex];
    const nextRenderer =
      nextItem.playlistPanelVideoRenderer ||
      nextItem.playlistPanelVideoWrapperRenderer?.primaryRenderer
        ?.playlistPanelVideoRenderer;

    if (!nextRenderer) {
      ctx.status(204);
      return ctx.body(null);
    }

    // Extract relevant information similar to SongInfo format
    const nextSongInfo = {
      title: nextRenderer.title?.runs?.[0]?.text,
      videoId: nextRenderer.videoId,
      thumbnail: nextRenderer.thumbnail,
      lengthText: nextRenderer.lengthText,
      shortBylineText: nextRenderer.shortBylineText,
    };

    ctx.status(200);
    return ctx.json(nextSongInfo);
  });

  app.openapi(routes.addSongToQueue, (ctx) => {
    const { videoId, insertPosition } = ctx.req.valid('json');
    controller.addSongToQueue(videoId, insertPosition);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.moveSongInQueue, (ctx) => {
    const index = Number(ctx.req.param('index'));
    const { toIndex } = ctx.req.valid('json');
    controller.moveSongInQueue(index, toIndex);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.removeSongFromQueue, (ctx) => {
    const index = Number(ctx.req.param('index'));
    controller.removeSongFromQueue(index);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.setQueueIndex, (ctx) => {
    const { index } = ctx.req.valid('json');
    controller.setQueueIndex(index);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.clearQueue, (ctx) => {
    controller.clearQueue();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.search, async (ctx) => {
    const { query, params, continuation } = ctx.req.valid('json');
    const response = await controller.search(query, params, continuation);

    ctx.status(200);
    return ctx.json(response as object);
  });
};
