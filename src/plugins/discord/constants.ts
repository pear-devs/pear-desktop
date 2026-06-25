/**
 * Application ID registered by @th-ch/pear-desktop dev team
 */
export const clientId = '1177081335727267940';
/**
 * Throttle time for progress updates in milliseconds
 */
export const PROGRESS_THROTTLE_MS = 15_000;
/**
 * Time in milliseconds to wait before sending a time update
 */
export const TIME_UPDATE_DEBOUNCE_MS = 5000;
/**
 * Filler character for padding short Hangul strings (Discord requires min 2 chars)
 */
export const HANGUL_FILLER = '\u3164';

/**
 * Enum for keys used in TimerManager.
 */
export enum TimerKey {
  ClearActivity = 'clearActivity', // Timer to clear activity when paused
  UpdateTimeout = 'updateTimeout', // Timer for throttled activity updates
  DiscordConnectRetry = 'discordConnectRetry', // Timer for Discord connection retries
}
