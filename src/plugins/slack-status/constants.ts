/**
 * Throttle time for progress updates in milliseconds
 */
export const SLACK_PROGRESS_THROTTLE_MS = 15_000;
/**
 * Time in milliseconds to wait before sending a time update
 */
export const SLACK_TIME_UPDATE_DEBOUNCE_MS = 5000;

export enum TimerKey {
  ClearActivity = 'clearActivity',
  UpdateTimeout = 'updateTimeout',
}
