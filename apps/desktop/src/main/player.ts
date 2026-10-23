// Host-side mirror of the page's NowPlaying state, for OS integrations.

import { EventEmitter } from "node:events";
import { IDLE, type HostPlayer, type NowPlaying, type PlayerAction, type Track } from "@pear/sdk";

// The page's details are read through PageRequests (see plugins.ts), not mirrored.
export class PlayerMirror implements Omit<HostPlayer, "details"> {
  #state: NowPlaying = { ...IDLE };
  #events = new EventEmitter();
  #send: (action: PlayerAction) => void;

  constructor(send: (action: PlayerAction) => void) {
    this.#send = send;
    this.#events.setMaxListeners(0);
  }

  get state() {
    return this.#state;
  }

  update(next: NowPlaying) {
    const previous = this.#state;
    this.#state = next;
    this.#events.emit("change", next, previous);
    if (next.track?.videoId !== previous.track?.videoId || next.track?.title !== previous.track?.title) {
      this.#events.emit("trackChange", next.track, next);
    }
  }

  on(event: "change", listener: (state: NowPlaying, previous: NowPlaying) => void): () => void;
  on(event: "trackChange", listener: (track: Track | null, state: NowPlaying) => void): () => void;
  on(event: string, listener: (...args: any[]) => void) {
    this.#events.on(event, listener);
    return () => void this.#events.off(event, listener);
  }

  control(action: PlayerAction) {
    this.#send(action);
  }
}
