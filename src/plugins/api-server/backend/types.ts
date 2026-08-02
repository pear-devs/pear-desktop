import { type serve } from '@hono/node-server';
import { type OpenAPIHono as Hono } from '@hono/zod-openapi';

import type { APIServerConfig } from '../config';
import type { SongInfo } from '@/providers/song-info';
import type { BackendContext } from '@/types/contexts';
import type { RepeatMode, VolumeState } from '@/types/datahost-get-state';

export type HonoApp = Hono;
export type BackendType = {
  app?: HonoApp;
  server?: ReturnType<typeof serve>;
  oldConfig?: APIServerConfig;
  songInfo?: SongInfo;
  currentRepeatMode?: RepeatMode;
  volumeState?: VolumeState;

  init: (ctx: BackendContext<APIServerConfig>) => void;
  run: (config: APIServerConfig) => void;
  end: () => void;
};
