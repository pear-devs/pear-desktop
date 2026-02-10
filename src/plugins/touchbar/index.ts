import { nativeImage, type NativeImage, TouchBar } from 'electron';

import { createPlugin } from '@/utils';
import { getSongControls } from '@/providers/song-controls';
import { registerCallback, SongInfoEvent } from '@/providers/song-info';
import { t } from '@/i18n';

import musicPlayerIcon from '@assets/icon.png?asset&asarUnpack';
import { Platform } from '@/types/plugins';

export default createPlugin({
  name: () => t('plugins.touchbar.name'),
  description: () => t('plugins.touchbar.description'),
  restartNeeded: true,
  platform: Platform.macOS,
  config: {
    enabled: false,
  },
  backend({ window }) {
    const {
      TouchBarButton,
      TouchBarLabel,
      TouchBarSpacer,
      TouchBarSegmentedControl,
      TouchBarScrubber,
    } = TouchBar;

    // Songtitle label
    const songTitle = new TouchBarLabel({
      label: '',
    });
    // This will store the song controls once available
    let controls: (() => void)[] = [];

    // This will store the song image once available
    const songImage: {
      icon?: NativeImage;
    } = {};

    // Pause/play button
    const pausePlayButton = new TouchBarButton({});

    // The song control buttons (control functions are in the same order)
    const buttons = new TouchBarSegmentedControl({
      mode: 'buttons',
      segments: [
        new TouchBarButton({
          label: '⏮',
        }),
        pausePlayButton,
        new TouchBarButton({
          label: '⏭',
        }),
        new TouchBarButton({
          label: '👎',
        }),
        new TouchBarButton({
          label: '👍',
        }),
      ],
      change: (i) => controls[i](),
    });

    // This is the touchbar object, this combines everything with proper layout
    const touchBar = new TouchBar({
      items: [
        new TouchBarScrubber({
          items: [songImage, songTitle],
          continuous: false,
        }),
        new TouchBarSpacer({
          size: 'flexible',
        }),
        buttons,
      ],
    });

    const { playPause, next, previous, dislike, like } =
      getSongControls(window);

    // If the page is ready, register the callback
    window.once('ready-to-show', () => {
      controls = [previous, playPause, next, dislike, like];

      // Register the callback
      registerCallback((songInfo, event) => {
        if (event === SongInfoEvent.TimeChanged) return;
        // Song information changed, so lets update the touchBar

        // Set the song title
        songTitle.label = songInfo.title;

        // Changes the pause button if paused
        pausePlayButton.label = songInfo.isPaused ? '▶️' : '⏸';

        // Get image source
        songImage.icon = (
          songInfo.image
            ? songInfo.image
            : nativeImage.createFromPath(musicPlayerIcon)
        ).resize({ height: 23 });

        window.setTouchBar(touchBar);
      });
    });
  },
});
