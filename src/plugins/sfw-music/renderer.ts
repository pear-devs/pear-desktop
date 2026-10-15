import type { MusicPlayer } from '@/types/music-player';
import type { QueueElement } from '@/types/queue';

type QueueVideo = {
  videoId?: string;
  badges?: {
    musicInlineBadgeRenderer?: { icon?: { iconType?: string } };
  }[];
};

type QueueItem = {
  playlistPanelVideoRenderer?: QueueVideo;
  playlistPanelVideoWrapperRenderer?: {
    primaryRenderer?: { playlistPanelVideoRenderer?: QueueVideo };
    counterpart?: {
      counterpartRenderer?: { playlistPanelVideoRenderer?: QueueVideo };
    }[];
  };
};

type PlayerBar = HTMLElement & {
  getState?: () => {
    queue?: {
      items?: QueueItem[];
      selectedItemIndex?: number;
      repeatMode?: string;
    };
  };
};

export function startSfwMusic(api: MusicPlayer): () => void {
  let currentEntry: string | undefined;
  let handled = false;
  let blockedVideoId: string | undefined;
  let pendingCheck: ReturnType<typeof setTimeout> | undefined;
  const skipped = new Set<string>();

  const blockExplicitSelection = (event: Event) => {
    const target = event.target as Element | null;
    const playbackControl = target?.closest?.(
      'ytmusic-play-button-renderer, a[href*="watch?"]',
    );
    if (
      !playbackControl &&
      target?.closest?.(
        'a, button, ytmusic-menu-renderer, yt-icon-button, tp-yt-paper-icon-button',
      )
    )
      return;
    const control =
      playbackControl ?? target?.closest?.('ytmusic-player-queue-item');
    const rowSelector =
      'ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer, ytmusic-player-queue-item, ytmusic-card-shelf-renderer';
    const row = control?.closest(rowSelector);
    const badges = row?.querySelectorAll<
      HTMLElement & { data?: { icon?: { iconType?: string } } }
    >('ytmusic-inline-badge-renderer');
    if (
      badges &&
      [...badges].some(
        (badge) =>
          badge.closest(rowSelector) === row &&
          badge.data?.icon?.iconType === 'MUSIC_EXPLICIT_BADGE',
      )
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  const check = () => {
    const videoId = api.getVideoData()?.video_id;
    if (!videoId) return;
    // Queue selection may advance before the player actually leaves the song.
    if (videoId === blockedVideoId && api.getPlayerState() === 1) {
      api.pauseVideo();
    }

    const bar = document.querySelector<PlayerBar>('ytmusic-player-bar');
    const queue = bar?.getState?.()?.queue;
    const items = queue?.items ?? [];
    const findVideo = (item?: QueueItem) => {
      const wrapper = item?.playlistPanelVideoWrapperRenderer;
      return [
        item?.playlistPanelVideoRenderer,
        wrapper?.primaryRenderer?.playlistPanelVideoRenderer,
        ...(wrapper?.counterpart?.map(
          (entry) => entry.counterpartRenderer?.playlistPanelVideoRenderer,
        ) ?? []),
      ].find((entry) => entry?.videoId === videoId);
    };
    // Direct song selections can leave the queue index pointing at another song.
    let index = queue?.selectedItemIndex ?? -1;
    let video = findVideo(items[index]);
    if (!video) {
      index = items.findIndex((item) => !!findVideo(item));
      video = findVideo(items[index]);
    }
    if (!video) return;

    const entryKey = `${index}:${videoId}`;
    if (entryKey !== currentEntry) {
      currentEntry = entryKey;
      handled = false;
    }
    if (handled) return;

    const explicit = video.badges?.some(
      (badge) =>
        badge.musicInlineBadgeRenderer?.icon?.iconType ===
        'MUSIC_EXPLICIT_BADGE',
    );
    if (!explicit) {
      skipped.clear();
      return;
    }

    handled = true;
    blockedVideoId = videoId;
    api.pauseVideo();
    // Stop if an all-explicit queue wraps around instead of skipping forever.
    if (skipped.has(entryKey)) return;
    skipped.add(entryKey);
    if (index !== queue?.selectedItemIndex) {
      const nextIndex = index + 1 < items.length ? index + 1 : 0;
      if (nextIndex > 0 || queue?.repeatMode === 'ALL') {
        document.querySelector<QueueElement>('#queue')?.dispatch({
          type: 'SET_INDEX',
          payload: nextIndex,
        });
        return;
      }
    }
    bar?.querySelector<HTMLElement>('.next-button')?.click();
  };

  // Let YouTube finish its update before changing playback/queue state again.
  const scheduleCheck = () => {
    clearTimeout(pendingCheck);
    pendingCheck = setTimeout(check, 0);
  };
  api.addEventListener('videodatachange', scheduleCheck);
  api.addEventListener('onStateChange', scheduleCheck);
  // A direct selection can replace the queue before its metadata is available.
  document.addEventListener('click', blockExplicitSelection, true);
  document.addEventListener('tap', blockExplicitSelection, true);
  // Queue metadata can arrive after the player event, without another event.
  const timer = setInterval(check, 250);
  check();
  return () => {
    clearInterval(timer);
    clearTimeout(pendingCheck);
    api.removeEventListener('videodatachange', scheduleCheck);
    api.removeEventListener('onStateChange', scheduleCheck);
    document.removeEventListener('click', blockExplicitSelection, true);
    document.removeEventListener('tap', blockExplicitSelection, true);
  };
}
