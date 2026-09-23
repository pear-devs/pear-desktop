import { webFrame } from 'electron';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { installPreferSong } from './injectors/inject';

export type PreferSongPluginConfig = {
  /**
   * Whether to play the song instead of the music video.
   * @default false
   */
  enabled: boolean;
};

export default createPlugin({
  name: () => t('plugins.prefer-song.name'),
  description: () => t('plugins.prefer-song.description'),
  restartNeeded: true,
  config: {
    enabled: false,
  } as PreferSongPluginConfig,
  preload: {
    async start() {
      await webFrame.executeJavaScript(
        `(${installPreferSong.toString()})(); 0`,
      );
    },
  },
});
