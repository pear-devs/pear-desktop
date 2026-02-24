import { createRenderer } from '@/utils';

import workletCode from './StreamProcessor.js?raw';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

import type { AudioStreamConfig } from './config';

type ProcessingQueueItem = {
  buffer: Int16Array | Int32Array;
  metadata: {
    timestamp: number;
    sampleRate: number;
    bitDepth: number;
    channels: number;
  };
};

type RendererProperties = {
  audioContext?: AudioContext;
  audioSource?: AudioNode;
  scriptProcessor?: ScriptProcessorNode;
  config?: AudioStreamConfig;
  context?: RendererContext<AudioStreamConfig>;
  isStreaming: boolean;
  batchBuffer: Int16Array | Int32Array | null;
  batchCount: number;
  processingQueue: ProcessingQueueItem[];
  isProcessing: boolean;
  startStreaming: (
    ipc: RendererContext<{ enabled: boolean }>['ipc'],
    audioContext: AudioContext,
    audioSource: AudioNode,
  ) => void;
};

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function createWavHeader(
  sampleRate: number,
  numChannels: number,
  dataLength: number,
) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true); // file size - 8
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // subchunk1 size (16 for PCM)
  view.setUint16(20, 1, true); // audio format (1 = PCM)
  view.setUint16(22, numChannels, true); // number of channels
  view.setUint32(24, sampleRate, true); // sample rate
  view.setUint32(28, sampleRate * numChannels * 2, true); // byte rate
  view.setUint16(32, numChannels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true); // data chunk size
  return new Uint8Array(header);
}

export const renderer = createRenderer<RendererProperties, AudioStreamConfig>({
  isStreaming: false,
  batchBuffer: null,
  batchCount: 0,
  processingQueue: [],
  isProcessing: false,

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

    const sampleRate = audioContext.sampleRate;

    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);

    try {
      audioContext.audioWorklet
        .addModule(blobUrl)
        .then(() => {
          const workletNode = new AudioWorkletNode(
            audioContext,
            'recorder-processor',
            {
              sampleRate: this.config!.sampleRate,
              bufferSize: bufferSize,
            },
          );

          workletNode.port.onmessage = (event) => {
            // Received a Float32Array of interleaved stereo samples from the worklet
            const float32Data = event.data;

            // Convert floats [-1,1] to 16-bit PCM
            const int16Buffer = new ArrayBuffer(float32Data.length * 2);
            const view = new DataView(int16Buffer);
            for (let i = 0; i < float32Data.length; i++) {
              const s = Math.max(-1, Math.min(1, float32Data[i])); // clamp
              // Scale to 16-bit signed range
              view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            }
            const pcmData = new Uint8Array(int16Buffer);

            // Build WAV header (16-bit, stereo, given sample rate, data length = pcmData.byteLength)
            const wavHeader = createWavHeader(
              audioContext.sampleRate,
              2,
              pcmData.byteLength,
            );

            // Combine header + PCM data into one Uint8Array
            const wavChunk = new Uint8Array(wavHeader.length + pcmData.length);
            wavChunk.set(wavHeader, 0);
            wavChunk.set(pcmData, wavHeader.length);

            ipc.send('audio-stream:pcm-binary', wavChunk);
          };

          audioSource.connect(workletNode);
          this.isStreaming = true;
        })
        .catch((err) => {
          console.error(
            '[Audio Stream] Failed to add audio worklet module:',
            err,
          );
        });
    } catch (err) {
      console.error('[Audio Stream] AudioWorklet setup failed:', err);
    }
    this.isStreaming = true;

    console.log('[Audio Stream] Started PCM streaming:');
  },

  stop() {
    this.isStreaming = false;

    // Clear processing queue to prevent sending stale data
    this.processingQueue = [];
    this.isProcessing = false;

    // Flush any remaining batched data
    if (this.batchBuffer && this.batchBuffer.length > 0 && this.context) {
      try {
        let buffer: ArrayBuffer;
        if (this.batchBuffer.buffer instanceof SharedArrayBuffer) {
          buffer = new ArrayBuffer(this.batchBuffer.buffer.byteLength);
          new Uint8Array(buffer).set(new Uint8Array(this.batchBuffer.buffer));
        } else {
          buffer = this.batchBuffer.buffer;
        }
        const uint8 = new Uint8Array(buffer);
        this.context.ipc.send('audio-stream:pcm-binary', uint8);
      } catch {
        // Ignore flush errors
      }
      this.batchBuffer = null;
      this.batchCount = 0;
    }

    if (this.scriptProcessor) {
      try {
        this.scriptProcessor.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.scriptProcessor = undefined;
    }

    this.audioContext = undefined;
    this.audioSource = undefined;
  },

  onConfigChange(config: AudioStreamConfig) {
    const wasEnabled = this.config?.enabled;
    const oldBitDepth = this.config?.bitDepth;
    const oldChannels = this.config?.channels;
    const oldBufferSize = this.config?.bufferSize;

    // Check if quality/latency settings changed
    const qualityChanged =
      oldBitDepth !== config.bitDepth ||
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
            );
          },
          { once: true, passive: true },
        );
      }
    } else if (!config.enabled && wasEnabled) {
      // Stop streaming
      this.isStreaming = false;

      if (this.scriptProcessor) {
        try {
          this.scriptProcessor.disconnect();
        } catch {
          // Ignore disconnect errors
        }
        this.scriptProcessor = undefined;
      }

      this.audioContext = undefined;
      this.audioSource = undefined;
    } else if (
      config.enabled &&
      wasEnabled &&
      qualityChanged &&
      this.isStreaming
    ) {
      // Quality/latency settings changed while streaming - restart with new settings
      if (this.audioContext && this.audioSource) {
        // Stop current streaming
        this.isStreaming = false;

        // Clear processing queue to prevent sending stale data
        this.processingQueue = [];
        this.isProcessing = false;

        // Store references before cleanup
        const audioContext = this.audioContext;
        const audioSource = this.audioSource;

        if (this.scriptProcessor) {
          try {
            this.scriptProcessor.disconnect();
          } catch (error) {
            // Ignore disconnect errors
          }
          this.scriptProcessor = undefined;
        }

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
            this.startStreaming(this.context.ipc, audioContext, audioSource);
          }
        });
      }
    }
  },
});
