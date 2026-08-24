import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onPlayerApiReady, onUnload, onConfigChange } from './renderer';

export type PlaybackSpeedConfig = {
  enabled: boolean;
  noPreservesPitch: boolean;
};

export default createPlugin({
  name: () => t('plugins.playback-speed.name'),
  description: () => t('plugins.playback-speed.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    noPreservesPitch: false,
  } as PlaybackSpeedConfig,
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    return [
      {
        label: t('plugins.playback-speed.menu.no-preserves-pitch'),
        type: 'checkbox',
        checked: config.noPreservesPitch,
        click(item: any) {
          setConfig({ noPreservesPitch: item.checked });
        },
      },
    ];
  },
  renderer: {
    stop: onUnload,
    onPlayerApiReady,
    onConfigChange,
  },
});
