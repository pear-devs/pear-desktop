import { dialog, net } from 'electron';
import fs from 'fs/promises';

import { createBackend } from '@/utils';

import type { LyricResult } from './types';

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
}

function formatAsLRC(
  data: LyricResult,
  title: string,
  artist: string,
): string {
  let lrc = '';
  if (title) lrc += `[ti:${title}]\n`;
  if (artist) lrc += `[ar:${artist}]\n`;
  lrc += '[al:]\n';
  lrc += '[by:Pear Desktop - Synced Lyrics Plugin]\n\n';

  if (data.lines && Array.isArray(data.lines)) {
    for (const line of data.lines) {
      const time = formatTime(line.timeInMs);
      lrc += `[${time}]${line.text}\n`;
    }
  } else if (data.lyrics && typeof data.lyrics === 'string') {
    // If only plain lyrics are available, add them without timestamps
    lrc += `${data.lyrics}\n`;
  }

  return lrc;
}

const handlers = {
  // Note: This will only be used for Forbidden headers, e.g. User-Agent, Authority, Cookie, etc.
  // See: https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header
  async fetch(
    url: string,
    init: RequestInit,
  ): Promise<[number, string, Record<string, string>]> {
    const res = await net.fetch(url, init);
    return [
      res.status,
      await res.text(),
      Object.fromEntries(res.headers.entries()),
    ];
  },

  async save(
    lyricsData: LyricResult,
    videoId: string,
    title: string,
    artist: string,
  ): Promise<string> {
    const lrcContent = formatAsLRC(lyricsData, title, artist);
    const fileName = `${title || videoId} - ${artist || 'Unknown'}.lrc`;

    try {
      const result = await dialog.showSaveDialog({
        defaultPath: fileName,
        filters: [
          { name: 'LRC Files', extensions: ['lrc'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        throw new Error('Save operation cancelled');
      }

      await fs.writeFile(result.filePath, lrcContent, 'utf-8');
      return result.filePath;
    } catch (error) {
      throw new Error(`Failed to save lyrics: ${(error as Error).message}`);
    }
  },
};

export const backend = createBackend({
  start(ctx) {
    ctx.ipc.handle('synced-lyrics:fetch', (url: string, init: RequestInit) =>
      handlers.fetch(url, init),
    );
    ctx.ipc.handle(
      'synced-lyrics:save',
      (payload: {
        lyrics: LyricResult;
        videoId: string;
        title: string;
        artist: string;
      }) => {
        if (!payload || typeof payload !== 'object') {
          throw new Error('Missing lyrics payload');
        }

        return handlers.save(
          payload.lyrics,
          payload.videoId,
          payload.title,
          payload.artist,
        );
      },
    );
  },
  stop(ctx) {
    ctx.ipc.removeHandler('synced-lyrics:fetch');
    ctx.ipc.removeHandler('synced-lyrics:save');
  },
});
