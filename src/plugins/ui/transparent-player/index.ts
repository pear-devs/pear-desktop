import { t } from '@/i18n';
import { createPlugin } from '@/utils';
import { Platform } from '@/types/plugins';

import { MaterialType, type TransparentPlayerConfig } from './types';

import style from './style.css?inline';

import type { BrowserWindow } from 'electron';

const defaultConfig: TransparentPlayerConfig = {
  enabled: false,
  opacity: 0.5,
  type: MaterialType.ACRYLIC,
};

const opacityList = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const typeList = Object.values(MaterialType);

export default createPlugin({
  name: () => t('plugins.transparent-player.name'),
  description: () => t('plugins.transparent-player.description'),
  addedVersion: '3.11.x',
  restartNeeded: true,
  platform: Platform.Windows,
  config: defaultConfig,
  stylesheets: [style],
  async menu({ getConfig, setConfig }) {
    const config = await getConfig();
    return [
      {
        label: t('plugins.transparent-player.menu.opacity.label'),
        submenu: opacityList.map((opacity) => ({
          label: t('plugins.transparent-player.menu.opacity.submenu.percent', {
            opacity: opacity * 100,
          }),
          type: 'radio',
          checked: config.opacity === opacity,
          click() {
            setConfig({ opacity });
          },
        })),
      },
      {
        label: t('plugins.transparent-player.menu.type.label'),
        submenu: typeList.map((type) => ({
          label: t(`plugins.transparent-player.menu.type.submenu.${type}`),
          type: 'radio',
          checked: config.type === type,
          click() {
            setConfig({ type });
          },
        })),
      },
    ];
  },
  backend: {
    mainWindow: null as BrowserWindow | null,
    async start({ window, getConfig }) {
      this.mainWindow = window;

      const config = await getConfig();
      window.setBackgroundMaterial?.(config.type);
      window.setBackgroundColor?.(`rgba(0, 0, 0, ${config.opacity})`);
    },
    onConfigChange(newConfig) {
      this.mainWindow?.setBackgroundMaterial?.(newConfig.type);
    },
    stop({ window }) {
      window.setBackgroundMaterial?.('none');
    },
  },
  renderer: {
    props: {
      enabled: defaultConfig.enabled,
      opacity: defaultConfig.opacity,
      type: defaultConfig.type,
    } as TransparentPlayerConfig,
    async start({ getConfig }) {
      const config = await getConfig();
      this.props = config;
      if (config.enabled) {
        document.body.classList.add('transparent-background-color');
        document.body.classList.add('transparent-player-backdrop-filter');

        if (!(await window.mainConfig.plugins.isEnabled('album-color-theme'))) {
          document.body.classList.add('transparent-player');
        }
        this.applyVariables();
      }
    },
    onConfigChange(newConfig) {
      this.props = newConfig;
      this.applyVariables();
    },
    stop() {
      document.body.classList.remove('transparent-background-color');
      document.body.classList.remove('transparent-player-backdrop-filter');
      document.body.classList.remove('transparent-player');
      document.documentElement.style.removeProperty(
        '--ytmd-transparent-player-opacity',
      );
    },
    applyVariables(this: { props: TransparentPlayerConfig }) {
      const { opacity } = this.props;
      document.documentElement.style.setProperty(
        '--ytmd-transparent-player-opacity',
        opacity.toString(),
      );
    },
  },
});
