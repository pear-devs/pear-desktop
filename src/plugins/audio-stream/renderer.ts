import { createRenderer } from '@/utils';

import workletCode from './StreamProcessor.js?raw';

import type { AudioStreamConfig } from './config';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

const ENCODE_RATE = 48000; // Opus operates at 48 kHz; bridge resamples to this.

// Minimal OpusHead (RFC 7845), used only if WebCodecs doesn't supply one via
// decoderConfig.description (Chromium normally does).
function synthOpusHead(channels: number): Uint8Array {
  const head = new Uint8Array(19);
  const dv = new DataView(head.buffer);
  head.set(new TextEncoder().encode('OpusHead'), 0);
  head[8] = 1; // version
  head[9] = channels;
  dv.setUint16(10, 312, true); // pre-skip (~6.5 ms)
  dv.setUint32(12, ENCODE_RATE, true); // original input sample rate
  dv.setUint16(16, 0, true); // output gain
  head[18] = 0; // channel mapping family 0
  return head;
}

type RendererProperties = {
  audioContext?: AudioContext;
  audioSource?: AudioNode;
  config?: AudioStreamConfig;
  context?: RendererContext<AudioStreamConfig>;
  isStreaming: boolean;
  // WebCodecs Opus pipeline state.
  bridgeContext?: AudioContext;
  encoder?: AudioEncoder;
  encodedFrames: number; // 48 kHz samples fed to the encoder (for timestamps)
  sentHead: boolean;
  startStreaming: (
    ipc: RendererContext<{ enabled: boolean }>['ipc'],
    audioContext: AudioContext,
    audioSource: AudioNode,
    bufferSize?: number,
  ) => void;
  stop: () => void;
};

