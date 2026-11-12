declare module 'signalsmith-stretch' {
  export interface StretchSchedule {
    /** Context time from which later scheduled changes are replaced */
    outputTime?: number;
    /** Context time this change applies at */
    output?: number;
    active?: boolean;
    /** Position in the input buffers, in seconds */
    input?: number;
    rate?: number;
    semitones?: number;
  }

  export interface StretchNode extends AudioWorkletNode {
    inputTime: number;
    schedule(change: StretchSchedule): Promise<StretchSchedule>;
    start(when?: number): Promise<StretchSchedule>;
    stop(when?: number): Promise<StretchSchedule>;
    addBuffers(
      channels: Float32Array[],
      transfer?: Transferable[],
    ): Promise<number>;
    dropBuffers(): Promise<{ start: number; end: number }>;
    latency(): Promise<number>;
  }

  const SignalsmithStretch: (
    context: BaseAudioContext,
    options?: AudioWorkletNodeOptions,
  ) => Promise<StretchNode>;
  export default SignalsmithStretch;
}
