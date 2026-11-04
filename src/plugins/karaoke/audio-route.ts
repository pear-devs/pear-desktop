import { createCenterRemover } from './center-remover';

const CROSSFADE_SECONDS = 0.04;

const lazyDisconnect = (disconnect: () => void) => {
  try {
    disconnect();
    return true;
  } catch {
    // The Web Audio API throws when the connection does not exist.
    return false;
  }
};

/**
 * Puts the center remover between the player and the speakers, and undoes it.
 * Separated stems, when there are any, crossfade in over the top of it.
 */
export class AudioRoute {
  private remover: Promise<AudioWorkletNode> | null = null;
  private activeRemover: AudioWorkletNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private context: AudioContext | null = null;
  private filterGain: GainNode | null = null;
  private stemGain: GainNode | null = null;
  private removedDirectPath = false;
  private isEngaged = false;

  constructor(private readonly onMonoChange: (isMono: boolean) => void) {}

  async engage({ audioContext, audioSource }: Compressor, amount: number) {
    this.isEngaged = true;

    this.remover ??= createCenterRemover(
      audioContext,
      amount,
      this.onMonoChange,
    );
    const remover = await this.remover;

    // Karaoke mode may have been left while the processor was loading.
    if (!this.isEngaged) return;

    if (!this.source) {
      this.filterGain = audioContext.createGain();
      this.stemGain = audioContext.createGain();
      this.stemGain.gain.value = 0;

      audioSource.connect(remover);
      remover.connect(this.filterGain);
      this.filterGain.connect(audioContext.destination);
      this.stemGain.connect(audioContext.destination);

      this.activeRemover = remover;
      this.source = audioSource;
      this.context = audioContext;
    }

    this.setAmount(amount);

    // Other plugins can restore this path, so this also runs on every new track.
    const removed = lazyDisconnect(() =>
      audioSource.disconnect(audioContext.destination),
    );
    this.removedDirectPath ||= removed;
  }

  disengage() {
    this.isEngaged = false;

    const { activeRemover, source, context, filterGain, stemGain } = this;
    if (!(activeRemover && source && context)) return;

    // Only restore what was removed: another plugin may own the output path.
    if (this.removedDirectPath) source.connect(context.destination);
    lazyDisconnect(() => source.disconnect(activeRemover));
    lazyDisconnect(() => activeRemover.disconnect());
    lazyDisconnect(() => filterGain?.disconnect());
    lazyDisconnect(() => stemGain?.disconnect());

    this.activeRemover = null;
    this.source = null;
    this.context = null;
    this.filterGain = null;
    this.stemGain = null;
    this.removedDirectPath = false;
  }

  setAmount(amount: number) {
    this.activeRemover?.parameters.get('amount')?.setValueAtTime(amount, 0);
  }

  /** Returns false when karaoke mode has been left, so there is nothing to join. */
  connectStems(player: AudioNode) {
    if (!this.stemGain) return false;
    player.connect(this.stemGain);
    return true;
  }

  /**
   * The video's volume does not reach the stems, because they do not come from
   * the video element, so it is applied here.
   */
  setStemMix(useStems: boolean, volume: number) {
    const { context, filterGain, stemGain } = this;
    if (!(context && filterGain && stemGain)) return;

    const now = context.currentTime;
    filterGain.gain.setTargetAtTime(useStems ? 0 : 1, now, CROSSFADE_SECONDS);
    stemGain.gain.setTargetAtTime(
      useStems ? volume : 0,
      now,
      CROSSFADE_SECONDS,
    );
  }
}
