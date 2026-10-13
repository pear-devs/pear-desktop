import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onConfigChange, onMainLoad } from './main';
import { onMenu } from './menu';
import { onPlayerApiReady } from './renderer';
import style from './style.css?inline';

export type PictureInPicturePluginConfig = {
  'enabled': boolean;
  'alwaysOnTop': boolean;
  'savePosition': boolean;
  'saveSize': boolean;
  'hotkey': 'P';
  'pip-position': [number, number];
  'pip-size': [number, number];
  'isInPiP': boolean;
  'useNativePiP': boolean;
};

export default createPlugin({
  name: () => t('plugins.picture-in-picture.name'),
  description: () => t('plugins.picture-in-picture.description'),
  restartNeeded: true,
  config: {
    'enabled': false,
    'alwaysOnTop': true,
    'savePosition': true,
    'saveSize': false,
    'hotkey': 'P',
    'pip-position': [10, 10],
    'pip-size': [450, 275],
    'isInPiP': false,
    'useNativePiP': true,
  } as PictureInPicturePluginConfig,
  stylesheets: [style],
  settings: [
    {
      type: 'switch',
      key: 'alwaysOnTop',
      label: () => t('plugins.picture-in-picture.menu.always-on-top'),
    },
    {
      type: 'switch',
      key: 'savePosition',
      label: () => t('plugins.picture-in-picture.menu.save-window-position'),
    },
    {
      type: 'switch',
      key: 'saveSize',
      label: () => t('plugins.picture-in-picture.menu.save-window-size'),
    },
    {
      type: 'switch',
      key: 'useNativePiP',
      label: () => t('plugins.picture-in-picture.menu.use-native-pip'),
    },
    {
      type: 'text',
      key: 'hotkey',
      label: () => t('plugins.picture-in-picture.menu.hotkey.label'),
      placeholder: () => 'e.g. P',
    },
  ],
  menu: onMenu,

  backend: {
    start: onMainLoad,
    onConfigChange,
  },
  renderer: {
    onPlayerApiReady,
  },
});
