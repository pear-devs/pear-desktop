import { t } from '@/i18n';
import { createPlugin } from '@/utils';

const RESTORE_TIMEOUT_MS = 10_000;

export type ResumeShufflePluginConfig = {
  enabled: boolean;
  /** Whether the queue was shuffled when the app was last closed. */
  shuffled: boolean;
};

// Kept local so the plugin doesn't need to touch the shared queue types
type ShuffleQueue = {
  shuffle(): void;
  store: {
    store: {
      getState(): { queue: { items: unknown[] } };
      subscribe(callback: () => void): () => void;
    };
  };
};

const getQueue = () =>
  document.querySelector<HTMLElement & { queue?: ShuffleQueue }>('#queue')
    ?.queue;

const isShuffled = () =>
  (document
    .querySelector<HTMLElement>('ytmusic-player-bar')
    ?.attributes.getNamedItem('shuffle-on') ?? null) !== null;

// The queue is filled asynchronously, so wait for it before shuffling.
// Returns a canceller, so a pending shuffle can't outlive the plugin.
const shuffleWhenReady = (queue: ShuffleQueue) => {
  const store = queue.store.store;
  let unsubscribe: (() => void) | undefined;

  const shuffle = () => {
    if (!store.getState().queue.items.length) return;

    unsubscribe?.();
    if (!isShuffled()) queue.shuffle();
  };

  unsubscribe = store.subscribe(shuffle);
  shuffle();
  // Give up if it never arrives, so a queue started later isn't shuffled by surprise
  const timeout = setTimeout(() => unsubscribe?.(), RESTORE_TIMEOUT_MS);

  return () => {
    clearTimeout(timeout);
    unsubscribe?.();
  };
};

export default createPlugin<
  unknown,
  unknown,
  {
    observer: MutationObserver | null;
    cancelShuffle: (() => void) | null;
  },
  ResumeShufflePluginConfig
>({
  name: () => t('plugins.resume-shuffle.name'),
  description: () => t('plugins.resume-shuffle.description'),
  addedVersion: '3.12.X',
  restartNeeded: false,
  config: {
    enabled: false,
    shuffled: false,
  },
  renderer: {
    observer: null,
    cancelShuffle: null,
    async onPlayerApiReady(_api, { getConfig, setConfig }) {
      const saveShuffleState = () => setConfig({ shuffled: isShuffled() });

      const playerBar = document.querySelector('ytmusic-player-bar');
      if (playerBar) {
        this.observer = new MutationObserver(saveShuffleState);
        this.observer.observe(playerBar, { attributeFilter: ['shuffle-on'] });
      }

      const { shuffled } = await getConfig();
      const shouldRestore =
        location.pathname === '/watch' &&
        shuffled &&
        window.mainConfig.get('options.resumeOnStart');
      const queue = shouldRestore ? getQueue() : undefined;

      if (queue?.store.store) {
        this.cancelShuffle = shuffleWhenReady(queue);
      } else if (!shouldRestore) {
        // The observer above only reacts to changes, so record the initial state too.
        // Skipped when a restore was wanted but the queue was missing, so that a
        // saved `shuffled: true` survives instead of being overwritten with false.
        saveShuffleState();
      }
    },
    stop() {
      this.observer?.disconnect();
      this.observer = null;
      this.cancelShuffle?.();
      this.cancelShuffle = null;
    },
  },
});
