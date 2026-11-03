// The core API server: a local REST API + WebSocket to control playback and
// read what's playing (compatible with pear-desktop's v1 clients), plus the
// RPC methods plugins expose. Off until enabled in settings.

import { randomBytes } from "node:crypto";
import { livePosition, type NowPlaying } from "@pear/sdk";
import type { ApiServerConfig } from "@pear/sdk/core-config";
import type { CoreState } from "@pear/sdk/protocol";
import { toJsonSchema } from "@pear/sdk/rpc";
import { errorMessage } from "@pear/sdk/util";
import type { SongDetails } from "@pear/sdk/song-details";
import { type BrowserWindow, dialog } from "electron";
import type { WebSocket } from "ws";
import type { Settings } from "../config.ts";
import type { PageRequests } from "../page-requests.ts";
import type { PlayerMirror } from "../player.ts";
import type { PluginHost } from "../plugins.ts";
import { signToken } from "./jwt.ts";
import { createRoutes } from "./routes.ts";
import { startServer } from "./server.ts";
import { isPaused, REPEAT_NAMES, songInfo } from "./song-info.ts";
import type { Backend, RpcInfo } from "./types.ts";

export interface ApiServerEnvironment {
  settings: Settings;
  plugins: PluginHost;
  player: PlayerMirror;
  requests: PageRequests;
  window: BrowserWindow;
  /** Tells the settings overlay about config and status changes. */
  publish(state: CoreState): void;
}

type Running = Awaited<ReturnType<typeof startServer>>;

/** The "allow this client?" dialog's buttons. */
const ALLOW_BUTTON = 0;
const DENY_BUTTON = 1;
/** Of the generated token secret. */
const SECRET_BYTES = 32;

const networkKey = (c: ApiServerConfig) =>
  JSON.stringify([c.enabled, c.hostname, c.port, c.useHttps && c.certPath, c.useHttps && c.keyPath]);

const log = {
  info: (...args: unknown[]) => console.info("[pear:api]", ...args),
  error: (...args: unknown[]) => console.error("[pear:api]", ...args),
};

export class ApiServer {
  #env: ApiServerEnvironment;
  #server: Running | undefined;
  #listeningOn: string | undefined;
  #status: string | undefined;
  #error: string | undefined;
  #sockets = new Set<WebSocket>();
  #details: SongDetails | undefined;
  #dialogs = new AbortController();
  #generation = 0;
  #lastPosition = -1;

  constructor(env: ApiServerEnvironment) {
    this.#env = env;
    env.player.on("change", (state, previous) => this.#onPlayerChange(state, previous));
  }

  get #config() {
    return this.#env.settings.core("apiServer");
  }

