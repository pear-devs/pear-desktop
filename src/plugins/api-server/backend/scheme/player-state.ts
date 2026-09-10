import { z } from '@hono/zod-openapi';

import { SongInfoSchema } from './song-info';

export const PlayerStateSchema = z.object({
  isPlaying: z.boolean(),
  isPaused: z.boolean(),
  volume: z.number(),
  isMuted: z.boolean(),
  repeat: z.enum(['ONE', 'NONE', 'ALL']).nullable(),
  shuffle: z.boolean().nullable(),
  song: SongInfoSchema.nullable(),
  elapsedSeconds: z.number().nullable(),
  songDuration: z.number().nullable(),
});
