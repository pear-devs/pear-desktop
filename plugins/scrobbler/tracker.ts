// Decides when to send "now playing" and when a play counts as a scrobble,
// with pear-desktop's rule: once the playback position passes half the
// duration or 4 minutes, whichever comes first, for tracks of any length.

import { livePosition, type NowPlaying, type Track } from "@pear/sdk";

export interface Play {
  track: Track;
  /** Date.now() when this play started (the scrobble timestamp). */
  startedAt: number;
}

export interface TrackerEvents {
  nowPlaying(play: Play): void;
  scrobble(play: Play): void;
}

const MAX_THRESHOLD_S = 240;
// A jump from the end back to the start of the same track is a replay (repeat one).
const REPLAY_TAIL_S = 5;

/** The position (seconds) past which a track is scrobbled, or null if it never is (unknown duration, as pear-desktop). */
export function scrobbleThreshold(durationSeconds: number) {
  if (!(durationSeconds > 0)) return null;
  return Math.min(Math.ceil(durationSeconds / 2), MAX_THRESHOLD_S);
}

interface Current extends Play {
  scrobbled: boolean;
  started: boolean;
  lastPosition: number;
}

export class ScrobbleTracker {
  #events: TrackerEvents;
  #current: Current | undefined;
  #playing = false;
  #ended = false;
  #last: NowPlaying | undefined;

  constructor(events: TrackerEvents) {
    this.#events = events;
  }

  /** The current play's position (seconds), or 0 without one. */
  position(now = Date.now()) {
    if (!this.#current || !this.#last) return 0;
    return this.#last.ad ? this.#current.lastPosition : livePosition(this.#last, now);
  }

  /** Milliseconds until the current play's position reaches the threshold, or null if not playing towards it. */
  timeUntilScrobble(now = Date.now()) {
    const current = this.#current;
    if (!current || current.scrobbled || !this.#playing) return null;
    const threshold = scrobbleThreshold(current.track.durationSeconds);
    if (threshold === null) return null;
    return Math.max(0, (threshold - this.position(now)) * 1000);
  }

  update(state: NowPlaying, now = Date.now()) {
    this.#last = state;
    const current = this.#current;
    const track = state.track;
    if (!track) {
      this.#current = undefined;
      this.#playing = false;
      return;
    }

    const position = state.positionSeconds;
    const replay =
      !!current &&
      current.track.videoId === track.videoId &&
      current.started &&
      position < REPLAY_TAIL_S &&
      // Unknown lengths (0) have no end to come back from.
      (this.#ended || (track.durationSeconds > 0 && current.lastPosition >= track.durationSeconds - REPLAY_TAIL_S));
    const playing = state.status === "playing" && !state.ad;
    let play = current;
    if (!play || play.track.videoId !== track.videoId || replay) {
      play = { track, startedAt: now, scrobbled: false, started: false, lastPosition: position };
      this.#current = play;
    } else {
      play.track = track;
    }
    if (!state.ad) play.lastPosition = position;
    if (state.status === "ended") this.#ended = true;
    else if (playing) this.#ended = false;

    const wasPlaying = this.#playing && current === play;
    this.#playing = playing;
    if (playing && !wasPlaying) {
      if (!play.started) {
        play.started = true;
        play.startedAt = now - position * 1000;
      }
      this.#events.nowPlaying({ track: play.track, startedAt: play.startedAt });
    }
    this.#check(now);
  }

  /** Re-evaluates the threshold with the last state (for timers between updates). */
  tick(now = Date.now()) {
    if (this.#last) this.update(this.#last, now);
  }

  #check(now: number) {
    const current = this.#current;
    if (!current || current.scrobbled || !this.#playing) return;
    const threshold = scrobbleThreshold(current.track.durationSeconds);
    if (threshold === null || this.position(now) < threshold) return;
    current.scrobbled = true;
    this.#events.scrobble({ track: current.track, startedAt: current.startedAt });
  }
}
