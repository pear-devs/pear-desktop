import { Innertube } from '\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js';

import prompt from 'custom-electron-prompt';

import { Howl } from 'howler';

import promptOptions from '@/providers/prompt-options';
import { getNetFetchAsFetch } from '@/plugins/utils/main';
import { createPlugin } from '@/utils';
import { VolumeFader } from './fader';

import { t } from '@/i18n';

import type { BrowserWindow } from 'electron';
import type { RendererContext } from '@/types/contexts';

export type CrossfadePluginConfig = {
  enabled: boolean;
  fadeInDuration: number;
  fadeOutDuration: number;
  secondsBeforeEnd: number;
  fadeScaling: 'linear' | 'logarithmic' | number;
};

export default createPlugin<
  unknown,
  unknown,
  {
    config?: CrossfadePluginConfig;
    ipc?: RendererContext<CrossfadePluginConfig>['ipc'];
  },
  CrossfadePluginConfig
>({
  name: () => t('plugins.crossfade.name'),
  description: () => t('plugins.crossfade.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    /**
     * The duration of the fade in and fade out in milliseconds.
     *
     * @default 1500ms
     */
    fadeInDuration: 1500,
    /**
     * The duration of the fade in and fade out in milliseconds.
     *
     * @default 5000ms
     */
    fadeOutDuration: 5000,
    /**
     * The duration of the fade in and fade out in seconds.
     *
     * @default 10s
     */
    secondsBeforeEnd: 10,
    /**
     * The scaling algorithm to use for the fade.
     * (or a positive number in dB)
     *
     * @default 'linear'
     */
    fadeScaling: 'linear',
  },
  menu({ window, getConfig, setConfig }) {
    const promptCrossfadeValues = async (
      win: BrowserWindow,
      options: CrossfadePluginConfig,
    ): Promise<Omit<CrossfadePluginConfig, 'enabled'> | undefined> => {
      const res = await prompt(
        {
          title: t('plugins.crossfade.prompt.options'),
          type: 'multiInput',
          multiInputOptions: [
            {
              label: t(
                'plugins.crossfade.prompt.options.multi-input.fade-in-duration',
              ),
              value: options.fadeInDuration,
              inputAttrs: {
                type: 'number',
                required: true,
                min: '0',
                step: '100',
              },
            },
            {
              label: t(
                'plugins.crossfade.prompt.options.multi-input.fade-out-duration',
              ),
              value: options.fadeOutDuration,
              inputAttrs: {
                type: 'number',
                required: true,
                min: '0',
                step: '100',
              },
            },
            {
              label: t(
                'plugins.crossfade.prompt.options.multi-input.seconds-before-end',
              ),
              value: options.secondsBeforeEnd,
              inputAttrs: {
                type: 'number',
                required: true,
                min: '0',
              },
            },
            {
              label: t(
                'plugins.crossfade.prompt.options.multi-input.fade-scaling.label',
              ),
              selectOptions: {
                linear: t(
                  'plugins.crossfade.prompt.options.multi-input.fade-scaling.linear',
                ),
                logarithmic: t(
                  'plugins.crossfade.prompt.options.multi-input.fade-scaling.logarithmic',
                ),
              },
              value: options.fadeScaling,
            },
          ],
          resizable: true,
          height: 360,
          ...promptOptions(),
        },
        win,
      ).catch(console.error);

      if (!res) {
        return undefined;
      }

      let fadeScaling: 'linear' | 'logarithmic' | number;
      if (res[3] === 'linear' || res[3] === 'logarithmic') {
        fadeScaling = res[3];
      } else if (isFinite(Number(res[3]))) {
        fadeScaling = Number(res[3]);
      } else {
        fadeScaling = options.fadeScaling;
      }

      return {
        fadeInDuration: Number(res[0]),
        fadeOutDuration: Number(res[1]),
        secondsBeforeEnd: Number(res[2]),
        fadeScaling,
      };
    };

    return [
      {
        label: t('plugins.crossfade.menu.advanced'),
        async click() {
          const newOptions = await promptCrossfadeValues(
            window,
            await getConfig(),
          );
          if (newOptions) {
            setConfig(newOptions);
          }
        },
      },
    ];
  },

  async backend({ ipc }) {
    const yt = await Innertube.create({
      fetch: getNetFetchAsFetch(),
    });

    ipc.handle('audio-url', async (videoID: string) => {
      const info = await yt.getBasicInfo(videoID);
      return info.streaming_data?.formats[0].decipher(yt.session.player);
    });
  },

  renderer: {
    async start({ ipc, getConfig }) {
      this.config = await getConfig();
      this.ipc = ipc;
    },
    onConfigChange(newConfig) {
      this.config = newConfig;
    },
    onPlayerApiReady() {
      let transitionAudio: Howl; // Howler audio used to fade out the current music
      let firstVideo = true;
      let waitForTransition: Promise<unknown>;

      const getStreamURL = async (videoID: string): Promise<string> =>
        this.ipc?.invoke('audio-url', videoID) as Promise<string>;

      const getVideoIDFromURL = (url: string) =>
        new URLSearchParams(url.split('?')?.at(-1)).get('v');

      const isReadyToCrossfade = () =>
        transitionAudio && transitionAudio.state() === 'loaded';

      const watchVideoIDChanges = (cb: (id: string) => void) => {
        window.navigation.addEventListener('navigate', (event) => {
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
        if (transitionAudio) {
          transitionAudio.unload();
        }

        transitionAudio = new Howl({
          src: url,
          html5: true,
          volume: 0,
        });
        syncVideoWithTransitionAudio();
      };

      const syncVideoWithTransitionAudio = () => {
        const video = document.querySelector('video')!;

        const videoFader = new VolumeFader(video, {
          fadeScaling: this.config?.fadeScaling,
          fadeDuration: this.config?.fadeInDuration,
        });

        transitionAudio.play();
        transitionAudio.seek(video.currentTime);

        video.addEventListener('seeking', () => {
          transitionAudio.seek(video.currentTime);
        });

        video.addEventListener('pause', () => {
          transitionAudio.pause();
        });

        video.addEventListener('play', () => {
          transitionAudio.play();
          transitionAudio.seek(video.currentTime);

          // Fade in
          const videoVolume = video.volume;
          video.volume = 0;
          videoFader.fadeTo(videoVolume);
        });

        // Exit just before the end for the transition
        const transitionBeforeEnd = () => {
          if (
            video.currentTime >=
              video.duration - (this.config?.secondsBeforeEnd ?? 0) &&
            isReadyToCrossfade()
          ) {
            video.removeEventListener('timeupdate', transitionBeforeEnd);

            // Go to next video - XXX: does not support "repeat 1" mode
            document.querySelector<HTMLButtonElement>('.next-button')?.click();
          }
        };

        video.addEventListener('timeupdate', transitionBeforeEnd);
      };

      const crossfade = (cb: () => void) => {
        if (!isReadyToCrossfade()) {
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
          fadeScaling: this.config?.fadeScaling,
          fadeDuration: this.config?.fadeOutDuration,
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
        const url = await getStreamURL(videoID);
        if (!url) {
          return;
        }

        createAudioForCrossfade(url);
      });
    },
  },
});
