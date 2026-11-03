// Decides when to send "now playing" and when a play counts as a scrobble,
// following Last.fm's rule: tracks longer than 30 s, scrobbled once they have
// been *listened to* (not paused, not an ad, not skipped over) for half their
// duration or 4 minutes, whichever comes first.

import type { NowPlaying, Track } from "@pear/sdk";

export interface Play {
  track: Track;
  /** Date.now() when this play started (the scrobble timestamp). */
  startedAt: number;
}

export interface TrackerEvents {
  nowPlaying(play: Play): void;
  scrobble(play: Play): void;
}

const MIN_DURATION_S = 30;
const MAX_THRESHOLD_S = 240;
// A jump from the end back to the start of the same track is a replay (repeat one).
const REPLAY_TAIL_S = 5;

/** Seconds of listening after which a track is scrobbled, or null if it never is. */
export function scrobbleThreshold(durationSeconds: number) {
  if (durationSeconds <= 0) return MAX_THRESHOLD_S;
  if (durationSeconds <= MIN_DURATION_S) return null;
  return Math.min(durationSeconds / 2, MAX_THRESHOLD_S);
}

interface Current extends Play {
  listenedMs: number;
  scrobbled: boolean;
  started: boolean;
  lastPosition: number;
}

export class ScrobbleTracker {
  #events: TrackerEvents;
  #current: Current | undefined;
  #playingSince: number | undefined;
  #ended = false;
  #last: NowPlaying | undefined;

  constructor(events: TrackerEvents) {
    this.#events = events;
  }

  /** Seconds listened to the current play so far. */
  listened(now = Date.now()) {
    if (!this.#current) return 0;
    const running = this.#playingSince === undefined ? 0 : now - this.#playingSince;
    return (this.#current.listenedMs + running) / 1000;
  }

  /** Milliseconds until the current play reaches the threshold, or null if not counting. */
  timeUntilScrobble(now = Date.now()) {
    const current = this.#current;
    if (!current || current.scrobbled || this.#playingSince === undefined) return null;
    const threshold = scrobbleThreshold(current.track.durationSeconds);
    if (threshold === null) return null;
    return Math.max(0, threshold * 1000 - this.listened(now) * 1000);
  }

  update(state: NowPlaying, now = Date.now()) {
    this.#last = state;
    const current = this.#accumulate(now);
    const track = state.track;
    if (!track) {
      this.#current = undefined;
      this.#playingSince = undefined;
      return;
    }

    const position = state.positionSeconds;
    const replay =
      !!current &&
      current.track.videoId === track.videoId &&
      current.started &&
      position < REPLAY_TAIL_S &&
      (this.#ended || current.lastPosition >= track.durationSeconds - REPLAY_TAIL_S);
    const playing = state.status === "playing" && !state.ad;
    let play = current;
    if (!play || play.track.videoId !== track.videoId || replay) {
      play = { track, startedAt: now, listenedMs: 0, scrobbled: false, started: false, lastPosition: position };
      this.#current = play;
    } else {
      play.track = track;
    }
    if (!state.ad) play.lastPosition = position;
    if (state.status === "ended") this.#ended = true;
    else if (playing) this.#ended = false;

    const wasPlaying = this.#playingSince !== undefined && current === play;
    this.#playingSince = playing ? now : undefined;
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

  #accumulate(now: number) {
    const current = this.#current;
    if (current && this.#playingSince !== undefined) {
      current.listenedMs += Math.max(0, now - this.#playingSince);
      this.#playingSince = now;
    }
    return current;
  }

  #check(now: number) {
    const current = this.#current;
    if (!current || current.scrobbled) return;
    const threshold = scrobbleThreshold(current.track.durationSeconds);
    if (threshold === null || this.listened(now) < threshold) return;
    current.scrobbled = true;
    this.#events.scrobble({ track: current.track, startedAt: current.startedAt });
  }
}
