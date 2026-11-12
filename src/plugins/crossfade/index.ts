import prompt from 'custom-electron-prompt';
import { Howl } from 'howler';
import { Innertube } from '\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js';

import { t } from '@/i18n';
import { getNetFetchAsFetch } from '@/plugins/utils/main';
import promptOptions from '@/providers/prompt-options';
import { createPlugin } from '@/utils';

import { VolumeFader } from './fader';

import type { RendererContext } from '@/types/contexts';
import type { BrowserWindow } from 'electron';

export type CrossfadePluginConfig = {
  enabled: boolean;
  fadeInDuration: number;
  fadeOutDuration: number;
  secondsBeforeEnd: number;
  fadeScaling: 'linear' | 'logarithmic' | 'equalPower' | number;
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
     * @default 5000ms
     */
    fadeInDuration: 5000,
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
     * @default 'equalPower'
     */
    fadeScaling: 'equalPower',
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
                equalPower: 'Equal Power',
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

      let fadeScaling: 'linear' | 'logarithmic' | 'equalPower' | number;
      if (res[3] === 'linear' || res[3] === 'logarithmic' || res[3] === 'equalPower') {
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
      let syncedAudio: Howl | null = null;
      let firstVideo = true;
      let isAutoTransition = false;
      let cleanupListeners: (() => void) | null = null;

      const getStreamURL = async (videoID: string): Promise<string> =>
        this.ipc?.invoke('audio-url', videoID) as Promise<string>;

      const getVideoIDFromURL = (url: string) =>
        new URLSearchParams(url.split('?')?.at(-1)).get('v');

      const transitionBeforeEnd = () => {
        const video = document.querySelector('video');
        if (!video) return;

        if (
          video.currentTime >=
            video.duration - (this.config?.secondsBeforeEnd ?? 10) &&
          syncedAudio &&
          syncedAudio.state() === 'loaded'
        ) {
          isAutoTransition = true;
          video.removeEventListener('timeupdate', transitionBeforeEnd);
          document.querySelector<HTMLButtonElement>('.next-button')?.click();
        }
      };

      window.navigation.addEventListener('navigate', (event) => {
        const currentVideoID = getVideoIDFromURL(
          (event.currentTarget as any).currentEntry?.url ?? '',
        );
        const nextVideoID = getVideoIDFromURL((event as any).destination.url ?? '');

        if (
          nextVideoID &&
          currentVideoID &&
          (firstVideo || nextVideoID !== currentVideoID)
        ) {
          firstVideo = false;

          const isAuto = isAutoTransition;
          isAutoTransition = false;

          const video = document.querySelector('video');

          if (cleanupListeners) {
            cleanupListeners();
            cleanupListeners = null;
          }

          if (syncedAudio) {
            if (isAuto && syncedAudio.state() === 'loaded') {
              const fadingAudio = syncedAudio;
              syncedAudio = null;

              const targetVolume = video ? video.volume : 1;
              if (video) video.volume = 0;

              const volumeWrapper = {
                get volume() {
                  return fadingAudio.volume() as number;
                },
                set volume(v: number) {
                  fadingAudio.volume(v);
                },
              };

              const fadeOutFader = new VolumeFader(volumeWrapper, {
                initialVolume: targetVolume,
                fadeScaling: this.config?.fadeScaling,
                fadeDuration: this.config?.fadeOutDuration,
              });

              fadeOutFader.fadeOut(() => {
                fadingAudio.unload();
              });

              if (video) {
                const fadeInFader = new VolumeFader(video, {
                  initialVolume: 0,
                  fadeScaling: this.config?.fadeScaling,
                  fadeDuration: this.config?.fadeInDuration,
                });

                const onPlay = () => {
                  fadeInFader.fadeTo(targetVolume);
                  video.removeEventListener('play', onPlay);
                };
                video.addEventListener('play', onPlay);
              }
            } else {
              syncedAudio.unload();
              syncedAudio = null;
            }
          }

          getStreamURL(nextVideoID).then((url) => {
            if (!url) return;

            syncedAudio = new Howl({
              src: url,
              html5: true,
              volume: 0,
            });

            if (video) {
              const onSeeking = () => syncedAudio?.seek(video.currentTime);
              const onPause = () => syncedAudio?.pause();
              const onPlay = () => {
                syncedAudio?.play();
                syncedAudio?.seek(video.currentTime);
              };

              video.addEventListener('seeking', onSeeking);
              video.addEventListener('pause', onPause);
              video.addEventListener('play', onPlay);
              video.addEventListener('timeupdate', transitionBeforeEnd);

              cleanupListeners = () => {
                video.removeEventListener('seeking', onSeeking);
                video.removeEventListener('pause', onPause);
                video.removeEventListener('play', onPlay);
                video.removeEventListener('timeupdate', transitionBeforeEnd);
              };

              if (!video.paused) {
                syncedAudio.play();
                syncedAudio.seek(video.currentTime);
              }
            }
          });
        }
      });
    },
  },
});
