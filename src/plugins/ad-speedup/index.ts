import { createPlugin } from '@/utils';
import { t } from '@/i18n';

let observer: MutationObserver | null = null;
let lastAdCheck = 0;
let checkInterval: NodeJS.Timeout | null = null;

function checkAndSkipAd() {
  // Throttle checks to avoid performance issues
  const now = Date.now();
  if (now - lastAdCheck < 100) return;
  lastAdCheck = now;

  const video = document.querySelector<HTMLVideoElement>('video');
  if (!video) return;

  const adContainer = document.querySelector('.ytp-ad-player-overlay, .video-ads, .ytp-ad-module');
  const adText = document.querySelector('.ytp-ad-text, .ytp-ad-preview-text');
  
  // Check if ad is playing
  const isAd = adContainer || adText || 
               document.querySelector('.ad-showing') ||
               document.querySelector('.advertisement');

  if (isAd) {
    // Mute and speed up the video
    if (!video.muted) {
      video.muted = true;
    }
    if (video.playbackRate !== 16) {
      video.playbackRate = 16;
    }

    // Try to click skip button if available
    const skipButton = document.querySelector<HTMLElement>(
      '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, button.ytp-ad-skip-button'
    );
    if (skipButton && skipButton.offsetParent !== null) {
      skipButton.click();
    }
  } else {
    // Restore normal playback when not an ad
    if (video.muted) {
      video.muted = false;
    }
    if (video.playbackRate !== 1) {
      video.playbackRate = 1;
    }
  }
}

export default createPlugin({
  name: () => t('plugins.ad-speedup.name'),
  description: () => t('plugins.ad-speedup.description'),
  restartNeeded: false,
  config: {
    enabled: true,
  },
  renderer: {
    start() {
      // Check for ads periodically
      checkInterval = setInterval(() => {
        checkAndSkipAd();
      }, 500);

      // Also watch for DOM changes
      observer = new MutationObserver(() => {
        checkAndSkipAd();
      });

      const targetNode = document.body;
      if (targetNode) {
        observer.observe(targetNode, {
          childList: true,
          subtree: true,
        });
      }
    },

    stop() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
    },
  },
});
