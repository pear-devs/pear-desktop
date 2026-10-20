declare module "*?raw" {
  const source: string;
  export default source;
}

/** The parts of butterchurn's API the plugin uses (it ships no types). */
interface ButterchurnVisualizer {
  connectAudio(node: AudioNode): void;
  disconnectAudio(node: AudioNode): void;
  loadPreset(preset: unknown, blendSeconds?: number): Promise<void> | void;
  setRendererSize(width: number, height: number): void;
  render(): void;
  launchSongTitleAnim(text: string): void;
  loseGLContext(): void;
}

interface ButterchurnModule {
  default: {
    createVisualizer(
      context: AudioContext,
      canvas: HTMLCanvasElement,
      options: { width: number; height: number; pixelRatio?: number },
    ): ButterchurnVisualizer;
  };
}

/** vudio (UMD; no types). */
interface VudioInstance {
  dance(): void;
  pause(): void;
  setOption(option: Record<string, unknown>): void;
}
type VudioConstructor = new (source: MediaStream, canvas: HTMLCanvasElement, option: Record<string, unknown>) => VudioInstance;

/** @foobar404/wave (UMD build; the parts used). */
interface WaveInstance {
  animations: Record<string, new (config: unknown) => unknown>;
  addAnimation(animation: unknown): void;
  clearAnimations(): void;
}
interface WaveModule {
  Wave: new (audio: { context: AudioContext; source: AudioNode }, canvas: HTMLCanvasElement) => WaveInstance;
}
