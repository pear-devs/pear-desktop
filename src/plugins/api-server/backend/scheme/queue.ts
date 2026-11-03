import { z } from '@hono/zod-openapi';

export const QueueParamsSchema = z.object({
  index: z.coerce.number().int().nonnegative(),
});

export const AddSongToQueueSchema = z.object({
  videoId: z.string(),
  insertPosition: z
    .enum(['INSERT_AT_END', 'INSERT_AFTER_CURRENT_VIDEO'])
    .optional()
    .default('INSERT_AT_END'),
});
export const AddSongsToQueueSchema = z.object({
  videoIds: z.array(z.string().trim().min(1)).min(1),
  insertPosition: z
    .enum(['INSERT_AT_END', 'INSERT_AFTER_CURRENT_VIDEO'])
    .optional()
    .default('INSERT_AT_END'),
});
export const MoveSongInQueueSchema = z.object({
  toIndex: z.number(),
});
export const ReorderQueueSchema = z
  .object({
    fromIndex: z.number().int().nonnegative().optional(),
    toIndex: z.number().int().nonnegative().optional(),
    order: z.array(z.number().int().nonnegative()).min(2).optional(),
  })
  .refine(
    (value) =>
      (typeof value.fromIndex === 'number' &&
        typeof value.toIndex === 'number') ||
      (Array.isArray(value.order) && value.order.length >= 2),
    {
      message: 'Provide fromIndex+toIndex or an order array',
    },
  );
export const SetQueueIndexSchema = z.object({
  index: z.number().int().nonnegative(),
});
