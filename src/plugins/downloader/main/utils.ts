import { app, type BrowserWindow, Notification } from 'electron';
import is from 'electron-is';

import { t } from '@/i18n';

/**
 * Resolves the download destination directory, falling back to system downloads.
 * @param customFolder Optional custom directory path
 * @returns Directory path string
 */
export const getFolder = (customFolder?: string) =>
  customFolder ?? app.getPath('downloads');

/**
 * Sends a downloader feedback message to the renderer process.
 * @param win The target browser window
 * @param message The feedback message or payload to send
 */
export const sendFeedback = (win: BrowserWindow, message?: unknown) => {
  win.webContents.send('downloader-feedback', message);
};

/**
 * Crops standard 16:9 YouTube video thumbnails to a 1:1 square artwork.
 * @param image The native image to crop
 * @returns Cropped or unmodified native image
 */
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

/**
 * Updates application dock/taskbar badge count on supported platforms.
 * @param n Number of items to display on the badge
 */
export const setBadge = (n: number) => {
  if (is.linux() || is.macOS()) {
    app.setBadgeCount(n);
  }
};

/**
 * Resets download states and presents an OS desktop notification on failure.
 * @param win The parent browser window
 * @param error The encountered error
 * @param source Optional track, URL, or step identifier where the error occurred
 */
export const sendError = (
  win: BrowserWindow,
  error: Error,
  source?: string,
) => {
  win.setProgressBar(-1); // close progress bar
  setBadge(0); // close badge
  sendFeedback(win); // reset in-app button/progress state

  const songNameMessage = source ? `\nin ${source}` : '';
  const cause = error.cause
    ? `\n\n${
        // oxlint-disable-next-line typescript/no-base-to-string,typescript/restrict-template-expressions
        error.cause instanceof Error ? error.cause.toString() : error.cause
      }`
    : '';
  const message = `${error.toString()}${songNameMessage}${cause}`;

  console.error(message);
  console.trace(error);

  if (Notification.isSupported()) {
    new Notification({
      title: t('plugins.downloader.backend.dialog.error.title'),
      body: `${t('plugins.downloader.backend.dialog.error.message')}\n${source ? `[${source}] ` : ''}${error.message ?? error}`,
      urgency: 'normal',
    }).show();
  }
};
