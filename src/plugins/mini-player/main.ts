import MiniPlayerHtml from '@assets/mini-player/index.html?asset';
import MiniPlayerPreload from '@assets/mini-player/preload.cjs?asset';
import { BrowserWindow, ipcMain, screen } from 'electron';
import is from 'electron-is';
import localShortcut from 'electron-localshortcut';

import { getSongControls } from '@/providers/song-controls';
import { registerCallback, type SongInfo } from '@/providers/song-info';
import {
  LikeType,
  type RepeatMode,
  type VolumeState,
} from '@/types/datahost-get-state';
import { LoggerPrefix } from '@/utils';

import type { MiniPlayerPluginConfig } from './index';
import type { BackendContext } from '@/types/contexts';

/** What the mini player window renders. */
interface MiniPlayerState {
  title: string;
  artist: string;
  imageSrc: string;
  isPaused: boolean;
  songDuration: number;
  elapsedSeconds: number;
  likeStatus: LikeType;
  volume: number;
  isMuted: boolean;
  isShuffled: boolean;
  repeatMode: RepeatMode;
}

const MARGIN = 24;

let config: MiniPlayerPluginConfig;
let mainWindow: BrowserWindow | null = null;
let miniWindow: BrowserWindow | null = null;
let saveConfig: BackendContext<MiniPlayerPluginConfig>['setConfig'] | null =
  null;
let saveBoundsTimer: NodeJS.Timeout | null = null;
let callbackRegistered = false;

/** Cached so the artwork is only re-encoded when the song actually changes. */
let artworkVideoId = '';

const state: MiniPlayerState = {
  title: '',
  artist: '',
  imageSrc: '',
  isPaused: true,
  songDuration: 0,
  elapsedSeconds: 0,
  likeStatus: LikeType.Indifferent,
  volume: 100,
  isMuted: false,
  isShuffled: false,
  repeatMode: 'NONE',
};

const isOpen = () => !!miniWindow && !miniWindow.isDestroyed();

const pushState = () => {
  if (isOpen()) {
    miniWindow!.webContents.send('mini-player:state', state);
  }
};

const applyArtwork = (songInfo: SongInfo) => {
  if (songInfo.videoId === artworkVideoId) {
    return;
  }

  artworkVideoId = songInfo.videoId;

  // Inline the artwork so the window never needs network access of its own.
  const image = songInfo.image;
  state.imageSrc =
    image && !image.isEmpty()
      ? image.resize({ width: 160, height: 160 }).toDataURL()
      : (songInfo.imageSrc ?? '');
};

const onSongInfo = (songInfo: SongInfo) => {
  // Tracked even while closed, so opening the window shows the current song
  // right away instead of waiting for the next player event.
  applyArtwork(songInfo);

  state.title = songInfo.alternativeTitle || songInfo.title;
  state.artist = songInfo.artist;
  state.isPaused = songInfo.isPaused ?? state.isPaused;
  state.songDuration = songInfo.songDuration;
  state.elapsedSeconds = songInfo.elapsedSeconds ?? 0;

  pushState();
};

const onVolumeChanged = (_: Electron.IpcMainEvent, volume: VolumeState) => {
  state.volume = volume.state;
  state.isMuted = volume.isMuted;
  pushState();
};

const onLikeChanged = (_: Electron.IpcMainEvent, likeStatus: LikeType) => {
  state.likeStatus = likeStatus;
  pushState();
};

const onShuffleChanged = (_: Electron.IpcMainEvent, isShuffled: boolean) => {
  state.isShuffled = isShuffled;
  pushState();
};

const onRepeatChanged = (_: Electron.IpcMainEvent, repeatMode: RepeatMode) => {
  state.repeatMode = repeatMode ?? 'NONE';
  pushState();
};

const defaultPosition = (width: number, height: number): [number, number] => {
  const { workArea } = screen.getPrimaryDisplay();

  return [
    workArea.x + workArea.width - width - MARGIN,
    workArea.y + workArea.height - height - MARGIN,
  ];
};

/** Keep the saved position usable if the display setup changed since last run. */
const isOnScreen = ([x, y]: [number, number]) =>
  screen
    .getAllDisplays()
    .some(
      ({ workArea }) =>
        x >= workArea.x - 8 &&
        y >= workArea.y - 8 &&
        x < workArea.x + workArea.width &&
        y < workArea.y + workArea.height,
    );

