import style from './style.css?inline';

import { createPlugin } from '@/utils';
import { t } from '@/i18n';

const handlePlay = (e: MouseEvent) => {
  if (!(e.target instanceof HTMLElement)) return;

  if (
    e.target.closest('ytmusic-play-button-renderer') &&
    !e.target.closest('ytmusic-player-page')
  ) {
    document.body.classList.add('unobtrusive-player--did-play');
  }

  if (
    e.target.closest('ytmusic-player-bar') &&
    !document.body.classList.contains('unobtrusive-player--auto-closing')
  ) {
    document.body.classList.remove('unobtrusive-player--did-play');
  }
};

const handleVideoDataChange = () => {
  const isPlayerPageOpen =
    document
      .querySelector('ytmusic-app-layout')
      ?.attributes.getNamedItem('player-ui-state')?.value ===
    'PLAYER_PAGE_OPEN';

  if (
    document.body.classList.contains('unobtrusive-player--did-play') &&
    isPlayerPageOpen
  ) {
    document.body.classList.add('unobtrusive-player--auto-closing');

    document
      .querySelector<HTMLButtonElement>('.toggle-player-page-button')
      ?.click();

    // prevent animation flickering
    setTimeout(() => {
      document.body.classList.remove('unobtrusive-player--auto-closing');
    }, 500);
  }
};

export default createPlugin({
  name: () => t('plugins.unobtrusive-player.name'),
  description: () => t('plugins.unobtrusive-player.description'),
  restartNeeded: false,
  config: {
    enabled: false,
  },
  stylesheets: [style],
  renderer: {
    start: () => {
      document.body.classList.add('unobtrusive-player');
      document.addEventListener('click', handlePlay);
    },
    onPlayerApiReady: () => {
      // Close player page when video changes while
      // `unobtrusive-player--did-play` className is present.
      document.addEventListener('videodatachange', handleVideoDataChange);
    },
    stop: () => {
      document.removeEventListener('click', handlePlay);
      document.removeEventListener('videodatachange', handleVideoDataChange);

      [
        'unobtrusive-player',
        'unobtrusive-player--did-play',
        'unobtrusive-player--auto-closing',
      ].forEach((className) => document.body.classList.remove(className));
    },
  },
});
