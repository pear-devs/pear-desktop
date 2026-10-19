// The REST routes of the original pear-desktop API server (v1), as a table
// that drives both request dispatch and the OpenAPI document.

import { livePosition, type NowPlaying, type PlayerAction, type RepeatMode } from "@pear/sdk";
import type { SongDetails } from "@pear/sdk/song-details";

export const API_VERSION = "v1";
const API = `/api/${API_VERSION}`;

export type Method = "GET" | "POST" | "PATCH" | "DELETE";
type FieldType = "number" | "integer" | "string" | "boolean";
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
  body?: BodySchema;
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

interface PanelVideoRenderer {
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

export interface Backend {
  state(): NowPlaying;
  details(): SongDetails | undefined;
  control(action: PlayerAction): void;
  /** Asks the page part. */
  page<T = unknown>(event: string, payload?: unknown): Promise<T>;
  setFullscreen(fullscreen: boolean): Promise<void>;
  /** Issues an access token for a client, asking the user if needed; null when denied. */
  authorize(id: string, remoteAddress: string): Promise<string | null>;
}

const MUSIC_VIDEO_TYPES: Record<string, MediaTypeName> = {
  MUSIC_VIDEO_TYPE_ATV: "AUDIO",
  MUSIC_VIDEO_TYPE_OMV: "ORIGINAL_MUSIC_VIDEO",
  MUSIC_VIDEO_TYPE_UGC: "USER_GENERATED_CONTENT",
  MUSIC_VIDEO_TYPE_PODCAST_EPISODE: "PODCAST_EPISODE",
};
const MEDIA_TYPES: Record<string, MediaTypeName> = { audio: "AUDIO", video: "ORIGINAL_MUSIC_VIDEO", podcast: "PODCAST_EPISODE" };

export const REPEAT_NAMES: Record<RepeatMode, "NONE" | "ALL" | "ONE"> = { none: "NONE", all: "ALL", one: "ONE" };

export function isPaused(state: NowPlaying) {
  return state.ad || (state.status !== "playing" && state.status !== "buffering");
}

export function songInfo(state: NowPlaying, details: SongDetails | undefined): SongInfo | null {
  const track = state.track;
  if (!track) return null;
  const extra = details?.videoId === track.videoId ? details : undefined;
  const info: SongInfo = {
    title: track.title,
    artist: track.artist,
    views: extra?.views ?? 0,
    imageSrc: track.artworkUrl ?? null,
    isPaused: isPaused(state),
    songDuration: track.durationSeconds,
    elapsedSeconds: Math.floor(livePosition(state)),
    url: track.url,
    album: track.album ?? null,
    videoId: track.videoId,
    mediaType: MUSIC_VIDEO_TYPES[extra?.musicVideoType ?? ""] ?? MEDIA_TYPES[track.mediaType] ?? "OTHER_VIDEO",
    tags: extra?.tags ?? [],
  };
  if (extra?.alternativeTitle) info.alternativeTitle = extra.alternativeTitle;
  if (extra?.artistUrl) info.artistUrl = extra.artistUrl;
  if (extra?.uploadDate) info.uploadDate = extra.uploadDate;
  if (track.playlistId) info.playlistId = track.playlistId;
  return info;
}

const NO_CONTENT: Reply = { status: 204 };
const ok = (body: unknown): Reply => ({ status: 200, body });

const renderer = (item: QueueItem | undefined) =>
  item?.playlistPanelVideoRenderer ?? item?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;

export function createRoutes(backend: Backend): Route[] {
  const action = (method: Method, path: string, summary: string, act: PlayerAction): Route => ({
    method,
    path: `${API}${path}`,
    summary,
    handle() {
      backend.control(act);
      return NO_CONTENT;
    },
  });
  const pageAction = (method: Method, path: string, summary: string, run: (request: RouteRequest) => Promise<unknown>, body?: BodySchema): Route => ({
    method,
    path: `${API}${path}`,
    summary,
    ...(body ? { body } : {}),
    async handle(request) {
      await run(request);
      return NO_CONTENT;
    },
  });
  const getSong = (): Reply => {
    const info = songInfo(backend.state(), backend.details());
    return info ? ok(info) : NO_CONTENT;
  };
  const getQueue = async (): Promise<Reply> => {
    const queue = await backend.page<QueueResponse | null>("queue");
    return queue ? ok(queue) : NO_CONTENT;
  };
  const num = (value: unknown) => value as number;

  return [
    {
      method: "POST",
      path: "/auth/{id}",
      summary: "Request an access token (asks the user to allow the client the first time)",
      public: true,
      async handle({ params, remoteAddress }) {
        const token = await backend.authorize(params.id!, remoteAddress);
        return token ? ok({ accessToken: token }) : { status: 403 };
      },
    },
    action("POST", "/previous", "Play the previous song", { type: "previous" }),
    action("POST", "/next", "Play the next song", { type: "next" }),
    action("POST", "/play", "Play", { type: "play" }),
    action("POST", "/pause", "Pause", { type: "pause" }),
    action("POST", "/toggle-play", "Toggle play/pause", { type: "toggle" }),
    {
      method: "GET",
      path: `${API}/like-state`,
      summary: "Get the like state",
      handle() {
        const like = backend.state().like;
        return ok({ state: backend.state().track ? { like: "LIKE", dislike: "DISLIKE", none: "INDIFFERENT" }[like] : null });
      },
    },
    pageAction("POST", "/like", "Like the song", () => backend.page("like", "LIKE")),
    pageAction("POST", "/dislike", "Dislike the song", () => backend.page("like", "DISLIKE")),
    {
      method: "POST",
      path: `${API}/seek-to`,
      summary: "Seek to a position",
      body: { seconds: "number" },
      handle({ body }) {
        backend.control({ type: "seek", seconds: num(body.seconds) });
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: `${API}/go-back`,
      summary: "Seek backwards",
      body: { seconds: "number" },
      handle({ body }) {
        backend.control({ type: "seekBy", seconds: -num(body.seconds) });
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: `${API}/go-forward`,
      summary: "Seek forwards",
      body: { seconds: "number" },
      handle({ body }) {
        backend.control({ type: "seekBy", seconds: num(body.seconds) });
        return NO_CONTENT;
      },
    },
    {
      method: "GET",
      path: `${API}/shuffle`,
      summary: "Get the shuffle state",
      handle: () => ok({ state: backend.state().shuffle }),
    },
    action("POST", "/shuffle", "Shuffle the queue", { type: "shuffle" }),
    {
      method: "GET",
      path: `${API}/repeat-mode`,
      summary: "Get the repeat mode",
      handle: () => ok({ mode: REPEAT_NAMES[backend.state().repeat] }),
    },
    {
      method: "POST",
      path: `${API}/switch-repeat`,
      summary: "Advance the repeat mode (NONE → ALL → ONE) `iteration` times",
      body: { iteration: "integer" },
      handle({ body }) {
        const times = ((num(body.iteration) % 3) + 3) % 3;
        for (let i = 0; i < times; i++) backend.control({ type: "repeat" });
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: `${API}/volume`,
      summary: "Set the volume (0–100)",
      body: { volume: "number" },
      handle({ body }) {
        backend.control({ type: "volume", value: num(body.volume) });
        return NO_CONTENT;
      },
    },
    {
      method: "GET",
      path: `${API}/volume`,
      summary: "Get the volume state",
      handle() {
        const { volume, muted } = backend.state();
        return ok({ state: volume, isMuted: muted });
      },
    },
    {
      method: "POST",
      path: `${API}/fullscreen`,
      summary: "Enter or leave fullscreen",
      body: { state: "boolean" },
      async handle({ body }) {
        await backend.setFullscreen(body.state as boolean);
        return NO_CONTENT;
      },
    },
    {
      method: "GET",
      path: `${API}/fullscreen`,
      summary: "Get the fullscreen state",
      handle: async () => ok({ state: await backend.page<boolean>("fullscreen") }),
    },
    action("POST", "/toggle-mute", "Toggle mute", { type: "mute" }),
    { method: "GET", path: `${API}/song-info`, summary: "Get the current song (deprecated alias of /song)", handle: getSong },
    { method: "GET", path: `${API}/song`, summary: "Get the current song", handle: getSong },
    { method: "GET", path: `${API}/queue-info`, summary: "Get the queue (deprecated alias of /queue)", handle: getQueue },
    { method: "GET", path: `${API}/queue`, summary: "Get the queue", handle: getQueue },
    {
      method: "GET",
      path: `${API}/queue/next`,
      summary: "Get the next song in the queue",
      async handle() {
        const items = (await backend.page<QueueResponse | null>("queue"))?.items ?? [];
        const next = renderer(items[items.findIndex((item) => renderer(item)?.selected) + 1]);
        if (!next) return NO_CONTENT;
        return ok({
          title: next.title?.runs?.[0]?.text,
          videoId: next.videoId,
          thumbnail: next.thumbnail,
          lengthText: next.lengthText,
          shortBylineText: next.shortBylineText,
        });
      },
    },
    pageAction(
      "POST",
      "/queue",
      "Add a song to the queue",
      ({ body }) =>
        backend.page("queue:add", { videoId: body.videoId, insertPosition: body.insertPosition ?? "INSERT_AT_END" }),
      { videoId: "string", insertPosition: ["INSERT_AT_END", "INSERT_AFTER_CURRENT_VIDEO"] },
    ),
    pageAction(
      "PATCH",
      "/queue/{index}",
      "Move a song in the queue",
      ({ params, body }) => backend.page("queue:move", { fromIndex: Number(params.index), toIndex: body.toIndex }),
      { toIndex: "integer" },
    ),
    pageAction("DELETE", "/queue/{index}", "Remove a song from the queue", ({ params }) =>
      backend.page("queue:remove", Number(params.index)),
    ),
    pageAction("PATCH", "/queue", "Play the song at a queue index", ({ body }) => backend.page("queue:set-index", body.index), {
      index: "integer",
    }),
    pageAction("DELETE", "/queue", "Clear the queue", () => backend.page("queue:clear")),
    {
      method: "POST",
      path: `${API}/search`,
      summary: "Search \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music (raw innertube response)",
      body: { query: "string", params: "string?", continuation: "string?" },
      handle: async ({ body }) => ok(await backend.page("search", body)),
    },
  ];
}

/** Validates a JSON body against a schema; returns an error message or null. */
export function validateBody(schema: BodySchema, body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "expected a JSON object";
  const record = body as Record<string, unknown>;
  for (const [key, type] of Object.entries(schema)) {
    const value = record[key];
    if (Array.isArray(type)) {
      if (value !== undefined && !type.includes(value as string)) return `${key} must be one of ${type.join(", ")}`;
      continue;
    }
    const optional = (type as string).endsWith("?");
    const base = (type as string).replace("?", "") as FieldType;
    if (value === undefined && optional) continue;
    const valid =
      base === "integer"
        ? Number.isInteger(value) && (value as number) >= 0
        : base === "number"
          ? typeof value === "number" && Number.isFinite(value)
          : typeof value === base;
    if (!valid) return `${key} must be ${base === "integer" ? "a non-negative integer" : `a ${base}`}`;
  }
  return null;
}

/** An OpenAPI 3.1 document for the route table. */
export function openApiDocument(routes: readonly Route[], title: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const params = [...route.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
      name,
      in: "path",
      required: true,
      schema: { type: name === "index" ? "integer" : "string" },
    }));
    const operation: Record<string, unknown> = {
      summary: route.summary,
      ...(route.public ? { security: [] } : {}),
      ...(params.length ? { parameters: params } : {}),
      responses: { 200: { description: "Success" }, 204: { description: "No content" } },
    };
    if (route.body) operation.requestBody = { required: true, content: { "application/json": { schema: jsonSchema(route.body) } } };
    (paths[route.path] ??= {})[route.method.toLowerCase()] = operation;
  }
  paths[`${API}/ws`] = {
    get: {
      summary: "WebSocket with real-time player updates (pass ?token= unless auth is off)",
      responses: { 101: { description: "Switching Protocols" } },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      version: "1.0.0",
      title,
      description: "Get an access token from `/auth/{id}` first to call the endpoints under `/api`.",
    },
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
    security: [{ bearerAuth: [] }],
    paths,
  };
}

function jsonSchema(schema: BodySchema) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, type] of Object.entries(schema)) {
    if (Array.isArray(type)) {
      properties[key] = { type: "string", enum: type };
      continue;
    }
    const name = type as string;
    if (!name.endsWith("?")) required.push(key);
    properties[key] = { type: name.replace("?", "") };
  }
  return { type: "object", properties, required };
}
