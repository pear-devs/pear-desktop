declare module 'butterchurn' {
  interface VisualizerOptions {
    width?: number;
    height?: number;
    meshWidth?: number;
    meshHeight?: number;
    pixelRatio?: number;
    textureRatio?: number;
    outputFXAA?: boolean;
  }

  class Visualizer {
    constructor(
      audioContext: AudioContext,
      canvas: HTMLCanvasElement,
      opts: ButterchurnOptions,
    );
    loseGLContext(): void;
    connectAudio(audioNode: AudioNode): void;
    disconnectAudio(audioNode: AudioNode): void;
    static overrideDefaultVars(
      baseValsDefaults: unknown,
      baseVals: unknown,
    ): unknown;
    createQVars(): Record<string, WebAssembly.Global>;
    createTVars(): Record<string, WebAssembly.Global>;
    createPerFramePool(baseVals: unknown): Record<string, WebAssembly.Global>;
    createPerPixelPool(baseVals: unknown): Record<string, WebAssembly.Global>;
    createCustomShapePerFramePool(
      baseVals: unknown,
    ): Record<string, WebAssembly.Global>;
    createCustomWavePerFramePool(
      baseVals: unknown,
    ): Record<string, WebAssembly.Global>;
    static makeShapeResetPool(
      pool: Record<string, WebAssembly.Global>,
      variables: string[],
      idx: number,
    ): Record<string, WebAssembly.Global>;
    static base64ToArrayBuffer(base64: string): ArrayBuffer;
    loadPreset(presetMap: unknown, blendTime?: number): Promise<void>;
    async loadWASMPreset(preset: unknown, blendTime: number): Promise<void>;
    loadJSPreset(preset: unknown, blendTime: number): void;
    loadExtraImages(imageData: unknown): void;
    setRendererSize(
      width: number,
      height: number,
      opts?: VisualizerOptions,
    ): void;
    setInternalMeshSize(width: number, height: number): void;
    setOutputAA(useAA: boolean): void;
    setCanvas(canvas: HTMLCanvasElement): void;
    render(opts?: VisualizerOptions): unknown;
    launchSongTitleAnim(text: string): void;
    toDataURL(): string;
    warpBufferToDataURL(): string;
  }

  interface ButterchurnOptions {
    width?: number;
    height?: number;
    onlyUseWASM?: boolean;
  }

  export default class Butterchurn {
    static createVisualizer(
      audioContext: AudioContext,
      canvas: HTMLCanvasElement,
      options?: ButterchurnOptions,
    ): Visualizer;
  }
}

declare module 'butterchurn-presets' {
  const presets: Record<string, unknown>;

  export default presets;
}
