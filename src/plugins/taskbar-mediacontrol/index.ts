import { nativeImage } from 'electron';

import playIcon from '@assets/media-icons-black/play.png?asset&asarUnpack';
import pauseIcon from '@assets/media-icons-black/pause.png?asset&asarUnpack';
import nextIcon from '@assets/media-icons-black/next.png?asset&asarUnpack';
import previousIcon from '@assets/media-icons-black/previous.png?asset&asarUnpack';

import { createPlugin } from '@/utils';
import { getSongControls } from '@/providers/song-controls';
import {
  registerCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import { t } from '@/i18n';
import { Platform } from '@/types/plugins';

export default createPlugin({
  name: () => t('plugins.taskbar-mediacontrol.name'),
  description: () => t('plugins.taskbar-mediacontrol.description'),
  restartNeeded: true,
  platform: Platform.Windows,
  config: {
    enabled: false,
  },

  backend({ window }) {
    let currentSongInfo: SongInfo;

    const { playPause, next, previous } = getSongControls(window);

    const images = {
      play: nativeImage.createFromPath(playIcon),
      pause: nativeImage.createFromPath(pauseIcon),
      next: nativeImage.createFromPath(nextIcon),
      previous: nativeImage.createFromPath(previousIcon),
    };

    const setThumbar = (songInfo: SongInfo) => {
      // Wait for song to start before setting thumbar
      if (!songInfo?.title) {
        return;
      }

      // Win32 require full rewrite of components
      window.setThumbarButtons([
        {
          tooltip: 'Previous',
          icon: images.previous,
          click() {
            previous();
          },
        },
        {
          tooltip: 'Play/Pause',
          // Update icon based on play state
          icon: songInfo.isPaused ? images.play : images.pause,
          click() {
            playPause();
          },
        },
        {
          tooltip: 'Next',
          icon: images.next,
          click() {
            next();
          },
        },
      ]);
    };

    registerCallback((songInfo, event) => {
      if (event !== SongInfoEvent.TimeChanged) {
        // Update currentsonginfo for win.on('show')
        currentSongInfo = songInfo;
        // Update thumbar
        setThumbar(songInfo);
      }
    });

    // Need to set thumbar again after win.show
    window.on('show', () => setThumbar(currentSongInfo));
  },
});
