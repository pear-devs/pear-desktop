import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { menu } from './menu';
import { renderer } from './renderer';

export type MiniPlayerPluginConfig = {
  enabled: boolean;
  visible: boolean;
  alwaysOnTop: boolean;
  lyricsScale: number;
  lyricsEmphasis: 'none' | 'subtle' | 'normal' | 'strong';
  hideMeta: boolean;
  showLyricsArea: boolean;
  transparentBg: boolean;
  lyricsColor: string;
  bounds?: { x: number; y: number; width: number; height: number } | null;
};

export default createPlugin<
  typeof backend,
  unknown,
  typeof renderer,
  MiniPlayerPluginConfig
>({
  name: () => t('plugins.mini-player.name'),
  description: () => t('plugins.mini-player.description'),
  authors: ['pumpkinfadly'],
  restartNeeded: true,
  addedVersion: '3.12.X',
  config: {
    enabled: false,
    visible: false,
    alwaysOnTop: true,
    lyricsScale: 1,
    lyricsEmphasis: 'normal',
    hideMeta: false,
    showLyricsArea: true,
    transparentBg: false,
    lyricsColor: '#ffffff',
  },

  menu,
  renderer,
  backend,
});
