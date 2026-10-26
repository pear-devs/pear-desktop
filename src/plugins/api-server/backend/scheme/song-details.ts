import { z } from '@hono/zod-openapi';

export const SongDetailsQuerySchema = z.object({
  videoId: z.string().optional().openapi({
    description: 'video id of the song, defaults to the current song',
  }),
});

export const CommentsQuerySchema = SongDetailsQuerySchema.extend({
  continuation: z.string().optional().openapi({
    description: 'continuation token returned by a previous call',
  }),
  sort: z.enum(['top', 'newest']).optional().default('top'),
});

const CommentSchema = z.object({
  commentId: z.string(),
  author: z.string().nullable(),
  authorChannelId: z.string().nullable(),
  authorThumbnail: z.string().nullable(),
  isVerified: z.boolean(),
  isCreator: z.boolean(),
  text: z.string(),
  publishedTime: z.string().nullable(),
  likeCount: z.string().nullable(),
  replyCount: z.string().nullable(),
  isPinned: z.boolean(),
});

export const CommentsResponseSchema = z.object({
  videoId: z.string(),
  commentsAvailable: z.boolean(),
  commentCount: z.string().nullable(),
  comments: z.array(CommentSchema),
  continuation: z.string().nullable(),
});

export const LyricsResponseSchema = z.object({
  videoId: z.string(),
  lyrics: z.string().nullable(),
  source: z.string().nullable(),
});
