import { z } from 'zod';

import { createPlugin } from '@/utils';
import dbus from '@jellybrick/dbus-next';
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
let hasRegisteredCallback = false;
let isEnabled = false;
let intervalStart: number | null = null;

let isLinux;
let bus: ReturnType<(typeof dbus)['sessionBus']>;

const stopProgressInterval = () => {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
    intervalStart = null;
  }
};

const setProgressBar = async (
  window: BrowserWindow,
  progress: number,
  options: { mode: 'normal' | 'paused' } = { mode: 'normal' },
) => {
  window.setProgressBar(progress, options);

  isLinux ??= (await import('electron-is')).linux();
  if (isLinux) {
    bus ??= dbus.sessionBus();

    const signal = new dbus.Message({
      type: dbus.MessageType.SIGNAL,
      path: '/', // I don't know what should be put as a path, but anything works
      interface: 'com.canonical.Unity.LauncherEntry',
      member: 'Update',
      signature: 'sa{sv}',
      body: [
        'application://com.github.th_ch.\u0079\u006f\u0075\u0074\u0075\u0062\u0065\u005f\u006d\u0075\u0073\u0069\u0063.desktop',
        {
          'progress': new dbus.Variant('d', progress),
          'progress-visible': new dbus.Variant(
            'b',
            options.mode === 'normal' && progress > 0,
          ),
        },
      ],
    });

    bus.send(signal);
  }
};

const updateProgressBar = (songInfo: SongInfo, window: BrowserWindow) => {
  const validated = requiredSongInfoSchema.safeParse(songInfo);
  if (!validated.success) return;

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

  setProgressBar(window, progress, options);
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
        const timeDelta = (performance.now() - intervalStart) / 1000;
        const elapsedSeconds = Math.floor(
          lastSongInfo.elapsedSeconds + timeDelta,
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

      if (!hasRegisteredCallback) {
        hasRegisteredCallback = true;

        registerCallback((songInfo) => {
          if (!isEnabled || !songInfo?.title) return;
          updateProgressBar(songInfo, window);
          if (songInfo.isPaused) {
            stopProgressInterval();
          } else {
            startProgressInterval(songInfo, window);
          }
        });
      }
    },

    stop({ window }) {
      isEnabled = false;
      stopProgressInterval();
      setProgressBar(window, -1);
    },
  },
});
