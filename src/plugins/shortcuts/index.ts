import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onMainLoad } from './main';
import { onMenu } from './menu';

export type ShortcutMappingType = {
  previous: string;
  playPause: string;
  next: string;
  like: string;
  dislike: string;
};
export type ShortcutsPluginConfig = {
  enabled: boolean;
  overrideMediaKeys: boolean;
  global: ShortcutMappingType;
  local: ShortcutMappingType;
};

export default createPlugin({
  name: () => t('plugins.shortcuts.name'),
  description: () => t('plugins.shortcuts.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    overrideMediaKeys: false,
    global: {
      previous: '',
      playPause: '',
      next: '',
      like: '',
      dislike: '',
    },
    local: {
      previous: '',
      playPause: '',
      next: '',
      like: '',
      dislike: '',
    },
  } as ShortcutsPluginConfig,
  menu: onMenu,

  backend: onMainLoad,
});
