import { createRenderer } from '@/utils';

import type { skipSilencesConfig } from './index';

const smoothing = 0.1;
const threshold = -100; // DB (-100 = absolute silence, 0 = loudest)
const interval = 2; // Ms
const history = 10;

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

export default createRenderer<typeof skipSilencesConfig>((ctx) => {
  let isSilent = false;
  let hasAudioStarted = false;
  const speakingHistory = Array.from({ length: history }).fill(0) as number[];

  // Undoes what was set up for the current audio source
  let teardown: (() => void) | undefined;
  ctx.onCleanup(() => teardown?.());

  // The config is read when it is used; nothing to redo on a change.
  ctx.onConfigChange(() => {});

  const audioCanPlayListener = (e: CustomEvent<Compressor>) => {
    teardown?.();

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

    const skipSilence = () => {
      if (ctx.config.onlySkipBeginning && hasAudioStarted) {
        return;
      }

      if (isSilent && video && !video.paused) {
        video.currentTime += 0.2; // In s
      }
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const looper = () => {
      timer = ctx.setTimeout(() => {
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

    const playOrSeekHandler = () => {
      hasAudioStarted = false;
      skipSilence();
    };

    video?.addEventListener('play', playOrSeekHandler);
    video?.addEventListener('seeked', playOrSeekHandler);

    teardown = () => {
      ctx.clearTimeout(timer);
      try {
        sourceNode.disconnect(analyser);
      } catch {}
      video?.removeEventListener('play', playOrSeekHandler);
      video?.removeEventListener('seeked', playOrSeekHandler);
      teardown = undefined;
    };
  };

  ctx.listen(document, 'peard:audio-can-play', audioCanPlayListener, {
    passive: true,
  });
});
