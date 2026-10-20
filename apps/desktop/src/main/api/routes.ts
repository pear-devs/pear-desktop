// The REST routes of the original pear-desktop API server (v1), as a table
// that drives both request dispatch and the OpenAPI document.

import type { LikeStatus, PlayerAction } from "@pear/sdk";
import { REPEAT_NAMES, songInfo } from "./song-info.ts";
import type { Backend, BodySchema, Method, QueueItem, QueueResponse, Reply, Route, RouteRequest } from "./types.ts";

export const API_VERSION = "v1";
export const API = `/api/${API_VERSION}`;

/** How many repeat modes `switch-repeat` cycles through (NONE → ALL → ONE). */
const REPEAT_MODES = 3;

const LIKE_STATES: Record<LikeStatus, "LIKE" | "DISLIKE" | "INDIFFERENT"> = { like: "LIKE", dislike: "DISLIKE", none: "INDIFFERENT" };

const NO_CONTENT: Reply = { status: 204 };
const ok = (body: unknown): Reply => ({ status: 200, body });

export const rpcPath = (plugin: string, method: string) => `${API}/plugins/${plugin}/${method}`;

const renderer = (item: QueueItem | undefined) =>
  item?.playlistPanelVideoRenderer ?? item?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;

/** A deprecated path that answers like `route`. */
function alias(path: string, route: Route): Route {
  return { ...route, path, summary: `${route.summary} (deprecated alias of ${route.path.slice(API.length)})` };
}

interface PageCommand {
  method: Method;
  path: string;
  summary: string;
  body?: BodySchema;
  /** Asks the page part; the reply is "no content" once it answers. */
  run(request: RouteRequest): Promise<unknown>;
}

