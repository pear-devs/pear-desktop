import { type ConfigOf, config } from '@/plugins/utils/common/config';

export enum AuthStrategy {
  AUTH_AT_FIRST = 'AUTH_AT_FIRST',
  NONE = 'NONE',
}

export const apiServerConfig = {
  hostname: config.string('0.0.0.0', {
    label: 'plugins.api-server.menu.hostname.label',
    placeholder: '0.0.0.0',
  }),
  port: config.number(26538, {
    label: 'plugins.api-server.menu.port.label',
    min: 0,
    max: 65535,
  }),
  authStrategy: config.select(
    AuthStrategy.AUTH_AT_FIRST,
    [
      {
        value: AuthStrategy.AUTH_AT_FIRST,
        label:
          'plugins.api-server.menu.auth-strategy.submenu.auth-at-first.label',
      },
      {
        value: AuthStrategy.NONE,
        label: 'plugins.api-server.menu.auth-strategy.submenu.none.label',
      },
    ],
    { label: 'plugins.api-server.menu.auth-strategy.label' },
  ),
  // Edited by the custom "HTTPS & Certificates" submenu (see menu.ts).
  useHttps: config.bool(false),
  certPath: config.string(''),
  keyPath: config.string(''),
  // Signs the access tokens; a new one each launch until it is saved.
  secret: config.hidden(Date.now().toString(36)),
  authorizedClients: config.hidden<string[]>([]),
};

export type APIServerConfig = ConfigOf<typeof apiServerConfig>;
