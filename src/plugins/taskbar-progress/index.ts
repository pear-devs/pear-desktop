import { createPlugin } from '@/utils';
import { registerCallback, type SongInfo } from '@/providers/song-info';
import { t } from '@/i18n';

export default createPlugin({
  name: () => t('plugins.taskbar-progress.name'),
  description: () => t('plugins.taskbar-progress.description'),
  restartNeeded: true,
  config: { enabled: false },

  backend({ window }) {
    let lastSongInfo: SongInfo | null = null;
    let progressInterval: ReturnType<typeof setInterval> | null = null;

    const updateProgressBar = (songInfo: SongInfo) => {
      if (
        !songInfo?.title ||
        typeof songInfo.elapsedSeconds !== 'number' ||
        !songInfo.songDuration
      ) {
        return;
      }

      if (
        !lastSongInfo ||
        songInfo.title !== lastSongInfo.title ||
        songInfo.elapsedSeconds !== lastSongInfo.elapsedSeconds ||
        songInfo.isPaused !== lastSongInfo.isPaused
      ) {
        lastSongInfo = songInfo;
      }

      const progress = songInfo.elapsedSeconds / songInfo.songDuration;
      window.setProgressBar(progress, {
        mode: songInfo.isPaused ? 'paused' : 'normal',
      });
    };

    const startProgressInterval = (songInfo: SongInfo) => {
      stopProgressInterval();
      if (!songInfo.isPaused) {
        progressInterval = setInterval(() => {
          if (
            lastSongInfo &&
            !lastSongInfo.isPaused &&
            typeof lastSongInfo.elapsedSeconds === 'number'
          ) {
            updateProgressBar({
              ...lastSongInfo,
              elapsedSeconds: lastSongInfo.elapsedSeconds + 1,
            });
          }
        }, 1000);
      }
    };

    const stopProgressInterval = () => {
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    };

    registerCallback((songInfo) => {
      if (!songInfo?.title) return;
      updateProgressBar(songInfo);
      if (songInfo.isPaused) {
        stopProgressInterval();
      } else {
        startProgressInterval(songInfo);
      }
    });

    return () => {
      stopProgressInterval();
      window.setProgressBar(-1);
    };
  },
});
