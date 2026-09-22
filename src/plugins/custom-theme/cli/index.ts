import style from './style.css?inline';

import type { PearTheme } from '../types';

const cli: PearTheme = {
  id: 'cli',
  name: 'CLI',
  description: 'Terminal-style green-on-black layout',
  author: 'pear-desktop',
  palette: {
    accentColor: '#22c55e',
    backgroundColor: '#0a0a0a',
    surfaceColor: '#141414',
    textColor: '#e5e7eb',
  },
  css: style,
  mount() {
    document.body.classList.add('pear-cli-theme');

    const layout = document.querySelector('ytmusic-app-layout');
    if (!layout) {
      return () => {
        document.body.classList.remove('pear-cli-theme');
      };
    }

    layout.classList.add('pear-cli-theme');

    const apply = () => {
      document.body.classList.add('pear-cli-theme');
      layout.classList.add('pear-cli-theme');
    };

    const observer = new MutationObserver(apply);
    observer.observe(layout, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      layout.classList.remove('pear-cli-theme');
      document.body.classList.remove('pear-cli-theme');
    };
  },
};

export default cli;
