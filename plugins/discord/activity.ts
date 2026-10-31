// Builds the Rich Presence payload from the player state (pure, unit-tested).

import { livePosition, type NowPlaying } from "@pear/sdk";
import { isPlaying } from "@pear/sdk/util";
import type { SongDetails } from "@pear/sdk/song-details";
import type { SetActivity } from "@xhayper/discord-rpc";

// discord-api-types' ActivityType and StatusDisplayType.
export const ACTIVITY_TYPES = { playing: 0, listening: 2, watching: 3 } as const;
export const STATUS_DISPLAY_TYPES = { name: 0, state: 1, details: 2 } as const;

export interface ActivityOptions {
  activityType: keyof typeof ACTIVITY_TYPES;
  statusDisplayType: keyof typeof STATUS_DISPLAY_TYPES;
  playButton: boolean;
  hideGitHubButton: boolean;
  hideDurationLeft: boolean;
  hideWhenPaused: boolean;
}

const GITHUB_URL = "https://github.com/pear-devs/pear-desktop";
// Discord rejects fields shorter than 2 characters; pad with an invisible Hangul filler.
const FILLER = "ㅤ";
const MIN_FIELD = 2;
const MAX_FIELD = 128;

/** Trims to Discord's 128-character limit and pads to its 2-character minimum. */
export function sanitize(input: string | undefined, fallback = "Unknown") {
  let text = input?.trim() || fallback;
  if (text.length > MAX_FIELD) text = `${text.slice(0, MAX_FIELD - 3)}...`;
  return text.length < MIN_FIELD ? text.padEnd(MIN_FIELD, FILLER) : text;
}

export function isPaused(state: NowPlaying) {
  return state.ad || !isPlaying(state);
}

/** The activity to show, or null to clear it. */
export function buildActivity(
  state: NowPlaying,
  details: SongDetails | undefined,
  options: ActivityOptions,
  now = Date.now(),
): SetActivity | null {
  const track = state.track;
  if (!track || (!track.title && !track.artist)) return null;
  const paused = isPaused(state);
  if (paused && options.hideWhenPaused) return null;
  const extra = details?.videoId === track.videoId ? details : undefined;

  const activity: SetActivity = {
    type: ACTIVITY_TYPES[options.activityType],
    statusDisplayType: STATUS_DISPLAY_TYPES[options.statusDisplayType],
    details: sanitize(extra?.alternativeTitle ?? track.title),
    detailsUrl: track.url,
    state: sanitize(extra?.tags[0] ?? track.artist),
    instance: false,
  };
  if (extra?.artistUrl) activity.stateUrl = extra.artistUrl;
  if (track.artworkUrl) activity.largeImageKey = track.artworkUrl;
  if (track.album) activity.largeImageText = sanitize(track.album);

  const buttons = [];
  if (options.playButton) buttons.push({ label: "Play on \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music", url: track.url });
  if (!options.hideGitHubButton) buttons.push({ label: "View App On GitHub", url: GITHUB_URL });
  if (buttons.length) activity.buttons = buttons;

  if (paused) {
    activity.largeImageText = "⏸︎";
  } else if (!options.hideDurationLeft && track.durationSeconds > 0) {
    const start = now - livePosition(state, now) * 1000;
    activity.startTimestamp = Math.floor(start / 1000);
    activity.endTimestamp = Math.floor((start + track.durationSeconds * 1000) / 1000);
  }
  return activity;
}

/**
 * Whether `next` needs to be sent when `previous` is showing. Timestamps that
 * drift by less than a couple of seconds aren't worth an update: Discord
 * renders the progress itself.
 */
export function needsUpdate(previous: SetActivity | null, next: SetActivity | null) {
  if (!previous || !next) return previous !== next;
  const { startTimestamp: a, endTimestamp: b, ...restPrevious } = previous;
  const { startTimestamp: c, endTimestamp: d, ...restNext } = next;
  if (JSON.stringify(restPrevious) !== JSON.stringify(restNext)) return true;
  if ((a === undefined) !== (c === undefined)) return true;
  return Math.abs(Number(a ?? 0) - Number(c ?? 0)) > 2 || Math.abs(Number(b ?? 0) - Number(d ?? 0)) > 2;
}
