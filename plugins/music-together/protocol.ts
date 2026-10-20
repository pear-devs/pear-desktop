// Wire protocol between the host and its guests. The host is the single source
// of truth: guests send requests, the host decides and broadcasts state.

/**
 * What guests may do: `host-only` = only listen, `suggest` = add tracks to the
 * room queue, `control` = also play, pause, seek and skip for everyone.
 */
export type Permission = "host-only" | "suggest" | "control";

export const PERMISSIONS: readonly { value: Permission; label: string; description: string }[] = [
  { value: "host-only", label: "Listen only", description: "Only you control the music" },
  { value: "suggest", label: "Suggest", description: "Guests can add songs to the queue" },
  { value: "control", label: "Full control", description: "Guests can also play, pause, seek and skip" },
];

export interface Participant {
  /** Peer id; the host is always "host". */
  id: string;
  name: string;
}

export interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  /** Participant id of whoever suggested it. */
  by: string;
}

export interface Playback {
  videoId: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  durationSeconds: number;
  playing: boolean;
  /** Position in seconds at the moment the message was sent. */
  position: number;
}

export interface RoomState {
  permission: Permission;
  participants: Participant[];
  queue: QueueItem[];
}

export type GuestAction =
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; seconds: number }
  | { type: "next" }
  | { type: "load"; videoId: string }
  | { type: "playItem"; id: string }
  | { type: "removeItem"; id: string };

export type GuestMessage =
  | { type: "hello"; name: string }
  | { type: "suggest"; videoId: string }
  | { type: "control"; action: GuestAction }
  | { type: "ping"; t: number };

export type HostMessage =
  | { type: "welcome"; you: string; host: string; room: RoomState; playback: Playback | null }
  | { type: "room"; room: RoomState }
  | { type: "playback"; playback: Playback | null }
  | { type: "pong"; t: number }
  /** `key` (plugins.music-together.*) lets the guest show it in its own language; `text` is the English. */
  | { type: "notice"; text: string; key?: string }
  | { type: "closed" };

export const HOST_ID = "host";

/** Room codes avoid look-alike characters (0/O, 1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

export function randomCode(random: () => number = Math.random) {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

/** Accepts "abc-def", " ABCDEF ", etc. Returns undefined for anything that isn't a code. */
export function normalizeCode(input: string) {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : undefined;
}

export const formatCode = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`;

/** A YT (Music) link, a youtu.be link or a bare video id. */
export function parseVideoId(input: string): string | undefined {
  const text = input.trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.hostname === "youtu.be") return idOrUndefined(url.pathname.slice(1));
    if (/(^|\.)\u0079\u006f\u0075\u0074\u0075\u0062\u0065\.com$/.test(url.hostname)) return idOrUndefined(url.searchParams.get("v") ?? "");
  } catch {}
}

const idOrUndefined = (id: string) => (/^[\w-]{11}$/.test(id) ? id : undefined);

export function isGuestMessage(value: unknown): value is GuestMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case "hello":
      return typeof message.name === "string";
    case "suggest":
      return typeof message.videoId === "string";
    case "control":
      return !!message.action && typeof message.action === "object";
    case "ping":
      return typeof message.t === "number";
    default:
      return false;
  }
}

export function isHostMessage(value: unknown): value is HostMessage {
  return !!value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string";
}
