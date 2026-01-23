import style from './font-customizer.css?inline';

import { createPlugin } from '@/utils';

import { menu } from './menu';
import { renderer } from './renderer';

import type { FontCustomizerConfig } from './types';

const defaultConfig: FontCustomizerConfig = {
  enabled: true,
  mode: 'simple',
  globalFont: 'System Default',
  primaryFont: 'System Default',
  headerFont: 'System Default',
  titleFont: 'System Default',
  artistFont: 'System Default',
  lyricsFont: 'System Default',
  menuFont: 'System Default',
  customFonts: [],
};

export default createPlugin({
  name: () => 'Font Customizer',
  description: () =>
    'Change fonts globally or specifically for song title, artist, lyrics, and navigation menu. Uses Google Fonts.',
  restartNeeded: true,
  config: defaultConfig,
  stylesheets: [style],
  menu,
  renderer,
});
