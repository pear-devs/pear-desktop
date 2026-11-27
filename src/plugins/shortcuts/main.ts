import { type BrowserWindow, globalShortcut } from 'electron';
import is from 'electron-is';
import { register as registerElectronLocalShortcut } from 'electron-localshortcut';

import { getSongControls } from '@/providers/song-controls';

import { registerMPRIS } from './mpris';

import type { ShortcutMappingType, ShortcutsPluginConfig } from './index';
import type { BackendContext } from '@/types/contexts';

// Older configs can contain the literal string "undefined" for an unset
// shortcut. Electron throws a TypeError for that (or any invalid accelerator),
// which used to abort registration of every shortcut after it.
const isValidAccelerator = (accelerator: unknown): accelerator is string =>
  typeof accelerator === 'string' &&
  accelerator.trim() !== '' &&
  accelerator !== 'undefined' &&
  accelerator !== 'null';

function _registerGlobalShortcut(
  webContents: Electron.WebContents,
  shortcut: string,
  action: (webContents: Electron.WebContents) => void,
) {
  if (!isValidAccelerator(shortcut)) return;
  try {
    if (
      !globalShortcut.register(shortcut, () => {
        action(webContents);
      })
    ) {
      console.warn(
        `[shortcuts] Could not register global shortcut "${shortcut}" (already in use?)`,
      );
    }
  } catch (error) {
    console.warn(`[shortcuts] Invalid global shortcut "${shortcut}"`, error);
  }
}

function _registerLocalShortcut(
  win: BrowserWindow,
  shortcut: string,
  action: (webContents: Electron.WebContents) => void,
) {
  if (!isValidAccelerator(shortcut)) return;
  try {
    registerElectronLocalShortcut(win, shortcut, () => {
      action(win.webContents);
    });
  } catch (error) {
    console.warn(`[shortcuts] Invalid local shortcut "${shortcut}"`, error);
  }
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

      if (!isValidAccelerator(container[action])) {
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
