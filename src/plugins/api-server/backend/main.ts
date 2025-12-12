/** biome-ignore-all lint/suspicious/noAssignInExpressions: Hono framework patterns use assignment expressions in conditionals for concise route handling */

import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono as Hono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';

import { registerCallback } from '@/providers/song-info';
import {
  type LikeType,
  type RepeatMode,
  type VolumeState,
} from '@/types/datahost-get-state';
import { createBackend } from '@/utils';
import { type APIServerConfig, AuthStrategy } from '../config';
import { registerAuth, registerControl, registerWebsocket } from './routes';
import { JWTPayloadSchema } from './scheme';
import { type BackendType } from './types';

export const backend = createBackend<BackendType, APIServerConfig>({
  async start(ctx) {
    const config = await ctx.getConfig();

    this.init(ctx);
    registerCallback((songInfo) => {
      this.songInfo = songInfo;
    });

    ctx.ipc.on('peard:player-api-loaded', () => {
      ctx.ipc.send('peard:setup-seeked-listener');
      ctx.ipc.send('peard:setup-time-changed-listener');
      ctx.ipc.send('peard:setup-repeat-changed-listener');
      ctx.ipc.send('peard:setup-like-changed-listener');
      ctx.ipc.send('peard:setup-volume-changed-listener');
      ctx.ipc.send('peard:setup-shuffle-changed-listener');
    });

    ctx.ipc.on(
      'peard:repeat-changed',
      (mode: RepeatMode) => (this.currentRepeatMode = mode),
    );

    ctx.ipc.on(
      'peard:volume-changed',
      (newVolumeState: VolumeState) => (this.volumeState = newVolumeState),
    );

    this.run(config.hostname, config.port);
  },
  stop() {
    this.end();
  },
  onConfigChange(config) {
    if (
      this.oldConfig?.hostname === config.hostname &&
      this.oldConfig?.port === config.port
    ) {
      this.oldConfig = config;
      return;
    }

    this.end();
    this.run(config.hostname, config.port);
    this.oldConfig = config;
  },

  // Custom
  init(backendCtx) {
    this.app = new Hono();

    const ws = createNodeWebSocket({
      app: this.app,
    });

    this.app.use('*', cors());

    // for web remote control
    this.app.use('*', async (ctx, next) => {
      ctx.header('Access-Control-Request-Private-Network', 'true');
      await next();
    });

    // middlewares
    this.app.use('/api/*', async (ctx, next) => {
      const config = await backendCtx.getConfig();

      if (config.authStrategy !== AuthStrategy.NONE) {
        return await jwt({
          secret: config.secret,
        })(ctx, next);
      }
      await next();
    });
    this.app.use('/api/*', async (ctx, next) => {
      const result = await JWTPayloadSchema.spa(await ctx.get('jwtPayload'));
      const config = await backendCtx.getConfig();

      const isAuthorized =
        config.authStrategy === AuthStrategy.NONE ||
        (result.success && config.authorizedClients.includes(result.data.id));
      if (!isAuthorized) {
        ctx.status(401);
        return ctx.body('Unauthorized');
      }

      return await next();
    });

    // routes
    registerControl(
      this.app,
      backendCtx,
      () => this.songInfo,
      () => this.currentRepeatMode,
      () =>
        backendCtx.window.webContents.executeJavaScript(
          'document.querySelector("#like-button-renderer")?.likeStatus',
        ) as Promise<LikeType>,
      () => this.volumeState,
    );
    registerAuth(this.app, backendCtx);
    registerWebsocket(this.app, backendCtx, ws);

    // swagger
    this.app.openAPIRegistry.registerComponent(
      'securitySchemes',
      'bearerAuth',
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    );
    this.app.doc('/doc', {
      openapi: '3.1.0',
      info: {
        version: '1.0.0',
        title: 'Pear Desktop API Server',
        description:
          'Note: You need to get an access token using the `/auth/{id}` endpoint first to call any API endpoints under `/api`.',
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    });

    this.app.get('/swagger', swaggerUI({ url: '/doc' }));

    this.injectWebSocket = ws.injectWebSocket.bind(this);
  },
  run(hostname, port) {
    if (!this.app) return;

    try {
      this.server = serve({
        fetch: this.app.fetch.bind(this.app),
        port,
        hostname,
      });

      if (this.injectWebSocket && this.server) {
        this.injectWebSocket(this.server);
      }
    } catch (err) {
      console.error(err);
    }
  },
  end() {
    this.server?.close();
    this.server = undefined;
  },
});
