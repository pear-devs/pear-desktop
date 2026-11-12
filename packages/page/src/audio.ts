// The shared Web Audio graph. A media element can only ever have one
// MediaElementAudioSourceNode, so plugins (equalizer, compressor, visualizer…)
// insert stages into this single chain instead of creating their own.

import type { AudioGraph as AudioGraphApi, Unsubscribe } from "@pear/sdk";

interface Stage {
  input: AudioNode;
  output: AudioNode;
  order: number;
  seq: number;
}

export class AudioGraph implements AudioGraphApi {
  readonly context: AudioContext;
  readonly source: MediaElementAudioSourceNode;
  readonly video: HTMLVideoElement;
  #stages: Stage[] = [];
  #taps = new Set<AudioNode>();
  #seq = 0;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.context = new AudioContext({ latencyHint: "playback" });
    this.source = this.context.createMediaElementSource(video);
    // Autoplay policy may create the context suspended; playback resumes it.
    video.addEventListener("playing", () => void this.context.resume());
    if (!video.paused) void this.context.resume();
    this.#rewire();
  }

  insert(input: AudioNode, output: AudioNode = input, order = 0): Unsubscribe {
    const stage = { input, output, order, seq: this.#seq++ };
    this.#stages.push(stage);
    this.#rewire();
    return () => {
      this.#stages = this.#stages.filter((s) => s !== stage);
      safeDisconnect(stage.output);
      this.#rewire();
    };
  }

  tap(node: AudioNode): Unsubscribe {
    this.#taps.add(node);
    this.#rewire();
    return () => {
      this.#taps.delete(node);
      this.#rewire();
    };
  }

  #rewire() {
    safeDisconnect(this.source);
    for (const stage of this.#stages) safeDisconnect(stage.output);
    const ordered = [...this.#stages].sort((a, b) => a.order - b.order || a.seq - b.seq);
    let last: AudioNode = this.source;
    for (const stage of ordered) {
      last.connect(stage.input);
      last = stage.output;
    }
    last.connect(this.context.destination);
    for (const tap of this.#taps) last.connect(tap);
  }
}

function safeDisconnect(node: AudioNode) {
  try {
    node.disconnect();
  } catch {
    // Not connected.
  }
}
