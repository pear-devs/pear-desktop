import style from './style.css?inline';

import type { PearTheme } from '../types';

const tokyoNight: PearTheme = {
  id: 'tokyo-night',
  name: 'Tokyo Night',
  description:
    'Blue-dominant night palette inspired by the Tokyo Night editor scheme',
  author: 'pear-desktop',
  palette: {
    accentColor: '#7aa2f7',
    backgroundColor: '#1a1b26',
    surfaceColor: '#24283b',
    textColor: '#c0caf5',
  },
  css: style,
  mount() {
    document.body.classList.add('pear-tokyo-night-theme');
    return () => {
      document.body.classList.remove('pear-tokyo-night-theme');
    };
  },
};

export default tokyoNight;
