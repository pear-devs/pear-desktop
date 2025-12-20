import { type BrowserWindow, globalShortcut } from 'electron';
import is from 'electron-is';
import { register as registerElectronLocalShortcut } from 'electron-localshortcut';

import { registerMPRIS } from './mpris';
import { getSongControls } from '@/providers/song-controls';

import type { ShortcutMappingType, ShortcutsPluginConfig } from './index';

import type { BackendContext } from '@/types/contexts';

// Inline shortcut tracking to avoid path resolution issues
declare global {
  // eslint-disable-next-line no-var
  var __pearShortcutTracker: { 
    lastShortcutActionTime: number;
    lastShortcutAction: 'like' | 'dislike' | 'play' | 'pause' | 'other' | null;
    onLikeDislikeShortcut?: (action: 'like' | 'dislike', timestamp: number) => void;
    onPreviousNextShortcut?: (action: 'previous' | 'next') => void;
  } | undefined;
}

const markShortcutUsed = (action: 'like' | 'dislike' | 'play' | 'pause' | 'other' = 'other') => {
  if (typeof globalThis.__pearShortcutTracker === 'undefined') {
    globalThis.__pearShortcutTracker = { 
      lastShortcutActionTime: 0,
      lastShortcutAction: null,
    };
  }
  const timestamp = Date.now();
  globalThis.__pearShortcutTracker.lastShortcutActionTime = timestamp;
  globalThis.__pearShortcutTracker.lastShortcutAction = action;
  console.debug('Shortcut used:', action, 'timestamp:', timestamp);
  
  // Trigger notification callback if like/dislike shortcut was used
  if (action === 'like' || action === 'dislike') {
    console.debug('[Shortcuts] Like/dislike shortcut detected:', action, 'callback exists:', !!globalThis.__pearShortcutTracker.onLikeDislikeShortcut);
    if (globalThis.__pearShortcutTracker.onLikeDislikeShortcut) {
      try {
        globalThis.__pearShortcutTracker.onLikeDislikeShortcut(action, timestamp);
        console.debug('[Shortcuts] Notification callback called successfully');
      } catch (err) {
        console.error('[Shortcuts] Error calling notification callback:', err);
      }
    } else {
      console.warn('[Shortcuts] Notification callback not registered yet!');
    }
  }
};

function _registerGlobalShortcut(
  _webContents: Electron.WebContents,
  shortcut: string,
  action: () => void,
  actionType: 'like' | 'dislike' | 'play' | 'pause' | 'other' = 'other',
) {
  globalShortcut.register(shortcut, () => {
    // Mark that a keyboard shortcut was used
    try {
      markShortcutUsed(actionType);
    } catch (err) {
      console.warn('Failed to mark shortcut used:', err);
    }
    action();
  });
}

function _registerLocalShortcut(
  win: BrowserWindow,
  shortcut: string,
  action: () => void,
  actionType: 'like' | 'dislike' | 'play' | 'pause' | 'other' = 'other',
) {
  registerElectronLocalShortcut(win, shortcut, () => {
    // Mark that a keyboard shortcut was used
    try {
      markShortcutUsed(actionType);
    } catch (err) {
      console.warn('Failed to mark shortcut used:', err);
    }
    action();
  });
}

export const onMainLoad = async ({
  getConfig,
  window,
}: BackendContext<ShortcutsPluginConfig>) => {
  const config = await getConfig();

  const songControls = getSongControls(window);
  const { playPause, next, previous } = songControls;

  // Track if shortcuts have been registered to prevent double registration
  let shortcutsRegistered = false;

  // Wait for window to be ready before registering shortcuts
  // This ensures webContents is ready to receive IPC messages
  const registerShortcuts = () => {
    if (shortcutsRegistered) {
      console.debug('[Shortcuts] Shortcuts already registered, skipping');
      return;
    }
    
    shortcutsRegistered = true;
    console.debug('[Shortcuts] Registering shortcuts...');

    if (config.overrideMediaKeys) {
      _registerGlobalShortcut(window.webContents, 'MediaPlayPause', playPause, 'other');
      _registerGlobalShortcut(window.webContents, 'MediaNextTrack', next, 'other');
      _registerGlobalShortcut(window.webContents, 'MediaPreviousTrack', previous, 'other');
    }

    if (is.linux()) {
      registerMPRIS(window);
    }

    const { global, local: localShortcuts } = config;
    const shortcutOptions = { global, local: localShortcuts };

    for (const optionType in shortcutOptions) {
      registerAllShortcuts(
        shortcutOptions[optionType as 'global' | 'local'],
        optionType,
      );
    }
    
    console.debug('[Shortcuts] Shortcuts registered successfully');
  };

  // Register shortcuts - try multiple strategies to ensure it works
  // Strategy 1: If webContents is already loaded, register immediately with a small delay
  if (!window.webContents.isLoading()) {
    // Wait a bit for IPC to be fully ready
    setTimeout(() => {
      registerShortcuts();
    }, 200);
  } else {
    // Strategy 2: Wait for webContents to finish loading
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        registerShortcuts();
      }, 200);
    });
  }
  
  // Strategy 3: Also listen for ready-to-show as a backup
  window.once('ready-to-show', () => {
    setTimeout(() => {
      registerShortcuts();
    }, 200);
  });

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

      // Determine the action type for tracking
      let actionType: 'like' | 'dislike' | 'play' | 'pause' | 'other' = 'other';
      if (action === 'like') {
        actionType = 'like';
      } else if (action === 'dislike') {
        actionType = 'dislike';
      } else if (action === 'playPause') {
        // playPause can be either play or pause, we'll track it as 'other'
        actionType = 'other';
      } else if (action === 'previous' || action === 'next') {
        // Trigger callback to clear waiting flag in notifications plugin
        if (globalThis.__pearShortcutTracker?.onPreviousNextShortcut) {
          try {
            globalThis.__pearShortcutTracker.onPreviousNextShortcut(action);
          } catch (err) {
            console.warn('[Shortcuts] Error calling onPreviousNextShortcut:', err);
          }
        }
        actionType = 'other';
      }

      // markShortcutUsed() is already called in _registerGlobalShortcut/_registerLocalShortcut
      // The notification plugin will detect shortcuts via the global tracker when state changes

      if (type === 'global') {
        _registerGlobalShortcut(
          window.webContents,
          container[action],
          actionCallback,
          actionType,
        );
      } else {
        // Type === "local"
        _registerLocalShortcut(window, container[action], actionCallback, actionType);
      }
    }
  }
};
