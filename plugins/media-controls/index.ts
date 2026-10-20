// OS media controls. Linux: a full MPRIS player (metadata, artwork, seek,
// volume, shuffle, repeat). Windows and macOS get SMTC / Now Playing from
// Chromium's Media Session integration, which YTM already feeds, so this
// plugin is Linux-only.

import MprisPlayer, { type LoopStatus, type Position } from "@jellybrick/mpris-service";
import { definePlugin, livePosition, type NowPlaying, type RepeatMode } from "@pear/sdk";
import { openableUrl } from "./open.ts";

/** What only the page knows: YTM's full-screen player and where the queue is at. */
interface PageNav {
  fullscreen: boolean;
  /** Tracks before and after the playing one (autoplay's included). */
  before: number;
  after: number;
}

const secToMicro = (seconds: number) => Math.round(seconds * 1e6);
const microToSec = (micro: number | bigint) => Number(micro) / 1e6;

const LOOP_STATUS: Record<RepeatMode, LoopStatus> = {
  none: MprisPlayer.LOOP_STATUS_NONE,
  all: MprisPlayer.LOOP_STATUS_PLAYLIST,
  one: MprisPlayer.LOOP_STATUS_TRACK,
};
// YTM's repeat button cycles none → all → one.
const REPEAT_CYCLE: readonly RepeatMode[] = ["none", "all", "one"];