export const renderer = createRenderer<RendererProperties, AudioStreamConfig>({
  isStreaming: false,
  encodedFrames: 0,
  sentHead: false,

  async onPlayerApiReady(
    _: MusicPlayer,
    context: RendererContext<AudioStreamConfig>,
  ) {
    this.context = context;
    this.config = await context.getConfig();

    if (!this.config.enabled) {
      return;
    }

    // Wait for audio to be ready
    document.addEventListener(
      'peard:audio-can-play',
      (e) => {
        this.startStreaming(
          context.ipc,
          e.detail.audioContext,
          e.detail.audioSource,
          this.config?.bufferSize,
        );
      },
      { once: true, passive: true },
    );
  },

  startStreaming(
    ipc: RendererContext<{ enabled: boolean }>['ipc'],
    audioContext: AudioContext,
    audioSource: AudioNode,
    bufferSize = 4096,
  ) {
    if (this.isStreaming || !this.context) {
      return;
    }

    this.audioContext = audioContext;
    this.audioSource = audioSource;
    this.encodedFrames = 0;
    this.sentHead = false;

    // Opus needs 48 kHz; the app's AudioContext may be 44.1 kHz. Fan the source
    // out to a MediaStream and read it back through our own 48 kHz context,
    // which resamples for free. This extra connect does not disturb the app's
    // own audio output.
    const msDest = audioContext.createMediaStreamDestination();
    audioSource.connect(msDest);

    const bridge = new AudioContext({ sampleRate: ENCODE_RATE });
    this.bridgeContext = bridge;
    const bridgeSource = bridge.createMediaStreamSource(msDest.stream);

    // Set up the Opus encoder. Each EncodedAudioChunk is one Opus packet.
    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        if (!this.sentHead) {
          const desc = meta?.decoderConfig?.description;
          const head = desc
            ? ArrayBuffer.isView(desc)
              ? new Uint8Array(
                  desc.buffer.slice(
                    desc.byteOffset,
                    desc.byteOffset + desc.byteLength,
                  ),
                )
              : new Uint8Array(desc.slice(0))
            : synthOpusHead(2); // fallback if Chromium omits the description
          ipc.send('audio-stream:opus-head', head);
          this.sentHead = true;
        }
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        ipc.send('audio-stream:opus', {
          bytes,
          durationUs: chunk.duration ?? 0,
        });
      },
      error: (err) => console.error('[Audio Stream] Opus encoder error:', err),
    });
    encoder.configure({
      codec: 'opus',
      sampleRate: ENCODE_RATE,
      numberOfChannels: 2,
      bitrate: this.config!.bitrate ?? 128000,
    });
    this.encoder = encoder;

    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);

    bridge.audioWorklet
      .addModule(blobUrl)
      .then(() => {
        const workletNode = new AudioWorkletNode(bridge, 'recorder-processor', {
          processorOptions: { bufferSize },
        });

        workletNode.port.onmessage = (event) => {
          if (!this.encoder || this.encoder.state !== 'configured') return;
          // Interleaved stereo Float32 at 48 kHz from the worklet.
          const interleaved = event.data as Float32Array;
          const numberOfFrames = interleaved.length / 2;
          const audioData = new AudioData({
            format: 'f32',
            sampleRate: ENCODE_RATE,
            numberOfFrames,
            numberOfChannels: 2,
            timestamp: Math.round((this.encodedFrames / ENCODE_RATE) * 1e6),
            data: interleaved as unknown as BufferSource,
          });
          this.encodedFrames += numberOfFrames;
          try {
            this.encoder.encode(audioData);
          } finally {
            audioData.close();
          }
        };

        bridgeSource.connect(workletNode);
        // A muted sink keeps the bridge graph pulling without playing the audio
        // a second time (the app already outputs it on its own context).
        const mute = bridge.createGain();
        mute.gain.value = 0;
        workletNode.connect(mute).connect(bridge.destination);
        this.isStreaming = true;
        console.log('[Audio Stream] Started Opus streaming');
      })
      .catch((err) => {
        console.error(
          '[Audio Stream] Failed to add audio worklet module:',
          err,
        );
      });
  },

  stop() {
    this.isStreaming = false;

    // Tear down the Opus encoder and the 48 kHz bridge context.
    if (this.encoder) {
      try {
        if (this.encoder.state !== 'closed') this.encoder.close();
      } catch {
        // Ignore close errors
      }
      this.encoder = undefined;
    }
    if (this.bridgeContext) {
      this.bridgeContext.close().catch(() => {});
      this.bridgeContext = undefined;
    }
    this.sentHead = false;
    this.encodedFrames = 0;

    this.audioContext = undefined;
    this.audioSource = undefined;
  },

  onConfigChange(config: AudioStreamConfig) {
    const wasEnabled = this.config?.enabled;
    const oldBitrate = this.config?.bitrate;
    const oldChannels = this.config?.channels;
    const oldBufferSize = this.config?.bufferSize;

    // Check if quality/latency settings changed
    const qualityChanged =
      oldBitrate !== config.bitrate ||
      oldChannels !== config.channels ||
      oldBufferSize !== config.bufferSize;

    this.config = config;

    if (config.enabled && !wasEnabled) {
      // Wait for audio to be ready if not already streaming
      if (!this.isStreaming && this.audioContext && this.audioSource) {
        // Already have audio context, start immediately
        this.startStreaming(
          this.context!.ipc,
          this.audioContext,
          this.audioSource,
          this.config?.bufferSize,
        );
      } else if (!this.isStreaming) {
        // Wait for audio to be ready
        document.addEventListener(
          'peard:audio-can-play',
          (e) => {
            this.startStreaming(
              this.context!.ipc,
              e.detail.audioContext,
              e.detail.audioSource,
              this.config?.bufferSize,
            );
          },
          { once: true, passive: true },
        );
      }
    } else if (!config.enabled && wasEnabled) {
      // Stop streaming
      this.stop();
    } else if (
      config.enabled &&
      wasEnabled &&
      qualityChanged &&
      this.isStreaming
    ) {
      // Quality/latency settings changed while streaming - restart with new settings
      if (this.audioContext && this.audioSource) {
        // Store references before cleanup
        const audioContext = this.audioContext;
        const audioSource = this.audioSource;

        this.stop();

        // Use requestAnimationFrame to ensure cleanup is complete before restarting
        requestAnimationFrame(() => {
          // Double-check we're not streaming and have valid references
          if (
            audioContext &&
            audioSource &&
            !this.isStreaming &&
            this.context
          ) {
            // Restart with new settings - this will send new config to backend
            this.startStreaming(
              this.context.ipc,
              audioContext,
              audioSource,
              this.config?.bufferSize,
            );
          }
        });
      }
    }
  },
});
