import { t } from '@/i18n';
import { createPlugin } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import style from './style.css?inline';

const IDLE_MS = 2500;
const ACTIVE_CLASS = 'fullscreen-auto-hide--active';
const IDLE_CLASS = 'fullscreen-auto-hide--idle';

type Teardown = () => void;

async function setupFullscreenAutoHide(
  generation: number,
  isCurrentGeneration: (gen: number) => boolean,
): Promise<Teardown> {
  const playerBar = await waitForElement<HTMLElement>('ytmusic-player-bar');
  // waitForElement retries indefinitely by default, so the plugin can be
  // stopped (or stopped and started again) while still waiting for it - a
  // plain "was I cancelled" flag isn't enough, since a later start() would
  // clear it and let a stale, still-pending setup attach anyway. Comparing
  // against the current generation instead means only the most recent
  // start() call can ever win.
  if (!isCurrentGeneration(generation)) return () => {};

  let idleTimeout: number | null = null;

  playerBar.style.setProperty('transition', 'opacity 0.3s ease', 'important');

  const isFullscreen = () =>
    playerBar.attributes.getNamedItem('player-fullscreened') !== null;

  const setBarHidden = (hidden: boolean) => {
    playerBar.style.setProperty('opacity', hidden ? '0' : '1', 'important');
    playerBar.style.setProperty(
      'pointer-events',
      hidden ? 'none' : '',
      'important',
    );
  };

  // Fully removes the inline overrides rather than just un-hiding, so
  // normal player-bar styling takes back over once fullscreen ends
  // instead of leaving opacity/pointer-events !important behind
  // indefinitely.
  const clearBarOverrides = () => {
    playerBar.style.removeProperty('opacity');
    playerBar.style.removeProperty('pointer-events');
  };

  const clearIdleTimeout = () => {
    if (idleTimeout !== null) {
      window.clearTimeout(idleTimeout);
      idleTimeout = null;
    }
  };

  const scheduleIdle = () => {
    clearIdleTimeout();
    idleTimeout = window.setTimeout(() => {
      document.body.classList.add(IDLE_CLASS);
      setBarHidden(true);
    }, IDLE_MS);
  };

  const wake = () => {
    document.body.classList.remove(IDLE_CLASS);
    setBarHidden(false);
    if (document.body.classList.contains(ACTIVE_CLASS)) scheduleIdle();
  };

  const activityEvents = ['mousemove', 'mousedown', 'keydown'] as const;
  activityEvents.forEach((eventName) =>
    document.addEventListener(eventName, wake),
  );

  const applyFullscreenState = () => {
    if (isFullscreen()) {
      document.body.classList.add(ACTIVE_CLASS);
      scheduleIdle();
    } else {
      document.body.classList.remove(ACTIVE_CLASS, IDLE_CLASS);
      clearIdleTimeout();
      clearBarOverrides();
    }
  };
  applyFullscreenState();

  const observer = new MutationObserver(applyFullscreenState);
  observer.observe(playerBar, {
    attributes: true,
    attributeFilter: ['player-fullscreened'],
  });

  return () => {
    observer.disconnect();
    clearIdleTimeout();
    activityEvents.forEach((eventName) =>
      document.removeEventListener(eventName, wake),
    );
    document.body.classList.remove(ACTIVE_CLASS, IDLE_CLASS);
    playerBar.style.removeProperty('transition');
    clearBarOverrides();
  };
}

export default createPlugin<
  unknown,
  unknown,
  { cleanup: Teardown | null; generation: number },
  { enabled: boolean }
>({
  name: () => t('plugins.fullscreen-auto-hide.name'),
  description: () => t('plugins.fullscreen-auto-hide.description'),
  restartNeeded: false,
  config: {
    enabled: false,
  },
  stylesheets: [style],

  renderer: {
    cleanup: null,
    generation: 0,
    async start() {
      const generation = ++this.generation;
      const cleanup = await setupFullscreenAutoHide(
        generation,
        (gen) => gen === this.generation,
      );
      if (generation !== this.generation) {
        cleanup();
        return;
      }
      this.cleanup = cleanup;
    },
    stop() {
      this.generation++;
      this.cleanup?.();
      this.cleanup = null;
    },
  },
});
