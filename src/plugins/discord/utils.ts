import { HANGUL_FILLER } from './constants';

import { APPLICATION_NAME } from '@/i18n';

import type { GatewayActivityButton } from 'discord-api-types/v10';
import type { SongInfo } from '@/providers/song-info';
import type { DiscordPluginConfig } from './index';

/**
 * Truncates a string to a specified length, adding ellipsis if truncated.
 * @param str - The string to truncate.
 * @param length - The maximum allowed length.
 * @returns The truncated string.
 */
export const truncateString = (str: string, length: number): string => {
  if (str.length > length) {
    return `${str.substring(0, length - 3)}...`;
  }
  return str;
};

/**
 * Builds the array of buttons for the Discord Rich Presence activity.
 * @param config - The plugin configuration.
 * @param songInfo - The current song information.
 * @returns An array of buttons or undefined if no buttons are configured.
 */
export const buildDiscordButtons = (
  config: DiscordPluginConfig,
  songInfo: SongInfo,
): GatewayActivityButton[] | undefined => {
  const buttons: GatewayActivityButton[] = [];
  if (
    config[
      'playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063'
    ] &&
    songInfo.url
  ) {
    buttons.push({
      label: `Play on ${APPLICATION_NAME}`,
      url: songInfo.url,
    });
  }
  if (!config.hideGitHubButton) {
    buttons.push({
      label: 'View App On GitHub',
      url: 'https://github.com/pear-devs/pear-desktop',
    });
  }
  return buttons.length ? buttons : undefined;
};

/**
 * Pads Hangul fields (title, artist, album) in SongInfo if they are less than 2 characters long.
 * Discord requires fields to be at least 2 characters.
 * @param songInfo - The song information object (will be mutated).
 */
export const padHangulFields = (songInfo: SongInfo): void => {
  (['title', 'artist', 'album'] as const).forEach((key) => {
    const value = songInfo[key];
    if (typeof value === 'string' && value.length > 0 && value.length < 2) {
      songInfo[key] = value + HANGUL_FILLER.repeat(2 - value.length);
    }
  });
};

/**
 * Checks if the difference between two time values indicates a seek operation.
 * @param oldSeconds - The previous elapsed time in seconds.
 * @param newSeconds - The current elapsed time in seconds.
 * @returns True if the time difference suggests a seek, false otherwise.
 */
export const isSeek = (oldSeconds: number, newSeconds: number): boolean => {
  // Consider it a seek if the time difference is greater than 2 seconds
  // (allowing for minor discrepancies in reporting)
  return Math.abs(newSeconds - oldSeconds) > 2;
};
