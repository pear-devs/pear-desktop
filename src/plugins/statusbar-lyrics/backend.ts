import { nativeImage, Tray } from 'electron';
import is from 'electron-is';

import { createBackend } from '@/utils';

let tray: Tray | undefined;

// Lazily create a tray instance so the plugin can reuse a single macOS title
// target without allocating a visible icon.
const getTray = () => {
  if (!tray) {
    tray = new Tray(nativeImage.createEmpty());
  }
  return tray;
};

// Normalize lyric text before sending it to the tray title so the result stays
// compact and readable even when the source line contains extra whitespace.
const normalizeText = (text: string, maxLength: number) => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (maxLength <= 0) return '';
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
};

export const backend = createBackend({
  // Handle renderer requests that update or clear the macOS menu bar title.
  start(ctx) {
    ctx.ipc.handle('statusbar-lyrics:set-text', (text: string, maxLength: number) => {
      if (!is.macOS()) return;

      const trayInstance = getTray();
      trayInstance.setTitle(normalizeText(text, maxLength));
    });

    ctx.ipc.handle('statusbar-lyrics:clear', () => {
      if (!is.macOS()) return;
      getTray().setTitle('');
    });
  },
  // Tear down handlers and clear any remaining tray text when the plugin stops.
  stop(ctx) {
    ctx.ipc.removeHandler('statusbar-lyrics:set-text');
    ctx.ipc.removeHandler('statusbar-lyrics:clear');
    tray?.setTitle('');
  },
});
