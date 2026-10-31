import type {
  LongBylineText,
  QueueItem,
  RepeatMode,
  Subtitle,
  ThumbnailDetailsClass,
} from '@/types/datahost-get-state';
import type { QueueElement } from '@/types/queue';

export interface QueueTrack {
  videoId: string;
  title: string;
  /** First artist in the byline, when the queue lists one */
  artist: string;
  /** Album browse id (MPRE...), when the queue knows it */
  albumId?: string;
  /** Square artwork, large enough for the player's big image */
  art?: string;
}

interface TrackRenderer {
  videoId: string;
  title?: Subtitle;
  longBylineText?: LongBylineText;
  thumbnail?: ThumbnailDetailsClass;
  selected?: boolean;
}

/** The queue lists small thumbnails; Google's image URLs take a size */
const ART_SIZE = 544;
export const largeArt = (url: string | undefined) =>
  url?.replace(/=w\d+-h\d+/, `=w${ART_SIZE}-h${ART_SIZE}`);

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
    artist: renderer.longBylineText?.runs?.[0]?.text ?? '',
    albumId,
    art: largeArt(renderer.thumbnail?.thumbnails?.at(-1)?.url),
  };
};

export interface QueueSnapshot {
  current: QueueTrack | null;
  next: QueueTrack | null;
  /** The song after `next`, analysed ahead so queue edits are covered */
  afterNext: QueueTrack | null;
  repeatMode: RepeatMode;
}

/**
 * Reads the current and upcoming song from the player queue.
 * When the player is on the "video" side of a song, the next track's
 * video counterpart is returned too, since that's what will play.
 */
export const getQueueStore = () =>
  document.querySelector<QueueElement>('#queue')?.queue?.store?.store;

type QueueState = NonNullable<
  ReturnType<NonNullable<ReturnType<typeof getQueueStore>>['getState']>
>['queue'];

/** Index of the playing item, and whether it plays the item's counterpart */
const locate = (state: QueueState, playingId: string | null) => {
  const selected = state.items.findIndex(
    (item) => primaryOf(item)?.selected || counterpartOf(item)?.selected,
  );

  // Trust the song that's actually playing over the "selected" flag, which
  // can lag behind after a programmatic skip. If the same song is queued
  // more than once, take the copy closest to the selected one.
  let index = -1;
  if (playingId !== null) {
    state.items.forEach((item, i) => {
      if (
        (primaryOf(item)?.videoId === playingId ||
          counterpartOf(item)?.videoId === playingId) &&
        (index < 0 ||
          Math.abs(i - Math.max(selected, 0)) <
            Math.abs(index - Math.max(selected, 0)))
      ) {
        index = i;
      }
    });
  }
  if (index < 0) index = selected;
  if (index < 0) return null;

  const currentItem = state.items[index];
  const onCounterpart =
    playingId !== null &&
    primaryOf(currentItem)?.videoId !== playingId &&
    counterpartOf(currentItem)?.videoId === playingId;
  return { index, onCounterpart };
};

export const readQueue = (playingId: string | null): QueueSnapshot | null => {
  const state = getQueueStore()?.getState()?.queue;
  if (!state?.items?.length) return null;
  const located = locate(state, playingId);
  if (!located) return null;
  const { index, onCounterpart } = located;
  const currentItem = state.items[index];

  // With Autoplay on, the player carries on into its suggestions (listed
  // under the queue) once the queue itself runs out
  const autoplayItems =
    state.autoplay && Array.isArray(state.automixItems)
      ? (state.automixItems as QueueItem[])
      : [];

  const itemAt = (offset: number): QueueItem | undefined => {
    const at = index + offset;
    if (at < state.items.length) return state.items[at];
    if (state.repeatMode === 'ALL') {
      return state.items[at % state.items.length];
    }
    return autoplayItems[at - state.items.length];
  };

  const pick = (item: QueueItem | undefined) => {
    if (!item) return undefined;
    return (onCounterpart && counterpartOf(item)) || primaryOf(item);
  };

  return {
    current: toTrack(pick(currentItem)),
    next: toTrack(pick(itemAt(1))),
    afterNext: toTrack(pick(itemAt(2))),
    repeatMode: state.repeatMode,
  };
};

export interface QueueEntry {
  /** Position in the queue */
  index: number;
  track: QueueTrack;
}

/**
 * The playing song and up to `limit` queued songs after it (not Autoplay
 * suggestions), as the player will play them
 */
export const readUpcoming = (playingId: string | null, limit: number) => {
  const state = getQueueStore()?.getState()?.queue;
  if (!state?.items?.length) return null;
  const located = locate(state, playingId);
  if (!located) return null;
  const { index, onCounterpart } = located;
  const trackAt = (i: number) => {
    const item = state.items[i];
    return toTrack((onCounterpart && counterpartOf(item)) || primaryOf(item));
  };
  const current = trackAt(index);
  if (!current) return null;
  const upcoming: QueueEntry[] = [];
  for (
    let i = index + 1;
    i < state.items.length && upcoming.length < limit;
    i++
  ) {
    const track = trackAt(i);
    if (track) upcoming.push({ index: i, track });
  }
  return { current, upcoming };
};

/** Moves a queue item, the way the player's own drag and drop does */
export const moveQueueItem = (fromIndex: number, toIndex: number) => {
  document
    .querySelector<QueueElement>('#queue')
    ?.dispatch({ type: 'MOVE_ITEM', payload: { fromIndex, toIndex } });
};
