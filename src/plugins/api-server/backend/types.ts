import { type OpenAPIHono as Hono } from '@hono/zod-openapi';

import type { APIServerConfig } from '../config';
import type { BackendContext } from '@/types/contexts';

export type HonoApp = Hono;
export type ApiServerContext = BackendContext<APIServerConfig>;
