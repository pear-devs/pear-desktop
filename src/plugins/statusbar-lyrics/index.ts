import { createPlugin } from '@/utils';
import { Platform } from '@/types/plugins';

import { backend } from './backend';
import { renderer } from './renderer';

export interface StatusbarLyricsPluginConfig {
  enabled: boolean;
  maxLength: number;
}

export const defaultConfig: StatusbarLyricsPluginConfig = {
  enabled: false,
  maxLength: 32,
};

export default createPlugin({
  name: () => 'Status Bar Lyrics',
  description: () => 'Show the current lyric line in the macOS menu bar title.',
  restartNeeded: false,
  platform: Platform.macOS,
  config: defaultConfig,
  backend,
  renderer,
});
