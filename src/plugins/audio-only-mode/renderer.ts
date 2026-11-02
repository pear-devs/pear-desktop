import { createRenderer } from '@/utils';

import type { MusicPlayer } from '@/types/music-player';

type QueueItem = Element & {
  getMenuRenderer?: () => {
    items?: {
      toggleMenuServiceItemRenderer?: {
        defaultServiceEndpoint?: {
          likeEndpoint?: {
            target?: { videoId?: string };
          };
        };
      };
    }[];
  };
};

/** Returns the catalog audio ID exposed by the selected queue item. */
function getCanonicalVideoId(queueItem: QueueItem): string | undefined {
  const menu = queueItem?.getMenuRenderer?.();

  for (const item of menu?.items ?? []) {
    const videoId =
      item?.toggleMenuServiceItemRenderer?.defaultServiceEndpoint?.likeEndpoint
        ?.target?.videoId;

    if (videoId) {
      return videoId;
    }
  }

  return undefined;
}

export const renderer = createRenderer<{
  player?: MusicPlayer;
  lastVideoId?: string;
  stateChangeHandler?: () => void;
}>({
  start() {
    console.log('[Audio only mode] Renderer started');
  },

  onPlayerApiReady(api) {
    if (this.player && this.stateChangeHandler) {
      this.player.removeEventListener('onStateChange', this.stateChangeHandler);
    }
    this.lastVideoId = undefined;

    const player = api;
    this.player = player;

    const checkCurrentTrack = () => {
      const response = player.getPlayerResponse?.();
      const details = response?.videoDetails;

      if (!details?.videoId) return;

      const { videoId, title, author, musicVideoType } = details;

      // Evita procesar varias veces el mismo video por los
      // múltiples onStateChange que dispara el reproductor.
      if (videoId === this.lastVideoId) return;

      console.log('[Audio only mode] Track:', {
        videoId,
        title,
        author,
        musicVideoType,
      });
      switch (musicVideoType) {
        case 'MUSIC_VIDEO_TYPE_ATV':
          // Already playing catalog audio.
          this.lastVideoId = videoId;
          return;

        case 'MUSIC_VIDEO_TYPE_OMV':
          // Try to replace with canonical audio.
          break;

        case 'MUSIC_VIDEO_TYPE_UGC':
          this.lastVideoId = videoId;
          console.log(
            '[Audio only mode] UGC track detected. Keeping original.',
          );
          return;

        default:
          this.lastVideoId = videoId;
          console.log(
            '[Audio only mode] Unsupported musicVideoType. Keeping original:',
            musicVideoType,
          );
          return;
      }
      const queueItem = document.querySelector<QueueItem>(
        'ytmusic-player-queue-item[selected]',
      );

      if (!queueItem) {
        console.warn('[Audio only mode] Could not find selected queue item.');
        return;
      }

      const canonicalVideoId = getCanonicalVideoId(queueItem);

      if (!canonicalVideoId) {
        console.warn(
          '[Audio only mode] Could not find canonical audio videoId.',
        );
        return;
      }

      if (canonicalVideoId === videoId) {
        this.lastVideoId = videoId;
        console.log(
          '[Audio only mode] Canonical videoId is the current video.',
        );
        return;
      }

      const currentTime = player.getCurrentTime?.() ?? 0;

      console.log('[Audio only mode] Replacing music video:', {
        from: videoId,
        to: canonicalVideoId,
        startSeconds: currentTime,
      });

      this.lastVideoId = canonicalVideoId;
      player.loadVideoById(canonicalVideoId, currentTime, 'default');
    };

    this.stateChangeHandler = checkCurrentTrack;

    player.addEventListener('onStateChange', this.stateChangeHandler);

    checkCurrentTrack();
  },

  stop() {
    if (this.player && this.stateChangeHandler) {
      this.player.removeEventListener('onStateChange', this.stateChangeHandler);
    }

    this.player = undefined;
    this.stateChangeHandler = undefined;
    this.lastVideoId = undefined;

    console.log('[Audio only mode] Renderer stopped');
  },
});