const applyOpacity = (isHovered = false) => {
  if (!isOpen()) {
    return;
  }

  const opacity = isHovered && config.opaqueOnHover ? 1 : config.opacity;

  if (is.linux()) {
    // `setOpacity` is a no-op on Linux, so fade the card in CSS instead.
    miniWindow!.webContents.send('mini-player:config', { opacity });
  } else {
    miniWindow!.setOpacity(opacity);
  }
};

const applyAlwaysOnTop = () => {
  if (!isOpen()) {
    return;
  }

  miniWindow!.setAlwaysOnTop(config.alwaysOnTop, 'screen-saver', 1);
  miniWindow!.setVisibleOnAllWorkspaces(config.alwaysOnTop, {
    visibleOnFullScreen: true,
  });
};

/** Persist window bounds, debounced so dragging does not hammer the store. */
const rememberBounds = () => {
  if (!isOpen() || miniWindow!.isMinimized()) {
    return;
  }

  const [x, y] = miniWindow!.getPosition();
  const [width, height] = miniWindow!.getSize();

  config.position = [x, y];
  config.size = [width, height];

  if (saveBoundsTimer) {
    clearTimeout(saveBoundsTimer);
  }

  saveBoundsTimer = setTimeout(async () => {
    saveBoundsTimer = null;
    await saveConfig?.({ position: config.position, size: config.size });
  }, 500);
};

const openMiniPlayer = () => {
  if (isOpen()) {
    miniWindow!.show();
    return;
  }

  const [width, height] = config.size;
  const position =
    config.position && isOnScreen(config.position)
      ? config.position
      : defaultPosition(width, height);

  miniWindow = new BrowserWindow({
    width,
    height,
    x: position[0],
    y: position[1],
    minWidth: 400,
    minHeight: 92,
    maxHeight: 140,
    title: 'Mini Player',
    frame: false,
    transparent: true,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: MiniPlayerPreload,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  miniWindow.loadFile(MiniPlayerHtml).catch((error: unknown) => {
    console.error(LoggerPrefix, '[mini-player] failed to load window', error);
  });

  miniWindow.once('ready-to-show', () => {
    applyAlwaysOnTop();
    applyOpacity();
    miniWindow?.showInactive();
  });

  miniWindow.on('move', () => rememberBounds());

  miniWindow.on('resize', () => rememberBounds());

  miniWindow.on('closed', () => {
    miniWindow = null;
    restoreMainWindow(false);
  });

  registerHotkey(miniWindow);

  if (mainWindow && config.hideMainWindow) {
    // Media keeps playing in the hidden window; make sure it is not throttled.
    mainWindow.webContents.setBackgroundThrottling(false);
    mainWindow.hide();
  }

  // Ask the renderer to start reporting player state changes.
  mainWindow?.webContents.send('peard:setup-volume-changed-listener');
  mainWindow?.webContents.send('peard:setup-like-changed-listener');
  mainWindow?.webContents.send('peard:setup-repeat-changed-listener');
  mainWindow?.webContents.send('peard:setup-shuffle-changed-listener');

  // The shuffle observer only fires on change, so ask for the current value.
  mainWindow?.webContents.send('peard:get-shuffle');
};

const closeMiniPlayer = () => {
  if (isOpen()) {
    miniWindow!.close();
  }
};

const restoreMainWindow = (focus: boolean) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.setBackgroundThrottling(true);
  mainWindow.show();

  if (focus) {
    mainWindow.focus();
  }
};

const toggleMiniPlayer = () => {
  if (isOpen()) {
    closeMiniPlayer();
  } else {
    openMiniPlayer();
  }
};

const registerHotkey = (window: BrowserWindow) => {
  if (!config.hotkey) {
    return;
  }

  try {
    localShortcut.register(window, config.hotkey, toggleMiniPlayer);
  } catch (error: unknown) {
    console.error(LoggerPrefix, '[mini-player] invalid hotkey', error);
  }
};

const unregisterHotkey = (window: BrowserWindow | null) => {
  if (window && !window.isDestroyed()) {
    localShortcut.unregisterAll(window);
  }
};

const onControl = (
  _: Electron.IpcMainEvent,
  action: string,
  value?: number,
) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const controls = getSongControls(mainWindow);

  switch (action) {
    case 'playPause': {
      controls.playPause();
      // Optimistic update: the renderer echoes the real value right after.
      state.isPaused = !state.isPaused;
      pushState();
      break;
    }
    case 'next': {
      controls.next();
      break;
    }
    case 'previous': {
      controls.previous();
      break;
    }
    case 'like': {
      controls.like();
      break;
    }
    case 'shuffle': {
      controls.shuffle();
      // The player bar does not always report back, so ask for the new value.
      controls.requestShuffleInformation();
      break;
    }
    case 'repeat': {
      controls.switchRepeat(1);
      break;
    }
    case 'mute': {
      controls.muteUnmute();
      break;
    }
    case 'volume': {
      if (typeof value === 'number') {
        controls.setVolume(value);
      }
      break;
    }
    case 'seek': {
      if (typeof value === 'number') {
        controls.seekTo(value);
        state.elapsedSeconds = value;
      }
      break;
    }
    case 'restore': {
      restoreMainWindow(true);
      if (config.hideMainWindow) {
        closeMiniPlayer();
      }
      break;
    }
    case 'close': {
      closeMiniPlayer();
      break;
    }
    default: {
      break;
    }
  }
};

