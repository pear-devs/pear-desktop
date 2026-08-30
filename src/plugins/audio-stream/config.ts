export interface AudioStreamConfig {
  enabled: boolean;
  port: number;
  hostname: string;
  // Audio settings for the Opus/Ogg stream.
  sampleRate: number; // Capture sample rate hint (Opus always encodes at 48 kHz)
  bitrate: number; // Opus target bitrate in bits/sec (e.g. 128000)
  channels: number; // Number of channels (2 = stereo)
  bufferSize: number; // AudioWorklet batch size in frames - affects latency
}

export const defaultAudioStreamConfig: AudioStreamConfig = {
  enabled: false,
  port: 8765,
  hostname: '0.0.0.0',
  sampleRate: 48000, // 48kHz - Opus native rate
  bitrate: 128000, // 128 kbps Opus
  channels: 2, // Stereo
  bufferSize: 4096, // AudioWorklet batch (frames)
};
