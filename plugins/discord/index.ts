// Discord Rich Presence. Connects to the local Discord client over IPC and
// quietly keeps retrying (with backoff) while Discord isn't running.

import { config, definePlugin } from "@pear/sdk";
import { readSongDetails, type SongDetails } from "@pear/sdk/song-details";
import { Client, type SetActivity } from "@xhayper/discord-rpc";
import { buildActivity, isPaused, needsUpdate } from "./activity.ts";

/** The Rich Presence application registered by the pear-desktop team. */
const CLIENT_ID = "1177081335727267940";
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 60_000;
// Discord allows 5 activity updates per 20 s.
const MIN_UPDATE_INTERVAL_MS = 4_000;

// Re-applies the config to the running instance.
let refresh: (() => void) | undefined;
/** The running instance's settings actions. */
const controls = new WeakMap<object, { connect(): void; clear(): void }>();

export default definePlugin({
  id: "discord",
  name: "Discord Rich Presence",
  description: "Show your friends what you're listening to in your Discord status.",
  config: {
    activityType: config.select(
      "listening",
      [
        { value: "listening", label: "Listening to" },
        { value: "playing", label: "Playing" },
        { value: "watching", label: "Watching" },
      ],
      { label: "Activity type" },
    ),
    statusDisplayType: config.select(
      "details",
      [
        { value: "details", label: "Song title" },
        { value: "state", label: "Artist" },
        { value: "name", label: "App name" },
      ],
      { label: "Status text", description: "What your member-list status shows after the activity type." },
    ),
    playButton: config.bool(true, { label: "“Play on \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music” button" }),
    hideGitHubButton: config.bool(false, { label: "Hide the GitHub button" }),
    hideDurationLeft: config.bool(false, { label: "Hide elapsed and remaining time" }),
    hideWhenPaused: config.bool(false, { label: "Hide while paused" }),
    activityTimeoutEnabled: config.bool(true, {
      label: "Clear after a long pause",
      description: "Remove the activity when playback stays paused.",
    }),
    // Seconds, as pear-desktop's prompt asked for them.
    activityTimeoutSeconds: config.number(600, { label: "Pause timeout", min: 1, max: 14_400, step: 1, unit: "s", variant: "stepper" }),
    autoReconnect: config.bool(true, {
      label: "Keep trying to connect",
      description: "Reconnect automatically when Discord starts or restarts.",
    }),
  },
  // pear-desktop's menu items, as settings buttons.
  actions: {
    connect: { label: "Connect", description: "Connect to Discord now instead of waiting for the next retry." },
    clearActivity: { label: "Clear activity", description: "Remove the activity until the next track or until playback resumes." },
  },
  host: {
    start(ctx) {
      let client: Client | undefined;
      let ready = false;
      let stopped = false;
      let retryDelay = RETRY_MIN_MS;
      let warned = false;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      let updateTimer: ReturnType<typeof setTimeout> | undefined;
      let pauseTimer: ReturnType<typeof setTimeout> | undefined;
      let shown: SetActivity | null = null;
      let lastSentAt = 0;
      let details: SongDetails | undefined;
      // Cleared after a long pause: stays hidden until playback resumes.
      let idle = false;

      const dispose = (target: Client) => {
        target.removeAllListeners();
        void target.destroy().catch(() => {});
      };

      const scheduleRetry = () => {
        if (stopped || !ctx.config.autoReconnect || retryTimer) return;
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          connect();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
      };

      // pear-desktop's connected / disconnected indicator, on the settings card.
      const showConnection = () =>
        ctx.setStatus(
          ready
            ? ctx.t("plugins.discord.backend.connected", "Connected to Discord")
            : ctx.t("plugins.discord.backend.disconnected", "Disconnected from Discord"),
        );

      const connect = () => {
        // The library leaves listeners behind after a failed login: use a fresh client per attempt.
        const attempt = new Client({ clientId: CLIENT_ID });
        client = attempt;
        attempt.on("ready", () => {
          if (client !== attempt) return;
          ready = true;
          retryDelay = RETRY_MIN_MS;
          warned = false;
          shown = null;
          ctx.log.info("connected to Discord");
          showConnection();
          update();
        });
        attempt.on("disconnected", () => {
          if (client !== attempt) return;
          if (ready) ctx.log.info("disconnected from Discord");
          ready = false;
          client = undefined;
          dispose(attempt);
          showConnection();
          scheduleRetry();
        });
        attempt.login().catch((error: unknown) => {
          if (client !== attempt) return;
          client = undefined;
          ready = false;
          dispose(attempt);
          showConnection();
          if (!warned) {
            warned = true;
            const message = error instanceof Error ? error.message : String(error);
            ctx.log.warn(`can't reach Discord (${message})${ctx.config.autoReconnect ? "; retrying in the background" : ""}`);
          }
          scheduleRetry();
        });
      };

      const send = () => {
        clearTimeout(updateTimer);
        updateTimer = undefined;
        if (!ready || !client?.user) return;
        const next = idle ? null : buildActivity(ctx.player.state, details, ctx.config);
        if (!needsUpdate(shown, next)) return;
        shown = next;
        lastSentAt = Date.now();
        const request = next ? client.user.setActivity(next) : client.user.clearActivity();
        request.catch((error: unknown) => ctx.log.warn("couldn't update the activity", error));
      };

      /** Sends now, or as soon as Discord's rate limit allows (coalescing bursts). */
      const update = () => {
        if (updateTimer) return;
        const wait = lastSentAt + MIN_UPDATE_INTERVAL_MS - Date.now();
        if (wait <= 0) send();
        else updateTimer = setTimeout(send, wait);
      };

      const armPauseTimeout = () => {
        clearTimeout(pauseTimer);
        pauseTimer = undefined;
        idle = false;
        const state = ctx.player.state;
        if (!state.track || !isPaused(state) || !ctx.config.activityTimeoutEnabled) return;
        pauseTimer = setTimeout(() => {
          idle = true;
          update();
        }, ctx.config.activityTimeoutSeconds * 1000);
      };

      const fetchDetails = async (videoId: string) => {
        try {
          const result = await ctx.request<SongDetails | null>("details", undefined, { timeout: 5000 });
          if (result?.videoId === videoId && ctx.player.state.track?.videoId === videoId) {
            details = result;
            update();
          }
        } catch {
          // Page part not up yet: show the plain title and artist.
        }
      };

      ctx.player.on("change", (state, previous) => {
        if (state.track && state.track.videoId !== previous.track?.videoId) void fetchDetails(state.track.videoId);
        if (isPaused(state) !== isPaused(previous) || state.track !== previous.track) armPauseTimeout();
        // Position ticks only matter when they drift from the shown timestamps (needsUpdate).
        update();
      });
      if (ctx.player.state.track) void fetchDetails(ctx.player.state.track.videoId);

      refresh = () => {
        armPauseTimeout();
        if (ctx.config.autoReconnect && !client) scheduleRetry();
        update();
      };
      controls.set(ctx, {
        connect() {
          if (ready || client) return;
          clearTimeout(retryTimer);
          retryTimer = undefined;
          retryDelay = RETRY_MIN_MS;
          warned = false;
          connect();
        },
        clear() {
          // Hidden like after a long pause: back with the next track or when playback resumes.
          clearTimeout(pauseTimer);
          idle = true;
          shown = null;
          if (ready && client?.user) void client.user.clearActivity().catch(() => {});
        },
      });
      armPauseTimeout();
      showConnection();
      connect();

      return () => {
        stopped = true;
        refresh = undefined;
        controls.delete(ctx);
        clearTimeout(retryTimer);
        clearTimeout(updateTimer);
        clearTimeout(pauseTimer);
        const current = client;
        client = undefined;
        if (current) {
          if (ready) void current.user?.clearActivity().catch(() => {});
          dispose(current);
        }
      };
    },
    // Options are read when the activity is built; no need to reconnect.
    onConfigChange: () => (refresh ? refresh() : "restart"),
    commands: {
      connect() {
        controls.get(this)?.connect();
      },
      clearActivity() {
        controls.get(this)?.clear();
      },
    },
  },
  page: {
    start(ctx) {
      ctx.host.handle("details", () => (ctx.player.api ? readSongDetails(ctx.player.api) : null));
    },
    onConfigChange() {},
  },
});
