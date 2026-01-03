import { createRenderer } from '@/utils';

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
  startStreaming: (audioContext: AudioContext, audioSource: AudioNode) => void;
};

export const renderer = createRenderer<RendererProperties, AudioStreamConfig>({
  isStreaming: false,
  batchBuffer: null,
  batchCount: 0,
  processingQueue: [],
  isProcessing: false,

  async onPlayerApiReady(_: MusicPlayer, context: RendererContext<AudioStreamConfig>) {
    this.context = context;
    this.config = await context.getConfig();

    if (!this.config.enabled) {
      return;
    }

    // Wait for audio to be ready
    document.addEventListener(
      'peard:audio-can-play',
      (e) => {
        this.startStreaming(e.detail.audioContext, e.detail.audioSource);
      },
      { once: true, passive: true },
    );
  },

  startStreaming(
    audioContext: AudioContext,
    audioSource: AudioNode,
  ) {
    if (this.isStreaming || !this.context) {
      return;
    }

    this.audioContext = audioContext;
    this.audioSource = audioSource;

    // Get fresh config to ensure we have the latest values
    const config = this.config!;
    // Use the actual AudioContext sample rate, not config (audio might be resampled)
    const sampleRate = audioContext.sampleRate;
    const bitDepth = config.bitDepth || 16;
    // Use actual number of channels from the audio source
    const channels = config.channels || 2;

    // Send audio configuration to backend
    this.context.ipc.send('audio-stream:config', {
      sampleRate,
      bitDepth,
      channels,
    });

    // Prefer AudioWorkletNode for stable timing and higher-quality capture.
    // We create a small inline AudioWorkletProcessor via a Blob so bundling
    // doesn't need extra files. The worklet interleaves and converts to
    // Int16 and posts transferable ArrayBuffers to the main thread.
    this.batchBuffer = null;
    this.batchCount = 0;
    this.processingQueue = [];
    this.isProcessing = false;

    

    // Process queue with limited items per tick to prevent blocking
    // Increased queue size to handle bursts better
    const MAX_QUEUE_SIZE = 16; // Increased from 8 to handle bursts
    const ITEMS_PER_TICK = 2; // Process 2 items per tick for better throughput

    const processQueue = () => {
      if (this.isProcessing || this.processingQueue.length === 0 || !this.context) {
        return;
      }

      this.isProcessing = true;

      // Process multiple items per tick to keep up with audio callback rate
      let itemsProcessed = 0;
      const processBatch = () => {
        while (itemsProcessed < ITEMS_PER_TICK && this.processingQueue.length > 0 && this.context) {
          const item = this.processingQueue.shift();
          if (!item) break;
          
          try {
            // Convert to regular ArrayBuffer (handle SharedArrayBuffer case)
            let buffer: ArrayBuffer;
            if (item.buffer.buffer instanceof SharedArrayBuffer) {
              buffer = new ArrayBuffer(item.buffer.buffer.byteLength);
              new Uint8Array(buffer).set(new Uint8Array(item.buffer.buffer));
            } else {
              buffer = item.buffer.buffer;
            }

            // Send binary PCM to backend (avoid base64 to reduce CPU/GC)
            const uint8 = new Uint8Array(buffer);
            this.context!.ipc.send('audio-stream:pcm-binary', {
              metadata: item.metadata,
              data: uint8,
            });
            
            itemsProcessed++;
          } catch (error) {
            console.error('[Audio Stream] Error processing queue item:', error);
            itemsProcessed++;
          }
        }

        this.isProcessing = false;

        // Schedule next batch if queue still has items
        if (this.processingQueue.length > 0) {
          // Use immediate microtask for low latency when queue is small
          // Use setTimeout(0) for larger queues to prevent blocking
          if (this.processingQueue.length > 8) {
            setTimeout(processQueue, 0);
          } else {
            queueMicrotask(processQueue);
          }
        }
      };

      // Start processing immediately
      processBatch();
    };

    // Create AudioWorklet module inline (avoids bundling extra files).
    const workletCode = `class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (e) => {
      if (e.data && e.data.sampleRate) {
        this._sampleRate = e.data.sampleRate;
      }
    };
  }

  process(inputs) {
    try {
      const input = inputs[0];
      if (!input || input.length === 0) return true;

      const channels = input.length;
      const frames = input[0].length;
      const interleaved = new Int16Array(frames * channels);
      const MAX_INT16 = 0x7fff;

      if (channels === 2) {
        const left = input[0];
        const right = input[1];
        for (let i = 0; i < frames; i++) {
          const l = left[i] < -1 ? -1 : left[i] > 1 ? 1 : left[i];
          const r = right[i] < -1 ? -1 : right[i] > 1 ? 1 : right[i];
          interleaved[i * 2] = Math.round(l * MAX_INT16);
          interleaved[i * 2 + 1] = Math.round(r * MAX_INT16);
        }
      } else {
        for (let ch = 0; ch < channels; ch++) {
          const data = input[ch];
          for (let i = 0; i < frames; i++) {
            const s = data[i] < -1 ? -1 : data[i] > 1 ? 1 : data[i];
            interleaved[i * channels + ch] = Math.round(s * MAX_INT16);
          }
        }
      }

      this.port.postMessage({
        buffer: interleaved.buffer,
        metadata: {
          timestamp: Date.now(),
          sampleRate: this._sampleRate || 48000,
          bitDepth: 16,
          channels: channels,
        }
      }, [interleaved.buffer]);
    } catch (err) {
      // keep audio thread alive
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
`;

    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);

    try {
      audioContext.audioWorklet.addModule(blobUrl).then(() => {
        const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: channels,
        });

        workletNode.port.postMessage({ sampleRate });

        workletNode.port.onmessage = (event) => {
          if (!this.isStreaming || !this.context) return;

          try {
            const ab = event.data.buffer as ArrayBuffer;
            const metadata = event.data.metadata || {};

            while (this.processingQueue.length >= MAX_QUEUE_SIZE) {
              this.processingQueue.shift();
            }

            this.processingQueue.push({
              buffer: new Int16Array(ab),
              metadata: {
                timestamp: metadata.timestamp || Date.now(),
                sampleRate: metadata.sampleRate || sampleRate,
                bitDepth: metadata.bitDepth || 16,
                channels: metadata.channels || channels,
              },
            });

            if (!this.isProcessing) queueMicrotask(processQueue);
          } catch (err) {
            console.error('[Audio Stream] Worklet message error:', err);
          }
        };

        audioSource.connect(workletNode);

        this.scriptProcessor = undefined;
        this.isStreaming = true;
      }).catch((err) => {
        console.error('[Audio Stream] Failed to add audio worklet module:', err);
      });
    } catch (err) {
      console.error('[Audio Stream] AudioWorklet setup failed:', err);
    }
    this.isStreaming = true;

    console.log(
      '[Audio Stream] Started PCM streaming:',
      `${sampleRate}Hz, ${bitDepth}-bit, ${channels} channel(s)`,
    );
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
        this.context.ipc.send('audio-stream:pcm-binary', {
          metadata: {
            timestamp: Date.now(),
            sampleRate: this.config?.sampleRate || 48000,
            bitDepth: this.config?.bitDepth || 16,
            channels: 2,
          },
          data: uint8,
        });
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
        this.startStreaming(this.audioContext, this.audioSource);
      } else if (!this.isStreaming) {
        // Wait for audio to be ready
        document.addEventListener(
          'peard:audio-can-play',
          (e) => {
            this.startStreaming(e.detail.audioContext, e.detail.audioSource);
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
    } else if (config.enabled && wasEnabled && qualityChanged && this.isStreaming) {
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
          if (audioContext && audioSource && !this.isStreaming && this.context) {
            // Restart with new settings - this will send new config to backend
            this.startStreaming(audioContext, audioSource);
          }
        });
      }
    }
  },
});

