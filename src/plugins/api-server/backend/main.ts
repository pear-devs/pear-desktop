import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

import { serve, upgradeWebSocket } from '@hono/node-server';
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono as Hono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';
import { WebSocketServer } from 'ws';

import { APPLICATION_NAME } from '@/i18n';
import { registerCallback } from '@/providers/song-info';
import { createBackend } from '@/utils';

import { API_VERSION } from './api-version';
import { registerAuth, registerControl, registerWebsocket } from './routes';
import { JWTPayloadSchema } from './scheme';

import { type APIServerConfig, AuthStrategy } from '../config';

import type { SpectrumData } from './routes/websocket';
import type { BackendType } from './types';
import type {
  LikeType,
  RepeatMode,
  VolumeState,
} from '@/types/datahost-get-state';
import type { MiddlewareHandler } from 'hono';

export const backend = createBackend<BackendType, APIServerConfig>({
  async start(ctx) {
    const config = await ctx.getConfig();
    this.backendCtx = ctx;

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

    ctx.ipc.on(
      'peard:audio-spectrum',
      (spectrum: SpectrumData) => (this.spectrum = spectrum),
    );

    this.run(config);
    this.startSpectrumPolling(config);
  },
  stop() {
    this.stopSpectrumPolling();
    this.end();
  },
  onConfigChange(config) {
    const old = this.oldConfig;
    const serverChanged =
      old?.hostname != config.hostname ||
      old?.port != config.port ||
      old?.useHttps != config.useHttps ||
      old?.certPath != config.certPath ||
      old?.keyPath != config.keyPath;

    if (serverChanged) {
      this.end();
      this.run(config);
    }

    this.startSpectrumPolling(config);
    this.oldConfig = config;
  },

  startSpectrumPolling(config) {
    this.stopSpectrumPolling();
    if (!config.spectrumEnabled || !this.backendCtx) return;

    const fps = Math.min(60, Math.max(5, Math.round(config.spectrumFps ?? 20)));
    this.spectrumTimer = setInterval(
      () => {
        if (!this.backendCtx || this.backendCtx.window.isDestroyed()) return;
        this.backendCtx.ipc.send('peard:request-spectrum');
      },
      Math.round(1000 / fps),
    );
  },

  stopSpectrumPolling() {
    if (this.spectrumTimer) {
      clearInterval(this.spectrumTimer);
      this.spectrumTimer = undefined;
    }
  },

  // Custom
  init(backendCtx) {
    this.backendCtx = backendCtx;
    this.app = new Hono();

    this.app.use('*', cors());

    // for web remote control
    this.app.use('*', async (ctx, next) => {
      ctx.header('Access-Control-Allow-Private-Network', 'true');
      await next();
    });

    // middlewares
    const jwtGuard: MiddlewareHandler = async (ctx, next) => {
      if (ctx.req.path.endsWith(`${API_VERSION}/ws`)) {
        return await next();
      }

      const config = await backendCtx.getConfig();

      if (config.authStrategy !== AuthStrategy.NONE) {
        return await jwt({
          secret: config.secret,
          alg: 'HS256',
        })(ctx, next);
      }
      return await next();
    };
    this.app.use('/api/*', jwtGuard);
    this.app.use('/api/*', async (ctx, next) => {
      if (ctx.req.path.endsWith(`${API_VERSION}/ws`)) {
        return await next();
      }

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
      () => this.spectrum,
    );
    registerAuth(this.app, backendCtx);
    registerWebsocket(this.app, backendCtx, upgradeWebSocket);

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
        title: `${APPLICATION_NAME} API Server`,
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
  },
  run(config) {
    if (!this.app) return;

    try {
      const wss = new WebSocketServer({ noServer: true });
      const serveOptions =
        config.useHttps && config.certPath && config.keyPath
          ? {
              fetch: this.app.fetch.bind(this.app),
              port: config.port,
              hostname: config.hostname,
              createServer: createHttpsServer,
              serverOptions: {
                key: readFileSync(config.keyPath),
                cert: readFileSync(config.certPath),
              },
              websocket: { server: wss },
            }
          : {
              fetch: this.app.fetch.bind(this.app),
              port: config.port,
              hostname: config.hostname,
              createServer: createHttpServer,
              websocket: { server: wss },
            };

      this.server = serve(serveOptions);
    } catch (err) {
      console.error(err);
    }
  },
  end() {
    this.stopSpectrumPolling();
    this.server?.close();
    this.server = undefined;
  },
});
