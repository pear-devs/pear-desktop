// Local REST API + WebSocket to control playback and read what's playing,
// compatible with pear-desktop's API server (v1) clients.

import { randomBytes } from "node:crypto";
import { config, definePlugin, livePosition, type NowPlaying } from "@pear/sdk";
import { readSongDetails, type SongDetails } from "@pear/sdk/song-details";
import { dialog } from "electron";
import type { WebSocket } from "ws";
import { signToken } from "./jwt.ts";
import { createRoutes, isPaused, REPEAT_NAMES, songInfo, type QueueItem } from "./routes.ts";
import { startServer } from "./server.ts";

interface QueueElement extends HTMLElement {
  dispatch(action: { type: string; payload?: unknown }): void;
  queue?: {
    getItems(): QueueItem[];
    autoPlaying?: boolean;
    continuation?: string;
    store: { store: { dispatch(action: { type: string; payload?: unknown }): void; getState(): QueueStoreState } };
  };
}
interface QueueStoreState {
  queue: { items: QueueItem[]; queueContextParams: unknown; nextQueueItemId: unknown };
}
interface NetworkManagerApp extends HTMLElement {
  networkManager: { fetch<T = unknown>(path: string, body: unknown): Promise<T> };
}

const parseClients = (value: string) =>
  value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

const networkKey = (c: { hostname: string; port: number; useHttps: boolean; certPath: string; keyPath: string }) =>
  JSON.stringify([c.hostname, c.port, c.useHttps && c.certPath, c.useHttps && c.keyPath]);

// What the running server is bound to; other config changes apply live.
let listeningOn: string | undefined;

