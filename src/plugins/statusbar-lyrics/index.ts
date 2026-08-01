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

// Plugin entry point: wires the renderer, backend, and menu together and
// exposes the configuration that controls how lyrics appear in the status bar.
export default createPlugin({
  name: () => 'Status Bar Lyrics',
  description: () => 'Show the current lyric line in the macOS menu bar title. Requires Synced Lyrics to be enabled.',
  restartNeeded: false,
  platform: Platform.macOS,
  config: defaultConfig,
  menu,
  backend,
  renderer,
});
