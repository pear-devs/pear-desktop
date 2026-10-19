// WebRTC transport via PeerJS: the public PeerJS server only brokers the
// connection; music state flows peer-to-peer over data channels.

import { Peer, type DataConnection, type PeerOptions } from "peerjs";
import { randomCode } from "./protocol.ts";
import type { Link } from "./session.ts";

const ID_PREFIX = "pear-together-";
const OPEN_TIMEOUT_MS = 15_000;
const RECOVERABLE = new Set(["network", "server-error", "socket-error", "socket-closed", "disconnected"]);

// Same STUN/TURN servers as upstream pear-desktop.
const OPTIONS: PeerOptions = {
  debug: 0,
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"],
        username: "peerjs",
        credential: "peerjsp",
      },
      { urls: "stun:freestun.net:3478" },
      { urls: "turn:freestun.net:3478", username: "free", credential: "free" },
    ],
  },
};

export interface Transport {
  close(): void;
}

function linkOf(connection: DataConnection): Link {
  return {
    peerId: connection.peer,
    send: (message) => {
      if (connection.open) void connection.send(message);
    },
    onMessage: (listener) => void connection.on("data", listener),
    onClose: (listener) => {
      connection.on("close", listener);
      connection.on("error", listener);
    },
    close: () => connection.close({ flush: true }),
  };
}

function open(peer: Peer) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Couldn't reach the connection server")), OPEN_TIMEOUT_MS);
    peer.once("open", (id) => (clearTimeout(timer), resolve(id)));
    peer.once("error", (error) => (clearTimeout(timer), reject(error)));
  });
}

/** Keeps the broker connection alive so new guests can still join after a network blip. */
function keepAlive(peer: Peer) {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const retry = () => {
    if (peer.destroyed || !peer.disconnected || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      attempt++;
      try {
        peer.reconnect();
      } catch {}
      retry();
    }, Math.min(30_000, 1000 * 2 ** attempt));
  };
  peer.on("open", () => (attempt = 0));
  peer.on("disconnected", retry);
  peer.on("error", (error) => RECOVERABLE.has(error.type) && retry());
  return () => clearTimeout(timer);
}

/** Opens a room under a fresh code; `onGuest` receives each guest's link. */
export async function hostRoom(onGuest: (link: Link) => void): Promise<Transport & { code: string }> {
  for (let attempt = 0; ; attempt++) {
    const code = randomCode();
    const peer = new Peer(ID_PREFIX + code, OPTIONS);
    try {
      await open(peer);
    } catch (error) {
      peer.destroy();
      if ((error as { type?: string }).type === "unavailable-id" && attempt < 5) continue;
      throw error;
    }
    const stop = keepAlive(peer);
    peer.on("connection", (connection) => connection.on("open", () => onGuest(linkOf(connection))));
    return {
      code,
      close() {
        stop();
        // Give the "closed" notice a moment to leave before tearing down.
        setTimeout(() => peer.destroy(), 300);
      },
    };
  }
}

/** Connects to the room with `code`. */
export async function joinRoom(code: string): Promise<Transport & { link: Link }> {
  const peer = new Peer(OPTIONS);
  try {
    await open(peer);
    const connection = peer.connect(ID_PREFIX + code, { reliable: true });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The host didn't answer")), OPEN_TIMEOUT_MS);
      connection.once("open", () => (clearTimeout(timer), resolve()));
      peer.once("error", (error) => {
        clearTimeout(timer);
        reject(error.type === "peer-unavailable" ? new Error("No session with that code") : error);
      });
    });
    const stop = keepAlive(peer);
    return {
      link: linkOf(connection),
      close() {
        stop();
        setTimeout(() => peer.destroy(), 300);
      },
    };
  } catch (error) {
    peer.destroy();
    throw error;
  }
}
