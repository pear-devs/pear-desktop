import MprisPlayer, {
  type LoopStatus,
  type PlayBackStatus,
  type PlayerOptions,
  type Position,
  type Track,
} from '@jellybrick/mpris-service';

import * as config from '@/config';
import { APPLICATION_NAME } from '@/i18n';
import { getSongControls } from '@/providers/song-controls';
import { type SongInfo, SongInfoEvent } from '@/providers/song-info';
import { LoggerPrefix } from '@/utils';

import type { shortcutsConfig } from './types';
import type { ConfigOf } from '@/plugins/utils/common/config';
import type { BackendContext } from '@/types/contexts';
import type { RepeatMode, VolumeState } from '@/types/datahost-get-state';
import type { QueueResponse } from '@/types/music-player-desktop-internal';

class YTPlayer extends MprisPlayer {
  /**
   * @type {number} The current position in microseconds
   * @private
   */
  private currentPosition: number = 0;
  canUsePlayerControls: boolean = false;

  constructor(opts: PlayerOptions) {
    super(opts);
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
    return this.playbackStatus === MprisPlayer.PLAYBACK_STATUS_PLAYING;
  }

  isPaused(): boolean {
    return this.playbackStatus === MprisPlayer.PLAYBACK_STATUS_PAUSED;
  }

  isStopped(): boolean {
    return this.playbackStatus === MprisPlayer.PLAYBACK_STATUS_STOPPED;
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

/** The D-Bus connection behind a player (private in the library's types). */
const busOf = (player: MprisPlayer) =>
  (player as unknown as { _bus?: { disconnect(): void } })._bus;

export function registerMPRIS(
  ctx: BackendContext<ConfigOf<typeof shortcutsConfig>>,
) {
  const { window: win } = ctx;
  const { core } = ctx.ipc;
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
    // Releases the MPRIS name; the player's own listeners go with it.
    ctx.onCleanup(() => busOf(player)?.disconnect());

    const seekTo = (event: Position) => {
      if (
        currentSongInfo?.videoId &&
        event.trackId.endsWith(correctId(currentSongInfo.videoId))
      ) {
        core.send('peard:seek-to', microToSec(event.position ?? 0));
        player.setPosition(event.position ?? 0);
      }
    };
    const seekBy = (offset: number) => {
      core.send('peard:seek-by', microToSec(offset));
      player.setPosition(player.getPosition() + offset);
    };

    core.on('peard:player-api-loaded', () => {
      core.send('peard:setup-seeked-listener', 'mpris');
      core.send('peard:setup-time-changed-listener', 'mpris');
      core.send('peard:setup-repeat-changed-listener', 'mpris');
      core.send('peard:setup-volume-changed-listener', 'mpris');
      core.send('peard:setup-shuffle-changed-listener', 'mpris');
      core.send('peard:setup-fullscreen-changed-listener', 'mpris');
      core.send('peard:setup-autoplay-changed-listener', 'mpris');
      requestShuffleInformation();
      requestFullscreenInformation();
      requestQueueInformation();
    });

    core.on('peard:seeked', (t: number) => {
      player.setPosition(secToMicro(t));
      player.seeked(secToMicro(t));
    });

    core.on('peard:repeat-changed', (mode: RepeatMode) => {
      switch (mode) {
        case 'NONE': {
          player.setLoopStatus(MprisPlayer.LOOP_STATUS_NONE);
          break;
        }
        case 'ONE': {
          player.setLoopStatus(MprisPlayer.LOOP_STATUS_TRACK);
          break;
        }
        case 'ALL': {
          player.setLoopStatus(MprisPlayer.LOOP_STATUS_PLAYLIST);
          // No default
          break;
        }
      }
      requestQueueInformation();
    });

    core.on('peard:shuffle-changed', (shuffleEnabled: boolean) => {
      if (player.shuffle === undefined || !player.canUsePlayerControls) {
        return;
      }

      player.shuffle = shuffleEnabled ?? !player.shuffle;
    });

    core.on('peard:fullscreen-changed', (changedTo: boolean) => {
      if (player.fullscreen === undefined || !player.canUsePlayerControls) {
        return;
      }

      player.fullscreen =
        changedTo !== undefined ? changedTo : !player.fullscreen;
    });

    core.on('peard:set-fullscreen', (isFullscreen: boolean | undefined) => {
      if (!player.canUsePlayerControls || isFullscreen === undefined) {
        return;
      }

      player.fullscreen = isFullscreen;
    });

    core.on(
      'peard:fullscreen-changed-supported',
      (isFullscreenSupported: boolean) => {
        player.canUsePlayerControls = isFullscreenSupported;
      },
    );
    core.on('peard:autoplay-changed', () => {
      requestQueueInformation();
    });

    core.on('peard:get-queue-response', (queue: QueueResponse) => {
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
      } else if (player.loopStatus === MprisPlayer.LOOP_STATUS_PLAYLIST) {
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
        MprisPlayer.LOOP_STATUS_NONE,
        MprisPlayer.LOOP_STATUS_PLAYLIST,
        MprisPlayer.LOOP_STATUS_TRACK,
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
        player.setPlaybackStatus(MprisPlayer.PLAYBACK_STATUS_PLAYING);
        playPause();
      }
    });
    player.on('pause', () => {
      if (!player.isPaused()) {
        player.setPlaybackStatus(MprisPlayer.PLAYBACK_STATUS_PAUSED);
        playPause();
      }
    });
    player.on('playpause', () => {
      player.setPlaybackStatus(
        player.isPlaying()
          ? MprisPlayer.PLAYBACK_STATUS_PAUSED
          : MprisPlayer.PLAYBACK_STATUS_PLAYING,
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

    core.on('peard:volume-changed', (newVolumeState: VolumeState) => {
      player.volume = newVolumeState.isMuted
        ? 0
        : Number.parseFloat((newVolumeState.state / 100).toFixed(2));
    });

    player.on('volume', async (newVolume: number) => {
      if (await config.plugins.isEnabled('precise-volume')) {
        // With precise volume we can set the volume to the exact value.
        core.send('setVolume', ~~(newVolume * 100));
      } else {
        setVolume(newVolume * 100);
      }
    });

    ctx.onSongInfo((songInfo: SongInfo, event) => {
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
          songInfo.isPaused
            ? MprisPlayer.PLAYBACK_STATUS_PAUSED
            : MprisPlayer.PLAYBACK_STATUS_PLAYING,
        );
      }
      requestQueueInformation();
    });
  } catch (error) {
    console.error(LoggerPrefix, 'Error in MPRIS');
    console.trace(error);
  }
}
