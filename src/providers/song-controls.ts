// This is used for to control the songs
import { randomUUID } from 'node:crypto';

import { type BrowserWindow, ipcMain } from 'electron';

import { LikeType } from '@/types/datahost-get-state';

// see protocol-handler.ts
type ArgsType<T> = T | string[] | undefined;

const parseNumberFromArgsType = (args: ArgsType<number>) => {
  if (typeof args === 'number') {
    return args;
  } else if (Array.isArray(args)) {
    return Number(args[0]);
  } else {
    return null;
  }
};

const parseBooleanFromArgsType = (args: ArgsType<boolean>) => {
  if (typeof args === 'boolean') {
    return args;
  } else if (Array.isArray(args)) {
    return args[0] === 'true';
  } else {
    return null;
  }
};

const parseStringFromArgsType = (args: ArgsType<string>) => {
  if (typeof args === 'string') {
    return args;
  } else if (Array.isArray(args)) {
    return args[0];
  } else {
    return null;
  }
};

export const getSongControls = (win: BrowserWindow) => {
  return {
    // Playback
    previous: () => win.webContents.send('peard:previous-video'),
    next: () => win.webContents.send('peard:next-video'),
    play: () => win.webContents.send('peard:play'),
    pause: () => win.webContents.send('peard:pause'),
    playPause: () => win.webContents.send('peard:toggle-play'),
    like: () => win.webContents.send('peard:update-like', LikeType.Like),
    dislike: () => win.webContents.send('peard:update-like', LikeType.Dislike),
    seekTo: (seconds: ArgsType<number>) => {
      const secondsNumber = parseNumberFromArgsType(seconds);
      if (secondsNumber !== null) {
        win.webContents.send('peard:seek-to', seconds);
      }
    },
    goBack: (seconds: ArgsType<number>) => {
      const secondsNumber = parseNumberFromArgsType(seconds);
      if (secondsNumber !== null) {
        win.webContents.send('peard:seek-by', -secondsNumber);
      }
    },
    goForward: (seconds: ArgsType<number>) => {
      const secondsNumber = parseNumberFromArgsType(seconds);
      if (secondsNumber !== null) {
        win.webContents.send('peard:seek-by', seconds);
      }
    },
    requestShuffleInformation: () => {
      win.webContents.send('peard:get-shuffle');
    },
    shuffle: () => win.webContents.send('peard:shuffle'),
    switchRepeat: (n: ArgsType<number> = 1) => {
      const repeat = parseNumberFromArgsType(n);
      if (repeat !== null) {
        win.webContents.send('peard:switch-repeat', n);
      }
    },
    // General
    setVolume: (volume: ArgsType<number>) => {
      const volumeNumber = parseNumberFromArgsType(volume);
      if (volumeNumber !== null) {
        win.webContents.send('peard:update-volume', volume);
      }
    },
    setFullscreen: (isFullscreen: ArgsType<boolean>) => {
      const isFullscreenValue = parseBooleanFromArgsType(isFullscreen);
      if (isFullscreenValue !== null) {
        win.setFullScreen(isFullscreenValue);
        win.webContents.send(
          'peard:click-fullscreen-button',
          isFullscreenValue,
        );
      }
    },
    requestFullscreenInformation: () => {
      win.webContents.send('peard:get-fullscreen');
    },
    requestQueueInformation: () => {
      win.webContents.send('peard:get-queue');
    },
    muteUnmute: () => win.webContents.send('peard:toggle-mute'),
    openSearchBox: () => {
      win.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: '/',
      });
    },
    // Queue
    addSongToQueue: (videoId: string, queueInsertPosition: string) => {
      const videoIdValue = parseStringFromArgsType(videoId);
      if (videoIdValue === null) return;

      win.webContents.send(
        'peard:add-to-queue',
        videoIdValue,
        queueInsertPosition,
      );
    },
    addSongsToQueue: (videoIds: string[], queueInsertPosition: string) => {
      if (!Array.isArray(videoIds) || videoIds.length === 0) return;
      win.webContents.send(
        'peard:add-many-to-queue',
        videoIds,
        queueInsertPosition,
      );
    },
    addSongsToPlaylist: (playlistId: string, videoIds: string[]) =>
      new Promise<void>((resolve, reject) => {
        const responseChannel = `peard:add-songs-to-playlist-response:${randomUUID()}`;
        const timeout = setTimeout(() => {
          ipcMain.removeAllListeners(responseChannel);
          reject(new Error('Adding songs to playlist timed out'));
        }, 10_000);

        ipcMain.once(responseChannel, (_, error?: string) => {
          clearTimeout(timeout);
          if (error) {
            reject(new Error(error));
          } else {
            resolve();
          }
        });

        win.webContents.send(
          'peard:add-songs-to-playlist',
          responseChannel,
          playlistId,
          videoIds,
        );
      }),
    getPlaylistInfo: (playlistId: string) =>
      new Promise<unknown>((resolve, reject) => {
        const responseChannel = `peard:get-playlist-info-response:${randomUUID()}`;
        const timeout = setTimeout(() => {
          ipcMain.removeAllListeners(responseChannel);
          reject(new Error('Getting playlist info timed out'));
        }, 15_000);

        ipcMain.once(responseChannel, (_, error?: string, data?: unknown) => {
          clearTimeout(timeout);
          if (error) {
            reject(new Error(error));
          } else {
            resolve(data);
          }
        });

        win.webContents.send(
          'peard:get-playlist-info',
          responseChannel,
          playlistId,
        );
      }),
    moveSongInQueue: (
      fromIndex: ArgsType<number>,
      toIndex: ArgsType<number>,
    ) => {
      const fromIndexValue = parseNumberFromArgsType(fromIndex);
      const toIndexValue = parseNumberFromArgsType(toIndex);
      if (fromIndexValue === null || toIndexValue === null) return;

      win.webContents.send('peard:move-in-queue', fromIndexValue, toIndexValue);
    },
    reorderQueue: (order: number[]) => {
      if (!Array.isArray(order) || order.length < 2) return;
      win.webContents.send('peard:reorder-queue', order);
    },
    removeSongFromQueue: (index: ArgsType<number>) => {
      const indexValue = parseNumberFromArgsType(index);
      if (indexValue === null) return;

      win.webContents.send('peard:remove-from-queue', indexValue);
    },
    setQueueIndex: (index: ArgsType<number>) => {
      const indexValue = parseNumberFromArgsType(index);
      if (indexValue === null) return;

      win.webContents.send('peard:set-queue-index', indexValue);
    },
    clearQueue: () => win.webContents.send('peard:clear-queue'),

    search: (query: string, params?: string, continuation?: string) =>
      new Promise((resolve) => {
        ipcMain.once('peard:search-results', (_, result) => {
          resolve(result as string);
        });
        win.webContents.send('peard:search', query, params, continuation);
      }),
    playPlaylist: (
      playlistId: ArgsType<string>,
      videoId?: ArgsType<string>,
    ) => {
      const pid = parseStringFromArgsType(playlistId);
      const vid = videoId ? parseStringFromArgsType(videoId) : null;
      if (pid) {
        let url = `https://music.youtube.com/playlist?list=${pid}`;
        if (vid) {
          url += `&v=${vid}`;
        }
        win.webContents.loadURL(url);
      }
    },
    playArtist: (channelId: ArgsType<string>) => {
      const id = parseStringFromArgsType(channelId);
      if (!id) return;

      win.webContents.send('peard:play-artist', id);
    },
    playAlbum: (albumId: ArgsType<string>) => {
      const id = parseStringFromArgsType(albumId);
      if (!id) return;

      // Album audio playlists can be started like regular playlists.
      if (id.startsWith('OLAK5uy') || id.startsWith('PL')) {
        const playlistId = id.startsWith('VL') ? id.slice(2) : id;
        win.webContents.loadURL(
          `https://music.youtube.com/playlist?list=${playlistId}`,
        );
        return;
      }

      win.webContents.send('peard:play-album', id);
    },
  };
};
