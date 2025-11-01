import { z } from '@hono/zod-openapi';

export type JWTPayload = z.infer<typeof JWTPayloadSchema>;
export const JWTPayloadSchema = z.object({
  id: z.string(),
  iat: z.number(),
});
