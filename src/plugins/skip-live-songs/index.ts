import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import type { SongInfo } from '@/providers/song-info';
import { nonStudioPatterns } from './patterns';
import type { SongInfo } from '@/providers/song-info';

export default createPlugin({
  name: () => t('plugins.skip-live-songs.name'),
  description: () => t('plugins.skip-live-songs.description'),
  restartNeeded: false,
  config: {
    enabled: false,
  },
  renderer: {
    lastSkippedVideoId: '',

    _skipLiveHandler: undefined as unknown as
      | ((songInfo: SongInfo) => void)
      | undefined,

    start({ ipc }) {
      console.debug('[Skip Live Songs] Renderer started');

      const SELECTORS = [
        'yt-icon-button.next-button',
        '.next-button',
        'button[aria-label*="Next"]',
        'button[aria-label*="next"]',
        '#player-bar-next-button',
        'ytmusic-player-bar .next-button',
        '.player-bar .next-button',
      ];

      const handler = (songInfo: SongInfo) => {
        const titleToCheck = songInfo.alternativeTitle || songInfo.title;
        if (!titleToCheck) return;

        // Skip if we've already attempted this video id
        if (songInfo.videoId === this.lastSkippedVideoId) return;

        const isNonStudio = nonStudioPatterns.some((pattern) =>
          pattern.test(titleToCheck),
        );

        if (!isNonStudio) return; // studio version — nothing to do

        // Mark as attempted so we don't loop repeatedly
        this.lastSkippedVideoId = songInfo.videoId;
        console.info(`[Skip Live Songs] Skipping non-studio song: "${titleToCheck}" (id: ${songInfo.videoId})`);

        let clicked = false;
        for (const sel of SELECTORS) {
          const button = document.querySelector<HTMLElement>(sel);
          if (button) {
            button.click();
            console.debug(
              `[Skip Live Songs] Clicked next button using selector: ${sel}`,
            );
            clicked = true;
            break;
          }
        }

        if (!clicked) {
          console.warn('[Skip Live Songs] Could not find next button with any configured selector');
        }
      };

      this._skipLiveHandler = handler;
      ipc.on('peard:update-song-info', handler);
    },

    // Unregister the ipc handler on plugin stop to avoid duplicate listeners on hot reload
    stop({ ipc }) {
      if (this._skipLiveHandler) {
        ipc.removeAllListeners('peard:update-song-info');
        this._skipLiveHandler = undefined;
        console.debug('[Skip Live Songs] Renderer stopped and listeners removed');
      }
    },
  },
});
