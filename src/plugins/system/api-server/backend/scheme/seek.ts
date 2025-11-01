import { z } from '@hono/zod-openapi';

export const SeekSchema = z.object({
  seconds: z.number(),
});
