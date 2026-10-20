// The connection to Discord and the activity shown there.

import type { HostContextOf } from "@pear/sdk";
import type { SongDetails } from "@pear/sdk/song-details";
import { errorMessage } from "@pear/sdk/util";
import { Client, type SetActivity } from "@xhayper/discord-rpc";
import { buildActivity, isPaused, needsUpdate } from "./activity.ts";
import type { schema } from "./schema.ts";

/** The Rich Presence application registered by the pear-desktop team. */
const CLIENT_ID = "1177081335727267940";
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 60_000;
// Discord allows 5 activity updates per 20 s.
const MIN_UPDATE_INTERVAL_MS = 4_000;

type Ctx = HostContextOf<typeof schema>;

// The timers are re-armed all the time (every position tick), so they're kept by hand.
export class Presence {
  #ctx: Ctx;
  #client: Client | undefined;
  #ready = false;
  #stopped = false;
  #retryDelay = RETRY_MIN_MS;
  /** The "can't reach Discord" warning was logged; not again until it connects. */
  #warned = false;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #updateTimer: ReturnType<typeof setTimeout> | undefined;
  #pauseTimer: ReturnType<typeof setTimeout> | undefined;
  #shown: SetActivity | null = null;
  #lastSentAt = 0;
  #details: SongDetails | undefined;
  // Cleared after a long pause: stays hidden until playback resumes.
  #idle = false;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
    ctx.player.on("change", (state, previous) => {
      if (state.track && state.track.videoId !== previous.track?.videoId) void this.#fetchDetails(state.track.videoId);
      if (isPaused(state) !== isPaused(previous) || state.track !== previous.track) this.#armPauseTimeout();
      // Position ticks only matter when they drift from the shown timestamps (needsUpdate).
      this.#update();
    });
    if (ctx.player.state.track) void this.#fetchDetails(ctx.player.state.track.videoId);
    this.#armPauseTimeout();
    this.#showConnection();
    this.#connect();
  }

  /** Applies a config change. */
  refresh() {
    this.#armPauseTimeout();
    if (this.#ctx.config.autoReconnect && !this.#client) this.#scheduleRetry();
    this.#update();
  }

  /** The "Connect" action: try now instead of at the next retry. */
  connectNow() {
    if (this.#ready || this.#client) return;
    this.#ctx.clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#retryDelay = RETRY_MIN_MS;
    this.#warned = false;
    this.#connect();
  }

  /** The "Clear activity" action. Hidden like after a long pause: back with the next track or when playback resumes. */
  clear() {
    this.#ctx.clearTimeout(this.#pauseTimer);
    this.#idle = true;
    this.#shown = null;
    if (this.#ready && this.#client?.user) void this.#client.user.clearActivity().catch(() => {});
  }

  stop() {
    this.#stopped = true;
    const current = this.#client;
    this.#client = undefined;
    if (!current) return;
    if (this.#ready) void current.user?.clearActivity().catch(() => {});
    dispose(current);
  }

  #scheduleRetry() {
    if (this.#stopped || !this.#ctx.config.autoReconnect || this.#retryTimer) return;
    this.#retryTimer = this.#ctx.setTimeout(() => {
      this.#retryTimer = undefined;
      this.#connect();
    }, this.#retryDelay);
    this.#retryDelay = Math.min(this.#retryDelay * 2, RETRY_MAX_MS);
  }

  // pear-desktop's connected / disconnected indicator, on the settings card.
  #showConnection() {
    const { t } = this.#ctx;
    const status = this.#ready
      ? t("plugins.discord.backend.connected", "Connected to Discord")
      : t("plugins.discord.backend.disconnected", "Disconnected from Discord");
    this.#ctx.setStatus(status);
  }

  #connect() {
    // The library leaves listeners behind after a failed login: use a fresh client per attempt.
    const attempt = new Client({ clientId: CLIENT_ID });
    this.#client = attempt;
    attempt.on("ready", () => {
      if (this.#client === attempt) this.#onReady();
    });
    attempt.on("disconnected", () => {
      if (this.#client !== attempt) return;
      if (this.#ready) this.#ctx.log.info("disconnected from Discord");
      this.#lost(attempt);
    });
    attempt.login().catch((error: unknown) => {
      if (this.#client !== attempt) return;
      this.#warnUnreachable(error);
      this.#lost(attempt);
    });
  }

  #onReady() {
    this.#ready = true;
    this.#retryDelay = RETRY_MIN_MS;
    this.#warned = false;
    this.#shown = null;
    this.#ctx.log.info("connected to Discord");
    this.#showConnection();
    this.#update();
  }

  /** The client disconnected or never connected: drop it and try again later. */
  #lost(attempt: Client) {
    this.#ready = false;
    this.#client = undefined;
    dispose(attempt);
    this.#showConnection();
    this.#scheduleRetry();
  }

  #warnUnreachable(error: unknown) {
    if (this.#warned) return;
    this.#warned = true;
    const retrying = this.#ctx.config.autoReconnect ? "; retrying in the background" : "";
    this.#ctx.log.warn(`can't reach Discord (${errorMessage(error)})${retrying}`);
  }

  #send() {
    this.#ctx.clearTimeout(this.#updateTimer);
    this.#updateTimer = undefined;
    const user = this.#ready ? this.#client?.user : undefined;
    if (!user) return;
    const next = this.#idle ? null : buildActivity(this.#ctx.player.state, this.#details, this.#ctx.config);
    if (!needsUpdate(this.#shown, next)) return;
    this.#shown = next;
    this.#lastSentAt = Date.now();
    const request = next ? user.setActivity(next) : user.clearActivity();
    request.catch((error: unknown) => this.#ctx.log.warn("couldn't update the activity", error));
  }

  /** Sends now, or as soon as Discord's rate limit allows (coalescing bursts). */
  #update() {
    if (this.#updateTimer) return;
    const wait = this.#lastSentAt + MIN_UPDATE_INTERVAL_MS - Date.now();
    if (wait <= 0) this.#send();
    else this.#updateTimer = this.#ctx.setTimeout(() => this.#send(), wait);
  }

  #armPauseTimeout() {
    this.#ctx.clearTimeout(this.#pauseTimer);
    this.#pauseTimer = undefined;
    this.#idle = false;
    const { config, player } = this.#ctx;
    if (!player.state.track || !isPaused(player.state) || !config.activityTimeoutEnabled) return;
    this.#pauseTimer = this.#ctx.setTimeout(() => {
      this.#idle = true;
      this.#update();
    }, config.activityTimeoutSeconds * 1000);
  }

  async #fetchDetails(videoId: string) {
    // Null while the page isn't up: the plain title and artist show meanwhile.
    const result = await this.#ctx.player.details();
    if (result?.videoId === videoId && this.#ctx.player.state.track?.videoId === videoId) {
      this.#details = result;
      this.#update();
    }
  }
}

function dispose(client: Client) {
  client.removeAllListeners();
  void client.destroy().catch(() => {});
}
