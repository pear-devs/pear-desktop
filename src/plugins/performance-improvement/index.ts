import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { injectCpuTamer } from './scripts/cpu-tamer';
import { injectRm3 } from './scripts/rm3';

import type { MusicPlayer } from '@/types/music-player';

const AUDIO_QUALITY = 'tiny';

const isVideoPlayerVisible = () => {
  const songVideo = document.querySelector<HTMLElement>('#song-video');
  if (!songVideo) {
    return false;
  }
  return getComputedStyle(songVideo).display != 'none';
};

export default createPlugin({
  name: () => t('plugins.performance-improvement.name'),
  description: () => t('plugins.performance-improvement.description'),
  restartNeeded: true,
  addedVersion: '3.9.X',
  config: {
    enabled: true,
  },
  renderer: {
    api: null as MusicPlayer | null,
    restoredQuality: null as string | null,
    onVisibilityChange: null as (() => void) | null,
    start() {
      injectRm3();
      injectCpuTamer();
    },
    onPlayerApiReady(api: MusicPlayer) {
      this.api = api;

      this.onVisibilityChange = () => {
        document.documentElement.classList.toggle(
          'peard-window-hidden',
          document.hidden,
        );

        if (!this.api) {
          return;
        }

        if (document.hidden && isVideoPlayerVisible()) {
          if (this.restoredQuality == null) {
            this.restoredQuality = this.api.getPlaybackQuality();
          }
          try {
            this.api.setPlaybackQualityRange(AUDIO_QUALITY);
            this.api.setPlaybackQuality(AUDIO_QUALITY);
          } catch {
            // Quality APIs are best-effort and missing on some player builds.
          }
          return;
        }

        if (!document.hidden && this.restoredQuality) {
          try {
            this.api.setPlaybackQualityRange(this.restoredQuality);
            this.api.setPlaybackQuality(this.restoredQuality);
          } catch {
            // Ignore restore failures; playback can continue at the current quality.
          }
          this.restoredQuality = null;
        }
      };

      document.addEventListener('visibilitychange', this.onVisibilityChange);
    },
    stop() {
      if (this.onVisibilityChange) {
        document.removeEventListener(
          'visibilitychange',
          this.onVisibilityChange,
        );
        this.onVisibilityChange = null;
      }
      document.documentElement.classList.remove('peard-window-hidden');
      this.api = null;
      this.restoredQuality = null;
    },
  },
});
