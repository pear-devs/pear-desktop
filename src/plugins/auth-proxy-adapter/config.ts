import { config, type ConfigOf } from '@/plugins/utils/common/config';

export const authProxyConfig = {
  hostname: config.string('127.0.0.1', {
    label: 'plugins.auth-proxy-adapter.menu.hostname.label',
  }),
  port: config.number(4545, {
    label: 'plugins.auth-proxy-adapter.menu.port.label',
    min: 0,
    max: 65535,
  }),
};

export type AuthProxyConfig = ConfigOf<typeof authProxyConfig>;
