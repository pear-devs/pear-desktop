import { singleton } from './decorators';

import { LikeType, type GetState } from '@/types/datahost-get-state';

import type { MusicPlayer } from '@/types/music-player';
import type {
  AlbumDetails,
  PlayerOverlays,
  VideoDataChangeValue,
} from '@/types/player-api-events';

import type { SongInfo } from './song-info';
import type { VideoDataChanged } from '@/types/video-data-changed';

const DATAUPDATED_FALLBACK_TIMEOUT_MS = 1500;

let songInfo: SongInfo = {} as SongInfo;
export const getSongInfo = () => songInfo;

window.ipcRenderer.on(
  'peard:update-song-info',
  (_, extractedSongInfo: SongInfo) => {
    songInfo = extractedSongInfo;
  },
);

// Used because 'loadeddata' or 'loadedmetadata' weren't firing on song start for some users (https://github.com/pear-devs/pear-desktop/issues/473)
const srcChangedEvent = new CustomEvent('peard:src-changed');

export const setupSeekedListener = singleton(() => {
  document.querySelector('video')?.addEventListener('seeked', (v) => {
    if (v.target instanceof HTMLVideoElement) {
      window.ipcRenderer.send('peard:seeked', v.target.currentTime);
    }
  });
});

export const setupTimeChangedListener = singleton(() => {
  const progressObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const target = mutation.target as Node & { value: string };
      const numberValue = Number(target.value);
      window.ipcRenderer.send('peard:time-changed', numberValue);
      songInfo.elapsedSeconds = numberValue;
    }
  });
  const progressBar = document.querySelector('#progress-bar');
  if (progressBar) {
    progressObserver.observe(progressBar, { attributeFilter: ['value'] });
  }
});

export const setupRepeatChangedListener = singleton(() => {
  const repeatObserver = new MutationObserver((mutations) => {
    // provided by App
    window.ipcRenderer.send(
      'peard:repeat-changed',
      (
        mutations[0].target as Node & {
          __dataHost: {
            getState: () => GetState;
          };
        }
      ).__dataHost.getState().queue.repeatMode,
    );
  });
  repeatObserver.observe(document.querySelector('#right-controls .repeat')!, {
    attributeFilter: ['title'],
  });

  // Emit the initial value as well; as it's persistent between launches.
  // provided by App
  window.ipcRenderer.send(
    'peard:repeat-changed',
    document
      .querySelector<
        HTMLElement & {
          getState: () => GetState;
        }
      >('ytmusic-player-bar')
      ?.getState().queue.repeatMode,
  );
});

const mapLikeStatus = (status: string | null): LikeType =>
  Object.values(LikeType).includes(status as LikeType)
    ? (status as LikeType)
    : LikeType.Indifferent;

const LIKE_STATUS_ATTRIBUTE = 'like-status';

export const setupLikeChangedListener = singleton(() => {
  const likeDislikeObserver = new MutationObserver((mutations) => {
    window.ipcRenderer.send(
      'peard:like-changed',
      mapLikeStatus(
        (mutations[0].target as HTMLElement)?.getAttribute?.(
          LIKE_STATUS_ATTRIBUTE,
        ),
      ),
    );
  });
  const likeButtonRenderer = document.querySelector('#like-button-renderer');
  if (likeButtonRenderer) {
    likeDislikeObserver.observe(likeButtonRenderer, {
      attributes: true,
      attributeFilter: [LIKE_STATUS_ATTRIBUTE],
    });

    // Emit the initial value as well; as it's persistent between launches.
    window.ipcRenderer.send(
      'peard:like-changed',
      mapLikeStatus(likeButtonRenderer.getAttribute?.(LIKE_STATUS_ATTRIBUTE)),
    );
  }
});

export const setupVolumeChangedListener = singleton((api: MusicPlayer) => {
  document.querySelector('video')?.addEventListener('volumechange', () => {
    window.ipcRenderer.send('peard:volume-changed', {
      state: api.getVolume(),
      isMuted: api.isMuted(),
    });
  });

  // Emit the initial value as well; as it's persistent between launches.
  window.ipcRenderer.send('peard:volume-changed', {
    state: api.getVolume(),
    isMuted: api.isMuted(),
  });
});

export const setupShuffleChangedListener = singleton(() => {
  const playerBar = document.querySelector('ytmusic-player-bar');

  if (!playerBar) {
    window.ipcRenderer.send('peard:shuffle-changed-supported', false);
    return;
  }

  const observer = new MutationObserver(() => {
    window.ipcRenderer.send(
      'peard:shuffle-changed',
      (playerBar?.attributes.getNamedItem('shuffle-on') ?? null) !== null,
    );
  });

  observer.observe(playerBar, {
    attributes: true,
    attributeFilter: ['shuffle-on'],
    childList: false,
    subtree: false,
  });
});

export const setupFullScreenChangedListener = singleton(() => {
  const playerBar = document.querySelector('ytmusic-player-bar');

  if (!playerBar) {
    window.ipcRenderer.send('peard:fullscreen-changed-supported', false);
    return;
  }

  const observer = new MutationObserver(() => {
    window.ipcRenderer.send(
      'peard:fullscreen-changed',
      (playerBar?.attributes.getNamedItem('player-fullscreened') ?? null) !==
        null,
    );
  });

  observer.observe(playerBar, {
    attributes: true,
    attributeFilter: ['player-fullscreened'],
    childList: false,
    subtree: false,
  });
});

