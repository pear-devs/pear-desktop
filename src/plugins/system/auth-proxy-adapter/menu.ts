import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import { type AuthProxyConfig, defaultAuthProxyConfig } from './config';

import type { MenuContext } from '@/types/contexts';
import type { MenuTemplate } from '@/menu';

export const onMenu = async ({
  getConfig,
  setConfig,
  window,
}: MenuContext<AuthProxyConfig>): Promise<MenuTemplate> => {
  await getConfig();
  return [
    {
      label: t('plugins.auth-proxy-adapter.menu.hostname.label'),
      type: 'normal',
      async click() {
        const config = await getConfig();

        const newHostname =
          (await prompt(
            {
              title: t('plugins.auth-proxy-adapter.prompt.hostname.title'),
              label: t('plugins.auth-proxy-adapter.prompt.hostname.label'),
              value: config.hostname,
              type: 'input',
              width: 380,
              ...promptOptions(),
            },
            window,
          )) ??
          config.hostname ??
          defaultAuthProxyConfig.hostname;

        setConfig({ ...config, hostname: newHostname });
      },
    },
    {
      label: t('plugins.auth-proxy-adapter.menu.port.label'),
      type: 'normal',
      async click() {
        const config = await getConfig();

        const newPort =
          (await prompt(
            {
              title: t('plugins.auth-proxy-adapter.prompt.port.title'),
              label: t('plugins.auth-proxy-adapter.prompt.port.label'),
              value: config.port,
              type: 'counter',
              counterOptions: { minimum: 0, maximum: 65535 },
              width: 380,
              ...promptOptions(),
            },
            window,
          )) ??
          config.port ??
          defaultAuthProxyConfig.port;

        setConfig({ ...config, port: newPort });
      },
    },
  ];
};
