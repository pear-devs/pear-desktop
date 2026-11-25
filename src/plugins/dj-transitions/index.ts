import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import backend from './backend';
import {
  onConfigChange,
  onPlayerApiReady,
  onRendererLoad,
  onRendererUnload,
} from './renderer';

import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

export type DjTransitionsPluginConfig = {
  enabled: boolean;
  /** Length of the fade-out and of the fade-in, in seconds. */
  fadeSeconds: number;
  /** Cut the low end during the transition and swap it back on the next track. */
  bassSwap: boolean;
};

const FADE_LENGTHS = [3, 5, 8, 10, 12];

export default createPlugin({
  name: () => t('plugins.dj-transitions.name'),
  description: () => t('plugins.dj-transitions.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    fadeSeconds: 8,
    bassSwap: true,
  },
  menu: async ({
    getConfig,
    setConfig,
  }: MenuContext<DjTransitionsPluginConfig>): Promise<MenuTemplate> => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.dj-transitions.menu.fade-length'),
        type: 'submenu',
        submenu: FADE_LENGTHS.map((seconds) => ({
          label: t('plugins.dj-transitions.menu.seconds', { seconds }),
          type: 'radio',
          checked: config.fadeSeconds === seconds,
          click() {
            setConfig({ fadeSeconds: seconds });
          },
        })),
      },
      {
        label: t('plugins.dj-transitions.menu.bass-swap'),
        type: 'checkbox',
        checked: config.bassSwap,
        click(item) {
          setConfig({ bassSwap: item.checked });
        },
      },
    ];
  },
  backend,
  renderer: {
    start: onRendererLoad,
    stop: onRendererUnload,
    onPlayerApiReady,
    onConfigChange,
  },
});
