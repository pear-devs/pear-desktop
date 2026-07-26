import { t } from '@/i18n';
import { createPlugin } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import type { QueueElement } from '@/types/queue';
import type { VideoDataChanged } from '@/types/video-data-changed';

export type ForceShufflePluginConfig = {
  enabled: boolean;
  mode: 'preserve' | 'always';
};

// Cooldown period after re-enabling shuffle to ignore further events (ms)
const SHUFFLE_COOLDOWN_MS = 3000;
// Delay before checking shuffle state after track change (ms)
const TRACK_CHANGE_DELAY_MS = 1500;

export default createPlugin<
  unknown,
  unknown,
  {
    config: ForceShufflePluginConfig | null;
    wasShuffled: boolean;
    lastHandledVideoId: string | null;
    timeoutId?: NodeJS.Timeout;
    cooldownUntil: number;
    observer?: MutationObserver;
    eventListener?: (event: Event) => void;

    reEnableShuffle(): void;
    handleTrackChange(videoId: string): void;
    start({
      getConfig,
    }: {
      getConfig: () => Promise<ForceShufflePluginConfig>;
    }): Promise<void>;
    stop(): void;
    onConfigChange(newConfig: ForceShufflePluginConfig): void;
  },
  ForceShufflePluginConfig
>({
  name: () => t('plugins.force-shuffle.name'),
  description: () => t('plugins.force-shuffle.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    mode: 'always',
  },
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.force-shuffle.menu.mode-always'),
        type: 'checkbox',
        checked: config?.mode !== 'preserve',
        async click() {
          const nowConfig = await getConfig();
          setConfig({
            mode: nowConfig.mode === 'preserve' ? 'always' : 'preserve',
          });
        },
      },
    ];
  },
  renderer: {
    config: null,
    wasShuffled: true,
    lastHandledVideoId: null,
    cooldownUntil: 0,

    reEnableShuffle() {
      const playerBar =
        document.querySelector<HTMLElement>('ytmusic-player-bar');

      if (!playerBar) {
        console.warn('[ForceShuffle] playerBar not found!');
        return;
      }

      // Already shuffled — nothing to do
      if (playerBar.hasAttribute('shuffle-on')) {
        console.log('[ForceShuffle] Shuffle is already on, skipping.');
        return;
      }

      const queueElem = document.querySelector<QueueElement>('#queue');
      const store = queueElem?.queue?.store?.store;
      if (!store) {
        console.warn('[ForceShuffle] Queue store not found!');
        return;
      }

      const state = store.getState();
      if (!state?.queue) {
        console.warn('[ForceShuffle] Queue state not found!');
        return;
      }

      console.log(
        '[ForceShuffle] Shuffle was lost after track change, re-enabling...',
      );

      // 1. Set the UI attribute so the shuffle button shows as active
      playerBar.setAttribute('shuffle-on', '');

      // 2. Set the shuffleEnabled flag in the store
      state.queue.shuffleEnabled = true;

      // 3. Shuffle remaining queue items AFTER the currently playing track
      //    using MOVE_ITEM dispatches — these are proper state transitions
      //    that the queue store handles without causing track skips
      const items = state.queue.items;
      const currentIndex = state.queue.selectedItemIndex ?? 0;
      const startIdx = currentIndex + 1;

      if (Array.isArray(items) && startIdx < items.length - 1) {
        // Fisher-Yates shuffle via MOVE_ITEM dispatches
        // We iterate from the end of the sub-array to startIdx+1
        for (let i = items.length - 1; i > startIdx; i--) {
          const j = startIdx + Math.floor(Math.random() * (i - startIdx + 1));
          if (i !== j) {
            // Swap items[i] and items[j] using two MOVE_ITEM dispatches
            // Move i → j first, then adjust indices since the array shifted
            queueElem.dispatch({
              type: 'MOVE_ITEM',
              payload: { fromIndex: i, toIndex: j },
            });
            // After moving i→j, item that was at j is now at j+1 (or i, depending on direction)
            // Since i > j, moving fromIndex=i to toIndex=j shifts everything between j..i-1 up by 1
            // The element originally at j is now at j+1, and we need it at position i
            if (i > j + 1) {
              queueElem.dispatch({
                type: 'MOVE_ITEM',
                payload: { fromIndex: j + 1, toIndex: i },
              });
            }
          }
        }
        console.log(
          `[ForceShuffle] Shuffled ${items.length - startIdx} items after index ${currentIndex} via MOVE_ITEM dispatches.`,
        );
      } else {
        console.log('[ForceShuffle] Not enough items to shuffle.');
      }

      this.cooldownUntil = Date.now() + SHUFFLE_COOLDOWN_MS;
    },

    handleTrackChange(videoId: string) {
      if (!videoId) return;

      // Ignore events during cooldown (prevents chain reactions after re-enabling shuffle)
      if (Date.now() < this.cooldownUntil) {
        console.log(
          `[ForceShuffle] Ignoring track change to ${videoId} — in cooldown period.`,
        );
        // Still update lastHandledVideoId so we don't re-process it after cooldown
        this.lastHandledVideoId = videoId;
        return;
      }

      if (this.lastHandledVideoId === videoId) return;
      this.lastHandledVideoId = videoId;

      console.log(`[ForceShuffle] Track changed to videoId: ${videoId}`);

      const shouldShuffle =
        this.config?.mode === 'always' || this.wasShuffled;

      console.log(
        `[ForceShuffle] Should shuffle? ${shouldShuffle} (mode=${this.config?.mode}, wasShuffled=${this.wasShuffled})`,
      );

      if (!shouldShuffle) return;

      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
      }

      // Wait for YouTube Music to finish initializing the new track's queue
      // before checking/restoring shuffle state
      this.timeoutId = setTimeout(() => {
        const playerBar =
          document.querySelector<HTMLElement>('ytmusic-player-bar');
        const hasShuffleOn = playerBar?.hasAttribute('shuffle-on');
        console.log(
          `[ForceShuffle] Delayed check: playerBar exists? ${Boolean(playerBar)}, shuffle-on? ${hasShuffleOn}`,
        );
        if (playerBar && !hasShuffleOn) {
          this.reEnableShuffle();
        }
      }, TRACK_CHANGE_DELAY_MS);
    },

    async start({ getConfig }) {
      this.config = await getConfig();
      this.wasShuffled = true;
      this.lastHandledVideoId = null;
      this.cooldownUntil = 0;

      console.log(
        `[ForceShuffle] Plugin started. Mode: ${this.config?.mode ?? 'always'}`,
      );

      // Listen for track changes
      this.eventListener = (event: Event) => {
        const customEvent = event as CustomEvent<VideoDataChanged>;
        if (customEvent.detail?.name === 'dataloaded') {
          const videoId = customEvent.detail?.videoData?.videoId;
          if (videoId) {
            this.handleTrackChange(videoId);
          }
        }
      };
      document.addEventListener('videodatachange', this.eventListener);

      // Track shuffle-on state changes on player bar
      waitForElement<HTMLElement>('ytmusic-player-bar').then((playerBar) => {
        if (playerBar.hasAttribute('shuffle-on')) {
          this.wasShuffled = true;
        }

        this.observer = new MutationObserver(() => {
          const isShuffled = playerBar.hasAttribute('shuffle-on');
          if (isShuffled) {
            this.wasShuffled = true;
          }
        });

        this.observer.observe(playerBar, {
          attributes: true,
          attributeFilter: ['shuffle-on'],
          childList: false,
          subtree: false,
        });
      });
    },

    stop() {
      console.log('[ForceShuffle] Plugin stopped.');
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
      }
      if (this.eventListener) {
        document.removeEventListener('videodatachange', this.eventListener);
      }
      this.observer?.disconnect();
    },

    onConfigChange(newConfig) {
      this.config = newConfig;
      console.log('[ForceShuffle] Config changed:', newConfig);
    },
  },
});

