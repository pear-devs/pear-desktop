// audio-processor.js (loaded by audioContext.audioWorklet.addModule)
class RecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const bufferSize = options.bufferSize || 4096;
    // Prepare an interleaved stereo buffer [L,R,L,R,...]
    this.buffer = new Float32Array(bufferSize * 2);
    this.bufferIndex = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const left = input[0];
      const right = input[1] || left; // if mono input, duplicate for right
      for (let i = 0; i < left.length; i++) {
        this.buffer[this.bufferIndex++] = left[i];
        this.buffer[this.bufferIndex++] = right[i];
        if (this.bufferIndex >= this.buffer.length) {
          // Buffer full: send a copy to the main thread
          this.port.postMessage(new Float32Array(this.buffer));
          this.bufferIndex = 0;
        }
      }
    }
    // Optionally pass the audio through unchanged
    if (outputs[0] && inputs[0]) {
      outputs[0][0].set(inputs[0][0]);
      if (inputs[0][1]) outputs[0][1].set(inputs[0][1]);
    }
    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
