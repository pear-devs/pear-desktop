import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onMainLoad } from './main';
import { onMenu } from './menu';

export type ShortcutMappingType = {
  previous: string;
  playPause: string;
  next: string;
};
export type SeekMappingType = {
  forward: string;
  backward: string;
};
export type ShortcutsPluginConfig = {
  enabled: boolean;
  overrideMediaKeys: boolean;
  global: ShortcutMappingType;
  local: ShortcutMappingType;
  seekSeconds: number;
  seekGlobalShortcuts: SeekMappingType;
  focusWindowOnDoublePlayPause: boolean;
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
    },
    local: {
      previous: '',
      playPause: '',
      next: '',
    },
    seekSeconds: 10,
    seekGlobalShortcuts: {
      forward: '',
      backward: '',
    },
    focusWindowOnDoublePlayPause: false,
  } as ShortcutsPluginConfig,
  menu: onMenu,

  backend: onMainLoad,
});
