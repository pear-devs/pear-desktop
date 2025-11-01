declare module 'vudio/umd/vudio' {
  interface NoneWaveformOptions {
    maxHeight?: number;
    minHeight?: number;
    spacing?: number;
    color?: string | string[];
    shadowBlur?: number;
    shadowColor?: string;
    fadeSide?: boolean;
  }

  interface WaveformOptions extends NoneWaveformOptions {
    horizontalAlign: 'left' | 'center' | 'right';
    verticalAlign: 'top' | 'middle' | 'bottom';
  }

  interface VudioOptions {
    effect?: 'waveform' | 'circlewave' | 'circlebar' | 'lighting';
    accuracy?: number;
    width?: number;
    height?: number;
    waveform?: WaveformOptions;
  }

  class Vudio {
    constructor(
      audio: HTMLAudioElement | MediaStream,
      canvas: HTMLCanvasElement,
      options: VudioOptions = {},
    );

    dance(): void;
    pause(): void;
    setOption(options: VudioOptions): void;
  }

  export default Vudio;
}
