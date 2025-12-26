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
    // Use buffer size from config
    const bufferSize = config.bufferSize || 2048;

    // Send audio configuration to backend
    this.context.ipc.send('audio-stream:config', {
      sampleRate,
      bitDepth,
      channels,
    });

    // Create ScriptProcessorNode for PCM capture
    // NOTE: ScriptProcessorNode is deprecated and can cause timing issues/crackling.
    // For best results, consider migrating to AudioWorkletNode in the future.
    // Use buffer size from config for latency control
    const scriptProcessor = audioContext.createScriptProcessor(
      bufferSize,
      channels,
      channels,
    );

    // No batching - send immediately to minimize latency
    // Base64 encoding is deferred to async queue to prevent blocking
    this.batchBuffer = null;
    this.batchCount = 0;

    // Reset processing queue
    this.processingQueue = [];
    this.isProcessing = false;

    // Optimized base64 conversion - process in chunks to avoid stack overflow
    const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000; // 32KB chunks
      let binary = '';

      // Process in chunks to avoid call stack overflow with spread operator
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        // Use apply with Array.from for better performance and stack safety
        binary += String.fromCharCode.apply(null, Array.from(chunk));
      }
      return btoa(binary);
    };

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

            // Base64 encoding happens outside audio callback
            const pcmDataBase64 = arrayBufferToBase64(buffer);

            // Send PCM data to backend
            this.context!.ipc.send('audio-stream:pcm-data', {
              metadata: item.metadata,
              data: pcmDataBase64,
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

    scriptProcessor.onaudioprocess = (event) => {
      if (!this.isStreaming) {
        return;
      }

      const inputBuffer = event.inputBuffer;
      const numberOfChannels = inputBuffer.numberOfChannels;
      const length = inputBuffer.length;

      // Convert Float32Array to PCM - optimized conversion
      let pcmArray: Int16Array | Int32Array;

      if (bitDepth === 32) {
        // 32-bit PCM: convert float32 (-1.0 to 1.0) to int32 (-2147483648 to 2147483647)
        const pcm32 = new Int32Array(length * numberOfChannels);
        const MAX_INT32 = 2147483647;

        // Optimized loop - process channels interleaved
        for (let channel = 0; channel < numberOfChannels; channel++) {
          const channelData = inputBuffer.getChannelData(channel);
          for (let i = 0; i < length; i++) {
            const sample = channelData[i];
            // Clamp to [-1, 1] range and convert to int32
            // Use MAX_INT32 for scaling (2147483647), clamp result to valid int32 range
            const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
            const scaled = Math.round(clamped * MAX_INT32);
            // Clamp to int32 range
            pcm32[i * numberOfChannels + channel] =
              scaled < -2147483648
                ? -2147483648
                : scaled > MAX_INT32
                  ? MAX_INT32
                  : scaled;
          }
        }
        pcmArray = pcm32;
      } else {
        // 16-bit PCM: highly optimized conversion
        const pcm16 = new Int16Array(length * numberOfChannels);
        const MAX_INT16 = 0x7fff;

        // Optimize for common case (stereo)
        if (numberOfChannels === 2) {
          const leftChannel = inputBuffer.getChannelData(0);
          const rightChannel = inputBuffer.getChannelData(1);
          
          for (let i = 0; i < length; i++) {
            // Clamp and convert with minimal branching
            const left = leftChannel[i];
            const right = rightChannel[i];

            // Fast clamp: Math.max(-1, Math.min(1, sample))
            const leftClamped = left < -1 ? -1 : left > 1 ? 1 : left;
            const rightClamped = right < -1 ? -1 : right > 1 ? 1 : right;
            
            // Convert to int16 (interleaved: L, R, L, R, ...)
            pcm16[i * 2] = Math.round(leftClamped * MAX_INT16);
            pcm16[i * 2 + 1] = Math.round(rightClamped * MAX_INT16);
          }
        } else {
          // Generic case for mono or other channel counts
          for (let channel = 0; channel < numberOfChannels; channel++) {
            const channelData = inputBuffer.getChannelData(channel);
            for (let i = 0; i < length; i++) {
              const sample = channelData[i];
              const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
              pcm16[i * numberOfChannels + channel] = Math.round(clamped * MAX_INT16);
            }
          }
        }
        pcmArray = pcm16;
      }

      // Queue immediately for async processing (don't block audio callback)
      // No batching to minimize latency - each buffer is sent immediately
      if (this.context) {
        // Drop oldest items if queue is too long to prevent buildup and stuttering
        // More aggressive dropping to prevent queue buildup
        while (this.processingQueue.length >= MAX_QUEUE_SIZE) {
          // Remove oldest items (FIFO) until we have room
          this.processingQueue.shift();
        }

        this.processingQueue.push({
          buffer: pcmArray,
          metadata: {
            timestamp: Date.now(),
            sampleRate,
            bitDepth,
            channels: numberOfChannels,
          },
        });

        // Trigger async processing if not already running
        // Use queueMicrotask for immediate processing with minimal delay
        if (!this.isProcessing) {
          queueMicrotask(processQueue);
        }
      }
    };

    // Connect audio source to script processor, then to destination
    audioSource.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    this.scriptProcessor = scriptProcessor;
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
        // Optimized base64 conversion
        const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
          const bytes = new Uint8Array(buffer);
          const chunkSize = 0x8000; // 32KB chunks
          let binary = '';
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, Array.from(chunk));
          }
          return btoa(binary);
        };

        let buffer: ArrayBuffer;
        if (this.batchBuffer.buffer instanceof SharedArrayBuffer) {
          buffer = new ArrayBuffer(this.batchBuffer.buffer.byteLength);
          new Uint8Array(buffer).set(new Uint8Array(this.batchBuffer.buffer));
        } else {
          buffer = this.batchBuffer.buffer;
        }
        const pcmDataBase64 = arrayBufferToBase64(buffer);
        this.context.ipc.send('audio-stream:pcm-data', {
          metadata: {
            timestamp: Date.now(),
            sampleRate: this.config?.sampleRate || 48000,
            bitDepth: this.config?.bitDepth || 16,
            channels: 2,
          },
          data: pcmDataBase64,
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

