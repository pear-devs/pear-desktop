import prompt from 'custom-electron-prompt';

import promptOptions from '@/providers/prompt-options';

import type { McpServerConfig } from './config';
import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

export const onMenu = async ({
  getConfig,
  setConfig,
  window,
}: MenuContext<McpServerConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  return [
    {
      label: `Endpoint: http://127.0.0.1:${config.port}/mcp`,
      enabled: false,
    },
    {
      label: 'Port',
      async click() {
        const currentConfig = await getConfig();
        const port = await prompt(
          {
            title: 'MCP Server',
            label: 'Port (localhost only)',
            value: currentConfig.port,
            type: 'counter',
            counterOptions: { minimum: 1024, maximum: 65535 },
            width: 380,
            ...promptOptions(),
          },
          window,
        );

        if (typeof port === 'number') {
          setConfig({ port });
        }
      },
    },
  ];
};
