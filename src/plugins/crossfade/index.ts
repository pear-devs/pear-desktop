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
    onPlayerApiReady(playerApi) {
      let transitionAudio: Howl; // Howler audio used to fade out the current music
      let firstVideo = true;
      let waitForTransition: Promise<unknown>;
      // The video element the listeners below are attached to. They must only be
      // attached once, otherwise every song adds another 'play' handler and the
      // later handlers read the volume the first one just set to 0, fading the
      // song in to silence.
      let attachedVideo: HTMLVideoElement | undefined;
      let videoFader: VolumeFader | undefined;
      let transitionTriggered = false;

      // The volume the player wants (the slider value), as a 0…1 level. Reading
      // video.volume instead is unreliable because it may be mid-fade (or 0).
      const getTargetVolume = () =>
        Math.min(Math.max(playerApi.getVolume() / 100, 0), 1);

      const fadeInVideo = (video: HTMLVideoElement) => {
        videoFader?.stop();
        videoFader = undefined;

        const duration = Number(this.config?.fadeInDuration ?? 0);
        if (!(duration > 0)) {
          video.volume = getTargetVolume();
          return;
        }

        video.volume = 0;
        videoFader = new VolumeFader(video, {
          fadeScaling: this.config?.fadeScaling,
          fadeDuration: duration,
        });
        videoFader.fadeTo(getTargetVolume(), () => {
          // Land on the latest slider value in case it changed during the fade
          video.volume = getTargetVolume();
          videoFader = undefined;
        });
      };

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

      const attachVideoListeners = (video: HTMLVideoElement) => {
        if (attachedVideo === video) {
          return;
        }
        attachedVideo = video;

        video.addEventListener('seeking', () => {
          transitionAudio?.seek(video.currentTime);
        });

        video.addEventListener('pause', () => {
          transitionAudio?.pause();
        });

        video.addEventListener('play', () => {
          if (transitionAudio) {
            transitionAudio.play();
            transitionAudio.seek(video.currentTime);
          }

          fadeInVideo(video);
        });

        // Exit just before the end for the transition
        video.addEventListener('timeupdate', () => {
          if (
            !transitionTriggered &&
            video.currentTime >=
              video.duration - (this.config?.secondsBeforeEnd ?? 0) &&
            isReadyToCrossfade()
          ) {
            transitionTriggered = true;

            // Go to next video - XXX: does not support "repeat 1" mode
            document.querySelector<HTMLButtonElement>('.next-button')?.click();
          }
        });
      };

      const syncVideoWithTransitionAudio = () => {
        const video = document.querySelector('video');
        if (!video) {
          return;
        }

        transitionTriggered = false;
        attachVideoListeners(video);

        transitionAudio.play();
        transitionAudio.seek(video.currentTime);
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
        videoFader?.stop();
        videoFader = undefined;
        video.volume = 0;
        fader.fadeOut(() => {
          // If the next song started without a 'play' event, nothing faded it
          // back in and it would stay silent until the slider was touched.
          if (!video.paused && !videoFader && video.volume === 0) {
            fadeInVideo(video);
          }
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
