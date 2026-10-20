// Page-side glue: adapts YTM's player to the session's PlayerPort and owns the
// current session (hosting, joined or none) for the UI.

import { livePosition, type PageContext } from "@pear/sdk";
import type { Translate } from "@pear/sdk/i18n";
import { hostRoom, joinRoom, type Transport } from "../peer.ts";
import { normalizeCode, type Permission } from "../protocol.ts";
import { GuestSession, HostSession, type PlayerPort, type TrackInfo } from "../session.ts";

export interface TogetherConfig {
  displayName: string;
  defaultPermission: Permission;
}

export interface TogetherCommands {
  [name: string]: (...args: any[]) => unknown;
  trackInfo(videoId: string): Promise<TrackInfo>;
  copy(text: string): void;
}

export type Ctx = PageContext<TogetherConfig, TogetherCommands>;

export type Mode =
  | { kind: "idle"; message?: string }
  | { kind: "busy"; label: string }
  | { kind: "host"; session: HostSession; code: string }
  | { kind: "guest"; session: GuestSession; code: string };

export function playerPort(ctx: Ctx): PlayerPort {
  const player = ctx.player;
  return {
    snapshot() {
      const state = player.state;
      const track = state.track;
      if (!track) return null;
      const video = player.video();
      const snapshot = {
        videoId: track.videoId,
        title: track.title,
        artist: track.artist,
        durationSeconds: track.durationSeconds,
        playing: state.status === "playing" || state.status === "buffering",
        position: video && !state.ad ? video.currentTime : livePosition(state),
        ad: state.ad,
        ended: state.status === "ended",
      };
      return track.artworkUrl ? { ...snapshot, artworkUrl: track.artworkUrl } : snapshot;
    },
    load(videoId) {
      if (player.state.track?.videoId === videoId) return;
      // YTM's own navigation: updates the player page and its queue like a click would.
      ctx.$("app")?.dispatchEvent(
        new CustomEvent("yt-navigate", { bubbles: true, composed: true, detail: { endpoint: { watchEndpoint: { videoId } } } }),
      );
    },
    play: () => player.control({ type: "play" }),
    pause: () => player.control({ type: "pause" }),
    seek: (seconds) => player.control({ type: "seek", seconds }),
    next: () => player.control({ type: "next" }),
    subscribe(listener) {
      const unsubscribers = [
        player.on("trackChange", listener),
        player.on("statusChange", listener),
        player.on("adChange", listener),
      ];
      const controller = new AbortController();
      void player.ready().then(() => {
        const video = player.video();
        video?.addEventListener("seeked", listener, { signal: controller.signal });
      });
      return () => {
        controller.abort();
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
  };
}

export class Together {
  mode: Mode = { kind: "idle" };
  #ctx: Ctx;
  #transport: Transport | undefined;
  #sessionCleanup: (() => void) | undefined;
  #listeners = new Set<() => void>();
  #toastListeners = new Set<(text: string) => void>();

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
  }

  /** The page's translator (ctx.t), for the UI. */
  t: Translate = (key, fallback, vars) => this.#ctx.t(key, fallback, vars);

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  onToast(listener: (text: string) => void) {
    this.#toastListeners.add(listener);
    return () => void this.#toastListeners.delete(listener);
  }

  get name() {
    return this.#ctx.config.displayName.trim() || defaultName();
  }

  setName(name: string) {
    this.#ctx.setConfig({ displayName: name });
    if (this.mode.kind === "host") this.mode.session.setName(name || defaultName());
  }

  async host() {
    if (this.mode.kind === "busy") return;
    this.#set({ kind: "busy", label: this.t("plugins.music-together.ui.starting", "Starting session…") });
    const session = new HostSession({
      player: playerPort(this.#ctx),
      name: this.name,
      permission: this.#ctx.config.defaultPermission,
      resolve: (videoId) => this.#ctx.host.invoke("trackInfo", videoId),
      t: this.t,
    });
    try {
      const transport = await hostRoom((link) => session.addLink(link));
      if (this.#ctx.signal.aborted) return transport.close();
      this.#attach(transport, session);
      this.#set({ kind: "host", session, code: transport.code });
    } catch (error) {
      session.close();
      this.#set({ kind: "idle", message: this.t("plugins.music-together.ui.host-failed", "Couldn't start a session: {{error}}", { error: messageOf(error) }) });
    }
  }

  async join(input: string) {
    const code = normalizeCode(input);
    if (!code) return this.#set({ kind: "idle", message: this.t("plugins.music-together.ui.invalid-code", "That doesn't look like a session code") });
    this.#set({ kind: "busy", label: this.t("plugins.music-together.ui.joining", "Joining…") });
    try {
      const transport = await joinRoom(code);
      if (this.#ctx.signal.aborted) return transport.close();
      const session = new GuestSession({ link: transport.link, player: playerPort(this.#ctx), name: this.name, t: this.t });
      this.#attach(transport, session);
      this.#set({ kind: "guest", session, code });
    } catch (error) {
      this.#set({ kind: "idle", message: this.t("plugins.music-together.ui.join-failed", "Couldn't join: {{error}}", { error: messageOf(error) }) });
    }
  }

  /** Ends hosting or leaves the session. */
  stop(message?: string) {
    const mode = this.mode;
    if (mode.kind === "host") mode.session.close();
    if (mode.kind === "guest") mode.session.leave();
    this.#detach();
    this.#set(message ? { kind: "idle", message } : { kind: "idle" });
  }

  copy(text: string) {
    void this.#ctx.host.invoke("copy", text);
  }

  #attach(transport: Transport, session: HostSession | GuestSession) {
    this.#transport = transport;
    const unsubscribers = [
      session.subscribe(() => {
        if (session instanceof GuestSession && session.status === "closed") {
          this.#detach();
          return this.#set({ kind: "idle", message: session.closeReason });
        }
        this.#emit();
      }),
      session.onToast((text) => this.#toast(text)),
    ];
    this.#sessionCleanup = () => unsubscribers.forEach((u) => u());
  }

  #detach() {
    this.#sessionCleanup?.();
    this.#sessionCleanup = undefined;
    this.#transport?.close();
    this.#transport = undefined;
  }

  #set(mode: Mode) {
    this.mode = mode;
    this.#emit();
  }

  #emit() {
    for (const listener of this.#listeners) listener();
  }

  #toast(text: string) {
    for (const listener of this.#toastListeners) listener(text);
  }
}

let fallbackName: string | undefined;
function defaultName() {
  return (fallbackName ??= `Guest ${Math.floor(1000 + Math.random() * 9000)}`);
}

function messageOf(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\.$/, "") || "unknown error";
}
