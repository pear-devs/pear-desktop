import { createPlugin } from '@/utils';

import { t } from '@/i18n';

import type { VideoDataChanged } from '@/types/video-data-changed';
import type { MusicPlayer } from '@/types/music-player';

export type DisableAutoPlayPluginConfig = {
  enabled: boolean;
  applyOnce: boolean;
};

export default createPlugin<
  unknown,
  unknown,
  {
    config: DisableAutoPlayPluginConfig | null;
    api: MusicPlayer | null;
    eventListener: (event: CustomEvent<VideoDataChanged>) => void;
    timeUpdateListener: (e: Event) => void;
  },
  DisableAutoPlayPluginConfig
>({
  name: () => t('plugins.disable-autoplay.name'),
  description: () => t('plugins.disable-autoplay.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    applyOnce: false,
  },
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.disable-autoplay.menu.apply-once'),
        type: 'checkbox',
        checked: config.applyOnce,
        async click() {
          const nowConfig = await getConfig();
          setConfig({
            applyOnce: !nowConfig.applyOnce,
          });
        },
      },
    ];
  },
  renderer: {
    config: null,
    api: null,
    eventListener(event: CustomEvent<VideoDataChanged>) {
      if (this.config?.applyOnce) {
        document.removeEventListener('videodatachange', this.eventListener);
      }

      if (event.detail.name === 'dataloaded') {
        this.api?.pauseVideo();
        document
          .querySelector<HTMLVideoElement>('video')
          ?.addEventListener('timeupdate', this.timeUpdateListener, {
            once: true,
          });
      }
    },
    timeUpdateListener(e: Event) {
      if (e.target instanceof HTMLVideoElement) {
        e.target.pause();
      }
    },
    async start({ getConfig }) {
      this.config = await getConfig();
    },
    onPlayerApiReady(api) {
      this.api = api;

      document.addEventListener('videodatachange', this.eventListener);
    },
    stop() {
      document.removeEventListener('videodatachange', this.eventListener);
    },
    onConfigChange(newConfig) {
      this.config = newConfig;
    },
  },
});
