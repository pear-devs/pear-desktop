import { webFrame, type BrowserWindow } from 'electron';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import {
  isOmniblockEnabled,
  loadOmniblockEngine,
  unloadOmniblockEngine,
} from './blocker';
import style from './style.css?inline';

export interface OmniblockConfig {
  enabled: boolean;
  networkBlocker: boolean;
  jsonPruning: boolean;
  domRemoval: boolean;
  adSkipper: boolean;
}

interface PatchedVideoElement extends HTMLVideoElement {
  _adblockPatched?: boolean;
  _originalPlay?: HTMLVideoElement['play'];
  play?: HTMLVideoElement['play'];
}

const PRELOAD_SCRIPT = `
(() => {
  const isPruningEnabled = () => {
    return window.__omniblockConfig && window.__omniblockConfig.enabled && window.__omniblockConfig.jsonPruning;
  };

  const isBlockingEnabled = () => {
    return window.__omniblockConfig && window.__omniblockConfig.enabled;
  };

  const _omniblockPruner = (obj, force = false) => {
    if (!obj || typeof obj !== 'object') return obj;
    if (!force && !obj.responseContext && !obj.playabilityStatus && !obj.contents && !obj.playerAds && !obj.adPlacements) {
      return obj;
    }
    const adKeys = new Set([
      'playerAds', 'adPlacements', 'adSlots', 'adBreakHeartbeatParams', 
      'trackingParams', 'adEngine', 'adBreakParams', 'adBreak', 'adBreaks',
      'adReason', 'adSurvey', 'adThumbnails', 'adFormat', 'adType', 'adPreroll',
      'adMidroll', 'adPostroll', 'adState', 'adServer', 'adTags', 'adUrl',
      'adUrls', 'adCreative', 'adCreatives', 'adConfig', 'adConfigs', 'adContext',
      'adParams', 'adParameters', 'adPlayback', 'adRenderer', 'adRenderers',
      'adSlot', 'adTarget', 'adTargets', 'adTemplate', 'adTemplates', 'adTracking',
      'adTrackings', 'adView', 'adViews', 'adVolume', 'adVolumes', 'adWaterfall',
      'adWaterfalls', 'adWrapper', 'adWrappers', 'adZone', 'adZones',
      'displayAd', 'mastheadAd', 'inFeedAd', 'statementBanner', 'mealbarPromo',
      'adBreakHeartbeat', 'adServerConfig', 'adTrackingParams', 'adPrerollParams',
      'adMidrollParams', 'adPostrollParams', 'adStateParams', 'adServerParams'
    ]);
    const scrub = (o) => {
      if (Array.isArray(o)) {
        for (let i = 0; i < o.length; i++) scrub(o[i]);
      } else if (o !== null && typeof o === 'object') {
        for (const key of Object.keys(o)) {
          const lowerKey = key.toLowerCase();
          if (
            adKeys.has(key) || lowerKey.includes('adplacement') || lowerKey.includes('adbreak') ||
            lowerKey.includes('preroll') || lowerKey.includes('midroll') || lowerKey.includes('postroll') ||
            lowerKey.includes('playerad') || lowerKey.includes('adserver') || lowerKey.includes('adsurvey') ||
            lowerKey.includes('adreason') || lowerKey.includes('vmap')
          ) {
            delete o[key];
          } else {
            scrub(o[key]);
          }
        }
      }
    };
    scrub(obj);
    return obj;
  };

  const originalParse = JSON.parse;
  JSON.parse = new Proxy(originalParse, {
    apply(target, thisArg, argumentsList) {
      try {
        const result = Reflect.apply(target, thisArg, argumentsList);
        if (isPruningEnabled()) {
          return _omniblockPruner(result);
        }
        return result;
      } catch (e) {
        return Reflect.apply(target, thisArg, argumentsList);
      }
    },
  });

  const originalJson = Response.prototype.json;
  Response.prototype.json = new Proxy(originalJson, {
    apply(target, thisArg, argumentsList) {
      return Reflect.apply(target, thisArg, argumentsList).then((o) => {
        if (isPruningEnabled()) {
          return _omniblockPruner(o);
        }
        return o;
      });
    },
  });

  const originalText = Response.prototype.text;
  Response.prototype.text = new Proxy(originalText, {
    apply(target, thisArg, argumentsList) {
      return Reflect.apply(target, thisArg, argumentsList).then((text) => {
        if (isPruningEnabled()) {
          try { return JSON.stringify(_omniblockPruner(JSON.parse(text))); } 
          catch (e) { return text; }
        }
        return text;
      });
    },
  });

  const hookGlobalVar = (varName) => {
    let _value = window[varName];
    if (_value && typeof _value === 'object') _value = _omniblockPruner(_value, true);
    Object.defineProperty(window, varName, {
      get() { return _value; },
      set(val) { _value = _omniblockPruner(val, true); },
      configurable: true, enumerable: true,
    });
  };
  hookGlobalVar('ytInitialPlayerResponse');
  hookGlobalVar('ytInitialData');
  hookGlobalVar('ytcfg');
  hookGlobalVar('__INITIAL_DATA__');

  const originalCreateElement = document.createElement;
  document.createElement = function(tagName, options) {
    const el = originalCreateElement.call(this, tagName, options);
    if (isBlockingEnabled() && (tagName.toLowerCase() === 'script' || tagName.toLowerCase() === 'iframe')) {
      const originalSetAttribute = el.setAttribute;
      el.setAttribute = function(name, value) {
        if ((name === 'src' || name === 'href') && typeof value === 'string') {
          if (value.includes('doubleclick') || value.includes('googlesyndication') || value.includes('pagead') || value.includes('ad_break')) {
            value = 'about:blank';
          }
        }
        return originalSetAttribute.call(this, name, value);
      };
      Object.defineProperty(el, 'src', {
        set(val) {
          if (typeof val === 'string' && (val.includes('doubleclick') || val.includes('googlesyndication') || val.includes('pagead'))) {
            val = 'about:blank';
          }
          this.setAttribute('src', val);
        },
        get() { return this.getAttribute('src'); }
      });
    }
    return el;
  };

  const isAdUrl = (url) => typeof url === 'string' && (
    url.includes('/ptracking') || url.includes('/pagead') || url.includes('/ad_break') || 
    url.includes('/api/stats/ads') || url.includes('/api/stats/atr') || url.includes('/get_midroll_info') ||
    url.includes('/youtubei/v1/log_event') || url.includes('doubleclick.net') || 
    url.includes('googlesyndication.com') || url.includes('googleadservices.com') ||
    url.includes('innovid.com') || url.includes('scorecardresearch.com')
  );

  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    if (isBlockingEnabled() && isAdUrl(args[0])) return new Response('{}', { status: 200, statusText: 'OK' });
    return originalFetch.apply(this, args);
  };

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._blocked = isBlockingEnabled() && isAdUrl(url);
    if (this._blocked) {
      return originalXhrOpen.call(this, method, 'about:blank', ...rest);
    }
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  const originalXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args) {
    if (this._blocked) {
      Object.defineProperty(this, 'readyState', { value: 4 });
      Object.defineProperty(this, 'status', { value: 200 });
      Object.defineProperty(this, 'statusText', { value: 'OK' });
      Object.defineProperty(this, 'responseText', { value: '{}' });
      this.dispatchEvent(new Event('load'));
      this.dispatchEvent(new Event('readystatechange'));
      return;
    }
    return originalXhrSend.apply(this, args);
  };

  const originalXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (this._blocked) return;
    return originalXhrSetRequestHeader.call(this, name, value);
  };

  const originalSendBeacon = navigator.sendBeacon;
  navigator.sendBeacon = function(url, data) {
    if (isBlockingEnabled() && isAdUrl(url)) return true;
    return originalSendBeacon.call(this, url, data);
  };
})();
`;

