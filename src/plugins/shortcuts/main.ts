import { type BrowserWindow, globalShortcut } from 'electron';
import is from 'electron-is';
import { register as registerElectronLocalShortcut } from 'electron-localshortcut';

import { registerMPRIS } from './mpris';
import { getSongControls } from '@/providers/song-controls';

import type { ShortcutMappingType, ShortcutsPluginConfig } from './index';

import type { BackendContext } from '@/types/contexts';

// Media key accelerator names that must not be registered as global shortcuts
// on Windows, because doing so intercepts them before SMTC can process them.
const MEDIA_KEY_ACCELERATORS = new Set([
  'MediaPlayPause',
  'MediaNextTrack',
  'MediaPreviousTrack',
  'MediaStop',
]);

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
    // On Windows, media keys are handled through SMTC (System Media Transport
    // Controls) via Chromium's built-in MediaSessionService. Registering global
    // shortcuts for media keys intercepts them at the OS level, which prevents
    // the SMTC taskbar flyout from appearing and breaks native media key routing.
    if (is.windows()) {
      console.warn(
        'overrideMediaKeys is not supported on Windows as it breaks the SMTC taskbar flyout. ' +
          'Media keys are handled natively through Windows SMTC.',
      );
    } else {
      _registerGlobalShortcut(window.webContents, 'MediaPlayPause', playPause);
      _registerGlobalShortcut(window.webContents, 'MediaNextTrack', next);
      _registerGlobalShortcut(
        window.webContents,
        'MediaPreviousTrack',
        previous,
      );
    }
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
        if (is.windows() && MEDIA_KEY_ACCELERATORS.has(container[action])) {
          console.warn(
            `Skipping global shortcut '${container[action]}' on Windows to preserve SMTC.`,
          );
          continue;
        }

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
