export interface ChromecastPluginConfig {
  enabled: boolean;
  /**
   * mDNS id of the last device the user cast to. Used by `autoConnect`.
   */
  lastDeviceId?: string;
  /**
   * Reconnect to `lastDeviceId` automatically when the plugin starts.
   * @default false
   */
  autoConnect: boolean;
  /**
   * Port for the local audio proxy server the Cast device fetches from.
   * @default 26539
   */
  serverPort: number;
  /**
   * Mute the local YouTube Music player while casting to avoid hearing
   * audio from both the desktop and the speaker at once.
   * @default true
   */
  muteLocalWhenCasting: boolean;
  /**
   * Initial Cast-device volume (0..1) applied when a session starts. The live
   * YTM volume slider drives the speaker during a session but is not persisted
   * back here.
   * @default 0.4
   */
  castVolume: number;
}

export const defaultConfig: ChromecastPluginConfig = {
  enabled: false,
  lastDeviceId: undefined,
  autoConnect: false,
  serverPort: 26539,
  muteLocalWhenCasting: true,
  castVolume: 0.4,
};

/**
 * A Google Cast device discovered on the local network via mDNS
 * (`_googlecast._tcp`).
 */
export interface CastDevice {
  /** Stable mDNS device id (TXT `id`). */
  id: string;
  /** Friendly name (TXT `fn`), e.g. "Living Room speaker". */
  name: string;
  /** IPv4 address. */
  host: string;
  /** Cast control port (almost always 8009). */
  port: number;
  /** Model string (TXT `md`), e.g. "Nest Audio". */
  model?: string;
}
