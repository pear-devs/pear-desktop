import { t } from '@/i18n';
import { createPlugin } from '@/utils';

const RESTORE_TIMEOUT_MS = 10_000;

export type ResumeShufflePluginConfig = {
  enabled: boolean;
  /** Whether the queue was shuffled when the app was last closed */
  shuffled: boolean;
};

// Kept local so the plugin doesn't need to touch the shared queue types
type ShuffleQueue = {
  shuffle(): void;
  store: {
    store: {
      getState(): { queue: { items: unknown[]; shuffleEnabled: boolean } };
      subscribe(callback: () => void): () => void;
    };
  };
};

const getQueue = () =>
  document.querySelector<HTMLElement & { queue?: ShuffleQueue }>('#queue')
    ?.queue;

// Read from the queue's own state rather than the player bar, which newer versions of the player don't have
const isShuffled = (queue: ShuffleQueue) =>
  queue.store.store.getState().queue.shuffleEnabled;

// The queue is filled asynchronously, so wait for it before shuffling
// Returns a canceller, so a pending shuffle can't outlive the plugin
const shuffleWhenReady = (queue: ShuffleQueue) => {
  const store = queue.store.store;
  let unsubscribe: (() => void) | undefined;

  const shuffle = () => {
    if (!store.getState().queue.items.length) return;

    unsubscribe?.();
    if (!isShuffled(queue)) queue.shuffle();
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
    unwatch: (() => void) | null;
    cancelShuffle: (() => void) | null;
    stopped: boolean;
  },
  ResumeShufflePluginConfig
>({
  name: () => t('plugins.resume-shuffle.name'),
  description: () => t('plugins.resume-shuffle.description'),
  addedVersion: '3.13.X',
  restartNeeded: false,
  config: {
    enabled: false,
    shuffled: false,
  },
  renderer: {
    unwatch: null,
    cancelShuffle: null,
    stopped: false,
    async onPlayerApiReady(_api, { getConfig, setConfig }) {
      // Defensive: this can run again on plugin re-enable
      this.unwatch?.();
      this.cancelShuffle?.();
      this.stopped = false;

      // Without the queue there is nothing to save or restore, so a saved `shuffled: true` is left alone
      const queue = getQueue();
      if (!queue?.store.store) return;

      // The store notifies on every queue change, so only save when the shuffle state itself flips
      let current = isShuffled(queue);
      this.unwatch = queue.store.store.subscribe(() => {
        const next = isShuffled(queue);
        if (next === current) return;
        current = next;
        setConfig({ shuffled: current });
      });

      const { shuffled } = await getConfig();
      // The plugin may have been disabled while awaiting the config
      if (this.stopped) return;

      const shouldRestore =
        location.pathname === '/watch' &&
        shuffled &&
        window.mainConfig.get('options.resumeOnStart');

      if (shouldRestore) {
        this.cancelShuffle = shuffleWhenReady(queue);
      } else {
        // The subscription above only reacts to changes, so record the initial state too
        setConfig({ shuffled: current });
      }
    },
    stop() {
      this.stopped = true;
      this.unwatch?.();
      this.unwatch = null;
      this.cancelShuffle?.();
      this.cancelShuffle = null;
    },
  },
});