export default definePlugin({
  id: "api-server",
  name: "API server",
  description: "A local HTTP and WebSocket API to control playback and read the current song from other apps.",
  config: {
    hostname: config.string("0.0.0.0", {
      label: "Hostname",
      description: "0.0.0.0 accepts connections from your network; 127.0.0.1 only from this computer.",
    }),
    port: config.number(26538, { label: "Port", min: 1, max: 65535, step: 1 }),
    authStrategy: config.select(
      "AUTH_AT_FIRST",
      [
        { value: "AUTH_AT_FIRST", label: "Ask when a new client connects" },
        { value: "NONE", label: "None (anyone who can reach the port)" },
      ],
      { label: "Authorization" },
    ),
    authorizedClients: config.string("", {
      label: "Authorized clients",
      description: "Comma-separated client IDs that may use the API. Remove one to revoke it.",
    }),
    secret: config.string("", {
      label: "Token secret",
      secret: true,
      description: "Signs access tokens; changing it signs every client out. Generated when empty.",
    }),
    useHttps: config.bool(false, { label: "Use HTTPS" }),
    certPath: config.string("", { label: "Certificate file", placeholder: "/path/to/cert.pem" }),
    keyPath: config.string("", { label: "Private key file", placeholder: "/path/to/key.pem" }),
  },
  host: {
    async start(ctx) {
      listeningOn = networkKey(ctx.config);
      ctx.onCleanup(() => (listeningOn = undefined));
      if (!ctx.config.secret) ctx.setConfig({ secret: randomBytes(32).toString("base64url") });

      let details: SongDetails | undefined;
      const fetchDetails = async (videoId: string) => {
        try {
          const result = await ctx.request<SongDetails | null>("details", undefined, { timeout: 5000 });
          if (result?.videoId === videoId) details = result;
        } catch {
          // The page part isn't up yet; song info just lacks the extras.
        }
      };

      const sockets = new Set<WebSocket>();
      const broadcast = (type: string, data: Record<string, unknown>) => {
        const message = JSON.stringify({ type, ...data });
        for (const socket of sockets) if (socket.readyState === socket.OPEN) socket.send(message);
      };
      const song = () => songInfo(ctx.player.state, details);
      const playerInfo = (state: NowPlaying) => ({
        song: song() ?? undefined,
        isPlaying: !!state.track && !isPaused(state),
        muted: state.muted,
        position: Math.floor(livePosition(state)),
        volume: state.volume,
        repeat: REPEAT_NAMES[state.repeat],
        shuffle: state.shuffle,
      });

      let lastPosition = -1;
      ctx.player.on("change", (state, previous) => {
        const position = Math.floor(state.positionSeconds);
        if (state.track && state.track.videoId !== previous.track?.videoId) {
          const videoId = state.track.videoId;
          lastPosition = 0;
          void fetchDetails(videoId).then(() => {
            if (ctx.player.state.track?.videoId === videoId) broadcast("VIDEO_CHANGED", { song: song(), position: 0 });
          });
        }
        if (isPaused(state) !== isPaused(previous)) {
          broadcast("PLAYER_STATE_CHANGED", { isPlaying: !isPaused(state), position });
        }
        if (!state.ad && position !== lastPosition) {
          lastPosition = position;
          broadcast("POSITION_CHANGED", { position });
        }
        if (state.volume !== previous.volume || state.muted !== previous.muted) {
          broadcast("VOLUME_CHANGED", { volume: state.volume, muted: state.muted });
        }
        if (state.repeat !== previous.repeat) broadcast("REPEAT_CHANGED", { repeat: REPEAT_NAMES[state.repeat] });
        if (state.shuffle !== previous.shuffle) broadcast("SHUFFLE_CHANGED", { shuffle: state.shuffle });
      });
      if (ctx.player.state.track) void fetchDetails(ctx.player.state.track.videoId);

      const dialogs = new AbortController();
      ctx.onCleanup(() => dialogs.abort());

      const routes = createRoutes({
        state: () => ctx.player.state,
        details: () => details,
        control: (action) => ctx.player.control(action),
        page: (event, payload) => ctx.request(event, payload),
        async setFullscreen(fullscreen) {
          ctx.window.setFullScreen(fullscreen);
          await ctx.request("fullscreen:set", fullscreen);
        },
        async authorize(id, remoteAddress) {
          if (id.includes(",")) return null;
          if (!parseClients(ctx.config.authorizedClients).includes(id)) {
            if (ctx.config.authStrategy === "AUTH_AT_FIRST") {
              const { response } = await dialog.showMessageBox(ctx.window, {
                type: "question",
                title: "API server",
                message: `Allow “${id}” to control Pear Desktop?`,
                detail: `The request came from ${remoteAddress}. You can revoke access in the API server settings.`,
                buttons: ["Allow", "Deny"],
                defaultId: 1,
                cancelId: 1,
                signal: dialogs.signal,
              });
              if (response !== 0) return null;
            }
            const clients = parseClients(ctx.config.authorizedClients);
            if (!clients.includes(id)) ctx.setConfig({ authorizedClients: [...clients, id].join(", ") });
          }
          return signToken({ id, iat: Math.floor(Date.now() / 1000) }, ctx.config.secret);
        },
      });

      const { hostname, port, useHttps, certPath, keyPath } = ctx.config;
      const server = await startServer({
        hostname,
        port,
        ...(useHttps && certPath && keyPath ? { https: { certPath, keyPath } } : {}),
        routes,
        auth: () => ({
          authStrategy: ctx.config.authStrategy,
          secret: ctx.config.secret,
          authorizedClients: parseClients(ctx.config.authorizedClients),
        }),
        onSocket(socket) {
          sockets.add(socket);
          socket.on("close", () => sockets.delete(socket));
          socket.send(JSON.stringify({ type: "PLAYER_INFO", ...playerInfo(ctx.player.state) }));
        },
        onError: (error) => ctx.log.error(error),
      });
      ctx.log.info(`listening on ${useHttps ? "https" : "http"}://${hostname}:${port}`);

      return () => {
        broadcast("PLAYER_STATE_CHANGED", { isPlaying: false, position: Math.floor(livePosition(ctx.player.state)) });
        server.close();
      };
    },
    // Auth settings are read per request; only rebinding needs a restart.
    onConfigChange: (config) => (networkKey(config) === listeningOn ? undefined : "restart"),
  },
  page: {
    start(ctx) {
      const handle = ctx.host.handle;
      const queue = () => ctx.$<QueueElement>("queue");
      // Renderer data goes over IPC: drop anything that isn't plain JSON.
      const plain = <T,>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

      handle("details", () => (ctx.player.api ? readSongDetails(ctx.player.api) : null));
      handle("like", (status) => {
        const buttons = ctx.$<HTMLElement & { updateLikeStatus?(status: string): void }>("player_bar.like_buttons");
        buttons?.updateLikeStatus?.(status as string);
      });
      handle("fullscreen", () => !!ctx.$("integrations.fullscreen"));
      handle("fullscreen:set", (fullscreen) => {
        if (!!ctx.$("integrations.fullscreen") === fullscreen) return;
        ctx.$(fullscreen ? "integrations.fullscreen_button" : "integrations.exit_fullscreen_button")?.click();
      });

      handle("queue", () => {
        const api = queue()?.queue;
        if (!api) return null;
        return plain({ items: api.getItems(), autoPlaying: api.autoPlaying, continuation: api.continuation });
      });
      handle("queue:add", async (payload) => {
        const { videoId, insertPosition } = payload as { videoId: string; insertPosition: string };
        const element = queue();
        const store = element?.queue?.store.store;
        const app = ctx.$<NetworkManagerApp>("app");
        if (!element || !store || !app) throw new Error("queue unavailable");
        const result = await app.networkManager.fetch<{ queueDatas?: { content?: unknown }[] }>("/music/get_queue", {
          queueContextParams: store.getState().queue.queueContextParams,
          queueInsertPosition: insertPosition,
          videoIds: [videoId],
        });
        if (!Array.isArray(result?.queueDatas)) throw new Error("\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music returned no queue items");
        const { items, nextQueueItemId } = store.getState().queue;
        const selected = items.findIndex(
          (item) =>
            (item.playlistPanelVideoRenderer ??
              item.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer)?.selected,
        );
        element.dispatch({
          type: "ADD_ITEMS",
          payload: {
            nextQueueItemId,
            index: insertPosition === "INSERT_AFTER_CURRENT_VIDEO" ? selected + 1 || items.length : items.length,
            items: result.queueDatas.map((data) => data?.content).filter(Boolean),
            shuffleEnabled: false,
            shouldAssignIds: true,
          },
        });
      });
      handle("queue:move", (payload) => queue()?.dispatch({ type: "MOVE_ITEM", payload }));
      handle("queue:remove", (index) => queue()?.dispatch({ type: "REMOVE_ITEM", payload: index }));
      handle("queue:set-index", (index) => queue()?.dispatch({ type: "SET_INDEX", payload: index }));
      handle("queue:clear", () => {
        const element = queue();
        element?.queue?.store.store.dispatch({ type: "SET_PLAYER_PAGE_INFO", payload: { open: false } });
        element?.dispatch({ type: "CLEAR" });
      });
      handle("search", async (payload) => {
        const { query, params, continuation } = payload as { query: string; params?: string; continuation?: string };
        const app = ctx.$<NetworkManagerApp>("app");
        const searchBox = ctx.$<HTMLElement & { getSearchboxStats?(): unknown }>("nav_bar.search_box");
        if (!app) throw new Error("\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music isn't ready");
        return plain(
          await app.networkManager.fetch("/search", { query, params, continuation, suggestStats: searchBox?.getSearchboxStats?.() }),
        );
      });
    },
    onConfigChange() {},
  },
});
