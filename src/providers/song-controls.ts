// This is used for to control the songs
import { randomUUID } from 'node:crypto';

import { type BrowserWindow, ipcMain } from 'electron';

import { LikeType } from '@/types/datahost-get-state';

// see protocol-handler.ts
type ArgsType<T> = T | string[] | undefined;
const SEARCH_TIMEOUT_MS = 15_000;

type RendererResponse = {
  requestId: string;
  result?: unknown;
  error?: string;
};

export interface SearchRequest {
  requestId: string;
  query: string;
  params?: string;
  continuation?: string;
}

export type SearchResponse = RendererResponse;

export interface LibraryPlaylistsRequest {
  requestId: string;
  continuation?: string;
}

export type LibraryPlaylistsResponse = RendererResponse;

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

const requestRendererData = <TRequest extends { requestId: string }>(
  win: BrowserWindow,
  requestEvent: string,
  responseEvent: string,
  request: Omit<TRequest, 'requestId'>,
  timeoutMessage: string,
) =>
  new Promise<unknown>((resolve, reject) => {
    const requestId = randomUUID();
    let timeout: NodeJS.Timeout;
    const listener = (_: Electron.IpcMainEvent, response: RendererResponse) => {
      if (response.requestId !== requestId) return;

      clearTimeout(timeout);
      ipcMain.removeListener(responseEvent, listener);

      if (response.error) {
        reject(new Error(response.error));
        return;
      }

      resolve(response.result);
    };

    timeout = setTimeout(() => {
      ipcMain.removeListener(responseEvent, listener);
      reject(new Error(timeoutMessage));
    }, SEARCH_TIMEOUT_MS);

    ipcMain.on(responseEvent, listener);
    win.webContents.send(requestEvent, {
      requestId,
      ...request,
    } as TRequest);
  });

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
    requestQueueInformation: (requestId = randomUUID()) => {
      win.webContents.send('peard:get-queue', requestId);
      return requestId;
    },
    muteUnmute: () => win.webContents.send('peard:toggle-mute'),
    playVideo: (videoId: string) => {
      const videoIdValue = parseStringFromArgsType(videoId);
      if (videoIdValue === null) return;

      win.webContents.send('peard:play-video', videoIdValue);
    },
    playPlaylist: (playlistId: string) => {
      const playlistIdValue = parseStringFromArgsType(playlistId);
      if (playlistIdValue === null) return;

      win.webContents.send('peard:play-playlist', playlistIdValue);
    },
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

    search: (query: string, params?: string, continuation?: string) =>
      requestRendererData<SearchRequest>(
        win,
        'peard:search',
        'peard:search-results',
        { query, params, continuation },
        'Pear Desktop search did not respond before the timeout expired.',
      ),
    getLibraryPlaylists: (continuation?: string) =>
      requestRendererData<LibraryPlaylistsRequest>(
        win,
        'peard:get-library-playlists',
        'peard:get-library-playlists-response',
        { continuation },
        'Pear Desktop playlist library did not respond before the timeout expired.',
      ),
  };
};
