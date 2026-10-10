import { z } from '@hono/zod-openapi';

export const BrowseSchema = z.object({
  browseId: z.string().openapi({
    description:
      'Browse id of the page, e.g. FEmusic_home, FEmusic_explore, FEmusic_charts, FEmusic_moods_and_genres, FEmusic_new_releases, FEmusic_library_landing, an artist channel id (UC...), an album id (MPRE...) or a playlist id prefixed with VL',
    example: 'FEmusic_explore',
  }),
  params: z.string().optional(),
  continuation: z.string().optional(),
});

export const HomeQuerySchema = z.object({
  continuation: z.string().optional().openapi({
    description: 'continuation token to load more shelves of the home page',
  }),
});
