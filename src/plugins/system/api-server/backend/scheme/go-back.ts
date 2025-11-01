import { z } from '@hono/zod-openapi';

export const GoBackSchema = z.object({
  seconds: z.number(),
});
