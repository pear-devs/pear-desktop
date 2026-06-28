import { z } from '@hono/zod-openapi';

export const SearchSchema = z.object({
  query: z.string(),
  params: z.string().optional(),
  continuation: z.string().optional(),
});
