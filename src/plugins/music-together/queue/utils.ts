import type {
  ItemPlaylistPanelVideoRenderer,
  PlaylistPanelVideoWrapperRenderer,
  QueueItem,
} from '@/types/datahost-get-state';

export const mapQueueItem = <T>(
  map: (item?: ItemPlaylistPanelVideoRenderer) => T,
  array: QueueItem[],
): T[] =>
  array
    .map((item) => {
      if ('playlistPanelVideoWrapperRenderer' in item) {
        const keys = Object.keys(
          item.playlistPanelVideoWrapperRenderer!.primaryRenderer,
        ) as (keyof PlaylistPanelVideoWrapperRenderer['primaryRenderer'])[];
        return item.playlistPanelVideoWrapperRenderer!.primaryRenderer[keys[0]];
      }
      if ('playlistPanelVideoRenderer' in item) {
        return item.playlistPanelVideoRenderer;
      }

      console.error('Music Together: Unknown item', item);
      return undefined;
    })
    .map(map);

/** Cheap FNV-1a fingerprint of the queue order, used to detect desync. */
export const hashVideoIds = (videoIds: string[]) => {
  let hash = 0x811c9dc5;
  for (const id of videoIds) {
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x2c; // separator
    hash = Math.imul(hash, 0x01000193);
  }
  return `${videoIds.length}:${(hash >>> 0).toString(16)}`;
};
