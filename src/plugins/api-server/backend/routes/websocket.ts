import { createRoute, z } from '@hono/zod-openapi';
import { app as electronApp } from 'electron';
import { verify } from 'hono/jwt';

import { type SongInfo, SongInfoEvent } from '@/providers/song-info';
import { LoggerPrefix } from '@/utils';

import { AuthStrategy } from '../../config';
import { API_VERSION } from '../api-version';
import { JWTPayloadSchema } from '../scheme';

import type { ApiServerContext, HonoApp } from '../types';
import type { RepeatMode, VolumeState } from '@/types/datahost-get-state';
import type { WebSocketLike, upgradeWebSocket } from '@hono/node-server';
import type { Context, Next } from 'hono';
import type { WSContext } from 'hono/ws';

enum DataTypes {
  PlayerInfo = 'PLAYER_INFO',
  VideoChanged = 'VIDEO_CHANGED',
  PlayerStateChanged = 'PLAYER_STATE_CHANGED',
  PositionChanged = 'POSITION_CHANGED',
  VolumeChanged = 'VOLUME_CHANGED',
  RepeatChanged = 'REPEAT_CHANGED',
  ShuffleChanged = 'SHUFFLE_CHANGED',
}

type PlayerState = {
  song?: SongInfo;
  isPlaying: boolean;
  muted: boolean;
  position: number;
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
};

export const register = (
  app: HonoApp,
  plugin: ApiServerContext,
  uws: typeof upgradeWebSocket,
) => {
  const { core } = plugin.ipc;
  let volumeState: VolumeState | undefined = undefined;
  let repeat: RepeatMode = 'NONE';
  let shuffle = false;
  let lastSongInfo: SongInfo | undefined = undefined;

  const sockets = new Set<WSContext<WebSocketLike>>();

  const send = (type: DataTypes, state: Partial<PlayerState>) => {
    sockets.forEach((socket) =>
      socket.send(JSON.stringify({ type, ...state })),
    );
  };

  const createPlayerState = ({
    songInfo,
    volumeState,
    repeat,
    shuffle,
  }: {
    songInfo?: SongInfo;
    volumeState?: VolumeState;
    repeat: RepeatMode;
    shuffle: boolean;
  }): PlayerState => ({
    song: songInfo,
    isPlaying: songInfo ? !songInfo.isPaused : false,
    muted: volumeState?.isMuted ?? false,
    position: songInfo?.elapsedSeconds ?? 0,
    volume: volumeState?.state ?? 100,
    repeat,
    shuffle,
  });

  plugin.listen(electronApp, 'before-quit', () => {
    send(DataTypes.PlayerStateChanged, {
      isPlaying: false,
      position: lastSongInfo?.elapsedSeconds ?? 0,
    });
  });

  plugin.onSongInfo((songInfo, event) => {
    if (event === SongInfoEvent.VideoSrcChanged) {
      send(DataTypes.VideoChanged, { song: songInfo, position: 0 });
    }

    if (event === SongInfoEvent.PlayOrPaused) {
      send(DataTypes.PlayerStateChanged, {
        isPlaying: !(songInfo?.isPaused ?? true),
        position: songInfo.elapsedSeconds,
      });
    }

    if (event === SongInfoEvent.TimeChanged) {
      send(DataTypes.PositionChanged, { position: songInfo.elapsedSeconds });
    }

    lastSongInfo = { ...songInfo };
  });

  core.on('peard:volume-changed', (newVolumeState: VolumeState) => {
    volumeState = newVolumeState;
    send(DataTypes.VolumeChanged, {
      volume: volumeState.state,
      muted: volumeState.isMuted,
    });
  });

  core.on('peard:repeat-changed', (mode: RepeatMode) => {
    repeat = mode;
    send(DataTypes.RepeatChanged, { repeat });
  });

  core.on('peard:seeked', (t: number) => {
    send(DataTypes.PositionChanged, { position: t });
  });

  core.on('peard:shuffle-changed', (newShuffle: boolean) => {
    shuffle = newShuffle;
    send(DataTypes.ShuffleChanged, { shuffle });
  });

  app.openapi(
    createRoute({
      method: 'get',
      path: `/api/${API_VERSION}/ws`,
      summary: 'websocket endpoint',
      description: 'WebSocket endpoint for real-time updates',
      request: {
        query: z.object({
          token: z
            .string()
            .openapi({
              description:
                'Authentication token. Required when the API server authStrategy is not NONE; optional otherwise.',
            })
            .optional(),
        }),
      },
      responses: {
        101: {
          description: 'Switching Protocols',
        },
      },
    }),
    uws((ctx) => ({
      async onOpen(_, ws) {
        const config = plugin.config;

        if (config.authStrategy !== AuthStrategy.NONE) {
          const token = ctx.req.query('token');

          if (!token) {
            ws.close(1008, 'Unauthorized');
            return;
          }

          try {
            const payload = await verify(token, config.secret, 'HS256');
            const parsedPayload =
              await JWTPayloadSchema.safeParseAsync(payload);

            if (
              !parsedPayload.success ||
              !config.authorizedClients.includes(parsedPayload.data.id)
            ) {
              ws.close(1008, 'Unauthorized');
              return;
            }
          } catch (err) {
            console.error(
              LoggerPrefix,
              'WebSocket authentication failed:',
              err,
            );
            ws.close(1008, 'Unauthorized');
            return;
          }
        }

        sockets.add(ws);

        ws.send(
          JSON.stringify({
            type: DataTypes.PlayerInfo,
            ...createPlayerState({
              songInfo: lastSongInfo,
              volumeState,
              repeat,
              shuffle,
            }),
          }),
        );
      },

      onClose(_, ws) {
        sockets.delete(ws);
      },
    })) as (ctx: Context, next: Next) => Promise<Response>,
  );
};
