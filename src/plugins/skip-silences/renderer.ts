import type { RendererContext } from '@/types/contexts';
import type { SkipSilencesPluginConfig } from './index';

let config: SkipSilencesPluginConfig;

let isSilent = false;
let hasAudioStarted = false;

const smoothing = 0.1;
const threshold = -100; // DB (-100 = absolute silence, 0 = loudest)
const interval = 2; // Ms
const history = 10;
const speakingHistory = Array.from({ length: history }).fill(0) as number[];

let playOrSeekHandler: (() => void) | undefined;

const getMaxVolume = (
  analyser: AnalyserNode,
  fftBins: Float32Array<ArrayBuffer>,
) => {
  let maxVolume = Number.NEGATIVE_INFINITY;
  analyser.getFloatFrequencyData(fftBins);

  for (let i = 4, ii = fftBins.length; i < ii; i++) {
    if (fftBins[i] > maxVolume && fftBins[i] < 0) {
      maxVolume = fftBins[i];
    }
  }

  return maxVolume;
};

const audioCanPlayListener = (e: CustomEvent<Compressor>) => {
  const video = document.querySelector('video');
  const { audioContext } = e.detail;
  const sourceNode = e.detail.audioSource;

  // Use an audio analyser similar to Hark
  // https://github.com/otalk/hark/blob/master/hark.bundle.js
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = smoothing;
  const fftBins = new Float32Array(analyser.frequencyBinCount);

  sourceNode.connect(analyser);

  const looper = () => {
    setTimeout(() => {
      const currentVolume = getMaxVolume(analyser, fftBins);

      let history = 0;
      if (currentVolume > threshold && isSilent) {
        // Trigger quickly, short history
        for (
          let i = speakingHistory.length - 3;
          i < speakingHistory.length;
          i++
        ) {
          history += speakingHistory[i];
        }

        if (history >= 2) {
          // Not silent
          isSilent = false;
          hasAudioStarted = true;
        }
      } else if (currentVolume < threshold && !isSilent) {
        for (const element of speakingHistory) {
          history += element;
        }

        if (
          history == 0 && // Silent
          !(
            video &&
            (video.paused ||
              video.seeking ||
              video.ended ||
              video.muted ||
              video.volume === 0)
          )
        ) {
          isSilent = true;
          skipSilence();
        }
      }

      speakingHistory.shift();
      speakingHistory.push(Number(currentVolume > threshold));

      looper();
    }, interval);
  };

  looper();

  const skipSilence = () => {
    if (config.onlySkipBeginning && hasAudioStarted) {
      return;
    }

    if (isSilent && video && !video.paused) {
      video.currentTime += 0.2; // In s
    }
  };

  playOrSeekHandler = () => {
    hasAudioStarted = false;
    skipSilence();
  };

  video?.addEventListener('play', playOrSeekHandler);
  video?.addEventListener('seeked', playOrSeekHandler);
};

export const onRendererLoad = async ({
  getConfig,
}: RendererContext<SkipSilencesPluginConfig>) => {
  config = await getConfig();

  document.addEventListener('peard:audio-can-play', audioCanPlayListener, {
    passive: true,
  });
};

export const onRendererUnload = () => {
  document.removeEventListener('peard:audio-can-play', audioCanPlayListener);

  if (playOrSeekHandler) {
    const video = document.querySelector('video');
    video?.removeEventListener('play', playOrSeekHandler);
    video?.removeEventListener('seeked', playOrSeekHandler);
  }
};
