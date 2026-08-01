import { nativeImage, Tray } from 'electron';
import is from 'electron-is';

import { createBackend } from '@/utils';

let tray: Tray | undefined;

const getTray = () => {
  if (!tray) {
    tray = new Tray(nativeImage.createEmpty());
  }
  return tray;
};

const normalizeText = (text: string, maxLength: number) => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (maxLength <= 0) return '';
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
};

export const backend = createBackend({
  start(ctx) {
    ctx.ipc.handle('statusbar-lyrics:set-text', (text: string, maxLength: number) => {
      if (!is.macOS()) return;

      const trayInstance = getTray();
      // trayInstance.setTitle(normalizeText(text, maxLength));
      trayInstance.setTitle(text);
    });

    ctx.ipc.handle('statusbar-lyrics:clear', () => {
      if (!is.macOS()) return;
      getTray().setTitle('');
    });
  },
  stop(ctx) {
    ctx.ipc.removeHandler('statusbar-lyrics:set-text');
    ctx.ipc.removeHandler('statusbar-lyrics:clear');
    tray?.setTitle('');
  },
});
