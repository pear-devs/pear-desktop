import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './main';
import { onMenu } from './menu';

export type ShortcutMappingType = {
  previous: string;
  playPause: string;
  next: string;
  seekForward: string;
  seekBackward: string;
};
export type ShortcutsPluginConfig = {
  enabled: boolean;
  overrideMediaKeys: boolean;
  global: ShortcutMappingType;
  local: ShortcutMappingType;
  seekForwardSeconds: number;
  seekBackwardSeconds: number;
  podcastSeekForwardSeconds: number;
  podcastSeekBackwardSeconds: number;
};

export type SeekSecondsKey =
  | 'seekForwardSeconds'
  | 'seekBackwardSeconds'
  | 'podcastSeekForwardSeconds'
  | 'podcastSeekBackwardSeconds';

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
      seekForward: '',
      seekBackward: '',
    },
    local: {
      previous: '',
      playPause: '',
      next: '',
      seekForward: '',
      seekBackward: '',
    },
    seekForwardSeconds: 5,
    seekBackwardSeconds: 5,
    podcastSeekForwardSeconds: 10,
    podcastSeekBackwardSeconds: 30,
  } as ShortcutsPluginConfig,
  menu: onMenu,

  backend,
});
