/* oxlint-disable no-undef, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return, @stylistic/no-mixed-operators */
// Runs on the audio thread and is loaded from a Blob, so it cannot import.
//
// Plays separated audio in blocks as they arrive, following the video's clock.

const SOURCE_SAMPLE_RATE = 44100;

// Beyond this the position jumps. Below it, playback speed is nudged instead,
// which is inaudible, so normal timing jitter never causes a click.
const JUMP_THRESHOLD_SECONDS = 0.12;
const MAX_SPEED_NUDGE = 0.002;
const FADE_SECONDS = 0.012;

class StemPlayer extends AudioWorkletProcessor {
  constructor() {
    super();

    this.blocks = new Map();
    this.blockSamples = 1;
    this.position = 0;
    this.isPlaying = false;
    this.vocalGain = 0;
    this.baseStep = SOURCE_SAMPLE_RATE / sampleRate;
    this.step = this.baseStep;
    this.level = 0;
    this.levelStep = 1 / (FADE_SECONDS * sampleRate);
    this.hasAudio = false;

    this.port.onmessage = ({ data }) => this.onMessage(data);
  }

  onMessage(data) {
    switch (data.type) {
      case 'reset': {
        this.blocks.clear();
        this.blockSamples = data.blockSamples;
        break;
      }
      case 'block': {
        this.blocks.set(data.block, data);
        break;
      }
      case 'keep': {
        // Only blocks near the playhead are held, so memory does not grow with
        // the length of the song.
        for (const block of this.blocks.keys()) {
          if (block < data.first || block > data.last)
            this.blocks.delete(block);
        }
        break;
      }
      case 'vocals': {
        this.vocalGain = data.gain;
        break;
      }
      case 'sync': {
        this.sync(data.time, data.isPlaying);
        break;
      }
    }
  }

  sync(time, isPlaying) {
    // Nothing is audible when starting from a pause, so landing exactly is free.
    const isResuming = isPlaying && !this.isPlaying;
    this.isPlaying = isPlaying;

    const difference = time - this.position / SOURCE_SAMPLE_RATE;
    if (isResuming || Math.abs(difference) > JUMP_THRESHOLD_SECONDS) {
      this.position = time * SOURCE_SAMPLE_RATE;
      this.level = 0;
      this.step = this.baseStep;
      return;
    }

    const nudge = Math.max(
      -MAX_SPEED_NUDGE,
      Math.min(MAX_SPEED_NUDGE, difference),
    );
    this.step = this.baseStep * (1 + nudge);
  }

  // Instrumental plus however much of the vocals the slider asks for.
  read(index, instrumentalKey, vocalsKey) {
    const block = this.blocks.get(Math.floor(index / this.blockSamples));
    if (!block || index < 0) return 0;

    // The last block of a song is shorter than the rest.
    const offset = index % this.blockSamples;
    const instrumental = block[instrumentalKey];
    const vocals = block[vocalsKey];
    if (offset >= instrumental.length || offset >= vocals.length) return 0;
    return instrumental[offset] + this.vocalGain * vocals[offset];
  }

  // Catmull-Rom, because the song is at 44.1 kHz and the output may not be.
  interpolate(index, fraction, instrumentalKey, vocalsKey) {
    const a = this.read(index - 1, instrumentalKey, vocalsKey);
    const b = this.read(index, instrumentalKey, vocalsKey);
    const c = this.read(index + 1, instrumentalKey, vocalsKey);
    const d = this.read(index + 2, instrumentalKey, vocalsKey);

    return (
      b +
      0.5 *
        fraction *
        (c -
          a +
          fraction *
            (2 * a - 5 * b + 4 * c - d + fraction * (3 * (b - c) + d - a)))
    );
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];

    for (let i = 0; i < left.length; i++) {
      const target = this.isPlaying ? 1 : 0;
      this.level += Math.max(
        -this.levelStep,
        Math.min(this.levelStep, target - this.level),
      );

      if (this.level > 0) {
        const index = Math.floor(this.position);
        const fraction = this.position - index;
        left[i] =
          this.level *
          this.interpolate(index, fraction, 'instrumentalLeft', 'vocalsLeft');
        right[i] =
          this.level *
          this.interpolate(index, fraction, 'instrumentalRight', 'vocalsRight');
      }

      // Keep moving while fading out, so the fade is not one repeated sample.
      if (this.isPlaying || this.level > 0) this.position += this.step;
    }

    const hasAudio = this.blocks.has(
      Math.floor(this.position / this.blockSamples),
    );
    if (hasAudio !== this.hasAudio) {
      this.hasAudio = hasAudio;
      this.port.postMessage({ hasAudio });
    }

    return true;
  }
}

registerProcessor('karaoke-stem-player', StemPlayer);
