import type { QueueItem } from '@/types/datahost-get-state';
import type { QueueResponse } from '@/types/music-player-desktop-internal';

export const getQueueItemRenderer = (item: QueueItem) =>
  item.playlistPanelVideoRenderer ||
  item.playlistPanelVideoWrapperRenderer?.primaryRenderer
    ?.playlistPanelVideoRenderer;

export const getSelectedQueueIndex = (queue: QueueResponse) =>
  queue.items?.findIndex((item) => getQueueItemRenderer(item)?.selected) ?? -1;
