import type { App, BrowserWindow } from 'electron';

export const setupCloseToHide = (app: App, win: BrowserWindow) => {
  let forceQuit = false;
  let leavingFullscreen = false;

  const onBeforeQuit = () => {
    forceQuit = true;
  };
  const hideAfterFullscreen = () => {
    leavingFullscreen = false;
    if (!forceQuit && !win.isDestroyed()) {
      win.hide();
    }
  };

  app.on('before-quit', onBeforeQuit);
  win.once('closed', () => {
    app.removeListener('before-quit', onBeforeQuit);
    win.removeListener('leave-full-screen', hideAfterFullscreen);
  });

  win.on('close', (event) => {
    if (forceQuit) return;

    // Keep playback running when the close button is used.
    event.preventDefault();
    if (leavingFullscreen) return;

    if (process.platform === 'darwin' && win.isFullScreen()) {
      // Hiding before macOS removes the fullscreen Space can leave it blank.
      leavingFullscreen = true;
      win.once('leave-full-screen', hideAfterFullscreen);
      win.setFullScreen(false);
    } else {
      win.hide();
    }
  });
};
