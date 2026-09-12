import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import type { MusicPlayer } from '@/types/music-player';

const SEEK_SECONDS = 5;

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
};

export default createPlugin({
  name: () => t('plugins.seek-shortcuts.name'),
  description: () => t('plugins.seek-shortcuts.description'),
  restartNeeded: false,
  config: {
    enabled: false,
  },

  renderer: {
    api: null as MusicPlayer | null,
    listener: null as ((event: KeyboardEvent) => void) | null,

    onPlayerApiReady(api) {
      this.api = api;

      this.listener = (event: KeyboardEvent) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
          return;
        if (isTypingTarget(event.target)) return;
        if (
          document.querySelector<HTMLElement & { opened: boolean }>(
            'ytmusic-search-box',
          )?.opened
        ) {
          return;
        }

        switch (event.code) {
          case 'ArrowLeft':
            event.preventDefault();
            this.api?.seekBy(-SEEK_SECONDS);
            break;
          case 'ArrowRight':
            event.preventDefault();
            this.api?.seekBy(SEEK_SECONDS);
            break;
        }
      };
      window.addEventListener('keydown', this.listener);
    },
    stop() {
      if (this.listener) window.removeEventListener('keydown', this.listener);
      this.listener = null;
      this.api = null;
    },
  },
});
