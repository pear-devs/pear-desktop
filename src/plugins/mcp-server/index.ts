import { createPlugin } from '@/utils';

import { backend } from './backend';
import { defaultMcpServerConfig } from './config';
import { onMenu } from './menu';

export default createPlugin({
  name: () => 'MCP Server',
  description: () =>
    'Provides local MCP tools for YouTube Music playback and search.',
  restartNeeded: false,
  config: defaultMcpServerConfig,
  menu: onMenu,
  backend,
});
