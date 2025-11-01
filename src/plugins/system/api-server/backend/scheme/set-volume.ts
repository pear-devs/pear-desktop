import { z } from '@hono/zod-openapi';

export const SetVolumeSchema = z.object({
  volume: z.number(),
});
