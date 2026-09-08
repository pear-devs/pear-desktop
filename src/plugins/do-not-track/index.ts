import { webFrame, type BrowserWindow } from 'electron';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import {
  isBlockerEnabled,
  loadTrackerBlockerEngine,
  unloadTrackerBlockerEngine,
} from './blocker';
import { blockers } from './types';

export interface TrackerBlockerConfig {
  /**
   * Whether to enable the tracker blocker.
   * @default true
   */
  enabled: boolean;
  /**
   * When enabled, the tracker blocker will cache the blocklists.
   * @default true
   */
  cache: boolean;
  /**
   * Which tracker blocker mode to use.
   * @default blockers.WithBlocklists
   */
  blocker: (typeof blockers)[keyof typeof blockers];
  /**
   * Additional list of filters to use.
   * @example ["https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt"]
   * @default []
   */
  additionalBlockLists: string[];
  /**
   * Disable the default blocklists.
   * @default false
   */
  disableDefaultLists: boolean;
}

const IN_PLAYER_AD_KILLER_SCRIPT = `
(() => {
  if (window.__peard_adblock_injected__) return;
  window.__peard_adblock_injected__ = true;

  // 1. Prune ad metadata from all incoming player responses (JSON API & initial payload)
  const pruneAdPayload = (data) => {
    if (!data || typeof data !== 'object') return data;
    delete data.playerAds;
    delete data.adPlacements;
    delete data.adSlots;
    delete data.adBreakHeartbeatParams;
    if (data.playerResponse) pruneAdPayload(data.playerResponse);
    if (data.ytInitialPlayerResponse) pruneAdPayload(data.ytInitialPlayerResponse);
    return data;
  };

  const originalJSONParse = JSON.parse;
  JSON.parse = function (...args) {
    const result = originalJSONParse.apply(this, args);
    return pruneAdPayload(result);
  };

  const originalResponseJson = Response.prototype.json;
  Response.prototype.json = function (...args) {
    return originalResponseJson.apply(this, args).then(pruneAdPayload);
  };

  if (window.ytInitialPlayerResponse) {
    pruneAdPayload(window.ytInitialPlayerResponse);
  }

  // 2. High-speed In-Stream Ad Fast-Forward & Instant Skipper
  const fastSkipInStreamAds = () => {
    const video = document.querySelector('video');
    const adShowing = document.querySelector('.ad-showing, .ad-interrupting, [class*="ytp-ad-player-overlay"], .video-ads');
    const skipButton = document.querySelector(
      '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-slot, [class*="skip-button"]'
    );

    if (skipButton instanceof HTMLElement) {
      skipButton.click();
    }

    if (adShowing && video instanceof HTMLVideoElement) {
      video.muted = true;
      if (!isNaN(video.duration) && video.duration > 0) {
        video.currentTime = video.duration + 1;
      }
      video.playbackRate = 16;
    }
  };

  // Run continuously with minimal footprint
  setInterval(fastSkipInStreamAds, 50);

  // Hook DOM mutations for instantaneous reaction to ad overlays
  const adObserver = new MutationObserver(() => {
    fastSkipInStreamAds();
  });

  const setupObserver = () => {
    if (document.body) {
      adObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        adObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      });
    }
  };

  setupObserver();
})();
`;

export default createPlugin({
  name: () => t('plugins.do-not-track.name'),
  description: () => t('plugins.do-not-track.description'),
  restartNeeded: false,
  config: {
    enabled: true,
    cache: true,
    blocker: blockers.WithBlocklists,
    additionalBlockLists: [],
    disableDefaultLists: false,
  } as TrackerBlockerConfig,
  backend: {
    mainWindow: null as BrowserWindow | null,
    async start({ getConfig, window }) {
      const config = await getConfig();
      this.mainWindow = window;

      await loadTrackerBlockerEngine(
        window.webContents.session,
        config.cache,
        config.additionalBlockLists,
        config.disableDefaultLists,
      );
    },
    stop({ window }) {
      if (isBlockerEnabled(window.webContents.session)) {
        unloadTrackerBlockerEngine(window.webContents.session);
      }
    },
    async onConfigChange(newConfig) {
      if (this.mainWindow) {
        await loadTrackerBlockerEngine(
          this.mainWindow.webContents.session,
          newConfig.cache,
          newConfig.additionalBlockLists,
          newConfig.disableDefaultLists,
        );
      }
    },
  },
  preload: {
    async start() {
      await webFrame.executeJavaScript(IN_PLAYER_AD_KILLER_SCRIPT);
    },
  },
});
