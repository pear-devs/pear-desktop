// pear-desktop's app protocol: "<name>music://playPause" (from notification
// buttons, scripts or other apps) controls playback. A second instance started
// with such a link hands it to the running one.

import type { App } from "electron";
import type { PlayerAction } from "@pear/sdk";

/** pear-desktop's scheme, so links and scripts made for it keep working. */
export const APP_PROTOCOL = "\u0079\u006f\u0075\u0074\u0075\u0062\u0065music";

export interface ProtocolCommand {
  command: string;
  args: string[];
}

/** The command in a protocol link, as pear-desktop parsed it ("cmd arg arg", URI-encoded). */
export function parseProtocolLink(link: string): ProtocolCommand | null {
  const prefix = `${APP_PROTOCOL}://`;
  if (!link.startsWith(prefix)) return null;
  const raw = link.slice(prefix.length).replace(/\/$/, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const [command, ...args] = decoded.split(" ");
  return command ? { command, args } : null;
}

/** A link among a second instance's command line arguments. */
export function findProtocolLink(argv: readonly string[]): ProtocolCommand | null {
  for (const arg of argv) {
    const parsed = parseProtocolLink(arg);
    if (parsed) return parsed;
  }
  return null;
}

const number = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** pear-desktop's song controls that map onto player actions. */
export function protocolActions({ command, args }: ProtocolCommand): PlayerAction[] {
  switch (command) {
    case "previous":
      return [{ type: "previous" }];
    case "next":
      return [{ type: "next" }];
    case "play":
      return [{ type: "play" }];
    case "pause":
      return [{ type: "pause" }];
    case "playPause":
      return [{ type: "toggle" }];
    case "like":
      return [{ type: "like" }];
    case "dislike":
      return [{ type: "dislike" }];
    case "shuffle":
      return [{ type: "shuffle" }];
    case "muteUnmute":
      return [{ type: "mute" }];
    case "seekTo": {
      const seconds = number(args[0]);
      return seconds === undefined ? [] : [{ type: "seek", seconds }];
    }
    case "goBack":
    case "goForward": {
      const seconds = number(args[0]);
      if (seconds === undefined) return [];
      return [{ type: "seekBy", seconds: command === "goBack" ? -seconds : seconds }];
    }
    case "setVolume": {
      const value = number(args[0]);
      return value === undefined ? [] : [{ type: "volume", value }];
    }
    case "switchRepeat": {
      const times = Math.max(1, Math.min(3, Math.round(number(args[0]) ?? 1)));
      return Array.from({ length: times }, () => ({ type: "repeat" }) as const);
    }
    default:
      return [];
  }
}

export type ProtocolListener = (command: string, args: string[]) => void;

/** Runs the links that reach this instance: playback controls, then plugins' listeners. */
export class ProtocolLinks {
  #listeners = new Set<ProtocolListener>();
  #control: (action: PlayerAction) => void;

  constructor(control: (action: PlayerAction) => void) {
    this.#control = control;
  }

  run({ command, args }: ProtocolCommand) {
    for (const action of protocolActions({ command, args })) this.#control(action);
    for (const listener of this.#listeners) listener(command, args);
  }

  /** Subscribes to every link; returns the unsubscribe. */
  listen(listener: ProtocolListener) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  /** macOS hands links to the running app instead of starting a second instance. */
  handleOpenUrl(app: Pick<App, "on">) {
    app.on("open-url", (event, url) => {
      const parsed = parseProtocolLink(url);
      if (!parsed) return;
      event.preventDefault();
      this.run(parsed);
    });
  }
}

/**
 * Makes this app the handler for the protocol, as pear-desktop did. Only when
 * packaged: development runs (and tests) shouldn't take over the system's handler.
 */
export function registerProtocol(app: App) {
  if (!app.isPackaged) return;
  app.setAsDefaultProtocolClient(APP_PROTOCOL);
}
