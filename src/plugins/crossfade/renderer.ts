import { Howl } from 'howler';

import { createRenderer } from '@/utils';

import { VolumeFader } from './fader';

import type { CrossfadeIpc, crossfadeConfig } from './types';

export default createRenderer<typeof crossfadeConfig, CrossfadeIpc>((ctx) => {
  // Settings are read when they are used; nothing to redo on a change.
  ctx.onConfigChange(() => {});

  ctx.onPlayerApiReady(() => {
    let transitionAudio: Howl | undefined; // Howler audio used to fade out the current music
    let firstVideo = true;
    let waitForTransition: Promise<unknown> | undefined;
    // Listeners on the <video> for the current transition audio
    let videoListeners: AbortController | undefined;

    ctx.onCleanup(() => {
      videoListeners?.abort();
      transitionAudio?.unload();
    });

    const getVideoIDFromURL = (url: string) =>
      new URLSearchParams(url.split('?')?.at(-1)).get('v');

    const isReadyToCrossfade = () => transitionAudio?.state() === 'loaded';

    const watchVideoIDChanges = (cb: (id: string) => void) => {
      ctx.listen(window.navigation, 'navigate', (event: NavigateEvent) => {
        const currentVideoID = getVideoIDFromURL(
          (event.currentTarget as Navigation).currentEntry?.url ?? '',
        );
        const nextVideoID = getVideoIDFromURL(event.destination.url ?? '');

        if (
          nextVideoID &&
          currentVideoID &&
          (firstVideo || nextVideoID !== currentVideoID)
        ) {
          if (isReadyToCrossfade()) {
            crossfade(() => {
              cb(nextVideoID);
            });
          } else {
            cb(nextVideoID);
            firstVideo = false;
          }
        }
      });
    };

    const createAudioForCrossfade = (url: string) => {
      transitionAudio?.unload();

      transitionAudio = new Howl({
        src: url,
        html5: true,
        volume: 0,
      });
      syncVideoWithTransitionAudio(transitionAudio);
    };

    const syncVideoWithTransitionAudio = (audio: Howl) => {
      const video = document.querySelector('video')!;

      const videoFader = new VolumeFader(video, {
        fadeScaling: ctx.config.fadeScaling,
        fadeDuration: ctx.config.fadeInDuration,
      });

      audio.play();
      audio.seek(video.currentTime);

      // Replace the listeners of the previous transition audio
      videoListeners?.abort();
      videoListeners = new AbortController();
      const { signal } = videoListeners;

      video.addEventListener(
        'seeking',
        () => {
          audio.seek(video.currentTime);
        },
        { signal },
      );

      video.addEventListener(
        'pause',
        () => {
          audio.pause();
        },
        { signal },
      );

      video.addEventListener(
        'play',
        () => {
          audio.play();
          audio.seek(video.currentTime);

          // Fade in
          const videoVolume = video.volume;
          video.volume = 0;
          videoFader.fadeTo(videoVolume);
        },
        { signal },
      );

      // Exit just before the end for the transition
      const transitionBeforeEnd = () => {
        if (
          video.currentTime >= video.duration - ctx.config.secondsBeforeEnd &&
          isReadyToCrossfade()
        ) {
          video.removeEventListener('timeupdate', transitionBeforeEnd);

          // Go to next video - XXX: does not support "repeat 1" mode
          document.querySelector<HTMLButtonElement>('.next-button')?.click();
        }
      };

      video.addEventListener('timeupdate', transitionBeforeEnd, { signal });
    };

    const crossfade = (cb: () => void) => {
      if (!transitionAudio || !isReadyToCrossfade()) {
        cb();
        return;
      }

      let resolveTransition: () => void;
      waitForTransition = new Promise<void>((resolve) => {
        resolveTransition = resolve;
      });

      const video = document.querySelector('video')!;

      const fader = new VolumeFader(transitionAudio._sounds[0]._node, {
        initialVolume: video.volume,
        fadeScaling: ctx.config.fadeScaling,
        fadeDuration: ctx.config.fadeOutDuration,
      });

      // Fade out the music
      video.volume = 0;
      fader.fadeOut(() => {
        resolveTransition();
        cb();
      });
    };

    watchVideoIDChanges(async (videoID) => {
      await waitForTransition;
      const url = await ctx.ipc.invoke('audioUrl', videoID);
      if (!url || ctx.signal.aborted) {
        return;
      }

      createAudioForCrossfade(url);
    });
  });
});
