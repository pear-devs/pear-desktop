import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onConfigChange, onPlayerApiReady, onUnload } from './renderer';

export type PlaybackSpeedConfig = {
  enabled: boolean;
  pitchFollowsSpeed: boolean;
  allowExtremeSpeeds: boolean;
};

export default createPlugin({
  name: () => t('plugins.playback-speed.name'),
  description: () => t('plugins.playback-speed.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    pitchFollowsSpeed: true,
    allowExtremeSpeeds: false,
  } as PlaybackSpeedConfig,
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.playback-speed.menu.pitch-follows-speed'),
        type: 'checkbox',
        checked: config.pitchFollowsSpeed !== false,
        click(item) {
          setConfig({ pitchFollowsSpeed: item.checked });
        },
      },
      {
        label: t('plugins.playback-speed.menu.allow-extreme-speeds'),
        type: 'checkbox',
        checked: Boolean(config.allowExtremeSpeeds),
        click(item) {
          setConfig({ allowExtremeSpeeds: item.checked });
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
