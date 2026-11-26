import { app, type BrowserWindow } from 'electron';
import is from 'electron-is';

/**
 * Resolves the folder downloads are written to.
 *
 * An empty string is treated as "not configured", otherwise the downloads
 * would end up in a relative path next to the working directory.
 */
export const getFolder = (customFolder?: string) =>
  customFolder || app.getPath('downloads');

/** Pushes a status message to the download button in the renderer */
export const sendFeedback = (win: BrowserWindow, message?: unknown) => {
  win.webContents.send('downloader-feedback', message);
};

/** Trims the letterboxing off a widescreen thumbnail, so covers stay square */
export const cropMaxWidth = (image: Electron.NativeImage) => {
  const imageSize = image.getSize();
  // Standard artwork width with margins from both sides is 280 + 720 + 280
  if (imageSize.width === 1280 && imageSize.height === 720) {
    return image.crop({
      x: 280,
      y: 0,
      width: 720,
      height: 720,
    });
  }

  return image;
};

/** Shows the number of running downloads on the dock or taskbar icon */
export const setBadge = (n: number) => {
  if (is.linux() || is.macOS()) {
    app.setBadgeCount(n);
  }
};
