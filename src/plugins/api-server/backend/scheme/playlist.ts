import { z } from '@hono/zod-openapi';

export const PlaylistParamsSchema = z.object({
  playlistId: z.string().trim().min(1),
});

export const AddSongsToPlaylistSchema = z.object({
  videoIds: z.array(z.string().trim().min(1)).min(1),
});
