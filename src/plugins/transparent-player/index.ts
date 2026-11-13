import is from 'electron-is';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import style from './style.css?inline';
import {
  MACOS_MATERIALS,
  MaterialType,
  transparentPlayerConfig,
  typeLabel,
  WINDOWS_MATERIALS,
} from './types';

const OPACITY_VARIABLE = '--ytmd-transparent-player-opacity';

export default createPlugin({
  name: () => t('plugins.transparent-player.name'),
  description: () => t('plugins.transparent-player.description'),
  addedVersion: '3.11.x',
  restartNeeded: true,
  config: transparentPlayerConfig,
  stylesheets: [style],
  menu: (ctx) => {
    const typeList = is.windows()
      ? [MaterialType.NONE, ...WINDOWS_MATERIALS]
      : is.macOS()
        ? [MaterialType.NONE, ...MACOS_MATERIALS]
        : [MaterialType.NONE];

    return [
      {
        label: t('plugins.transparent-player.menu.type.label'),
        submenu: typeList.map((type) => ({
          label: t(typeLabel(type)),
          type: 'radio' as const,
          checked: ctx.config.type === type,
          click() {
            ctx.setConfig({ type });
          },
        })),
      },
    ];
  },
  backend,
  renderer: async (ctx) => {
    const applyVariables = () =>
      document.documentElement.style.setProperty(
        OPACITY_VARIABLE,
        ctx.config.opacity.toString(),
      );

    ctx.onCleanup(() => {
      document.body.classList.remove(
        'transparent-background-color',
        'transparent-player-backdrop-filter',
        'transparent-player',
      );
      document.documentElement.style.removeProperty(OPACITY_VARIABLE);
    });
    ctx.onConfigChange(applyVariables);

    document.body.classList.add('transparent-background-color');
    document.body.classList.add('transparent-player-backdrop-filter');
    applyVariables();

    if (!(await window.mainConfig.plugins.isEnabled('album-color-theme'))) {
      // The cleanup above already ran if the plugin stopped meanwhile.
      if (!ctx.signal.aborted) {
        document.body.classList.add('transparent-player');
      }
    }
  },
});
