import { nativeImage, nativeTheme, type NativeImage } from 'electron';

import playIconBlack from '@assets/media-icons-black/play.png?asset&asarUnpack';
import pauseIconBlack from '@assets/media-icons-black/pause.png?asset&asarUnpack';
import nextIconBlack from '@assets/media-icons-black/next.png?asset&asarUnpack';
import previousIconBlack from '@assets/media-icons-black/previous.png?asset&asarUnpack';

import playIconWhite from '@assets/media-icons-white/play.png?asset&asarUnpack';
import pauseIconWhite from '@assets/media-icons-white/pause.png?asset&asarUnpack';
import nextIconWhite from '@assets/media-icons-white/next.png?asset&asarUnpack';
import previousIconWhite from '@assets/media-icons-white/previous.png?asset&asarUnpack';

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

    const getImages = (): Record<
      'play' | 'pause' | 'next' | 'previous',
      NativeImage
    > => {
      const isDark = nativeTheme.shouldUseDarkColors;
      return {
        play: nativeImage.createFromPath(
          isDark ? playIconWhite : playIconBlack,
        ),
        pause: nativeImage.createFromPath(
          isDark ? pauseIconWhite : pauseIconBlack,
        ),
        next: nativeImage.createFromPath(
          isDark ? nextIconWhite : nextIconBlack,
        ),
        previous: nativeImage.createFromPath(
          isDark ? previousIconWhite : previousIconBlack,
        ),
      };
    };
    let images = getImages();

    nativeTheme.on('updated', () => {
      images = getImages();
      setThumbar(currentSongInfo);
    });

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
