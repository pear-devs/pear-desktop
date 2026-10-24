import { type BrowserWindow, globalShortcut } from 'electron';
import is from 'electron-is';
import {
  register as registerElectronLocalShortcut,
  unregister as unregisterElectronLocalShortcut,
} from 'electron-localshortcut';

import { getSongControls } from '@/providers/song-controls';
import { MediaType, registerCallback } from '@/providers/song-info';
import { createBackend } from '@/utils';

import { registerMPRIS } from './mpris';

import type { ShortcutMappingType, ShortcutsPluginConfig } from './index';

type ShortcutsBackend = {
  window?: BrowserWindow;
  config?: ShortcutsPluginConfig;
  isPodcast: boolean;
  registeredGlobal: string[];
  registeredLocal: string[];
  register(config: ShortcutsPluginConfig): void;
  unregister(): void;
};

export const backend = createBackend<ShortcutsBackend, ShortcutsPluginConfig>({
  isPodcast: false,
  registeredGlobal: [],
  registeredLocal: [],

  async start({ getConfig, window }) {
    this.window = window;

    // Podcasts get their own skip seconds
    registerCallback((songInfo) => {
      this.isPodcast = songInfo.mediaType === MediaType.PodcastEpisode;
    });

    if (is.linux()) {
      registerMPRIS(window);
    }

    this.register(await getConfig());
  },

  stop() {
    this.unregister();
  },

  // Re-register so changed keybinds apply without restarting the app
  onConfigChange(newConfig) {
    this.unregister();
    this.register(newConfig);
  },

  register(config) {
    const window = this.window;
    if (!window) return;

    this.config = config;

    const { playPause, next, previous, goForward, goBack } =
      getSongControls(window);

    // Seconds are read at call time so config and media type changes apply immediately
    const seekSeconds = (direction: 'Forward' | 'Backward') =>
      Number(
        this.isPodcast
          ? this.config?.[`podcastSeek${direction}Seconds`]
          : this.config?.[`seek${direction}Seconds`],
      );

    const shortcutActions: Record<keyof ShortcutMappingType, () => void> = {
      previous,
      playPause,
      next,
      seekForward: () => goForward(seekSeconds('Forward')),
      seekBackward: () => goBack(seekSeconds('Backward')),
    };

    const registerGlobal = (accelerator: string, action: () => void) => {
      try {
        if (globalShortcut.register(accelerator, action)) {
          this.registeredGlobal.push(accelerator);
        } else {
          console.warn('Failed to register global shortcut', accelerator);
        }
      } catch (error) {
        console.warn('Invalid global shortcut', accelerator, error);
      }
    };

    if (config.overrideMediaKeys) {
      registerGlobal('MediaPlayPause', playPause);
      registerGlobal('MediaNextTrack', next);
      registerGlobal('MediaPreviousTrack', previous);
    }

    for (const type of ['global', 'local'] as const) {
      const container = config[type];

      for (const _action in container) {
        // HACK: _action is detected as string, but it's actually a key of ShortcutMappingType
        const action = _action as keyof ShortcutMappingType;
        const accelerator = container[action];

        if (!accelerator) {
          continue; // Action accelerator is empty
        }

        const actionCallback = shortcutActions[action];
        if (typeof actionCallback !== 'function') {
          console.warn('Invalid action', action);
          continue;
        }

        console.debug(`Registering ${type} shortcut`, accelerator, ':', action);

        if (type === 'global') {
          registerGlobal(accelerator, actionCallback);
        } else {
          registerElectronLocalShortcut(window, accelerator, actionCallback);
          this.registeredLocal.push(accelerator);
        }
      }
    }
  },

  unregister() {
    for (const accelerator of this.registeredGlobal) {
      globalShortcut.unregister(accelerator);
    }
    this.registeredGlobal = [];

    if (this.window && !this.window.isDestroyed()) {
      for (const accelerator of this.registeredLocal) {
        unregisterElectronLocalShortcut(this.window, accelerator);
      }
    }
    this.registeredLocal = [];
  },
});
