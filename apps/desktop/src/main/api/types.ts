// The shapes the API server, its route table and the OpenAPI document share.

import type { NowPlaying, PlayerAction } from "@pear/sdk";
import type { SongDetails } from "@pear/sdk/song-details";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";
export type FieldType = "number" | "integer" | "string" | "boolean";
/** Field name → type; a trailing "?" marks it optional, an array is an enum of strings. */
export type BodySchema = Record<string, FieldType | `${FieldType}?` | readonly string[]>;

export interface Reply {
  status: number;
  body?: unknown;
}

export interface RouteRequest {
  params: Record<string, string>;
  body: Record<string, unknown>;
  remoteAddress: string;
}

export interface Route {
  method: Method;
  path: string;
  summary: string;
  /** A schema checked before `handle`, or "json" for any JSON body the handler checks itself. */
  body?: BodySchema | "json";
  /** Reachable without a token. */
  public?: boolean;
  handle(request: RouteRequest): Reply | Promise<Reply>;
}

export type MediaTypeName = "AUDIO" | "ORIGINAL_MUSIC_VIDEO" | "USER_GENERATED_CONTENT" | "PODCAST_EPISODE" | "OTHER_VIDEO";

/** The original's SongInfo shape, which existing API clients parse. */
export interface SongInfo {
  title: string;
  alternativeTitle?: string;
  artist: string;
  artistUrl?: string;
  views: number;
  uploadDate?: string;
  imageSrc: string | null;
  isPaused: boolean;
  songDuration: number;
  elapsedSeconds: number;
  url: string;
  album: string | null;
  videoId: string;
  playlistId?: string;
  mediaType: MediaTypeName;
  tags: string[];
}

export interface QueueResponse {
  items?: QueueItem[];
  autoPlaying?: boolean;
  continuation?: string;
}

export interface PanelVideoRenderer {
  selected?: boolean;
  videoId?: string;
  title?: { runs?: { text: string }[] };
  thumbnail?: unknown;
  lengthText?: unknown;
  shortBylineText?: unknown;
}

export interface QueueItem {
  playlistPanelVideoRenderer?: PanelVideoRenderer;
  playlistPanelVideoWrapperRenderer?: { primaryRenderer?: { playlistPanelVideoRenderer?: PanelVideoRenderer } };
}

/** What the routes act on. */
export interface Backend {
  state(): NowPlaying;
  details(): SongDetails | undefined;
  control(action: PlayerAction): void;
  /** Asks the page part. */
  page<T = unknown>(event: string, payload?: unknown): Promise<T>;
  setFullscreen(fullscreen: boolean): Promise<void>;
  /** Issues an access token for a client, asking the user if needed; null when denied. */
  authorize(id: string, remoteAddress: string): Promise<string | null>;
  /** RPC methods of the running plugins. */
  rpcMethods(): readonly RpcInfo[];
  /** Calls a plugin's RPC method with the (unchecked) JSON body. */
  callRpc(plugin: string, method: string, body: unknown): Promise<Reply>;
}

export interface RpcInfo {
  plugin: string;
  name: string;
  summary?: string;
  /** JSON schema of the input, for the OpenAPI document. */
  input?: unknown;
}
