import type {
  LongBylineText,
  QueueItem,
  RepeatMode,
  Subtitle,
} from '@/types/datahost-get-state';
import type { QueueElement } from '@/types/queue';

export interface QueueTrack {
  videoId: string;
  title: string;
  /** Album browse id (MPRE...), when the queue knows it */
  albumId?: string;
}

interface TrackRenderer {
  videoId: string;
  title?: Subtitle;
  longBylineText?: LongBylineText;
  selected?: boolean;
}

const primaryOf = (item: QueueItem): TrackRenderer | undefined =>
  item.playlistPanelVideoRenderer ??
  item.playlistPanelVideoWrapperRenderer?.primaryRenderer
    ?.playlistPanelVideoRenderer;

/** The "video" version of a "song" (or vice versa), when there is one */
const counterpartOf = (item: QueueItem): TrackRenderer | undefined =>
  item.playlistPanelVideoWrapperRenderer?.counterpart?.[0]?.counterpartRenderer
    ?.playlistPanelVideoRenderer;

const toTrack = (renderer: TrackRenderer | undefined): QueueTrack | null => {
  if (!renderer?.videoId) return null;

  const albumId = renderer.longBylineText?.runs
    ?.map((run) => run.navigationEndpoint?.browseEndpoint?.browseId)
    .find((id) => id?.startsWith('MPRE'));

  return {
    videoId: renderer.videoId,
    title: renderer.title?.runs?.map((run) => run.text).join('') ?? '',
    albumId,
  };
};

export interface QueueSnapshot {
  current: QueueTrack | null;
  next: QueueTrack | null;
  repeatMode: RepeatMode;
}

/**
 * Reads the current and upcoming song from the player queue.
 * When the player is on the "video" side of a song, the next track's
 * video counterpart is returned too, since that's what will play.
 */
export const readQueue = (playingId: string | null): QueueSnapshot | null => {
  const state = document
    .querySelector<QueueElement>('#queue')
    ?.queue?.store?.store?.getState()?.queue;
  if (!state?.items?.length) return null;

  const index = state.items.findIndex(
    (item) => primaryOf(item)?.selected || counterpartOf(item)?.selected,
  );
  if (index < 0) return null;

  const currentItem = state.items[index];
  const onCounterpart =
    playingId !== null &&
    primaryOf(currentItem)?.videoId !== playingId &&
    counterpartOf(currentItem)?.videoId === playingId;

  let nextItem: QueueItem | undefined = state.items[index + 1];
  if (!nextItem && state.repeatMode === 'ALL') nextItem = state.items[0];

  const pick = (item: QueueItem | undefined) => {
    if (!item) return undefined;
    return (onCounterpart && counterpartOf(item)) || primaryOf(item);
  };

  return {
    current: toTrack(pick(currentItem)),
    next: toTrack(pick(nextItem)),
    repeatMode: state.repeatMode,
  };
};