export const setupAutoPlayChangedListener = singleton(() => {
  const autoplaySlider = document.querySelector<HTMLInputElement>(
    '.autoplay > tp-yt-paper-toggle-button',
  );

  const observer = new MutationObserver(() => {
    window.ipcRenderer.send('peard:autoplay-changed');
  });

  observer.observe(autoplaySlider!, {
    attributes: true,
    childList: false,
    subtree: false,
  });
});

export const setupSongInfo = (api: MusicPlayer) => {
  window.ipcRenderer.on('peard:setup-time-changed-listener', () => {
    setupTimeChangedListener();
  });

  window.ipcRenderer.on('peard:setup-like-changed-listener', () => {
    setupLikeChangedListener();
  });

  window.ipcRenderer.on('peard:setup-repeat-changed-listener', () => {
    setupRepeatChangedListener();
  });

  window.ipcRenderer.on('peard:setup-volume-changed-listener', () => {
    setupVolumeChangedListener(api);
  });

  window.ipcRenderer.on('peard:setup-shuffle-changed-listener', () => {
    setupShuffleChangedListener();
  });

  window.ipcRenderer.on('peard:setup-fullscreen-changed-listener', () => {
    setupFullScreenChangedListener();
  });

  window.ipcRenderer.on('peard:setup-autoplay-changed-listener', () => {
    setupAutoPlayChangedListener();
  });

  window.ipcRenderer.on('peard:setup-seeked-listener', () => {
    setupSeekedListener();
  });

  const playPausedHandler = (e: Event, status: string) => {
    if (
      e.target instanceof HTMLVideoElement &&
      Math.round(e.target.currentTime) > 0
    ) {
      window.ipcRenderer.send('peard:play-or-paused', {
        isPaused: status === 'pause',
        elapsedSeconds: Math.floor(e.target.currentTime),
      });
    }
  };

  const playPausedHandlers = {
    playing: (e: Event) => playPausedHandler(e, 'playing'),
    pause: (e: Event) => playPausedHandler(e, 'pause'),
  };

  const videoEventDispatcher = async (
    name: string,
    videoData: VideoDataChangeValue,
    // eslint-disable-next-line @typescript-eslint/require-await
  ) =>
    document.dispatchEvent(
      new CustomEvent<VideoDataChanged>('videodatachange', {
        detail: { name, videoData },
      }),
    );

  const waitingEvent = new Set<string>();
  const waitingTimeouts = new Map<string, NodeJS.Timeout>();

  const clearVideoTimeout = (videoId: string) => {
    const timeoutId = waitingTimeouts.get(videoId);

    if (timeoutId) {
      clearTimeout(timeoutId);
      waitingTimeouts.delete(videoId);
    }
  };

  // Name = "dataloaded" and abit later "dataupdated"
  // Sometimes "dataupdated" is not fired, so we need to fallback to "dataloaded"
  api.addEventListener('videodatachange', (name, videoData) => {
    videoEventDispatcher(name, videoData);

    if (name === 'dataupdated' && waitingEvent.has(videoData.videoId)) {
      waitingEvent.delete(videoData.videoId);
      clearVideoTimeout(videoData.videoId);
      sendSongInfo(videoData);
    } else if (name === 'dataloaded') {
      const video = document.querySelector<HTMLVideoElement>('video');
      video?.dispatchEvent(srcChangedEvent);

      for (const status of ['playing', 'pause'] as const) {
        // for fix issue that pause event not fired
        video?.addEventListener(status, playPausedHandlers[status]);
      }

      clearVideoTimeout(videoData.videoId);
      waitingEvent.add(videoData.videoId);

      const timeoutId = setTimeout(() => {
        if (waitingEvent.has(videoData.videoId)) {
          waitingEvent.delete(videoData.videoId);
          waitingTimeouts.delete(videoData.videoId);
          sendSongInfo(videoData);
        }
      }, DATAUPDATED_FALLBACK_TIMEOUT_MS);

      waitingTimeouts.set(videoData.videoId, timeoutId);
    }
  });

  const video = document.querySelector('video');

  if (video) {
    for (const status of ['playing', 'pause'] as const) {
      video.addEventListener(status, playPausedHandlers[status]);
    }

    if (!isNaN(video.duration)) {
      const {
        title,
        author,
        video_id: videoId,
        list: playlistId,
      } = api.getVideoData();

      const watchNextResponse = api.getWatchNextResponse();

      sendSongInfo({
        title,
        author,
        videoId,
        playlistId,

        isUpcoming: false,
        lengthSeconds: video.duration,
        loading: true,

        ['\u0079\u0074\u006d\u0064WatchNextResponse']: watchNextResponse,
      } satisfies VideoDataChangeValue);
    }
  }

  function sendSongInfo(videoData: VideoDataChangeValue) {
    const data = api.getPlayerResponse();

    let playerOverlay: PlayerOverlays | undefined;

    if (!videoData['\u0079\u0074\u006d\u0064WatchNextResponse']) {
      playerOverlay = (
        Object.entries(videoData).find(
          ([, value]) => value && Object.hasOwn(value, 'playerOverlays'),
        ) as [string, AlbumDetails | undefined]
      )?.[1]?.playerOverlays;
    } else {
      playerOverlay =
        videoData['\u0079\u0074\u006d\u0064WatchNextResponse']?.playerOverlays;
    }
    data.videoDetails.album =
      playerOverlay?.playerOverlayRenderer?.browserMediaSession?.browserMediaSessionRenderer?.album?.runs?.at(
        0,
      )?.text;
    data.videoDetails.elapsedSeconds = 0;
    data.videoDetails.isPaused = false;

    window.ipcRenderer.send('peard:video-src-changed', data);
  }
};
