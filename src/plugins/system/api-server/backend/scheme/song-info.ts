import { z } from '@hono/zod-openapi';

import { MediaType } from '@/providers/song-info';

export type ResponseSongInfo = z.infer<typeof SongInfoSchema>;
export const SongInfoSchema = z.object({
  title: z.string(),
  artist: z.string(),
  views: z.number(),
  uploadDate: z.string().optional(),
  imageSrc: z.string().nullable().optional(),
  isPaused: z.boolean().optional(),
  songDuration: z.number(),
  elapsedSeconds: z.number().optional(),
  url: z.string().optional(),
  album: z.string().nullable().optional(),
  videoId: z.string(),
  playlistId: z.string().optional(),
  mediaType: z.enum([
    MediaType.Audio,
    MediaType.OriginalMusicVideo,
    MediaType.UserGeneratedContent,
    MediaType.PodcastEpisode,
    MediaType.OtherVideo,
  ]),
});
