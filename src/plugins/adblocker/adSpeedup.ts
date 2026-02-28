function skipAd(target: Element) {
  const skipButton = target.querySelector<HTMLButtonElement>(
    'button.ytp-ad-skip-button-modern',
  );
  if (skipButton) {
    skipButton.click();
  }
}

function speedUpAndMute(player: Element, isAdShowing: boolean) {
  const video = player.querySelector<HTMLVideoElement>('video');
  if (!video) return;
  if (isAdShowing) {
    video.playbackRate = 16;
    video.muted = true;
  } else if (!isAdShowing) {
    video.playbackRate = 1;
    video.muted = false;
  }
}

export const loadAdSpeedup = () => {
  const player = document.querySelector<HTMLVideoElement>('#movie_player');
  if (!player) return;

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName === 'class'
      ) {
        const target = mutation.target as HTMLElement;

        const isAdShowing =
          target.classList.contains('ad-showing') ||
          target.classList.contains('ad-interrupting');
        speedUpAndMute(target, isAdShowing);
      }
      if (
        mutation.type === 'childList' &&
        mutation.addedNodes.length &&
        mutation.target instanceof HTMLElement
      ) {
        skipAd(mutation.target);
      }
    }
  }).observe(player, {
    attributes: true,
    childList: true,
    subtree: true,
  });

  const isAdShowing =
    player.classList.contains('ad-showing') ||
    player.classList.contains('ad-interrupting');
  speedUpAndMute(player, isAdShowing);
  skipAd(player);
};
