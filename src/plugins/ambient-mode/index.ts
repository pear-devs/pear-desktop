import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import style from './style.css?inline';
import { ambientModeConfig } from './types';

export default createPlugin({
  name: () => t('plugins.ambient-mode.name'),
  description: () => t('plugins.ambient-mode.description'),
  restartNeeded: false,
  config: ambientModeConfig,
  stylesheets: [style],

  renderer: (ctx) => {
    let unregister: (() => void) | null = null;
    let update: (() => void) | null = null;
    let lastMediaType: 'video' | 'image' | null = null;
    let lastVideoSource: string | null = null;
    let lastImageSource: string | null = null;

    ctx.onCleanup(() => {
      update = null;
      unregister?.();
      unregister = null;
    });

    // Applies the new values to the injected element; the canvas interval
    // keeps its rate until the element is injected again (as before).
    ctx.onConfigChange(() => update?.());

    const setup = (video: HTMLVideoElement) => {
      const songImage = document.querySelector<HTMLImageElement>('#song-image');
      const songVideo = document.querySelector<HTMLDivElement>('#song-video');
      const image = songImage?.querySelector<HTMLImageElement>(
        'yt-img-shadow > img',
      );

      const videoWrapper = document.querySelector(
        '#song-video > .player-wrapper',
      );

      const injectBlurImage = () => {
        if (!songImage || !image) return null;

        lastImageSource = image.src;

        const blurImage = document.createElement('img');
        blurImage.classList.add('html5-blur-image');
        blurImage.src = image.src;

        update = () => {
          const { size, blur, opacity, fullscreen } = ctx.config;
          if (fullscreen) blurImage.classList.add('fullscreen');
          else blurImage.classList.remove('fullscreen');

          blurImage.style.setProperty('--width', `${size}%`);
          blurImage.style.setProperty('--height', `${size}%`);
          blurImage.style.setProperty('--blur', `${blur}px`);
          blurImage.style.setProperty('--opacity', `${opacity}`);
        };
        update();

        /* injecting */
        songImage.prepend(blurImage);

        /* cleanup */
        return () => {
          if (blurImage.isConnected) blurImage.remove();
        };
      };

      const injectBlurVideo = () => {
        if (!songVideo || !video || !videoWrapper) return null;

        lastVideoSource = video.src;

        const blurCanvas = document.createElement('canvas');
        blurCanvas.classList.add('html5-blur-canvas');

        const context = blurCanvas.getContext('2d', {
          willReadFrequently: true,
        });

        /* effect */
        let lastEffectWorkId: number | null = null;
        let lastImageData: ImageData | null = null;

        const onSync = () => {
          if (typeof lastEffectWorkId === 'number')
            cancelAnimationFrame(lastEffectWorkId);

          lastEffectWorkId = requestAnimationFrame(() => {
            if (!context) return;

            const width = ctx.config.quality;
            let height = Math.max(
              Math.floor((blurCanvas.height / blurCanvas.width) * width),
              1,
            );
            if (!Number.isFinite(height)) height = width;
            if (!height) return;

            context.globalAlpha = 1;
            if (lastImageData) {
              const frameOffset =
                (1 / ctx.config.buffer) * (1000 / ctx.config.interpolationTime);
              const fade = frameOffset * 2;
              context.globalAlpha = 1 - fade; // because of alpha value must be < 1
              context.putImageData(lastImageData, 0, 0);
              context.globalAlpha = frameOffset;
            }
            context.drawImage(video, 0, 0, width, height);

            lastImageData = context.getImageData(0, 0, width, height); // current image data

            lastEffectWorkId = null;
          });
        };

        update = () => {
          const { quality, size, blur, opacity, fullscreen } = ctx.config;
          const rect = video.getBoundingClientRect();

          const newWidth = Math.floor(video.width || rect.width);
          const newHeight = Math.floor(video.height || rect.height);

          if (newWidth === 0 || newHeight === 0) return;

          blurCanvas.width = quality;
          blurCanvas.height = Math.floor((newHeight / newWidth) * quality);

          if (fullscreen) blurCanvas.classList.add('fullscreen');
          else blurCanvas.classList.remove('fullscreen');

          blurCanvas.style.setProperty('--width', `${size}%`);
          blurCanvas.style.setProperty('--height', `${size}%`);
          blurCanvas.style.setProperty('--blur', `${blur}px`);
          blurCanvas.style.setProperty('--opacity', `${opacity}`);
        };
        update();

        /* hooking */
        const startSync = () =>
          ctx.setInterval(
            onSync,
            Math.max(1, Math.ceil(1000 / ctx.config.buffer)),
          );
        let canvasInterval: ReturnType<typeof setInterval> | null = startSync();

        const onPause = () => {
          if (canvasInterval) ctx.clearInterval(canvasInterval);
          canvasInterval = null;
        };
        const onPlay = () => {
          if (canvasInterval) ctx.clearInterval(canvasInterval);
          canvasInterval = startSync();
        };
        songVideo.addEventListener('pause', onPause);
        songVideo.addEventListener('play', onPlay);

        /* injecting */
        videoWrapper.prepend(blurCanvas);

        /* cleanup */
        return () => {
          if (canvasInterval) ctx.clearInterval(canvasInterval);
          if (typeof lastEffectWorkId === 'number')
            cancelAnimationFrame(lastEffectWorkId);

          songVideo.removeEventListener('pause', onPause);
          songVideo.removeEventListener('play', onPlay);

          if (blurCanvas.isConnected) blurCanvas.remove();
        };
      };

      const isVideoMode = () => {
        const songVideo = document.querySelector<HTMLDivElement>('#song-video');
        if (!songVideo) {
          lastMediaType = 'image';
          return false;
        }

        const isVideo = getComputedStyle(songVideo).display !== 'none';
        lastMediaType = isVideo ? 'video' : 'image';
        return isVideo;
      };

      const playerPage = document.querySelector<HTMLElement>('#player-page');
      const ytmusicAppLayout = document.querySelector<HTMLElement>('#layout');

      const injectBlurElement = (force?: boolean): boolean | void => {
        const isPageOpen = ytmusicAppLayout?.hasAttribute('player-page-open');
        if (isPageOpen) {
          const isVideo = isVideoMode();
          if (!force) {
            if (lastMediaType === 'video' && lastVideoSource === video?.src)
              return false;
            if (lastMediaType === 'image' && lastImageSource === image?.src)
              return false;
          }
          unregister?.();
          unregister =
            (isVideo ? injectBlurVideo() : injectBlurImage()) ?? null;
        } else {
          unregister?.();
          unregister = null;
        }
      };

      if (playerPage) {
        /* needed for switching between different views (e.g. miniplayer) */
        ctx.observe(playerPage, { attributes: true }, (mutationsList) => {
          for (const mutation of mutationsList) {
            if (mutation.type === 'attributes') {
              injectBlurElement(true);
              break;
            }
          }
        });

        /* fallback ticker for when the observer isn't triggered */
        ctx.setInterval(injectBlurElement, 1000);
      }
    };

    // Waits for the video element; the polling stops with the plugin.
    const waitTimer = ctx.setInterval(() => {
      const video = document.querySelector<HTMLVideoElement>(
        '.html5-video-container > video',
      );
      if (!video) return;
      ctx.clearInterval(waitTimer);
      setup(video);
    }, 100);
  },
});
