import { t } from '@/i18n';
import { createPlugin } from '@/utils';

const AUTO_CLOSE_MS = 3_000;

type Toast = HTMLElement & { close?: () => void };

export default createPlugin({
  name: () => t('plugins.toast-autoclose.name'),
  description: () => t('plugins.toast-autoclose.description'),
  restartNeeded: false,
  config: {
    enabled: true,
  },
  renderer: {
    start() {
      const timers = new Map<Toast, ReturnType<typeof setTimeout>>();
      const root =
        document.querySelector<HTMLElement>('ytmusic-app') ?? document.body;

      const arm = (toast: Toast) => {
        if (timers.has(toast)) return;

        timers.set(
          toast,
          setTimeout(() => {
            timers.delete(toast);
            if (!toast.classList.contains('paper-toast-open')) return;

            const closeButton = toast.querySelector<HTMLElement>(
              '#close-button button',
            );
            if (closeButton) closeButton.click();
            else toast.close?.();
          }, AUTO_CLOSE_MS),
        );
      };

      const scan = () =>
        root
          .querySelectorAll<Toast>('tp-yt-paper-toast.paper-toast-open')
          .forEach(arm);

      scan();
      this.observer = new MutationObserver(scan);
      this.observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });

      this.timers = timers;
    },
    stop() {
      this.observer?.disconnect();
      this.observer = null;
      this.timers?.forEach((timer) => clearTimeout(timer));
      this.timers?.clear();
      this.timers = null;
    },
    observer: null as MutationObserver | null,
    timers: null as Map<Toast, ReturnType<typeof setTimeout>> | null,
  },
});
