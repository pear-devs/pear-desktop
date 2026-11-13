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
import { createBackend } from '@/utils';

import { API_VERSION } from './api-version';
import { registerAuth, registerControl, registerWebsocket } from './routes';
import { JWTPayloadSchema } from './scheme';

import {
  type APIServerConfig,
  AuthStrategy,
  type apiServerConfig,
} from '../config';

import type { SongInfo } from '@/providers/song-info';
import type {
  LikeType,
  RepeatMode,
  VolumeState,
} from '@/types/datahost-get-state';
import type { MiddlewareHandler } from 'hono';

/** Changing these restarts the server. */
const serverOptions = [
  'hostname',
  'port',
  'useHttps',
  'certPath',
  'keyPath',
] as const satisfies (keyof APIServerConfig)[];

export default createBackend<typeof apiServerConfig>((plugin) => {
  const { core } = plugin.ipc;

  let songInfo: SongInfo | undefined;
  let currentRepeatMode: RepeatMode | undefined;
  let volumeState: VolumeState | undefined;

  plugin.onSongInfo((info) => {
    songInfo = info;
  });

  core.on('peard:player-api-loaded', () => {
    core.send('peard:setup-seeked-listener');
    core.send('peard:setup-time-changed-listener');
    core.send('peard:setup-repeat-changed-listener');
    core.send('peard:setup-like-changed-listener');
    core.send('peard:setup-volume-changed-listener');
    core.send('peard:setup-shuffle-changed-listener');
  });

  core.on('peard:repeat-changed', (mode: RepeatMode) => {
    currentRepeatMode = mode;
  });

  core.on('peard:volume-changed', (newVolumeState: VolumeState) => {
    volumeState = newVolumeState;
  });

  const app = new Hono();

  app.use('*', cors());

  // for web remote control
  app.use('*', async (ctx, next) => {
    ctx.header('Access-Control-Allow-Private-Network', 'true');
    await next();
  });

  // middlewares
  const jwtGuard: MiddlewareHandler = async (ctx, next) => {
    if (ctx.req.path.endsWith(`${API_VERSION}/ws`)) {
      return await next();
    }

    const config = plugin.config;

    if (config.authStrategy !== AuthStrategy.NONE) {
      return await jwt({
        secret: config.secret,
        alg: 'HS256',
      })(ctx, next);
    }
    return await next();
  };
  app.use('/api/*', jwtGuard);
  app.use('/api/*', async (ctx, next) => {
    if (ctx.req.path.endsWith(`${API_VERSION}/ws`)) {
      return await next();
    }

    const result = await JWTPayloadSchema.spa(await ctx.get('jwtPayload'));
    const config = plugin.config;

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
    app,
    plugin,
    () => songInfo,
    () => currentRepeatMode,
    () =>
      plugin.window.webContents.executeJavaScript(
        'document.querySelector("#like-button-renderer")?.likeStatus',
      ) as Promise<LikeType>,
    () => volumeState,
  );
  registerAuth(app, plugin);
  registerWebsocket(app, plugin, upgradeWebSocket);

  // swagger
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });
  app.doc('/doc', {
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

  app.get('/swagger', swaggerUI({ url: '/doc' }));

  let server: ReturnType<typeof serve> | undefined;
  let wss: WebSocketServer | undefined;

  const run = (config: APIServerConfig) => {
    try {
      wss = new WebSocketServer({ noServer: true });
      const options =
        config.useHttps && config.certPath && config.keyPath
          ? {
              fetch: app.fetch.bind(app),
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
              fetch: app.fetch.bind(app),
              port: config.port,
              hostname: config.hostname,
              createServer: createHttpServer,
              websocket: { server: wss },
            };

      server = serve(options);
    } catch (err) {
      console.error(err);
    }
  };

  const end = () => {
    for (const client of wss?.clients ?? []) client.terminate();
    wss?.close();
    wss = undefined;
    server?.close();
    // Keep-alive connections would keep the old server (and port) alive.
    if (server && 'closeAllConnections' in server) server.closeAllConnections();
    server = undefined;
  };

  run(plugin.config);
  plugin.onCleanup(end);

  // Only a change of the server's own options restarts it.
  plugin.onConfigChange((config, previous) => {
    if (serverOptions.every((key) => config[key] === previous[key])) return;
    end();
    run(config);
  });
});
