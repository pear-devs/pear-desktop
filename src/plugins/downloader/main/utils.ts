import { app, type BrowserWindow, Notification } from 'electron';
import is from 'electron-is';

import { t } from '@/i18n';

export const getFolder = (customFolder?: string) =>
  customFolder ?? app.getPath('downloads');

export const sendFeedback = (win: BrowserWindow, message?: unknown) => {
  win.webContents.send('downloader-feedback', message);
};

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

export const setBadge = (n: number) => {
  if (is.linux() || is.macOS()) {
    app.setBadgeCount(n);
  }
};

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
