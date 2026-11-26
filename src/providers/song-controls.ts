// This is used for to control the songs
import { randomUUID } from 'node:crypto';

import { type BrowserWindow, ipcMain } from 'electron';

import { LikeType } from '@/types/datahost-get-state';

// see protocol-handler.ts
type ArgsType<T> = T | string | string[] | undefined;

const parseNumberFromArgsType = (args: ArgsType<number>) => {
  const value = typeof args === 'object' && args !== null ? args[0] : args;
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const parseBooleanFromArgsType = (args: ArgsType<boolean>) => {
  const value = typeof args === 'object' && args !== null ? args[0] : args;
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value === 'true';
  }
  return null;
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
        win.webContents.send('peard:seek-to', secondsNumber);
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
        win.webContents.send('peard:seek-by', secondsNumber);
      }
    },
    requestShuffleInformation: () => {
      win.webContents.send('peard:get-shuffle');
    },
    shuffle: () => win.webContents.send('peard:shuffle'),
    switchRepeat: (n: ArgsType<number> = 1) => {
      const repeat = parseNumberFromArgsType(n);
      if (repeat !== null) {
        win.webContents.send('peard:switch-repeat', repeat);
      }
    },
    // General
    setVolume: (volume: ArgsType<number>) => {
      const volumeNumber = parseNumberFromArgsType(volume);
      if (volumeNumber !== null) {
        win.webContents.send('peard:update-volume', volumeNumber);
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
    moveSongInQueue: (
      fromIndex: ArgsType<number>,
      toIndex: ArgsType<number>,
    ) => {
      const fromIndexValue = parseNumberFromArgsType(fromIndex);
      const toIndexValue = parseNumberFromArgsType(toIndex);
      if (fromIndexValue === null || toIndexValue === null) return;

      win.webContents.send('peard:move-in-queue', fromIndexValue, toIndexValue);
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

    search: (query: string, params?: string, continuation?: string) => {
      const id = randomUUID();
      return new Promise<unknown>((resolve, reject) => {
        const handler = (
          _: Electron.IpcMainEvent,
          result: string,
          resultId?: string,
        ) => {
          if (resultId !== id) return;
          clearTimeout(timeout);
          ipcMain.removeListener('peard:search-results', handler);
          resolve(result);
        };
        const timeout = setTimeout(() => {
          ipcMain.removeListener('peard:search-results', handler);
          reject(new Error('Search request timed out'));
        }, 30_000);

        ipcMain.on('peard:search-results', handler);
        win.webContents.send('peard:search', query, params, continuation, id);
      });
    },
  };
};
