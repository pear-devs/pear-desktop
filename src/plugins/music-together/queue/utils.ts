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
