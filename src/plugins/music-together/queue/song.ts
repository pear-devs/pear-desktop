import type { QueueItem } from '@/types/datahost-get-state';
import type { MusicPlayerAppElement } from '@/types/music-player-app-element';
import type { QueueElement } from '@/types/queue';

type QueueRendererResponse = {
  queueDatas: {
    content: QueueItem;
  }[];
  responseContext: unknown;
  trackingParams: string;
};

export const getMusicQueueRenderer = async (
  target: { videoIds: string[] } | { playlistId: string },
): Promise<QueueRendererResponse | null> => {
  const queue = document.querySelector<QueueElement>('#queue');
  const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');
  if (!app) return null;

  const store = queue?.queue.store.store;
  if (!store) return null;

  return await app.networkManager.fetch<
    QueueRendererResponse,
    { queueContextParams: string } & typeof target
  >('/music/get_queue', {
    queueContextParams: store.getState().queue.queueContextParams,
    ...target,
  });
};
