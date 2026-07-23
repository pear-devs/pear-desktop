import { forceVideoMode } from './toggle';

/**
 * Initializes a MutationObserver on the player bar to catch track changes.
 */
export function startCinemodeObserver() {
  const playerBar = document.querySelector('ytmusic-player-bar');
  if (!playerBar) {
    setTimeout(startCinemodeObserver, 1000);
    return;
  }

  const observer = new MutationObserver(() => {
    forceVideoMode();
  });

  observer.observe(playerBar, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['title', 'src'],
  });

  forceVideoMode();
}
