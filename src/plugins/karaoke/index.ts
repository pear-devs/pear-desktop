import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { menu } from './menu';
import { renderer } from './renderer';
import style from './style.css?inline';

import type { KaraokePluginConfig } from './types';

export default createPlugin<
  typeof backend,
  unknown,
  typeof renderer,
  KaraokePluginConfig
>({
  name: () => t('plugins.karaoke.name'),
  description: () => t('plugins.karaoke.description'),
  restartNeeded: false,
  addedVersion: '3.13.X',
  config: {
    enabled: false,
    vocalReduction: 1,
    lyricsSize: 'medium',
    aiVocals: false,
  },

  menu,
  backend,
  renderer,
  stylesheets: [style],
});
