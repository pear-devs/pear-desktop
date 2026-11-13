import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import type { MusicPlayer } from '@/types/music-player';

const lazySafeTry = (...fns: (() => void)[]) => {
  for (const fn of fns) {
    try {
      fn();
    } catch {}
  }
};

const createCompressorNode = (
  audioContext: AudioContext,
): DynamicsCompressorNode => {
  const compressor = audioContext.createDynamicsCompressor();

  compressor.threshold.value = -50;
  compressor.ratio.value = 12;
  compressor.knee.value = 40;
  compressor.attack.value = 0;
  compressor.release.value = 0.25;

  return compressor;
};

// The page's audio source and context (created once by the core renderer and
// only announced on `peard:audio-can-play`), remembered so a restarted run can
// reconnect at once instead of waiting for the next song.
let lastAudio: Compressor | null = null;

const ensureAudioContextLoad = (playerApi: MusicPlayer) => {
  if (playerApi.getPlayerState() !== 1 || lastAudio) return;

  playerApi.loadVideoById(
    playerApi.getPlayerResponse().videoDetails.videoId,
    playerApi.getCurrentTime(),
    playerApi.getUserPlaybackQualityPreference(),
  );
};

export default createPlugin({
  name: () => t('plugins.audio-compressor.name'),
  description: () => t('plugins.audio-compressor.description'),

  renderer(ctx) {
    let connected: {
      source: MediaElementAudioSourceNode;
      audioContext: AudioContext;
      compressor: DynamicsCompressorNode;
    } | null = null;

    const connect = ({ audioSource: source, audioContext }: Compressor) => {
      lastAudio = { audioSource: source, audioContext };
      if (connected?.source === source) return;

      if (connected) {
        const current = connected;
        lazySafeTry(
          () => current.source.disconnect(current.compressor),
          () => current.compressor.disconnect(current.audioContext.destination),
        );
      } else {
        lazySafeTry(() => source.disconnect(audioContext.destination));
      }

      const compressor = createCompressorNode(audioContext);
      try {
        source.connect(compressor);
        compressor.connect(audioContext.destination);
        connected = { source, audioContext, compressor };
      } catch (error) {
        console.error('connectToCompressor failed', error);
        connected = null;
      }
    };

    ctx.onCleanup(() => {
      if (!connected) return;
      const { source, audioContext, compressor } = connected;
      lazySafeTry(
        () => source.connect(audioContext.destination),
        () => source.disconnect(compressor),
        () => compressor.disconnect(audioContext.destination),
      );
      connected = null;
    });

    ctx.listen(
      document,
      'peard:audio-can-play',
      ({ detail }) => connect(detail),
      { passive: true },
    );
    if (lastAudio) connect(lastAudio);

    ctx.onPlayerApiReady(ensureAudioContextLoad);
  },
});
