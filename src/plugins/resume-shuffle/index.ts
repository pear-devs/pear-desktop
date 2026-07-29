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

// The queue is filled asynchronously, so wait for it before shuffling
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
  setTimeout(() => unsubscribe?.(), RESTORE_TIMEOUT_MS);
};

export default createPlugin<
  unknown,
  unknown,
  {
    observer: MutationObserver | null;
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
    async onPlayerApiReady(_api, { getConfig, setConfig }) {
      const saveShuffleState = () => setConfig({ shuffled: isShuffled() });

      const playerBar = document.querySelector('ytmusic-player-bar');
      if (playerBar) {
        this.observer = new MutationObserver(saveShuffleState);
        this.observer.observe(playerBar, { attributeFilter: ['shuffle-on'] });
      }

      const { shuffled } = await getConfig();
      const queue =
        location.pathname === '/watch' &&
        shuffled &&
        window.mainConfig.get('options.resumeOnStart')
          ? getQueue()
          : undefined;

      if (queue?.store.store) {
        shuffleWhenReady(queue);
      } else {
        // The observer above only reacts to changes, so record the initial state too
        saveShuffleState();
      }
    },
    stop() {
      this.observer?.disconnect();
      this.observer = null;
    },
  },
});
