import { type BrowserWindow, globalShortcut } from 'electron';
import is from 'electron-is';
import { register as registerElectronLocalShortcut } from 'electron-localshortcut';

import { registerMPRIS } from './mpris';
import { getSongControls } from '@/providers/song-controls';

import type { ShortcutMappingType, ShortcutsPluginConfig } from './index';

import type { BackendContext } from '@/types/contexts';

function _registerGlobalShortcut(
  webContents: Electron.WebContents,
  shortcut: string,
  action: (webContents: Electron.WebContents) => void,
) {
  globalShortcut.register(shortcut, () => {
    action(webContents);
  });
}

function _registerLocalShortcut(
  win: BrowserWindow,
  shortcut: string,
  action: (webContents: Electron.WebContents) => void,
) {
  registerElectronLocalShortcut(win, shortcut, () => {
    action(win.webContents);
  });
}

export const onMainLoad = async ({
  getConfig,
  window,
}: BackendContext<ShortcutsPluginConfig>) => {
  const config = await getConfig();

  const songControls = getSongControls(window);
  const { playPause, next, previous } = songControls;

  if (config.overrideMediaKeys) {
    _registerGlobalShortcut(window.webContents, 'MediaPlayPause', playPause);
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
      const actionCallback: () => void = songControls[action];
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
};
