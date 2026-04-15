import { BrowserWindow, screen, app } from 'electron';

import HoverPopupAsset from '@assets/hover-popup.html?asset';

import { getSongControls } from '@/providers/song-controls';
import {
  registerCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import { setTrayOnMouseMove, getTrayBounds } from '@/tray';

const POPUP_WIDTH = 380;
const POPUP_HEIGHT = 85;
const SHADOW_PAD = 8;
const GAP = 4;

// Exported so interactive.ts can suppress toast notifications
// while the hover popup is visible
let _isVisible = false;
export const isHoverPopupVisible = () => _isVisible;

export const setupHoverPopup = (win: BrowserWindow) => {
  const songControls = getSongControls(win);
  let currentSongInfo: SongInfo | null = null;
  let popup: BrowserWindow | null = null;
  let popupReady = false;
  let mouseTracker: ReturnType<typeof setInterval> | null = null;

  const createPopup = () => {
    popup = new BrowserWindow({
      width: POPUP_WIDTH + SHADOW_PAD * 2,
      height: POPUP_HEIGHT + SHADOW_PAD * 2,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    popup.loadFile(HoverPopupAsset);

    popup.webContents.on('did-finish-load', () => {
      popupReady = true;
    });

    // Button clicks from the popup HTML via document.title changes
    popup.on('page-title-updated', (event, title) => {
      if (!title.startsWith('act:')) return;
      event.preventDefault();
      const cmd = title.split(':')[1];

      switch (cmd) {
        case 'playPause':
          songControls.playPause();
          break;
        case 'previous':
          songControls.previous();
          break;
        case 'next':
          songControls.next();
          break;
      }
    });

    popup.on('closed', () => {
      popup = null;
      popupReady = false;
      _isVisible = false;
      stopMouseTracking();
    });
  };

  const positionPopup = () => {
    if (!popup) return;

    const bounds = getTrayBounds();
    if (!bounds) return;

    const display = screen.getDisplayNearestPoint({
      x: bounds.x,
      y: bounds.y,
    });
    const workArea = display.workArea;
    const winW = POPUP_WIDTH + SHADOW_PAD * 2;
    const winH = POPUP_HEIGHT + SHADOW_PAD * 2;

    // Center horizontally on tray icon
    let x = Math.round(bounds.x + bounds.width / 2 - winW / 2);
    // Position above tray icon
    let y = bounds.y - winH - GAP;

    // Keep within screen bounds
    x = Math.max(
      workArea.x,
      Math.min(x, workArea.x + workArea.width - winW),
    );

    // If tray is at top of screen, position below instead
    if (bounds.y < workArea.y + workArea.height / 2) {
      y = bounds.y + bounds.height + GAP;
    }

    y = Math.max(workArea.y, y);
    popup.setPosition(x, y);
  };

  const isCursorOver = (bounds: Electron.Rectangle): boolean => {
    const cursor = screen.getCursorScreenPoint();
    return (
      cursor.x >= bounds.x &&
      cursor.x <= bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y <= bounds.y + bounds.height
    );
  };

  // Poll cursor position every 150ms while popup is visible.
  // If mouse is on neither the popup nor the tray icon, hide.
  const startMouseTracking = () => {
    if (mouseTracker) return;
    mouseTracker = setInterval(() => {
      if (!popup || !_isVisible) {
        stopMouseTracking();
        return;
      }

      const overPopup = isCursorOver(popup.getBounds());
      const trayBounds = getTrayBounds();
      const overTray = trayBounds ? isCursorOver(trayBounds) : false;

      if (!overPopup && !overTray) {
        doHide();
        stopMouseTracking();
      }
    }, 150);
  };

  const stopMouseTracking = () => {
    if (mouseTracker) {
      clearInterval(mouseTracker);
      mouseTracker = null;
    }
  };

  const doShow = () => {
    if (!popup) createPopup();
    if (!popup || !currentSongInfo) return;

    positionPopup();

    if (!_isVisible) {
      popup.showInactive();
      _isVisible = true;
      startMouseTracking();
    }

    if (popupReady) {
      pushSongInfo();
      popup.webContents
        .executeJavaScript('window.showPopup()')
        .catch(() => {});
    }
  };

  const doHide = () => {
    if (!popup || !_isVisible) return;

    if (popupReady) {
      popup.webContents
        .executeJavaScript('window.hidePopup()')
        .catch(() => {});
    }

    // Wait for CSS fade-out animation before hiding the window
    setTimeout(() => {
      if (popup && _isVisible) {
        // Final check: is the cursor back on popup or tray?
        const overPopup = isCursorOver(popup.getBounds());
        const trayBounds = getTrayBounds();
        const overTray = trayBounds ? isCursorOver(trayBounds) : false;
        if (overPopup || overTray) {
          // Cursor came back, re-show and resume tracking
          popup.webContents
            .executeJavaScript('window.showPopup()')
            .catch(() => {});
          startMouseTracking();
          return;
        }

        popup.hide();
        _isVisible = false;
      }
    }, 250);
  };

  const pushSongInfo = () => {
    if (!popup || !popupReady || !currentSongInfo) return;

    const data = JSON.stringify({
      title: currentSongInfo.title,
      artist: currentSongInfo.artist,
      imageSrc: currentSongInfo.imageSrc || '',
      isPaused: currentSongInfo.isPaused ?? false,
    });

    popup.webContents
      .executeJavaScript(`window.updateSongInfo(${data})`)
      .catch(() => {});
  };

  // Tray hover triggers popup
  setTrayOnMouseMove(() => {
    doShow();
  });

  // Track current song info
  registerCallback((songInfo, event) => {
    if (event === SongInfoEvent.TimeChanged) return;
    if (!songInfo.artist && !songInfo.title) return;

    currentSongInfo = { ...songInfo };
    if (_isVisible) pushSongInfo();
  });

  // Cleanup on quit
  app.once('before-quit', () => {
    stopMouseTracking();
    popup?.close();
  });
};
