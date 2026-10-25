/** Capture before local listening gain. Development prototype, 48 kHz stereo. */
const processor = `
class IndependentCapture extends AudioWorkletProcessor {
  constructor() { super(); this.frame = new Int16Array(1920); this.offset = 0; }
  process(inputs) {
    const channels = inputs[0];
    if (!channels || !channels.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      for (let c = 0; c < 2; c++) {
        const value = channels[Math.min(c, channels.length - 1)][i];
        this.frame[this.offset++] = Math.round(Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0)) * 32767);
      }
      if (this.offset === this.frame.length) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(1920); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('independent-audio-capture', IndependentCapture);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

export async function attachGraph(
  context: AudioContext,
  source: AudioNode,
  onFrame: (frame: ArrayBuffer) => void,
) {
  if (context.sampleRate !== 48000)
    throw new Error('Independent audio requires a 48 kHz audio context.');
  if (!loaded.has(context)) {
    const url = URL.createObjectURL(
      new Blob([processor], { type: 'text/javascript' }),
    );
    loaded.set(
      context,
      context.audioWorklet
        .addModule(url)
        .finally(() => URL.revokeObjectURL(url)),
    );
  }
  await loaded.get(context);
  const capture = new AudioWorkletNode(context, 'independent-audio-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  const monitor = context.createGain();
  const silent = context.createGain();
  silent.gain.value = 0;
  capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) =>
    onFrame(event.data);
  // The worklet emits silence; its independent input branch retains source PCM.
  source.connect(capture);
  capture.connect(silent);
  silent.connect(context.destination);
  source.connect(monitor);
  monitor.connect(context.destination);
  // Only replace Pear's original direct route, leaving our capture branch intact.
  try {
    source.disconnect(context.destination);
  } catch {
    /* No direct route in the synthetic test. */
  }
  let stopped = false;
  return {
    monitor,
    setGain(value: number) {
      if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new Error('Invalid local gain.');
      monitor.gain.setTargetAtTime(value, context.currentTime, 0.02);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      source.connect(context.destination);
      source.disconnect(capture);
      source.disconnect(monitor);
      capture.port.onmessage = null;
      capture.port.close();
      capture.disconnect();
      monitor.disconnect();
      silent.disconnect();
    },
  };
}
