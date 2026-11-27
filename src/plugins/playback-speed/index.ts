import { t } from '@/i18n';
import { createPlugin } from '@/utils';
import { onPlayerApiReady, onUnload } from './renderer';

export default createPlugin({
  name: () => t('plugins.playback-speed.name'),
  description: () => t('plugins.playback-speed.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    varispeed: false,
  },
  menu: async ({ getConfig, setConfig }) => {
    const cfg = await getConfig();
    return [
      {
        label: "Link Pitch",
        type: 'checkbox',
        checked: cfg.varispeed,
        click: (item) => {
          setConfig({ varispeed: item.checked });
        },
      }
    ];
  },
  renderer: {
    stop: onUnload,
    onPlayerApiReady,
  },
});
