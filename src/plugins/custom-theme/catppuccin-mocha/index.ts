import style from './style.css?inline';

import type { PearTheme } from '../types';

const catppuccinMocha: PearTheme = {
  id: 'catppuccin-mocha',
  name: 'Catppuccin Mocha',
  description: 'Cozy pastel palette from the Catppuccin Mocha flavor',
  author: 'pear-desktop',
  palette: {
    accentColor: '#cba6f7',
    backgroundColor: '#1e1e2e',
    surfaceColor: '#313244',
    textColor: '#cdd6f4',
  },
  css: style,
  mount() {
    document.body.classList.add('pear-catppuccin-theme');
    return () => {
      document.body.classList.remove('pear-catppuccin-theme');
    };
  },
};

export default catppuccinMocha;
