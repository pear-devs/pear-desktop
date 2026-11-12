import prompt from 'custom-electron-prompt';
import { Innertube } from '\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js';

import { t } from '@/i18n';
import { getNetFetchAsFetch } from '@/plugins/utils/main';
import {
  mintPoToken,
  setupYoutubeiEvaluator,
} from '@/plugins/utils/main/youtubei';
import promptOptions from '@/providers/prompt-options';
import { createPlugin, LoggerPrefix } from '@/utils';

import { type VolumeControl, VolumeFader } from './fader';

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
    setupYoutubeiEvaluator();
    const yt = await Innertube.create({
      fetch: getNetFetchAsFetch(),
    });

    ipc.handle('audio-url', async (videoID: string) => {
      try {
        const poToken = await mintPoToken(
          yt.session.context.client.visitorData ?? '',
          videoID,
        );
        const info = await yt.getBasicInfo(videoID, {
          client: 'YTMUSIC',
          po_token: poToken,
        });
        const url = new URL(
          await info
            .chooseFormat({ type: 'audio', quality: 'best' })
            .decipher(yt.session.player),
        );
        url.searchParams.set('pot', poToken);
        return url.toString();
      } catch (error) {
        console.error(
          LoggerPrefix,
          `[crossfade] Failed to get the stream URL of ${videoID}:`,
          error,
        );
        return '';
      }
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
    onPlayerApiReady(api) {
      const video = document.querySelector('video')!;

      // The current song as a second, silent stream. Near the end of a song
      // it takes over the old song, which then fades out on it while the
      // video already plays the next song.
      let transitionAudio: HTMLAudioElement | undefined;
      let transitionVideoID: string | undefined;
      let currentVideoID: string | undefined;
      // The end trigger moved the old song to the transition audio and
      // skipped to the next song; the navigation it causes finishes the handover
      let handedOver = false;
      let handoverTimeout: ReturnType<typeof setTimeout> | undefined;
      const fadingOut = new Set<HTMLAudioElement>();

      const getVideoIDFromURL = (url: string) =>
        new URLSearchParams(url.split('?')?.at(-1)).get('v');

      const fadeOptions = (fadeDuration?: number) => ({
        fadeScaling: this.config?.fadeScaling,
        fadeDuration,
      });

      // Video volume. YouTube Music writes `video.volume` for every song
      // (slider × loudness normalization), also while crossfade holds the
      // video silent. Its value is kept as the target, and the element
      // plays at `target × gain`; crossfade only moves the gain.
      const nativeVolume = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'volume',
      )!;
      let targetVolume = video.volume;
      let gain = 1;
      const applyVideoVolume = () =>
        nativeVolume.set!.call(video, targetVolume * gain);
      Object.defineProperty(video, 'volume', {
        configurable: true,
        get: () => targetVolume,
        set: (volume: number) => {
          if (!(volume >= 0 && volume <= 1)) {
            // Throws the native IndexSizeError
            nativeVolume.set!.call(video, volume);
          }
          targetVolume = volume;
          applyVideoVolume();
        },
      });
      const videoGain: VolumeControl = {
        get volume() {
          return gain;
        },
        set volume(level: number) {
          gain = level;
          applyVideoVolume();
        },
      };
      let videoFader: VolumeFader | undefined;
      const fadeInVideo = () => {
        videoFader?.stop();
        videoGain.volume = 0;
        videoFader = new VolumeFader(
          videoGain,
          fadeOptions(this.config?.fadeInDuration),
        );
        videoFader.fadeTo(1, () => {
          videoFader = undefined;
        });
      };

      const unload = (audio: HTMLAudioElement | undefined) => {
        if (!audio) return;
        fadingOut.delete(audio);
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      };

      const fadeOut = (audio: HTMLAudioElement) => {
        fadingOut.add(audio);
        new VolumeFader(
          audio,
          fadeOptions(this.config?.fadeOutDuration),
        ).fadeTo(0, () => unload(audio));
      };

      const isReadyToCrossfade = () =>
        !!transitionAudio &&
        transitionVideoID === currentVideoID &&
        transitionAudio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA &&
        Number.isFinite(transitionAudio.duration);

      // Song time comes from the player API: YouTube Music can append the
      // next song to the same <video> buffer, and then the element's
      // currentTime and duration span songs
      const songTime = () => api.getCurrentTime();

      // A seek leaves the audio tens of ms behind, which seeking again
      // cannot fix, so small offsets are corrected through the playback rate
      const syncTransitionAudio = () => {
        const audio = transitionAudio;
        if (!audio || handedOver || transitionVideoID !== currentVideoID) {
          return;
        }
        if (video.paused) {
          audio.pause();
          return;
        }
        if (audio.paused) {
          audio.currentTime = songTime();
          audio.play().catch(() => {});
          return;
        }
        const offset = audio.currentTime - songTime();
        if (Math.abs(offset) > 0.5) {
          audio.currentTime = songTime();
          audio.playbackRate = video.playbackRate;
        } else {
          // Catch up half the offset per second, at most 5% faster or slower
          const catchUp = offset / 2;
          const correction =
            Math.abs(offset) < 0.005
              ? 1
              : Math.min(1.05, Math.max(0.95, 1 - catchUp));
          audio.playbackRate = video.playbackRate * correction;
        }
      };

      const loadTransitionAudio = async (videoID: string) => {
        const url = (await this.ipc?.invoke('audio-url', videoID)) as string;
        if (videoID !== currentVideoID) return; // skipped in the meantime
        unload(transitionAudio);
        transitionAudio = undefined;
        if (!url) return; // the next song change is a plain cut

        const audio = new Audio();
        audio.preload = 'auto';
        audio.volume = 0;
        audio.addEventListener('error', () => {
          if (transitionAudio === audio) {
            transitionAudio = undefined;
            unload(audio);
          }
        });
        audio.src = url;
        transitionAudio = audio;
        transitionVideoID = videoID;
        syncTransitionAudio();
      };

      // Both play the old song for a moment, with an equal-power curve:
      // switching in one step left a gap, likely because the two paths have
      // different output delays (the video goes through the app's Web Audio graph)
      const OVERLAP_MS = 100;
      const handOver = () => {
        const audio = transitionAudio!;
        handedOver = true;
        videoFader?.stop();
        videoFader = undefined;
        audio.playbackRate = video.playbackRate;
        const startGain = gain;
        const start = Date.now();
        const step = () => {
          const progress = Math.min((Date.now() - start) / OVERLAP_MS, 1);
          if (progress < 1) {
            const angle = (progress * Math.PI) / 2;
            videoGain.volume = startGain * Math.cos(angle);
            audio.volume = targetVolume * startGain * Math.sin(angle);
            setTimeout(step, 10);
            return;
          }
          // Exact end values: cos(π/2) isn't 0, and the timeupdate fallback
          // only fades the next song in from a gain of exactly 0
          videoGain.volume = 0;
          audio.volume = targetVolume * startGain;
          // Go to next video - XXX: does not support "repeat 1" mode
          api.nextVideo();
          // No next song: give the old one back to the video
          handoverTimeout = setTimeout(() => {
            if (!handedOver) return;
            handedOver = false;
            audio.volume = 0;
            videoGain.volume = startGain;
          }, 3000);
        };
        step();
      };

      const onSongChange = (videoID: string) => {
        const previous = transitionAudio;
        if (handedOver) {
          clearTimeout(handoverTimeout);
          handedOver = false;
          fadeOut(previous!);
        } else if (previous && isReadyToCrossfade()) {
          // Manual skip: the video has already switched, so hand over at once
          previous.playbackRate = video.playbackRate;
          previous.volume = targetVolume * gain;
          videoFader?.stop();
          videoFader = undefined;
          videoGain.volume = 0;
          fadeOut(previous);
        } else {
          unload(previous);
        }
        transitionAudio = undefined;
        currentVideoID = videoID;
        loadTransitionAudio(videoID).catch(() => {});
      };

      window.navigation.addEventListener('navigate', (event) => {
        const nextVideoID = getVideoIDFromURL(event.destination.url ?? '');
        if (nextVideoID && nextVideoID !== currentVideoID) {
          onSongChange(nextVideoID);
        }
      });

      video.addEventListener('timeupdate', () => {
        if (handedOver) return;
        syncTransitionAudio();
        // The new song started without a `play` event: don't stay silent
        if (gain === 0 && !videoFader && !video.paused) fadeInVideo();

        const before = this.config?.secondsBeforeEnd ?? 0;
        if (!isReadyToCrossfade()) return;
        // Length from the same song's stream: `getDuration()` is sometimes
        // short right after a natural transition
        const length = transitionAudio!.duration;
        const time = songTime();
        if (
          length > before * 2 &&
          time >= length - before &&
          time < length - 0.5
        ) {
          handOver();
        }
      });

      video.addEventListener('seeked', () => {
        if (transitionAudio && !handedOver) {
          transitionAudio.currentTime = songTime();
        }
      });

      video.addEventListener('pause', () => {
        transitionAudio?.pause();
        // A fade-out cannot resume in place; drop it
        for (const audio of fadingOut) unload(audio);
      });

      video.addEventListener('play', () => {
        syncTransitionAudio();
        if (!handedOver) fadeInVideo();
      });

      const initialVideoID = getVideoIDFromURL(location.href);
      if (initialVideoID) onSongChange(initialVideoID);
    },
  },
});
