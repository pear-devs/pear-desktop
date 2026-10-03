import { z } from '@hono/zod-openapi';

export const PlaylistParamsSchema = z.object({
  playlistId: z.string().trim().min(1),
});

export const PlaylistIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const AddSongsToPlaylistSchema = z.object({
  videoIds: z.array(z.string().trim().min(1)).min(1),
});

export const PlayPlaylistSchema = z.object({
  playlistId: z.string().trim().min(1).describe('Playlist ID'),
  videoId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Video ID (optional)'),
});

export const PlayArtistSchema = z.object({
  channelId: z
    .string()
    .trim()
    .min(1)
    .describe('Artist channel / browse ID (e.g. UC...)'),
});

export const PlayAlbumSchema = z.object({
  albumId: z
    .string()
    .trim()
    .min(1)
    .describe('Album browse ID (MPREb_...) or audio playlist ID (OLAK5uy_...)'),
});

export const PlaylistTrackSchema = z.object({
  videoId: z.string().nullable(),
  title: z.string().nullable(),
  artists: z.array(z.string()).optional(),
  album: z.string().nullable().optional(),
  duration: z.string().nullable().optional(),
});

export const PlaylistInfoSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  trackCount: z.number().int().nonnegative(),
  tracks: z.array(PlaylistTrackSchema),
});

export const UserPlaylistSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  trackCount: z.number().int().nonnegative().nullable().optional(),
  author: z.string().nullable().optional(),
});

export const UserPlaylistsSchema = z.object({
  playlists: z.array(UserPlaylistSchema),
});