export default definePlugin({
  id: "media-controls",
  name: "Media controls",
  description: "Control playback from your desktop's media widgets and keys (MPRIS).",
  platforms: ["linux"],
  enabledByDefault: true,
  host: {
    beforeReady(ctx) {
      // Chromium would register a second, less capable MPRIS player.
      ctx.disableFeatures("MediaSessionService");
    },
    start(ctx) {
      let state = ctx.player.state;

      class PearMpris extends MprisPlayer {
        override getPosition() {
          return secToMicro(livePosition(state));
        }
      }
      const mpris = new PearMpris({
        name: "\u0059\u006f\u0075\u0074\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063",
        identity: "\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063",
        supportedInterfaces: ["player"],
      });
      mpris.canRaise = true;
      mpris.canQuit = false;
      mpris.desktopEntry = "\u0079\u006f\u0075\u0074\u0075\u0062\u0065\u002d\u006d\u0075\u0073\u0069\u0063";
      mpris.supportedUriSchemes = ["https"];
      mpris.supportedMimeTypes = [];
      mpris.canSeek = true;
      mpris.canSetFullscreen = true;
      // pear-desktop's rules: previous unless at the queue's start; next while
      // tracks follow (autoplay adds them) or the queue repeats.
      let nav: PageNav = { fullscreen: false, before: 0, after: 1 };
      const applyNav = () => {
        const canGoPrevious = nav.before > 0;
        const canGoNext = nav.after > 0 || state.repeat === "all";
        if (mpris.canGoPrevious !== canGoPrevious) mpris.canGoPrevious = canGoPrevious;
        if (mpris.canGoNext !== canGoNext) mpris.canGoNext = canGoNext;
        if (mpris.fullscreen !== nav.fullscreen) mpris.fullscreen = nav.fullscreen;
      };
      navs.set(ctx, (next) => {
        nav = next;
        applyNav();
      });
      ctx.onCleanup(() => navs.delete(ctx));
      applyNav();

      const trackId = (videoId: string) => mpris.objectPath(`track/${videoId.replace(/[^A-Za-z0-9_]/g, "_")}`);
      const control = ctx.player.control;

      mpris.on("play", () => control({ type: "play" }));
      mpris.on("pause", () => control({ type: "pause" }));
      mpris.on("playpause", () => control({ type: "toggle" }));
      mpris.on("stop", () => control({ type: "pause" }));
      mpris.on("next", () => control({ type: "next" }));
      mpris.on("previous", () => control({ type: "previous" }));
      mpris.on("seek", (offset: number) => control({ type: "seekBy", seconds: microToSec(offset) }));
      mpris.on("position", (event: Position) => {
        if (state.track && event.trackId === trackId(state.track.videoId)) {
          control({ type: "seek", seconds: microToSec(event.position) });
        }
      });
      mpris.on("volume", (volume: number) => control({ type: "volume", value: volume * 100 }));
      mpris.on("shuffle", (shuffle: boolean) => {
        if (shuffle !== state.shuffle) control({ type: "shuffle" });
      });
      mpris.on("loopStatus", (status: LoopStatus) => {
        const target = REPEAT_CYCLE.find((mode) => LOOP_STATUS[mode] === status) ?? "none";
        const presses = (REPEAT_CYCLE.indexOf(target) - REPEAT_CYCLE.indexOf(state.repeat) + 3) % 3;
        for (let i = 0; i < presses; i++) control({ type: "repeat" });
      });
      mpris.on("raise", () => {
        ctx.window.show();
        ctx.window.focus();
      });
      mpris.on("fullscreen", (fullscreen: boolean) => {
        ctx.request("fullscreen", fullscreen).catch((error: unknown) => ctx.log.warn("could not change full screen", error));
      });
      mpris.on("open", ({ uri }: { uri: string }) => {
        const url = openableUrl(uri);
        if (url) void ctx.window.loadURL(url);
        else ctx.log.warn("not opening a non-YTM link");
      });
      mpris.on("error", (error: Error) => ctx.log.error("MPRIS error", error));

      const apply = (next: NowPlaying, previous: NowPlaying | undefined) => {
        state = next;
        const track = next.track;
        const old = previous?.track;
        if (!previous || track?.videoId !== old?.videoId || track?.title !== old?.title || track?.artworkUrl !== old?.artworkUrl) {
          mpris.metadata = track
            ? {
                "mpris:trackid": trackId(track.videoId),
                "mpris:length": secToMicro(track.durationSeconds),
                "xesam:title": track.title,
                "xesam:artist": [track.artist],
                "xesam:url": track.url,
                ...(track.album ? { "xesam:album": track.album } : {}),
                ...(track.artworkUrl ? { "mpris:artUrl": track.artworkUrl } : {}),
              }
            : {};
        }
        const status =
          next.status === "playing" || next.status === "buffering"
            ? MprisPlayer.PLAYBACK_STATUS_PLAYING
            : track
              ? MprisPlayer.PLAYBACK_STATUS_PAUSED
              : MprisPlayer.PLAYBACK_STATUS_STOPPED;
        if (mpris.playbackStatus !== status) mpris.playbackStatus = status;
        const volume = next.muted ? 0 : next.volume / 100;
        if (mpris.volume !== volume) mpris.volume = volume;
        if (mpris.loopStatus !== LOOP_STATUS[next.repeat]) mpris.loopStatus = LOOP_STATUS[next.repeat];
        if (mpris.shuffle !== next.shuffle) mpris.shuffle = next.shuffle;
        applyNav();

        // Tell clients about jumps (seeks, track changes) so their progress bars resync.
        if (previous && Math.abs(livePosition(previous, next.updatedAt) - next.positionSeconds) > 1.5) {
          mpris.seeked(secToMicro(next.positionSeconds));
        }
      };
      apply(state, undefined);
      ctx.player.on("change", apply);

      return () => {
        (mpris as unknown as { _bus?: { disconnect(): void } })._bus?.disconnect();
      };
    },
    commands: {
      nav(next: PageNav) {
        navs.get(this)?.(next);
      },
    },
  },
  page(ctx) {
    let last = "";
    const report = () => {
      const items = ctx.$$("queue.item");
      const index = items.findIndex((item) => item.hasAttribute("selected"));
      const nav: PageNav = {
        fullscreen: !!ctx.$("integrations.fullscreen"),
        before: Math.max(0, index),
        after: index < 0 ? items.length : items.length - index - 1,
      };
      const key = JSON.stringify(nav);
      if (key === last) return;
      last = key;
      void ctx.host.invoke("nav", nav);
    };
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(scheduled);
      scheduled = setTimeout(report, 200);
    };
    ctx.host.handle("fullscreen", (fullscreen) => {
      if (!!ctx.$("integrations.fullscreen") === fullscreen) return;
      ctx.$(fullscreen ? "integrations.fullscreen_button" : "integrations.exit_fullscreen_button")?.click();
    });
    const observer = new MutationObserver(schedule);
    void ctx.waitFor("player_bar").then((bar) => observer.observe(bar, { attributes: true, attributeFilter: ["player-fullscreened"] }));
    void ctx.waitFor("queue").then((queue) =>
      observer.observe(queue, { childList: true, subtree: true, attributes: true, attributeFilter: ["selected"] }),
    );
    ctx.player.on("trackChange", schedule);
    report();
    return () => {
      clearTimeout(scheduled);
      observer.disconnect();
    };
  },
});

/** Per running host part: applies what the page reports. */
const navs = new WeakMap<object, (nav: PageNav) => void>();
