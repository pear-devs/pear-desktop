import { z } from '@hono/zod-openapi';

export const GoForwardScheme = z.object({
  seconds: z.number(),
});
