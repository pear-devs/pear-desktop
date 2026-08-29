import { createPlugin } from '@/utils';

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
    lastClick: number;
    lastAttempt: number;
    config: AutoAcknowledgeConfig | null;
    isVisible: (el: Element) => boolean;
    attempt: () => boolean;
    startObserver: () => void;
    stopObserver: () => void;
  },
  AutoAcknowledgeConfig
>({
  name: () => 'Auto-acknowledge',
  description: () =>
    'Automatically dismisses the player content-warning interstitial that blocks playback',
  restartNeeded: false,
  config: {
    enabled: false,
    debug: false,
  } as AutoAcknowledgeConfig,

  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    return [
      {
        label: 'Debug logging',
        type: 'checkbox',
        checked: Boolean(config.debug),
        click() {
          setConfig({ debug: !config.debug });
        },
      },
    ];
  },

  renderer: {
    observer: null,
    interval: null,
    lastClick: 0,
    lastAttempt: 0,
    config: null,

    isVisible(el: Element) {
      const h = el as HTMLElement;
      const style = window.getComputedStyle(h);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = h.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },

    attempt() {
      const now = Date.now();
      if (now - this.lastAttempt < 250) return false;
      this.lastAttempt = now;
      if (now - this.lastClick < 1200) return false;

      const debug = Boolean(this.config?.debug);
      const log = (...args: unknown[]) => {
        if (debug) console.debug('[auto-acknowledge]', ...args);
      };

      // Strictly scoped: only the player playability error interstitial.
      // This is <yt-player-error-message-renderer> inside <yt-playability-error-supported-renderers>,
      // not a page-level yt-confirm-dialog-renderer (playlist delete etc.), so it cannot affect other UI.
      const renderer = document.querySelector('yt-player-error-message-renderer');
      if (!renderer) return false;
      if (!this.isVisible(renderer)) return false;

      // The interstitial has #reason / #subreason and a single #button.
      // Clicking #button is language-agnostic (ID, not text) — works for translated UIs.
      const btn = (renderer.querySelector('#button button') ??
        renderer.querySelector('#button') ??
        renderer.querySelector('button')) as HTMLElement | null;

      if (!btn) {
        log('no button in renderer');
        return false;
      }
      if (!this.isVisible(btn)) return false;

      // Extra safety: ensure this is a content-warning interstitial, not a generic
      // "Video unavailable" error that happens to have a button. The warning always has
      // #reason text; generic errors often have different structure.
      const reasonEl =
        renderer.querySelector('#reason') ?? renderer.querySelector('[id*="reason"]');
      if (reasonEl) {
        // If #reason is empty, don't click — unknown error type
        const reasonText = (reasonEl.textContent ?? '').trim();
        if (!reasonText) {
          log('empty reason, skipping');
          return false;
        }
        log('reason:', reasonText.slice(0, 120));
      }

      btn.click();
      this.lastClick = now;
      log('clicked player warning button', btn);
      return true;
    },

    startObserver() {
      try {
        this.attempt();
      } catch (e) {
        if (this.config?.debug) console.debug('[auto-acknowledge] initial attempt failed', e);
      }

      this.observer = new MutationObserver(() => {
        try {
          this.attempt();
        } catch (e) {
          if (this.config?.debug) console.debug('[auto-acknowledge] observer failed', e);
        }
      });
      this.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      this.interval = setInterval(() => {
        try {
          this.attempt();
        } catch {}
      }, 800);
    },

    stopObserver() {
      this.observer?.disconnect();
      this.observer = null;
      if (this.interval != null) {
        clearInterval(this.interval);
        this.interval = null;
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