export default createPlugin<
  { mainWindow: BrowserWindow | null },
  { script: string },
  {
    observer: MutationObserver | null;
    bodyObserver: MutationObserver | null;
    rafId: number | null;
    config: OmniblockConfig | null;
    updateCosmeticState: () => void;
    setupAdSkipper: () => void;
  },
  OmniblockConfig
>({
  name: () => t('plugins.omniblock.name'),
  description: () => t('plugins.omniblock.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    networkBlocker: true,
    jsonPruning: true,
    domRemoval: true,
    adSkipper: true,
  } as OmniblockConfig,
  stylesheets: [style],
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    return [
      { label: t('plugins.omniblock.menu.network-blocker'), type: 'checkbox', checked: config.networkBlocker, click() { setConfig({ networkBlocker: !config.networkBlocker }); } },
      { label: t('plugins.omniblock.menu.json-pruning'), type: 'checkbox', checked: config.jsonPruning, click() { setConfig({ jsonPruning: !config.jsonPruning }); } },
      { label: t('plugins.omniblock.menu.dom-removal'), type: 'checkbox', checked: config.domRemoval, click() { setConfig({ domRemoval: !config.domRemoval }); } },
      { label: t('plugins.omniblock.menu.ad-skipper'), type: 'checkbox', checked: config.adSkipper, click() { setConfig({ adSkipper: !config.adSkipper }); } },
    ];
  },
  backend: {
    mainWindow: null,
    async start({ getConfig, window }) {
      const config = await getConfig();
      this.mainWindow = window;
      if (config.enabled && config.networkBlocker) {
        await loadOmniblockEngine(window.webContents.session, true);
      }
    },
    stop({ window }) {
      if (isOmniblockEnabled(window.webContents.session)) {
        unloadOmniblockEngine(window.webContents.session);
      }
    },
    async onConfigChange(newConfig) {
      if (this.mainWindow) {
        const session = this.mainWindow.webContents.session;
        if (newConfig.enabled && newConfig.networkBlocker) {
          if (!isOmniblockEnabled(session)) await loadOmniblockEngine(session, true);
        } else {
          if (isOmniblockEnabled(session)) unloadOmniblockEngine(session);
        }
      }
    },
  },
  preload: {
    script: PRELOAD_SCRIPT,
    async start({ getConfig }) {
      const config = await getConfig();
      await webFrame.executeJavaScript(this.script);
      await webFrame.executeJavaScript(`window.__omniblockConfig = ${JSON.stringify(config)};`);
    },
    async onConfigChange(newConfig) {
      await webFrame.executeJavaScript(`window.__omniblockConfig = ${JSON.stringify(newConfig)};`);
    },
  },
  renderer: {
    observer: null,
    bodyObserver: null,
    rafId: null,
    config: null,
    async start({ getConfig }) {
      this.config = await getConfig();
      this.updateCosmeticState();
      this.setupAdSkipper();
    },
    stop() {
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      if (this.bodyObserver) { this.bodyObserver.disconnect(); this.bodyObserver = null; }
      if (this.rafId) { clearInterval(this.rafId); this.rafId = null; }
      document.body.classList.add('omniblock-cosmetic-disabled');

      const videos = document.querySelectorAll<HTMLVideoElement>('video');
      videos.forEach((video) => {
        const patched = video as PatchedVideoElement;
        if (patched._adblockPatched) {
          if (patched._originalPlay) {
            patched.play = patched._originalPlay;
          } else {
            delete patched.play;
          }
          delete patched._adblockPatched;
          delete patched._originalPlay;
        }
      });
    },
    onConfigChange(newConfig) {
      this.config = newConfig;
      this.updateCosmeticState();

      if (!newConfig.enabled || !newConfig.adSkipper) {
        const videos = document.querySelectorAll<HTMLVideoElement>('video');
        videos.forEach((video) => {
          const patched = video as PatchedVideoElement;
          if (patched._adblockPatched) {
            if (patched._originalPlay) {
              patched.play = patched._originalPlay;
            } else {
              delete patched.play;
            }
            delete patched._adblockPatched;
            delete patched._originalPlay;
          }
        });
      }
    },
    updateCosmeticState() {
      if (this.config?.enabled && this.config?.domRemoval) {
        document.body.classList.remove('omniblock-cosmetic-disabled');
      } else {
        document.body.classList.add('omniblock-cosmetic-disabled');
      }
    },
    setupAdSkipper() {
      let moviePlayerObserved = false;

      const setupPlayerObserver = (player: Element) => {
        if (moviePlayerObserved) return;

        this.observer = new MutationObserver(() => {
          if (
            this.config?.enabled &&
            this.config?.adSkipper &&
            (player.classList.contains('ad-showing') ||
              player.classList.contains('ad-interrupting') ||
              player.classList.contains('ad-playing'))
          ) {
            const skipButtons = document.querySelectorAll<HTMLElement>(
              '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-text, .ytp-ad-skip-button-slot, .ytp-ad-overlay-close-button, .ytp-ad-preview-container, [aria-label*="Skip" i], [aria-label*="Close ad" i]',
            );
            for (const button of skipButtons) {
              if (button.offsetParent !== null) {
                button.click();
              }
            }
          }
        });

        this.observer.observe(player, {
          attributes: true,
          attributeFilter: ['class'],
          childList: true,
          subtree: true,
        });

        moviePlayerObserved = true;
      };

      const skipAds = () => {
        if (!this.config?.enabled || !this.config?.adSkipper) return;

        const moviePlayer = document.querySelector('#movie_player');
        if (!moviePlayer) return;

        if (!moviePlayerObserved) {
          setupPlayerObserver(moviePlayer);
        }

        const isAdPlaying =
          moviePlayer.classList.contains('ad-showing') ||
          moviePlayer.classList.contains('ad-interrupting') ||
          moviePlayer.classList.contains('ad-playing');

        if (isAdPlaying) {
          moviePlayer.classList.remove('ad-showing', 'ad-interrupting', 'ad-playing');
          
          const videos = document.querySelectorAll('video');
          let activeVideo: HTMLVideoElement | null = null;
          for (const v of videos) {
            if (!v.paused && v.currentTime > 0) {
              activeVideo = v;
              break;
            }
          }
          if (!activeVideo) activeVideo = document.querySelector('video');

          if (activeVideo) {
            activeVideo.muted = true;
            activeVideo.playbackRate = 16;
            if (activeVideo.duration && !isNaN(activeVideo.duration) && activeVideo.duration > 0) {
              activeVideo.currentTime = activeVideo.duration - 0.1;
            }
            activeVideo.dispatchEvent(new Event('ended', { bubbles: true }));
          }

          const skipButtons = document.querySelectorAll<HTMLElement>(
            '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-text, .ytp-ad-skip-button-slot, .ytp-ad-overlay-close-button, .ytp-ad-preview-container, [aria-label*="Skip" i], [aria-label*="Close ad" i]',
          );
          for (const button of skipButtons) {
            if (button.offsetParent !== null) {
              button.click();
            }
          }
        }

        const adSelectors = [
          '.ytp-ad-module', '.ytp-ad-player-overlay', '.ytp-ad-image-overlay',
          '.ytp-ad-overlay-container', '.ytp-ad-message-container', '.video-ads',
          'ytd-action-companion-ad-renderer', 'ytd-display-ad-renderer',
          'ytd-in-feed-ad-layout-renderer', 'ytd-promoted-sparkles-web-renderer',
          'ytd-banner-promo-renderer', 'ytd-mealbar-promo-renderer',
          'ytmusic-mealbar-promo-renderer', '#player-ads', 'ad-slot-renderer',
          '.ytp-ad-text-overlay', '.ytp-ad-visit-advertiser-button',
          '.ytp-sponsorship-badge', '.ytp-sponsorship-overlay',
          '[class*="sponsor" i]', '[class*="ad-badge" i]',
          'ytd-ad-slot-renderer', '.ytp-ad-client-side-rendered-companion-ad',
        ];

        const adElements = document.querySelectorAll(adSelectors.join(','));
        adElements.forEach((el) => el.remove());
      };

      this.rafId = window.setInterval(skipAds, 500) as unknown as number;

      const moviePlayer = document.querySelector('#movie_player');
      if (moviePlayer) {
        setupPlayerObserver(moviePlayer);
      }

      const patchVideo = () => {
        const videos = document.querySelectorAll<HTMLVideoElement>('video');
        videos.forEach((video) => {
          const patchedVideo = video as PatchedVideoElement;
          if (patchedVideo && !patchedVideo._adblockPatched) {
            patchedVideo._adblockPatched = true;
            // eslint-disable-next-line @typescript-eslint/unbound-method
            const originalPlay = HTMLMediaElement.prototype.play;
            // eslint-disable-next-line @typescript-eslint/unbound-method
            patchedVideo._originalPlay = video.play;

            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const self = this;
            patchedVideo.play = async function (this: HTMLVideoElement) {
              const player = document.querySelector('#movie_player');
              if (
                self.config?.enabled &&
                self.config?.adSkipper &&
                (player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting'))
              ) {
                this.muted = true;
                this.playbackRate = 16;
                if (this.duration && !isNaN(this.duration)) this.currentTime = this.duration - 0.1;
                this.dispatchEvent(new Event('ended', { bubbles: true }));
                return Promise.resolve();
              }
              return originalPlay.call(this);
            };
          }
        });
      };

      patchVideo();
      this.bodyObserver = new MutationObserver(patchVideo);
      this.bodyObserver.observe(document.body, { childList: true, subtree: true });
    },
  },
});