export function createRoutes(backend: Backend): Route[] {
  /** Sends a fixed player action. */
  const playerControl = (path: string, summary: string, action: PlayerAction): Route => ({
    method: "POST",
    path,
    summary,
    handle() {
      backend.control(action);
      return NO_CONTENT;
    },
  });
  /** Sends the player action made from one number in the body. */
  const bodyAction = (path: string, summary: string, field: string, toAction: (value: number) => PlayerAction): Route => ({
    method: "POST",
    path,
    summary,
    body: { [field]: "number" },
    handle({ body }) {
      backend.control(toAction(Number(body[field])));
      return NO_CONTENT;
    },
  });
  const pageCommand = ({ method, path, summary, body, run }: PageCommand): Route => ({
    method,
    path,
    summary,
    ...(body ? { body } : {}),
    async handle(request) {
      await run(request);
      return NO_CONTENT;
    },
  });
  const queue = () => backend.page<QueueResponse | null>("queue");

  const song: Route = {
    method: "GET",
    path: `${API}/song`,
    summary: "Get the current song",
    handle() {
      const info = songInfo(backend.state(), backend.details());
      return info ? ok(info) : NO_CONTENT;
    },
  };
  const queueRoute: Route = {
    method: "GET",
    path: `${API}/queue`,
    summary: "Get the queue",
    async handle() {
      const current = await queue();
      return current ? ok(current) : NO_CONTENT;
    },
  };

  return [
    {
      method: "POST",
      // Outside /api, like the original.
      path: "/auth/{id}",
      summary: "Request an access token (asks the user to allow the client the first time)",
      public: true,
      async handle({ params, remoteAddress }) {
        const token = await backend.authorize(params.id!, remoteAddress);
        return token ? ok({ accessToken: token }) : { status: 403 };
      },
    },
    playerControl(`${API}/previous`, "Play the previous song", { type: "previous" }),
    playerControl(`${API}/next`, "Play the next song", { type: "next" }),
    playerControl(`${API}/play`, "Play", { type: "play" }),
    playerControl(`${API}/pause`, "Pause", { type: "pause" }),
    playerControl(`${API}/toggle-play`, "Toggle play/pause", { type: "toggle" }),
    {
      method: "GET",
      path: `${API}/like-state`,
      summary: "Get the like state",
      handle() {
        const { track, like } = backend.state();
        return ok({ state: track ? LIKE_STATES[like] : null });
      },
    },
    pageCommand({ method: "POST", path: `${API}/like`, summary: "Like the song", run: () => backend.page("like", "LIKE") }),
    pageCommand({ method: "POST", path: `${API}/dislike`, summary: "Dislike the song", run: () => backend.page("like", "DISLIKE") }),
    bodyAction(`${API}/seek-to`, "Seek to a position", "seconds", (seconds) => ({ type: "seek", seconds })),
    bodyAction(`${API}/go-back`, "Seek backwards", "seconds", (seconds) => ({ type: "seekBy", seconds: -seconds })),
    bodyAction(`${API}/go-forward`, "Seek forwards", "seconds", (seconds) => ({ type: "seekBy", seconds })),
    {
      method: "GET",
      path: `${API}/shuffle`,
      summary: "Get the shuffle state",
      handle: () => ok({ state: backend.state().shuffle }),
    },
    playerControl(`${API}/shuffle`, "Shuffle the queue", { type: "shuffle" }),
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
        const times = Number(body.iteration) % REPEAT_MODES;
        for (let i = 0; i < times; i++) backend.control({ type: "repeat" });
        return NO_CONTENT;
      },
    },
    bodyAction(`${API}/volume`, "Set the volume (0–100)", "volume", (value) => ({ type: "volume", value })),
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
        await backend.setFullscreen(body.state === true);
        return NO_CONTENT;
      },
    },
    {
      method: "GET",
      path: `${API}/fullscreen`,
      summary: "Get the fullscreen state",
      handle: async () => ok({ state: await backend.page<boolean>("fullscreen") }),
    },
    playerControl(`${API}/toggle-mute`, "Toggle mute", { type: "mute" }),
    alias(`${API}/song-info`, song),
    song,
    alias(`${API}/queue-info`, queueRoute),
    queueRoute,
    {
      method: "GET",
      path: `${API}/queue/next`,
      summary: "Get the next song in the queue",
      async handle() {
        const items = (await queue())?.items ?? [];
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
    pageCommand({
      method: "POST",
      path: `${API}/queue`,
      summary: "Add a song to the queue",
      body: { videoId: "string", insertPosition: ["INSERT_AT_END", "INSERT_AFTER_CURRENT_VIDEO"] },
      run: ({ body }) => backend.page("queue:add", { videoId: body.videoId, insertPosition: body.insertPosition ?? "INSERT_AT_END" }),
    }),
    pageCommand({
      method: "PATCH",
      path: `${API}/queue/{index}`,
      summary: "Move a song in the queue",
      body: { toIndex: "integer" },
      run: ({ params, body }) => backend.page("queue:move", { fromIndex: Number(params.index), toIndex: body.toIndex }),
    }),
    pageCommand({
      method: "DELETE",
      path: `${API}/queue/{index}`,
      summary: "Remove a song from the queue",
      run: ({ params }) => backend.page("queue:remove", Number(params.index)),
    }),
    pageCommand({
      method: "PATCH",
      path: `${API}/queue`,
      summary: "Play the song at a queue index",
      body: { index: "integer" },
      run: ({ body }) => backend.page("queue:set-index", body.index),
    }),
    pageCommand({ method: "DELETE", path: `${API}/queue`, summary: "Clear the queue", run: () => backend.page("queue:clear") }),
    {
      method: "GET",
      path: `${API}/plugins`,
      summary: "List the RPC methods of the running plugins",
      handle: () =>
        ok(backend.rpcMethods().map(({ plugin, name, summary }) => ({ plugin, method: name, summary, path: rpcPath(plugin, name) }))),
    },
    {
      method: "POST",
      path: `${API}/plugins/{plugin}/{method}`,
      summary: "Call a plugin's RPC method (see the per-method entries)",
      body: "json",
      handle: ({ params, body }) => backend.callRpc(params.plugin!, params.method!, body),
    },
    {
      method: "POST",
      path: `${API}/search`,
      summary: "Search \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music (raw innertube response)",
      body: { query: "string", params: "string?", continuation: "string?" },
      handle: async ({ body }) => ok(await backend.page("search", body)),
    },
  ];
}
