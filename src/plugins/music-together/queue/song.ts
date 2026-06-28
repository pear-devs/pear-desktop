import type { MusicPlayerAppElement } from '@/types/music-player-app-element';
import type { QueueElement } from '@/types/queue';

type QueueRendererResponse = {
  queueDatas: {
    content: unknown;
  }[];
  responseContext: unknown;
  trackingParams: string;
};

export const getMusicQueueRenderer = async (
  videoIds: string[],
): Promise<QueueRendererResponse | null> => {
  const queue = document.querySelector<QueueElement>('#queue');
  const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');
  if (!app) return null;

  const store = queue?.queue.store.store;
  if (!store) return null;

  return await app.networkManager.fetch<
    QueueRendererResponse,
    {
      queueContextParams: string;
      videoIds: string[];
    }
  >('/music/get_queue', {
    queueContextParams: store.getState().queue.queueContextParams,
    videoIds,
  });
};
