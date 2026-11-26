export abstract class Visualizer {
  protected audioNode: GainNode;
  protected audioSource: AudioNode;

  protected constructor(_audioSource: AudioNode, _audioNode: GainNode) {
    this.audioNode = _audioNode;
    this.audioSource = _audioSource;
  }

  abstract resize(width: number, height: number): void;
  abstract destroy(): void;
}
