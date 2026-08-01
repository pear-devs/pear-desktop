import { createPlugin } from '@/utils';
import { Platform } from '@/types/plugins';

import { backend } from './backend';
import { menu } from './menu';
import { renderer } from './renderer';

export interface StatusbarLyricsPluginConfig {
  enabled: boolean;
  maxLength: number;
  includePronunciation: boolean;
}

export const defaultConfig: StatusbarLyricsPluginConfig = {
  enabled: false,
  maxLength: 32,
  includePronunciation: false,
};

export default createPlugin({
  name: () => 'Status Bar Lyrics',
  description: () => 'Show the current lyric line in the macOS menu bar title.',
  restartNeeded: false,
  platform: Platform.macOS,
  config: defaultConfig,
  menu,
  backend,
  renderer,
});
