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
        const portInput = await prompt(
          {
            title: 'MCP Server',
            label: 'Port (1–65535)',
            value: String(currentConfig.port),
            type: 'input',
            inputAttrs: {
              type: 'number',
              min: '1',
              max: '65535',
              step: '1',
              required: true,
            },
            width: 380,
            ...promptOptions(),
          },
          window,
        );
        const port = Number(portInput);

        if (
          typeof portInput === 'string' &&
          /^\d+$/.test(portInput) &&
          Number.isInteger(port) &&
          port >= 1 &&
          port <= 65535
        ) {
          setConfig({ port });
        }
      },
    },
  ];
};
