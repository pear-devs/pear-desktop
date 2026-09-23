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

  let wasInAd = false;
  let savedMuted = false;
  let savedPlaybackRate = 1;

  // 2. High-speed In-Stream Ad Fast-Forward & Instant Skipper
  const fastSkipInStreamAds = () => {
    const video = document.querySelector('video');
    const adShowing = document.querySelector(
      '.ad-showing, .ad-interrupting, [class*="ytp-ad-player-overlay"], .video-ads'
    );

    if (!adShowing) {
      if (wasInAd && video instanceof HTMLVideoElement) {
        video.muted = savedMuted;
        video.playbackRate = savedPlaybackRate || 1;
        wasInAd = false;
      }
      return;
    }

    if (video instanceof HTMLVideoElement) {
      if (!wasInAd) {
        savedMuted = video.muted;
        savedPlaybackRate = video.playbackRate;
        wasInAd = true;
      }

      video.muted = true;
      if (!isNaN(video.duration) && video.duration > 0) {
        video.currentTime = video.duration + 1;
      }
      video.playbackRate = 16;
    }

    const skipButton = document.querySelector(
      '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-slot'
    );

    if (skipButton instanceof HTMLElement) {
      skipButton.click();
    }
  };

  let isThrottled = false;
  const throttledSkip = () => {
    if (isThrottled) return;
    isThrottled = true;
    requestAnimationFrame(() => {
      isThrottled = false;
      fastSkipInStreamAds();
    });
  };

  // Passive fallback heartbeat interval (1000ms)
  const heartbeat = setInterval(throttledSkip, 1000);

  // Hook DOM mutations using throttled execution to eliminate render thread overhead
  const adObserver = new MutationObserver(() => {
    throttledSkip();
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

  window.__peard_adblock_dispose__ = () => {
    clearInterval(heartbeat);
    adObserver.disconnect();
    JSON.parse = originalJSONParse;
    Response.prototype.json = originalResponseJson;
    window.__peard_adblock_injected__ = false;
    window.__peard_adblock_dispose__ = undefined;
  };
})();
`;

export default createPlugin({
  /**
   * Returns the localized display name of the plugin.
   *
   * @returns The localized plugin name.
   */
  name: () => t('plugins.do-not-track.name'),
  /**
   * Returns the localized description of the plugin.
   *
   * @returns The localized plugin description.
   */
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
    /**
     * Initializes the tracker blocker engine for the main browser window.
     *
     * @param context - Plugin execution context containing window reference and configuration getter.
     */
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
    /**
     * Unloads the tracker blocker engine when the plugin is stopped or disabled.
     *
     * @param context - Plugin execution context containing the target browser window.
     */
    stop({ window }) {
      if (isBlockerEnabled(window.webContents.session)) {
        unloadTrackerBlockerEngine(window.webContents.session);
      }
    },
    /**
     * Dynamically reconfigures the blocker engine upon configuration changes.
     *
     * @param newConfig - The updated tracker blocker configuration.
     */
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
    /**
     * Injects the in-player ad pruning and instant fast-forward skipper script
     * into the page's main world (World 0) at startup, ensuring response pruning
     * operates directly on the page's global JSON.parse and Response.prototype.json.
     *
     * @returns A promise that resolves once the script execution is scheduled.
     */
    async start(): Promise<void> {
      await webFrame.executeJavaScriptInIsolatedWorld(0, [
        { code: IN_PLAYER_AD_KILLER_SCRIPT },
      ]);
    },
    /**
     * Cleans up the in-player ad blocker script injected into the main world (World 0)
     * by invoking the disposal hook to clear timers, disconnect observers, and restore native APIs.
     *
     * @returns A promise that resolves once the teardown script execution is scheduled.
     */
    async stop(): Promise<void> {
      await webFrame.executeJavaScriptInIsolatedWorld(0, [
        { code: 'window.__peard_adblock_dispose__?.(); 0' },
      ]);
    },
  },
});
