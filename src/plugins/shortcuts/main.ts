import { globalShortcut } from 'electron';
import is from 'electron-is';
import {
  register as registerLocalShortcut,
  unregister as unregisterLocalShortcut,
} from 'electron-localshortcut';

import { getSongControls } from '@/providers/song-controls';
import { createBackend } from '@/utils';

import { registerMPRIS } from './mpris';

import type { shortcutsConfig } from './types';

type ShortcutAction = 'previous' | 'playPause' | 'next';

export default createBackend<typeof shortcutsConfig>((ctx) => {
  const { window } = ctx;
  const songControls = getSongControls(window);
  const { playPause, next, previous } = songControls;

  // Undoes the current shortcuts; redone on config changes, so that MPRIS
  // keeps running.
  let unregisterAll: (() => void)[] = [];
  const unregisterShortcuts = () => {
    for (const unregister of unregisterAll) unregister();
    unregisterAll = [];
  };
  ctx.onCleanup(unregisterShortcuts);

  const registerGlobal = (accelerator: string, action: () => void) => {
    if (globalShortcut.register(accelerator, action)) {
      unregisterAll.push(() => globalShortcut.unregister(accelerator));
    }
  };

  const registerLocal = (accelerator: string, action: () => void) => {
    registerLocalShortcut(window, accelerator, action);
    unregisterAll.push(() => {
      if (!window.isDestroyed()) unregisterLocalShortcut(window, accelerator);
    });
  };

  const registerShortcuts = () => {
    if (ctx.config.overrideMediaKeys) {
      registerGlobal('MediaPlayPause', playPause);
      registerGlobal('MediaNextTrack', next);
      registerGlobal('MediaPreviousTrack', previous);
    }

    const { global, local } = ctx.config;
    const shortcutOptions = { global, local };

    for (const type of ['global', 'local'] as const) {
      const container = shortcutOptions[type];
      for (const action of Object.keys(container) as ShortcutAction[]) {
        const accelerator = container[action];
        if (!accelerator) {
          continue; // Action accelerator is empty
        }

        console.debug(`Registering ${type} shortcut`, accelerator, ':', action);
        const actionCallback: () => void = songControls[action];
        if (typeof actionCallback !== 'function') {
          console.warn('Invalid action', action);
          continue;
        }

        if (type === 'global') {
          registerGlobal(accelerator, actionCallback);
        } else {
          registerLocal(accelerator, actionCallback);
        }
      }
    }
  };

  if (is.linux()) {
    registerMPRIS(ctx);
  }

  registerShortcuts();
  ctx.onConfigChange(() => {
    unregisterShortcuts();
    registerShortcuts();
  });
});
