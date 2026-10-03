import { type BrowserWindow, globalShortcut } from 'electron';
import is from 'electron-is';
import { register as registerElectronLocalShortcut } from 'electron-localshortcut';

import { getSongControls } from '@/providers/song-controls';

import { registerMPRIS } from './mpris';

import type { ShortcutMappingType, ShortcutsPluginConfig } from './index';
import type { BackendContext } from '@/types/contexts';

const DOUBLE_PRESS_THRESHOLD_MS = 400;

function _registerGlobalShortcut(
  webContents: Electron.WebContents,
  shortcut: string,
  action: (webContents: Electron.WebContents) => void,
) {
  try {
    const registered = globalShortcut.register(shortcut, () => {
      action(webContents);
    });
    if (!registered) {
      console.warn(
        `Global shortcut "${shortcut}" is already in use by another app or the system, could not register it`,
      );
    }
  } catch (error) {
    console.warn(`Failed to register global shortcut "${shortcut}"`, error);
  }
}

function _registerLocalShortcut(
  win: BrowserWindow,
  shortcut: string,
  action: (webContents: Electron.WebContents) => void,
) {
  try {
    registerElectronLocalShortcut(win, shortcut, () => {
      action(win.webContents);
    });
  } catch (error) {
    console.warn(`Failed to register local shortcut "${shortcut}"`, error);
  }
}

function _createPlayPauseHandler(win: BrowserWindow, playPause: () => void) {
  let lastPressTime = 0;

  return () => {
    const now = Date.now();
    if (now - lastPressTime < DOUBLE_PRESS_THRESHOLD_MS) {
      lastPressTime = 0;

      if (win.isMinimized()) {
        win.restore();
      }
      if (!win.isVisible()) {
        win.show();
      }
      win.focus();
      return;
    }

    lastPressTime = now;
    playPause();
  };
}

export const onMainLoad = async ({
  getConfig,
  window,
}: BackendContext<ShortcutsPluginConfig>) => {
  const config = await getConfig();

  const songControls = getSongControls(window);
  const { playPause, next, previous, goForward, goBack } = songControls;

  const playPauseAction = config.focusWindowOnDoublePlayPause
    ? _createPlayPauseHandler(window, playPause)
    : playPause;

  if (config.overrideMediaKeys) {
    _registerGlobalShortcut(
      window.webContents,
      'MediaPlayPause',
      playPauseAction,
    );
    _registerGlobalShortcut(window.webContents, 'MediaNextTrack', next);
    _registerGlobalShortcut(window.webContents, 'MediaPreviousTrack', previous);
  }

  if (is.linux()) {
    registerMPRIS(window);
  }

  const { global, local } = config;
  const shortcutOptions = { global, local };

  for (const optionType in shortcutOptions) {
    registerAllShortcuts(
      shortcutOptions[optionType as 'global' | 'local'],
      optionType,
    );
  }

  function registerAllShortcuts(container: ShortcutMappingType, type: string) {
    for (const _action in container) {
      // HACK: _action is detected as string, but it's actually a key of ShortcutMappingType
      const action = _action as keyof ShortcutMappingType;

      if (!container[action]) {
        continue; // Action accelerator is empty
      }

      console.debug(
        `Registering ${type} shortcut`,
        container[action],
        ':',
        action,
      );
      const actionCallback: () => void =
        action === 'playPause' ? playPauseAction : songControls[action];
      if (typeof actionCallback !== 'function') {
        console.warn('Invalid action', action);
        continue;
      }

      if (type === 'global') {
        _registerGlobalShortcut(
          window.webContents,
          container[action],
          actionCallback,
        );
      } else {
        // Type === "local"
        _registerLocalShortcut(window, local[action], actionCallback);
      }
    }
  }

  const { seekSeconds, seekGlobalShortcuts } = config;

  if (seekGlobalShortcuts.forward) {
    _registerGlobalShortcut(
      window.webContents,
      seekGlobalShortcuts.forward,
      () => goForward(seekSeconds),
    );
  }
  if (seekGlobalShortcuts.backward) {
    _registerGlobalShortcut(
      window.webContents,
      seekGlobalShortcuts.backward,
      () => goBack(seekSeconds),
    );
  }
};
