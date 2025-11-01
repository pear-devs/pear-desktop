import { z } from '@hono/zod-openapi';

export const SetFullscreenSchema = z.object({
  state: z.boolean(),
});
