import { createPlugin } from '@/utils';
import { t } from '@/i18n';
import { type MusicPlayer } from '@/types/music-player';

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

class Storage {
  lastSource: MediaElementAudioSourceNode | null = null;
  lastContext: AudioContext | null = null;
  lastCompressor: DynamicsCompressorNode | null = null;

  connected: WeakMap<MediaElementAudioSourceNode, DynamicsCompressorNode> =
    new WeakMap();

  connectToCompressor = (
    source: MediaElementAudioSourceNode | null = null,
    audioContext: AudioContext | null = null,
    compressor: DynamicsCompressorNode | null = null,
  ): boolean => {
    if (!(source && audioContext && compressor)) return false;

    const current = this.connected.get(source);
    if (current === compressor) return false;

    this.lastSource = source;
    this.lastContext = audioContext;
    this.lastCompressor = compressor;

    if (current) {
      lazySafeTry(
        () => source.disconnect(current),
        () => current.disconnect(audioContext.destination),
      );
    } else {
      lazySafeTry(() => source.disconnect(audioContext.destination));
    }

    try {
      source.connect(compressor);
      compressor.connect(audioContext.destination);
      this.connected.set(source, compressor);
      return true;
    } catch (error) {
      console.error('connectToCompressor failed', error);
      return false;
    }
  };

  disconnectCompressor = (): boolean => {
    const source = this.lastSource;
    const audioContext = this.lastContext;
    if (!(source && audioContext)) return false;
    const current = this.connected.get(source);
    if (!current) return false;

    lazySafeTry(
      () => source.connect(audioContext.destination),
      () => source.disconnect(current),
      () => current.disconnect(audioContext.destination),
    );
    this.connected.delete(source);
    return true;
  };
}

const storage = new Storage();

const audioCanPlayHandler = ({
  detail: { audioSource, audioContext },
}: CustomEvent<Compressor>) => {
  storage.connectToCompressor(
    audioSource,
    audioContext,
    createCompressorNode(audioContext),
  );
};

const ensureAudioContextLoad = (playerApi: MusicPlayer) => {
  if (playerApi.getPlayerState() !== 1 || storage.lastContext) return;

  playerApi.loadVideoById(
    playerApi.getPlayerResponse().videoDetails.videoId,
    playerApi.getCurrentTime(),
    playerApi.getUserPlaybackQualityPreference(),
  );
};

export default createPlugin({
  name: () => t('plugins.audio-compressor.name'),
  description: () => t('plugins.audio-compressor.description'),

  renderer: {
    onPlayerApiReady(playerApi) {
      ensureAudioContextLoad(playerApi);
    },

    start() {
      document.addEventListener('peard:audio-can-play', audioCanPlayHandler, {
        passive: true,
      });
      storage.connectToCompressor(
        storage.lastSource,
        storage.lastContext,
        storage.lastCompressor,
      );
    },

    stop() {
      document.removeEventListener('peard:audio-can-play', audioCanPlayHandler);
      storage.disconnectCompressor();
    },
  },
});
