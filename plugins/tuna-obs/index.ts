// Feeds OBS's Tuna plugin (its "web server" source) with the current song.

import { config, definePlugin, livePosition, type NowPlaying } from "@pear/sdk";
import { readSongDetails, type SongDetails } from "@pear/sdk/song-details";
import { net } from "electron";

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Origin": "*",
};

export default definePlugin({
  id: "tuna-obs",
  name: "Tuna OBS",
  description: "Show the current song in OBS through the Tuna plugin.",
  config: {
    port: config.number(1608, {
      label: "Tuna port",
      min: 1,
      max: 65535,
      step: 1,
      description: "The port of Tuna's web server source in OBS.",
    }),
  },
  host: {
    start(ctx) {
      let details: SongDetails | undefined;
      // While Tuna isn't reachable, probe it with cheap OPTIONS requests instead of full posts ("lite mode").
      let lite = false;
      let busy = false;
      let again = false;
      let stopped = false;

      const send = async () => {
        const state = ctx.player.state;
        const track = state.track;
        if (!track) return;
        const extra = details?.videoId === track.videoId ? details : undefined;
        const data = {
          album: track.album ?? null,
          album_url: track.artworkUrl ?? "",
          artists: [track.artist],
          cover: track.artworkUrl ?? "",
          cover_url: track.artworkUrl ?? "",
          duration: Math.round(track.durationSeconds * 1000),
          progress: Math.round(livePosition(state) * 1000),
          status: state.status === "playing" && !state.ad ? "playing" : "stopped",
          title: track.title,
          alternativeTitle: extra?.alternativeTitle ?? "",
          url: track.url,
          tags: extra?.tags ?? [],
        };
        try {
          await net.fetch(`http://127.0.0.1:${ctx.config.port}/`, {
            method: lite ? "OPTIONS" : "POST",
            headers: HEADERS,
            ...(lite ? {} : { body: JSON.stringify({ data }) }),
          });
          if (lite) {
            lite = false;
            again = true;
            ctx.log.info(`Tuna is reachable on port ${ctx.config.port}`);
          }
        } catch {
          if (!lite) ctx.log.info(`Tuna isn't reachable on port ${ctx.config.port}; waiting for it`);
          lite = true;
        }
      };
      // One request at a time; changes meanwhile are coalesced into one more.
      const post = () => {
        if (stopped) return;
        if (busy) {
          again = true;
          return;
        }
        busy = true;
        void send().finally(() => {
          busy = false;
          if (!again) return;
          again = false;
          post();
        });
      };
      ctx.onCleanup(() => (stopped = true));

      ctx.player.on("change", (state, previous) => {
        if (state.track && state.track.videoId !== previous.track?.videoId) {
          const videoId = state.track.videoId;
          ctx
            .request<SongDetails | null>("details", undefined, { timeout: 5000 })
            .then((result) => {
              if (result?.videoId !== videoId) return;
              details = result;
              post();
            })
            .catch(() => {});
        }
        post();
      });
      post();
    },
    // The port is read for every request.
    onConfigChange() {},
  },
  page: {
    start(ctx) {
      ctx.host.handle("details", () => (ctx.player.api ? readSongDetails(ctx.player.api) : null));
    },
    onConfigChange() {},
  },
});
