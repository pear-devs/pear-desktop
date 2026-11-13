import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { menu } from './menu';
import renderer from './renderer';
import style from './style.css?inline';
import { syncedLyricsConfig } from './types';

export default createPlugin({
  name: () => t('plugins.synced-lyrics.name'),
  description: () => t('plugins.synced-lyrics.description'),
  authors: ['Non0reo', 'ArjixWasTaken', 'KimJammer', 'Strvm'],
  restartNeeded: true,
  addedVersion: '3.5.X',
  config: syncedLyricsConfig,
  menu,
  renderer,
  stylesheets: [style],
});
