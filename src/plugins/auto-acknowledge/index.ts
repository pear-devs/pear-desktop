import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import {
  ATTEMPT_DEBOUNCE_MS,
  CLICK_THROTTLE_MS,
  PLAYER_ROOT_SELECTOR,
  POLL_MS,
  findProceedButton,
  findVisibleErrorRenderer,
  readReasonText,
  readSubreasonText,
  shouldAcknowledge,
  warningScreenKey,
} from './matcher';

export type AutoAcknowledgeConfig = {
  enabled: boolean;
  debug: boolean;
};

export default createPlugin<
  unknown,
  unknown,
  {
    observer: MutationObserver | null;
    interval: ReturnType<typeof setInterval> | null;
    playerWait: ReturnType<typeof setInterval> | null;
    raf: number | null;
    lastClick: number;
    lastAttempt: number;
    lastHandledKey: string | null;
    lastVideoKey: string;
    stopped: boolean;
    config: AutoAcknowledgeConfig | null;
    log: (...args: unknown[]) => void;
    videoKey: () => string;
    searchRoot: () => ParentNode;
    attempt: () => boolean;
    scheduleAttempt: () => void;
    attach: (root: Element) => void;
    clearWatchers: () => void;
    startObserver: () => void;
    stopObserver: () => void;
  },
  AutoAcknowledgeConfig
>({
  name: () => t('plugins.auto-acknowledge.name'),
  description: () => t('plugins.auto-acknowledge.description'),
  addedVersion: '3.12.x',
  restartNeeded: false,
  config: {
    enabled: false,
    debug: false,
  },

  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    return [
      {
        label: t('plugins.auto-acknowledge.menu.debug'),
        type: 'checkbox',
        checked: Boolean(config.debug),
        click(item) {
          setConfig({ debug: Boolean(item.checked) });
        },
      },
    ];
  },

  renderer: {
    observer: null,
    interval: null,
    playerWait: null,
    raf: null,
    lastClick: 0,
    lastAttempt: 0,
    lastHandledKey: null,
    lastVideoKey: '',
    stopped: false,
    config: null,

    log(...args: unknown[]) {
      if (this.config?.debug) {
        console.debug('[auto-acknowledge]', ...args);
      }
    },

    videoKey() {
      const video = document.querySelector('video');
      const src = video?.currentSrc || video?.src || '';
      const title =
        document.querySelector('.title.ytmusic-player-bar')?.textContent ?? '';
      return `${src}|${title}`;
    },

    searchRoot() {
      return document.querySelector(PLAYER_ROOT_SELECTOR) ?? document;
    },

    attempt() {
      const now = Date.now();
      if (now - this.lastAttempt < ATTEMPT_DEBOUNCE_MS) return false;
      this.lastAttempt = now;
      if (now - this.lastClick < CLICK_THROTTLE_MS) return false;

      const videoKey = this.videoKey();
      if (videoKey !== this.lastVideoKey) {
        this.lastHandledKey = null;
        this.lastVideoKey = videoKey;
      }

      const renderer = findVisibleErrorRenderer(this.searchRoot());
      if (!renderer) return false;

      const reason = readReasonText(renderer);
      const subreason = readSubreasonText(renderer);
      const btn = findProceedButton(renderer);
      if (
        !btn ||
        !shouldAcknowledge({
          reason,
          subreason,
          hasProceedButton: true,
        })
      ) {
        this.log('skip non-warning interstitial', reason?.slice(0, 120));
        return false;
      }

      if (!reason) return false;

      const key = warningScreenKey(reason, videoKey);
      if (this.lastHandledKey === key) {
        this.log('already handled this screen');
        return false;
      }

      btn.click();
      this.lastClick = now;
      this.lastHandledKey = key;
      this.log('clicked content-warning proceed button', reason.slice(0, 120));
      return true;
    },

    scheduleAttempt() {
      if (this.raf != null) return;
      this.raf = window.requestAnimationFrame(() => {
        this.raf = null;
        try {
          this.attempt();
        } catch (error) {
          this.log('scheduled attempt failed', error);
        }
      });
    },

    attach(root: Element) {
      this.clearWatchers();
      this.observer = new MutationObserver(() => this.scheduleAttempt());
      this.observer.observe(root, {
        childList: true,
        subtree: true,
      });
      this.interval = setInterval(() => {
        try {
          this.attempt();
        } catch (error) {
          this.log('poll failed', error);
        }
      }, POLL_MS);
      try {
        this.attempt();
      } catch (error) {
        this.log('initial attempt failed', error);
      }
    },

    clearWatchers() {
      this.observer?.disconnect();
      this.observer = null;
      if (this.interval != null) {
        clearInterval(this.interval);
        this.interval = null;
      }
      if (this.raf != null) {
        cancelAnimationFrame(this.raf);
        this.raf = null;
      }
    },

    startObserver() {
      this.stopped = false;
      this.clearWatchers();
      if (this.playerWait != null) {
        clearInterval(this.playerWait);
        this.playerWait = null;
      }

      const existing = document.querySelector(PLAYER_ROOT_SELECTOR);
      if (existing) {
        this.attach(existing);
        return;
      }

      this.playerWait = setInterval(() => {
        if (this.stopped) {
          if (this.playerWait != null) {
            clearInterval(this.playerWait);
            this.playerWait = null;
          }
          return;
        }
        const root = document.querySelector(PLAYER_ROOT_SELECTOR);
        if (!root) return;
        if (this.playerWait != null) {
          clearInterval(this.playerWait);
          this.playerWait = null;
        }
        this.attach(root);
      }, 200);
    },

    stopObserver() {
      this.stopped = true;
      this.clearWatchers();
      if (this.playerWait != null) {
        clearInterval(this.playerWait);
        this.playerWait = null;
      }
    },

    async start({ getConfig }) {
      this.config = await getConfig();
      this.startObserver();
    },

    onConfigChange(newConfig) {
      this.config = newConfig;
    },

    stop() {
      this.stopObserver();
    },
  },
});