const onHover = (_: Electron.IpcMainEvent, isHovered: boolean) =>
  applyOpacity(isHovered);

const onReady = () => {
  pushState();
  applyOpacity();
};

export const onMainLoad = async ({
  window,
  getConfig,
  setConfig,
}: BackendContext<MiniPlayerPluginConfig>) => {
  config = await getConfig();
  mainWindow = window;
  saveConfig = setConfig;

  ipcMain.on('mini-player:control', onControl);
  ipcMain.on('mini-player:hover', onHover);
  ipcMain.on('mini-player:ready', onReady);
  ipcMain.on('peard:volume-changed', onVolumeChanged);
  ipcMain.on('peard:like-changed', onLikeChanged);
  ipcMain.on('peard:shuffle-changed', onShuffleChanged);
  ipcMain.on('peard:get-shuffle-response', onShuffleChanged);
  ipcMain.on('peard:repeat-changed', onRepeatChanged);
  ipcMain.on('plugin:toggle-mini-player', toggleMiniPlayer);

  if (!callbackRegistered) {
    // `registerCallback` has no counterpart; the handler no-ops when closed.
    registerCallback(onSongInfo);
    callbackRegistered = true;
  }

  registerHotkey(window);

  window.on('close', closeMiniPlayer);

  if (config.openOnStart) {
    openMiniPlayer();
  }
};

export const onConfigChange = (newConfig: MiniPlayerPluginConfig) => {
  const hotkeyChanged = config?.hotkey !== newConfig.hotkey;
  config = newConfig;

  if (hotkeyChanged) {
    unregisterHotkey(mainWindow);
    unregisterHotkey(miniWindow);

    if (mainWindow) registerHotkey(mainWindow);
    if (miniWindow) registerHotkey(miniWindow);
  }

  applyAlwaysOnTop();
  applyOpacity();
};

export const onUnload = () => {
  ipcMain.removeListener('mini-player:control', onControl);
  ipcMain.removeListener('mini-player:hover', onHover);
  ipcMain.removeListener('mini-player:ready', onReady);
  ipcMain.removeListener('peard:volume-changed', onVolumeChanged);
  ipcMain.removeListener('peard:like-changed', onLikeChanged);
  ipcMain.removeListener('peard:shuffle-changed', onShuffleChanged);
  ipcMain.removeListener('peard:get-shuffle-response', onShuffleChanged);
  ipcMain.removeListener('peard:repeat-changed', onRepeatChanged);
  ipcMain.removeAllListeners('plugin:toggle-mini-player');

  unregisterHotkey(mainWindow);
  closeMiniPlayer();
  restoreMainWindow(false);

  mainWindow?.removeListener('close', closeMiniPlayer);
  mainWindow = null;
};

export const openMiniPlayerWindow = openMiniPlayer;
export const isMiniPlayerOpen = isOpen;
export const toggle = toggleMiniPlayer;
