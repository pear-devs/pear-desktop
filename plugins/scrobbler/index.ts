// Scrobbles to Last.fm and/or ListenBrainz: "now playing" when a track starts
// or resumes, a scrobble once it has really been listened to (see tracker.ts).

import { config, definePlugin, type Track } from "@pear/sdk";
import { readSongDetails, type SongDetails } from "@pear/sdk/song-details";
import { BrowserWindow, dialog, net } from "electron";
import { type Fetch, LASTFM_REAUTH_CODES, LastFmError, lastFm, type Listen, listenBrainzSubmit } from "./services.ts";
import { type Play, ScrobbleTracker } from "./tracker.ts";

const netFetch: Fetch = (url, init) => net.fetch(url, init);
const AUTH_POLL_MS = 2000;
const DETAILS_TIMEOUT_MS = 3000;

// Applies config changes to the running instance without losing the current play.
let reconfigure: (() => void) | undefined;

export default definePlugin({
  id: "scrobbler",
  name: "Scrobbler",
  description: "Scrobble what you listen to to Last.fm and ListenBrainz.",
  config: {
    lastfmEnabled: config.bool(false, {
      label: "Last.fm",
      description: "Enabling opens a Last.fm window to authorize Pear Desktop.",
    }),
    lastfmSessionKey: config.string("", {
      label: "Last.fm session",
      secret: true,
      description: "Filled in after authorizing. Clear it to authorize again (e.g. another account).",
    }),
    lastfmApiKey: config.string("04d76faaac8726e60988e14c105d421a", { label: "Last.fm API key" }),
    lastfmSecret: config.string("a5d2a36fdf64819290f6982481eaffa2", { label: "Last.fm API secret", secret: true }),
    lastfmApiRoot: config.string("https://ws.audioscrobbler.com/2.0/", { label: "Last.fm API root" }),
    listenbrainzEnabled: config.bool(false, { label: "ListenBrainz" }),
    listenbrainzToken: config.string("", {
      label: "ListenBrainz user token",
      secret: true,
      description: "From listenbrainz.org/settings.",
    }),
    listenbrainzApiRoot: config.string("https://api.listenbrainz.org/1/", {
      label: "ListenBrainz API root",
      description: "Change it for a compatible self-hosted server.",
    }),
    scrobbleOtherMedia: config.bool(true, {
      label: "Scrobble other videos",
      description: "Also scrobble podcasts and user uploads, not only songs and official music videos.",
    }),
    alternativeTitles: config.bool(true, {
      label: "Use alternative titles",
      description: "Prefer \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music's alternative title when it has one (e.g. original-script titles).",
    }),
    alternativeArtist: config.bool(true, {
      label: "Use the canonical artist",
      description: "Prefer the track's first tag as the artist (e.g. “DECO*27” instead of “DECO*27 & marasy”).",
    }),
  },
  host: {
    start(ctx) {
      const credentials = () => ({
        apiRoot: ctx.config.lastfmApiRoot,
        apiKey: ctx.config.lastfmApiKey,
        secret: ctx.config.lastfmSecret,
      });

      // Details (alternative title, tags, exact video type) arrive from the page part.
      const details = new Map<string, Promise<SongDetails | undefined>>();
      const detailsFor = (videoId: string) => {
        let pending = details.get(videoId);
        if (!pending) {
          pending = ctx
            .request<SongDetails | null>("details", undefined, { timeout: DETAILS_TIMEOUT_MS })
            .then((result) => (result?.videoId === videoId ? result : undefined))
            .catch(() => undefined);
          details.clear();
          details.set(videoId, pending);
        }
        return pending;
      };

      const toListen = async (track: Track, startedAt: number): Promise<Listen | null> => {
        const extra = await detailsFor(track.videoId);
        if (!ctx.config.scrobbleOtherMedia) {
          const type = extra?.musicVideoType;
          const isSong = type
            ? type === "MUSIC_VIDEO_TYPE_ATV" || type === "MUSIC_VIDEO_TYPE_OMV"
            : track.mediaType === "audio";
          if (!isSong) return null;
        }
        return {
          title: (ctx.config.alternativeTitles && extra?.alternativeTitle) || track.title,
          artist: (ctx.config.alternativeArtist && extra?.tags[0]) || track.artist,
          ...(track.album ? { album: track.album } : {}),
          durationSeconds: track.durationSeconds,
          url: track.url,
          startedAt,
        };
      };

      // One warning per distinct failure instead of one per track.
      let lastWarning = "";
      const warn = (service: string, error: unknown) => {
        const message = `${service}: ${error instanceof Error ? error.message : String(error)}`;
        if (message !== lastWarning) ctx.log.warn(message);
        lastWarning = message;
      };

      const submit = async (kind: "nowPlaying" | "scrobble", play: Play) => {
        const listen = await toListen(play.track, play.startedAt);
        if (!listen) return;
        const { lastfmEnabled, lastfmSessionKey, listenbrainzEnabled, listenbrainzToken, listenbrainzApiRoot } = ctx.config;
        if (lastfmEnabled && lastfmSessionKey) {
          const call = kind === "nowPlaying" ? lastFm.updateNowPlaying : lastFm.scrobble;
          call(netFetch, credentials(), lastfmSessionKey, listen).catch((error: unknown) => {
            if (error instanceof LastFmError && LASTFM_REAUTH_CODES.has(error.code)) {
              ctx.log.warn("Last.fm session is no longer valid; authorize again");
              ctx.setConfig({ lastfmSessionKey: "" });
            } else warn("Last.fm", error);
          });
        }
        if (listenbrainzEnabled && listenbrainzToken) {
          const type = kind === "nowPlaying" ? "playing_now" : "single";
          listenBrainzSubmit(netFetch, listenbrainzApiRoot, listenbrainzToken, type, listen).catch((error: unknown) =>
            warn("ListenBrainz", error),
          );
        }
      };

      const tracker = new ScrobbleTracker({
        nowPlaying: (play) => void submit("nowPlaying", play),
        scrobble: (play) => void submit("scrobble", play),
      });
      let tick: ReturnType<typeof setTimeout> | undefined;
      const schedule = () => {
        clearTimeout(tick);
        const wait = tracker.timeUntilScrobble();
        if (wait === null) return;
        tick = setTimeout(() => {
          tracker.tick();
          schedule();
        }, wait + 50);
      };
      ctx.player.on("change", (state) => {
        if (state.track) void detailsFor(state.track.videoId);
        tracker.update(state);
        schedule();
      });
      tracker.update(ctx.player.state);
      ctx.onCleanup(() => clearTimeout(tick));

      // ---- Last.fm authorization: the user signs in and approves in a Last.fm window.
      interface AuthWindow {
        window: BrowserWindow;
        poll?: ReturnType<typeof setTimeout>;
      }
      let auth: AuthWindow | undefined;
      let authDeclined = false;
      const authorize = async () => {
        if (auth || authDeclined || !ctx.config.lastfmEnabled || ctx.config.lastfmSessionKey) return;
        let token: string;
        try {
          token = await lastFm.getToken(netFetch, credentials());
        } catch (error) {
          warn("Last.fm", error);
          return;
        }
        const window = new BrowserWindow({
          parent: ctx.window,
          modal: true,
          width: 520,
          height: 680,
          title: "Authorize Pear Desktop on Last.fm",
          autoHideMenuBar: true,
          minimizable: false,
          maximizable: false,
          webPreferences: { partition: "persist:pear-lastfm", sandbox: true, contextIsolation: true },
        });
        const current: AuthWindow = { window };
        auth = current;
        let authorized = false;
        // Last.fm has no redirect for desktop apps: poll until the token is approved.
        const poll = () => {
          current.poll = setTimeout(async () => {
            try {
              const session = await lastFm.getSession(netFetch, credentials(), token);
              authorized = true;
              ctx.log.info(`authorized on Last.fm as ${session.name}`);
              ctx.setConfig({ lastfmSessionKey: session.key });
              if (!window.isDestroyed()) window.close();
            } catch {
              if (auth === current) poll();
            }
          }, AUTH_POLL_MS);
        };
        window.on("closed", () => {
          clearTimeout(current.poll);
          if (auth === current) auth = undefined;
          if (authorized || !reconfigure) return;
          // Don't reopen the window by itself; toggling Last.fm (or clearing the session) asks again.
          authDeclined = true;
          void dialog.showMessageBox(ctx.window, {
            type: "warning",
            title: "Last.fm",
            message: "Pear Desktop wasn't authorized on Last.fm",
            detail: "Scrobbling to Last.fm stays off until you authorize. Turn the Last.fm option off and on to try again.",
          });
        });
        void window.loadURL(lastFm.authUrl(ctx.config.lastfmApiKey, token));
        poll();
      };
      ctx.onCleanup(() => {
        const current = auth;
        auth = undefined;
        if (current) {
          clearTimeout(current.poll);
          if (!current.window.isDestroyed()) current.window.close();
        }
      });

      let wasEnabled = ctx.config.lastfmEnabled;
      let hadSession = !!ctx.config.lastfmSessionKey;
      reconfigure = () => {
        const { lastfmEnabled, lastfmSessionKey } = ctx.config;
        if ((lastfmEnabled && !wasEnabled) || (hadSession && !lastfmSessionKey)) authDeclined = false;
        wasEnabled = lastfmEnabled;
        hadSession = !!lastfmSessionKey;
        void authorize();
      };
      ctx.onCleanup(() => (reconfigure = undefined));
      void authorize();
    },
    onConfigChange: () => (reconfigure ? reconfigure() : "restart"),
  },
  page: {
    start(ctx) {
      ctx.host.handle("details", () => (ctx.player.api ? readSongDetails(ctx.player.api) : null));
    },
    onConfigChange() {},
  },
});
