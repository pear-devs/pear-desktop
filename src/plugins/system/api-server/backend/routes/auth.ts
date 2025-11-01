import { createRoute, z } from '@hono/zod-openapi';
import { dialog } from 'electron';
import { sign } from 'hono/jwt';

import { getConnInfo } from '@hono/node-server/conninfo';

import { t } from '@/i18n';

import { type APIServerConfig, AuthStrategy } from '../../config';

import type { JWTPayload } from '../scheme';
import type { HonoApp } from '../types';
import type { BackendContext } from '@/types/contexts';

const routes = {
  request: createRoute({
    method: 'post',
    path: '/auth/{id}',
    summary: '',
    description: '',
    security: [],
    request: {
      params: z.object({
        id: z.string(),
      }),
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              accessToken: z.string(),
            }),
          },
        },
      },
      403: {
        description: 'Forbidden',
      },
    },
  }),
};

export const register = (
  app: HonoApp,
  { getConfig, setConfig }: BackendContext<APIServerConfig>,
) => {
  app.openapi(routes.request, async (ctx) => {
    const config = await getConfig();
    const { id } = ctx.req.param();

    if (config.authorizedClients.includes(id)) {
      // SKIP CHECK
    } else if (config.authStrategy === AuthStrategy.AUTH_AT_FIRST) {
      const result = await dialog.showMessageBox({
        title: t('plugins.api-server.dialog.request.title'),
        message: t('plugins.api-server.dialog.request.message', {
          origin: getConnInfo(ctx).remote.address,
          ID: id,
        }),
        buttons: [
          t('plugins.api-server.dialog.request.buttons.allow'),
          t('plugins.api-server.dialog.request.buttons.deny'),
        ],
        defaultId: 1,
        cancelId: 1,
      });

      if (result.response === 1) {
        ctx.status(403);
        return ctx.body(null);
      }
    } else if (config.authStrategy === AuthStrategy.NONE) {
      // SKIP CHECK
    }

    if (!config.authorizedClients.includes(id)) {
      setConfig({
        authorizedClients: [...config.authorizedClients, id],
      });
    }

    const token = await sign(
      {
        id,
        iat: ~~(Date.now() / 1000),
      } satisfies JWTPayload,
      config.secret,
    );

    ctx.status(200);
    return ctx.json({
      accessToken: token,
    });
  });
};
