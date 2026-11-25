import type { GetState, QueueItem } from '@/types/datahost-get-state';
import type { MusicPlayer } from '@/types/music-player';

type StoreState = GetState;
export type Store = {
  dispatch: (obj: { type: string; payload?: unknown }) => void;

  getState: () => StoreState;
  replaceReducer: (param1: unknown) => unknown;
  subscribe: (callback: () => void) => unknown;
};

export type QueueElement = HTMLElement & {
  dispatch(obj: { type: string; payload?: unknown }): void;
  queue: QueueAPI;
};
export type QueueAPI = {
  getItems(): QueueItem[];
  store: {
    store: Store;
  };
  continuation?: string;
  autoPlaying?: boolean;
};

export type AddToToastAction = {
  addToToastAction: {
    item: {
      notificationTextRenderer: {
        successResponseText: { simpleText: string };
      };
    };
  };
};

export type AppElement = HTMLElement & AppAPI;
export type AppAPI = {
  queue: QueueAPI;
  playerApi: MusicPlayer;

  handleAddToToastAction(action: AddToToastAction): void;

  // TODO: Add more
};
