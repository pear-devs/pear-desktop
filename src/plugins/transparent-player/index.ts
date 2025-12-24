import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onMenu } from './menu';
import { onMainLoad, onConfigChange, onMainStop } from './backend';
import { MaterialType, type TransparentPlayerConfig } from './types';

import style from './style.css?inline';

const defaultConfig: TransparentPlayerConfig = {
  enabled: false,
  opacity: 0.5,
  type: MaterialType.NONE,
};

export default createPlugin({
  name: () => t('plugins.transparent-player.name'),
  description: () => t('plugins.transparent-player.description'),
  addedVersion: '3.11.x',
  restartNeeded: true,
  config: defaultConfig,
  stylesheets: [style],
  menu: onMenu,
  backend: {
    start: onMainLoad,
    onConfigChange,
    stop: onMainStop,
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