  state(): CoreState {
    return {
      config: this.#config,
      ...(this.#status ? { status: this.#status } : {}),
      ...(this.#error ? { error: this.#error } : {}),
    };
  }

  /** Applies the current config: (re)binds only when the address changes; auth applies per request. */
  async apply() {
    const config = this.#config;
    const key = networkKey(config);
    if (key === this.#listeningOn) return this.#publish();
    this.stop();
    this.#listeningOn = key;
    if (!config.enabled) return this.#publish();
    if (!config.secret) this.#env.settings.setCore("apiServer", { secret: randomBytes(SECRET_BYTES).toString("base64url") });

    const generation = ++this.#generation;
    try {
      const server = await this.#start(config);
      if (generation !== this.#generation) return server.close();
      this.#server = server;
      this.#status = `${config.useHttps ? "https" : "http"}://${config.hostname}:${config.port}`;
      log.info(`listening on ${this.#status}`);
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#error = `couldn't start: ${errorMessage(error)}`;
      log.error(this.#error);
    }
    this.#publish();
  }

  stop() {
    this.#generation++;
    this.#listeningOn = undefined;
    this.#status = undefined;
    this.#error = undefined;
    this.#dialogs.abort();
    this.#dialogs = new AbortController();
    if (!this.#server) return;
    this.#broadcast("PLAYER_STATE_CHANGED", { isPlaying: false, position: Math.floor(livePosition(this.#env.player.state)) });
    this.#server.close();
    this.#server = undefined;
    this.#sockets.clear();
  }

  /** A plugin's `ctx.api.broadcast`. */
  broadcastPluginEvent(plugin: string, event: string, data: unknown) {
    this.#broadcast("PLUGIN_EVENT", { plugin, event, data });
  }

  #publish() {
    this.#env.publish(this.state());
  }

  #broadcast(type: string, data: Record<string, unknown>) {
    if (this.#sockets.size === 0) return;
    const message = JSON.stringify({ type, ...data });
    for (const socket of this.#sockets) if (socket.readyState === socket.OPEN) socket.send(message);
  }

  #song() {
    return songInfo(this.#env.player.state, this.#details);
  }

  async #fetchDetails(videoId: string) {
    // Null while the page runtime isn't up; song info then just lacks the extras.
    const result = await this.#env.requests.songDetails();
    if (result?.videoId === videoId) this.#details = result;
  }

  #onPlayerChange(state: NowPlaying, previous: NowPlaying) {
    if (!this.#server) return;
    const position = Math.floor(state.positionSeconds);
    if (state.track && state.track.videoId !== previous.track?.videoId) {
      const videoId = state.track.videoId;
      this.#lastPosition = 0;
      void this.#fetchDetails(videoId).then(() => {
        if (this.#env.player.state.track?.videoId === videoId) this.#broadcast("VIDEO_CHANGED", { song: this.#song(), position: 0 });
      });
    }
    if (isPaused(state) !== isPaused(previous)) {
      this.#broadcast("PLAYER_STATE_CHANGED", { isPlaying: !isPaused(state), position });
    }
    if (!state.ad && position !== this.#lastPosition) {
      this.#lastPosition = position;
      this.#broadcast("POSITION_CHANGED", { position });
    }
    if (state.volume !== previous.volume || state.muted !== previous.muted) {
      this.#broadcast("VOLUME_CHANGED", { volume: state.volume, muted: state.muted });
    }
    if (state.repeat !== previous.repeat) this.#broadcast("REPEAT_CHANGED", { repeat: REPEAT_NAMES[state.repeat] });
    if (state.shuffle !== previous.shuffle) this.#broadcast("SHUFFLE_CHANGED", { shuffle: state.shuffle });
  }

  #playerInfo(state: NowPlaying) {
    return {
      song: this.#song() ?? undefined,
      isPlaying: !!state.track && !isPaused(state),
      muted: state.muted,
      position: Math.floor(livePosition(state)),
      volume: state.volume,
      repeat: REPEAT_NAMES[state.repeat],
      shuffle: state.shuffle,
    };
  }

  #rpcMethods(): RpcInfo[] {
    return this.#env.plugins.rpcMethods().map(({ plugin, name, method }) => ({
      plugin,
      name,
      ...(method.summary ? { summary: method.summary } : {}),
      input: inputSchema(method.input),
    }));
  }

  #start(config: ApiServerConfig) {
    const { settings, player } = this.#env;
    if (player.state.track) void this.#fetchDetails(player.state.track.videoId);
    const { hostname, port, useHttps, certPath, keyPath } = config;
    return startServer({
      hostname,
      port,
      ...(useHttps && certPath && keyPath ? { https: { certPath, keyPath } } : {}),
      routes: createRoutes(this.#backend()),
      rpcMethods: () => this.#rpcMethods(),
      auth: () => {
        const current = settings.core("apiServer");
        return {
          authStrategy: current.authStrategy,
          secret: current.secret,
          authorizedClients: current.authorizedClients,
        };
      },
      onSocket: (socket) => {
        this.#sockets.add(socket);
        socket.on("close", () => this.#sockets.delete(socket));
        socket.send(JSON.stringify({ type: "PLAYER_INFO", ...this.#playerInfo(player.state) }));
      },
      onError: (error) => log.error(error),
    });
  }

  /** What the routes act on. */
  #backend(): Backend {
    const { player, requests, window, plugins } = this.#env;
    const page = <T,>(event: string, payload?: unknown) => requests.request<T>("core", event, payload);
    return {
      state: () => player.state,
      details: () => this.#details,
      control: (action) => player.control(action),
      page,
      async setFullscreen(fullscreen) {
        window.setFullScreen(fullscreen);
        await page("fullscreen:set", fullscreen);
      },
      authorize: (id, remoteAddress) => this.#authorize(id, remoteAddress),
      rpcMethods: () => this.#rpcMethods(),
      async callRpc(plugin, method, body) {
        const result = await plugins.callRpc(plugin, method, body);
        if (!result.ok) return { status: result.status, body: { error: result.error } };
        return result.value === undefined ? { status: 204 } : { status: 200, body: result.value };
      },
    };
  }

  /** A token for the client, once it is (or the user makes it) an authorized one; null when denied. */
  async #authorize(id: string, remoteAddress: string) {
    if (id.includes(",")) return null;
    const { settings } = this.#env;
    if (!settings.core("apiServer").authorizedClients.includes(id)) {
      if (!(await this.#userAllows(id, remoteAddress))) return null;
      this.#addClient(id);
    }
    return signToken({ id, iat: Math.floor(Date.now() / 1000) }, settings.core("apiServer").secret);
  }

  async #userAllows(id: string, remoteAddress: string) {
    if (this.#config.authStrategy !== "AUTH_AT_FIRST") return true;
    // pear-desktop's translated texts (the keys its translators already filled in).
    const { t } = this.#env.plugins;
    const { response } = await dialog.showMessageBox(this.#env.window, {
      type: "question",
      title: t("plugins.api-server.dialog.request.title", "API authorization request"),
      message: t("plugins.api-server.dialog.request.message", "Allow {{ID}} ({{origin}}) to access the API?", {
        ID: id,
        origin: remoteAddress,
      }),
      detail: t("plugins.api-server.dialog.request.detail", "You can revoke access in the API server settings."),
      buttons: [
        t("plugins.api-server.dialog.request.buttons.allow", "Allow"),
        t("plugins.api-server.dialog.request.buttons.deny", "Deny"),
      ],
      defaultId: DENY_BUTTON,
      cancelId: DENY_BUTTON,
      signal: this.#dialogs.signal,
    });
    return response === ALLOW_BUTTON;
  }

  #addClient(id: string) {
    const { settings } = this.#env;
    const clients = settings.core("apiServer").authorizedClients;
    if (!clients.includes(id)) settings.setCore("apiServer", { authorizedClients: [...clients, id] });
    this.#publish();
  }
}

/** The input's JSON schema for the OpenAPI document; parts JSON schema can't express are left out. */
function inputSchema(input: Parameters<typeof toJsonSchema>[0]) {
  try {
    return toJsonSchema(input, { errorMode: "ignore" });
  } catch {
    return undefined;
  }
}
