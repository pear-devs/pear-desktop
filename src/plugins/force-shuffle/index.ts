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
// Max number of upcoming tracks to shuffle per track change (keeps MOVE_ITEM dispatches minimal)
const SHUFFLE_WINDOW = 8;

export default createPlugin<
  unknown,
  unknown,
  {
    config: ForceShufflePluginConfig | null;
    wasShuffled: boolean;
    lastHandledVideoId: string | null;
    timeoutId?: NodeJS.Timeout;
    cooldownUntil: number;
    isStopped: boolean;
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
    isStopped: false,

    reEnableShuffle() {
      const playerBar = document.querySelector<
        HTMLElement & { queue: { shuffle: () => void } }
      >('ytmusic-player-bar');

      if (!playerBar) {
        console.warn('[ForceShuffle] playerBar not found!');
        return;
      }

      // Already shuffled — nothing to do
      if (playerBar.hasAttribute('shuffle-on')) {
        console.log('[ForceShuffle] Shuffle is already on, skipping.');
        return;
      }

      console.log(
        '[ForceShuffle] Shuffle was lost after track change, re-enabling via native YTM player-bar API...',
      );

      if (typeof playerBar.queue?.shuffle === 'function') {
        // Use the exact native shuffle method that YTM's player bar uses
        // This is the same method triggered by MPRIS/media keys in renderer.ts
        // It performs a full shuffle efficiently without causing track skips.
        playerBar.queue.shuffle();
        console.log('[ForceShuffle] Native playerBar.queue.shuffle() called.');
      } else {
        // Fallback to clicking the actual UI button if the API is unavailable
        const shuffleBtn = playerBar.querySelector<HTMLElement>(
          'tp-yt-paper-icon-button.shuffle, .shuffle',
        );
        if (shuffleBtn) {
          shuffleBtn.click();
          console.log('[ForceShuffle] Clicked native UI shuffle button.');
        } else {
          console.warn('[ForceShuffle] Native shuffle API and UI button not found!');
        }
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
      this.isStopped = false;

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
        if (this.isStopped) return;

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
      this.isStopped = true;
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

