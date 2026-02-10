import { type BrowserWindow, ipcMain } from 'electron';

import MprisPlayer, {
  LOOP_STATUS_NONE,
  LOOP_STATUS_PLAYLIST,
  LOOP_STATUS_TRACK,
  type LoopStatus,
  PLAYBACK_STATUS_PAUSED,
  PLAYBACK_STATUS_PLAYING,
  PLAYBACK_STATUS_STOPPED,
  type PlayBackStatus,
  type PlayerOptions,
  type Position,
  type Track,
} from '@jellybrick/mpris-service';

import {
  registerCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import { getSongControls } from '@/providers/song-controls';
import * as config from '@/config';
import { LoggerPrefix } from '@/utils';

import { APPLICATION_NAME } from '@/i18n';

import type { RepeatMode, VolumeState } from '@/types/datahost-get-state';
import type { QueueResponse } from '@/types/music-player-desktop-internal';

class YTPlayer extends MprisPlayer {
  /**
   * @type {number} The current position in microseconds
   * @private
   */
  private currentPosition: number;

  constructor(opts: PlayerOptions) {
    super(opts);

    this.currentPosition = 0;
  }

  setPosition(t: number) {
    this.currentPosition = t;
  }

  override getPosition(): number {
    return this.currentPosition;
  }

  setLoopStatus(status: LoopStatus) {
    this.loopStatus = status;
  }

  isPlaying(): boolean {
    return this.playbackStatus === PLAYBACK_STATUS_PLAYING;
  }

  isPaused(): boolean {
    return this.playbackStatus === PLAYBACK_STATUS_PAUSED;
  }

  isStopped(): boolean {
    return this.playbackStatus === PLAYBACK_STATUS_STOPPED;
  }

  setPlaybackStatus(status: PlayBackStatus) {
    this.playbackStatus = status;
  }
}

function setupMPRIS() {
  const instance = new YTPlayer({
    name: '\u0059\u006f\u0075\u0074\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063',
    identity: APPLICATION_NAME,
    supportedMimeTypes: ['audio/mpeg'],
    supportedInterfaces: ['player'],
  });

  instance.canRaise = true;
  instance.canQuit = false;
  instance.canUsePlayerControls = true;
  instance.supportedUriSchemes = ['http', 'https'];
  instance.desktopEntry =
    '\u0079\u006f\u0075\u0074\u0075\u0062\u0065\u002d\u006d\u0075\u0073\u0069\u0063';
  return instance;
}

export function registerMPRIS(win: BrowserWindow) {
  const songControls = getSongControls(win);
  const {
    playPause,
    next,
    previous,
    setVolume,
    shuffle,
    switchRepeat,
    setFullscreen,
    requestShuffleInformation,
    requestFullscreenInformation,
    requestQueueInformation,
  } = songControls;
  try {
    let currentSongInfo: SongInfo | null = null;
    const secToMicro = (n: number) => Math.round(Number(n) * 1e6);
    const microToSec = (n: number) => Math.round(Number(n) / 1e6);

    const correctId = (videoId: string) => {
      return videoId.replace(/-/g, '_MINUS_');
    };

    const player = setupMPRIS();

    const seekTo = (event: Position) => {
      if (
        currentSongInfo?.videoId &&
        event.trackId.endsWith(correctId(currentSongInfo.videoId))
      ) {
        win.webContents.send('peard:seek-to', microToSec(event.position ?? 0));
        player.setPosition(event.position ?? 0);
      }
    };
    const seekBy = (offset: number) => {
      win.webContents.send('peard:seek-by', microToSec(offset));
      player.setPosition(player.getPosition() + offset);
    };

    ipcMain.on('peard:player-api-loaded', () => {
      win.webContents.send('peard:setup-seeked-listener', 'mpris');
      win.webContents.send('peard:setup-time-changed-listener', 'mpris');
      win.webContents.send('peard:setup-repeat-changed-listener', 'mpris');
      win.webContents.send('peard:setup-volume-changed-listener', 'mpris');
      win.webContents.send('peard:setup-shuffle-changed-listener', 'mpris');
      win.webContents.send('peard:setup-fullscreen-changed-listener', 'mpris');
      win.webContents.send('peard:setup-autoplay-changed-listener', 'mpris');
      requestShuffleInformation();
      requestFullscreenInformation();
      requestQueueInformation();
    });

    ipcMain.on('peard:seeked', (_, t: number) => {
      player.setPosition(secToMicro(t));
      player.seeked(secToMicro(t));
    });

    ipcMain.on('peard:repeat-changed', (_, mode: RepeatMode) => {
      switch (mode) {
        case 'NONE': {
          player.setLoopStatus(LOOP_STATUS_NONE);
          break;
        }
        case 'ONE': {
          player.setLoopStatus(LOOP_STATUS_TRACK);
          break;
        }
        case 'ALL': {
          player.setLoopStatus(LOOP_STATUS_PLAYLIST);
          // No default
          break;
        }
      }
      requestQueueInformation();
    });

    ipcMain.on('peard:shuffle-changed', (_, shuffleEnabled: boolean) => {
      if (player.shuffle === undefined || !player.canUsePlayerControls) {
        return;
      }

      player.shuffle = shuffleEnabled ?? !player.shuffle;
    });

    ipcMain.on('peard:fullscreen-changed', (_, changedTo: boolean) => {
      if (player.fullscreen === undefined || !player.canUsePlayerControls) {
        return;
      }

      player.fullscreen =
        changedTo !== undefined ? changedTo : !player.fullscreen;
    });

    ipcMain.on(
      'peard:set-fullscreen',
      (_, isFullscreen: boolean | undefined) => {
        if (!player.canUsePlayerControls || isFullscreen === undefined) {
          return;
        }

        player.fullscreen = isFullscreen;
      },
    );

    ipcMain.on(
      'peard:fullscreen-changed-supported',
      (_, isFullscreenSupported: boolean) => {
        player.canUsePlayerControls = isFullscreenSupported;
      },
    );
    ipcMain.on('peard:autoplay-changed', (_) => {
      requestQueueInformation();
    });

    ipcMain.on('peard:get-queue-response', (_, queue: QueueResponse) => {
      if (!queue) {
        return;
      }

      const currentPosition =
        queue.items?.findIndex(
          (it) =>
            it?.playlistPanelVideoRenderer?.selected ||
            it?.playlistPanelVideoWrapperRenderer?.primaryRenderer
              ?.playlistPanelVideoRenderer?.selected,
        ) ?? 0;
      player.canGoPrevious = currentPosition !== 0;

      let hasNext: boolean;
      if (queue.autoPlaying) {
        hasNext = true;
      } else if (player.loopStatus === LOOP_STATUS_PLAYLIST) {
        hasNext = true;
      } else {
        // Example: currentPosition = 0, queue.items.length = 29 -> hasNext = true
        hasNext = !!(currentPosition - (queue?.items?.length ?? 0 - 1));
      }

      player.canGoNext = hasNext;
    });

    player.on('loopStatus', (status: LoopStatus) => {
      // SwitchRepeat cycles between states in that order
      const switches = [
        LOOP_STATUS_NONE,
        LOOP_STATUS_PLAYLIST,
        LOOP_STATUS_TRACK,
      ];
      const currentIndex = switches.indexOf(player.loopStatus);
      const targetIndex = switches.indexOf(status);

      // Get a delta in the range [0,2]
      const delta = (targetIndex - currentIndex + 3) % 3;
      switchRepeat(delta);
    });

    player.on('raise', () => {
      if (!player.canRaise) {
        return;
      }

      win.setSkipTaskbar(false);
      win.show();
    });

    player.on('fullscreen', (fullscreenEnabled: boolean) => {
      setFullscreen(fullscreenEnabled);
    });

    player.on('play', () => {
      if (!player.isPlaying()) {
        player.setPlaybackStatus(PLAYBACK_STATUS_PLAYING);
        playPause();
      }
    });
    player.on('pause', () => {
      if (!player.isPaused()) {
        player.setPlaybackStatus(PLAYBACK_STATUS_PAUSED);
        playPause();
      }
    });
    player.on('playpause', () => {
      player.setPlaybackStatus(
        player.isPlaying() ? PLAYBACK_STATUS_PAUSED : PLAYBACK_STATUS_PLAYING,
      );
      playPause();
    });

    player.on('next', () => {
      next();
    });

    player.on('previous', () => {
      previous();
    });

    player.on('seek', seekBy);
    player.on('position', seekTo);

    player.on('shuffle', (enableShuffle) => {
      if (!player.canUsePlayerControls || enableShuffle === undefined) {
        return;
      }

      player.shuffle = enableShuffle;

      if (enableShuffle) {
        shuffle();
        requestQueueInformation();
      }
    });
    player.on('open', (args: { uri: string }) => {
      win.loadURL(args.uri).then(() => {
        requestQueueInformation();
      });
    });

    player.on('error', (error: Error) => {
      console.error(LoggerPrefix, 'Error in MPRIS');
      console.trace(error);
    });

    ipcMain.on('peard:volume-changed', (_, newVolumeState: VolumeState) => {
      player.volume = newVolumeState.isMuted
        ? 0
        : Number.parseFloat((newVolumeState.state / 100).toFixed(2));
    });

    player.on('volume', async (newVolume: number) => {
      if (await config.plugins.isEnabled('precise-volume')) {
        // With precise volume we can set the volume to the exact value.
        win.webContents.send('setVolume', ~~(newVolume * 100));
      } else {
        setVolume(newVolume * 100);
      }
    });

    registerCallback((songInfo: SongInfo, event) => {
      if (event === SongInfoEvent.TimeChanged) {
        player.setPosition(secToMicro(songInfo.elapsedSeconds ?? 0));
        return;
      }
      if (player) {
        const data: Track = {
          'mpris:length': secToMicro(songInfo.songDuration),
          ...(songInfo.imageSrc
            ? { 'mpris:artUrl': songInfo.imageSrc }
            : undefined),
          'xesam:title': songInfo.title,
          'xesam:url': songInfo.url,
          'xesam:artist': [songInfo.artist],
          'mpris:trackid': player.objectPath(
            `Track/${correctId(songInfo.videoId)}`,
          ),
        };
        if (songInfo.album) {
          data['xesam:album'] = songInfo.album;
        }
        currentSongInfo = songInfo;

        player.metadata = data;

        const currentElapsedMicroSeconds = secToMicro(
          songInfo.elapsedSeconds ?? 0,
        );
        player.setPosition(currentElapsedMicroSeconds);
        player.seeked(currentElapsedMicroSeconds);

        player.setPlaybackStatus(
          songInfo.isPaused ? PLAYBACK_STATUS_PAUSED : PLAYBACK_STATUS_PLAYING,
        );
      }
      requestQueueInformation();
    });
  } catch (error) {
    console.error(LoggerPrefix, 'Error in MPRIS');
    console.trace(error);
  }
}
