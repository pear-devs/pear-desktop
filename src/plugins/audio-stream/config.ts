export interface AudioStreamConfig {
  enabled: boolean;
  port: number;
  hostname: string;
  // Audio quality settings for PCM streaming
  sampleRate: number; // Audio sample rate (e.g., 44100, 48000, 96000)
  bitDepth: number; // Bit depth (16 or 32)
  channels: number; // Number of channels (1 = mono, 2 = stereo)
  bufferSize: number; // Audio buffer size (1024, 2048, 4096, 8192) - affects latency
}

export const defaultAudioStreamConfig: AudioStreamConfig = {
  enabled: false,
  port: 8765,
  hostname: '0.0.0.0',
  // High quality audio settings for local network
  // Using 48kHz/16-bit for stability - can increase to 96kHz/32-bit once working
  sampleRate: 48000, // 48kHz - high quality and widely supported
  bitDepth: 16, // 16-bit - reliable and well-tested
  channels: 2, // Stereo
  bufferSize: 2048, // Low latency buffer size
};


