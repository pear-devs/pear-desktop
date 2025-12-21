import { z } from 'zod';

import { createPlugin } from '@/utils';
import {
  registerCallback,
  getCurrentSongInfo,
  type SongInfo,
} from '@/providers/song-info';
import { t } from '@/i18n';

import type { BrowserWindow } from 'electron';

const requiredSongInfoSchema = z.object({
  title: z.string().min(1),
  elapsedSeconds: z.number().optional(),
  songDuration: z.number(),
  isPaused: z.boolean().optional(),
});

let lastSongInfo: SongInfo | null = null;
let progressInterval: ReturnType<typeof setInterval> | null = null;
let isEnabled = false;
let intervalStart: number | null = null;

const stopProgressInterval = () => {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
    intervalStart = null;
  }
};

const updateProgressBar = (songInfo: SongInfo, window: BrowserWindow) => {
  const validated = requiredSongInfoSchema.safeParse(songInfo);

  if (!validated.success) {
    return;
  }

  const { title, elapsedSeconds, songDuration, isPaused } = validated.data;

  if (
    !lastSongInfo ||
    title !== lastSongInfo.title ||
    elapsedSeconds !== lastSongInfo.elapsedSeconds ||
    isPaused !== lastSongInfo.isPaused
  ) {
    lastSongInfo = songInfo;
  }

  const progress = (elapsedSeconds ?? 0) / songDuration;
  const options: { mode: 'normal' | 'paused' } = {
    mode: isPaused ? 'paused' : 'normal',
  };
  window.setProgressBar(progress, options);
};

const startProgressInterval = (songInfo: SongInfo, window: BrowserWindow) => {
  stopProgressInterval();
  if (!songInfo.isPaused) {
    intervalStart = performance.now();
    progressInterval = setInterval(() => {
      if (
        lastSongInfo &&
        !lastSongInfo.isPaused &&
        typeof lastSongInfo.elapsedSeconds === 'number' &&
        intervalStart !== null
      ) {
        const elapsedSeconds = Math.floor(
          (lastSongInfo.elapsedSeconds +
            (performance.now() - intervalStart) / 1000),
        );
        updateProgressBar(
          {
            ...lastSongInfo,
            elapsedSeconds,
          },
          window,
        );
      }
    }, 1000);
  }
};

export default createPlugin({
  name: () => t('plugins.taskbar-progress.name'),
  description: () => t('plugins.taskbar-progress.description'),
  restartNeeded: false,
  config: { enabled: false },

  backend: {
    start({ window }) {
      isEnabled = true;

      const currentSongInfo = getCurrentSongInfo();
      if (currentSongInfo?.title) {
        updateProgressBar(currentSongInfo, window);
        if (!currentSongInfo.isPaused) {
          startProgressInterval(currentSongInfo, window);
        }
      }

      registerCallback((songInfo) => {
        if (!isEnabled || !songInfo?.title) return;
        updateProgressBar(songInfo, window);
        if (songInfo.isPaused) {
          stopProgressInterval();
        } else {
          startProgressInterval(songInfo, window);
        }
      });
    },

    stop({ window }) {
      isEnabled = false;
      stopProgressInterval();
      window.setProgressBar(-1);
    },
  },
});
