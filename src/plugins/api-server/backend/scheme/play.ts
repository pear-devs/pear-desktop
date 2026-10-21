import { z } from '@hono/zod-openapi';

export const PlaySongSchema = z.object({
  videoId: z.string().openapi({ example: 'dQw4w9WgXcQ' }),
  playlistId: z.string().optional().openapi({
    description: 'play the song in the context of this playlist / album',
  }),
});

export const PlayPlaylistSchema = z.object({
  playlistId: z.string().openapi({
    description: 'id of the playlist or album (OLAK5uy_...) to play',
  }),
  videoId: z.string().optional().openapi({
    description: 'song of the playlist to start from',
  }),
  shuffle: z.boolean().optional().default(false),
});

export const StartRadioSchema = z
  .object({
    videoId: z.string().optional().openapi({
      description:
        'song to start the radio from, defaults to the current song when neither videoId nor playlistId is given',
    }),
    playlistId: z.string().optional().openapi({
      description: 'start a radio based on a playlist / album instead',
    }),
  })
  .optional()
  .default({});
