import type { MusicPlayer } from '@/types/music-player';
import type { GetState, QueueItem } from '@/types/datahost-get-state';

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

export type ToastElement = HTMLElement & {
  autoFitOnAttach: boolean;
  duration: number;
  expandSizingTargetForScrollbars: boolean;
  horizontalAlign: 'left' | 'right' | 'center';
  importPath?: unknown;
  label: string;
  noAutoFocus: boolean;
  noCancelOnEscKey: boolean;
  noCancelOnOutsideClick: boolean;
  noIronAnnounce: boolean;
  restoreFocusOnClose: boolean;
  root: ToastElement;
  rootPath: string;
  sizingTarget: ToastElement;
  verticalAlign: 'bottom' | 'top' | 'center';
};

export interface ToastService {
  attached: boolean;
  displaying: boolean;
  messageQueue: string[];
  toastElement: ToastElement;
  show: (message: string) => void;
}

export type AppElement = HTMLElement & AppAPI;
export type AppAPI = {
  queue: QueueAPI;
  playerApi: MusicPlayer;

  toastService: ToastService;

  // TODO: Add more
};
