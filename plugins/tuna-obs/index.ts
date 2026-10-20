// Feeds OBS's Tuna plugin (its "web server" source) with the current song.

import { config, definePlugin, livePosition, type NowPlaying, type Track } from "@pear/sdk";
import type { SongDetails } from "@pear/sdk/song-details";
import { net } from "electron";

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Origin": "*",
};


/** Tuna's song data, in pear-desktop's shape. */
function songData(state: NowPlaying, track: Track, details: SongDetails | undefined) {
  const extra = details?.videoId === track.videoId ? details : undefined;
  return {
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
}

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
      let probing = false;
      let sending = false;
      /** Something changed while a request was out: send once more after it. */
      let resend = false;
      let stopped = false;

      const send = async () => {
        const state = ctx.player.state;
        const track = state.track;
        if (!track) return;
        const body = probing ? {} : { body: JSON.stringify({ data: songData(state, track, details) }) };
        try {
          await net.fetch(`http://127.0.0.1:${ctx.config.port}/`, { method: probing ? "OPTIONS" : "POST", headers: HEADERS, ...body });
          if (probing) {
            probing = false;
            resend = true;
            ctx.log.info(`Tuna is reachable on port ${ctx.config.port}`);
          }
        } catch {
          if (!probing) ctx.log.info(`Tuna isn't reachable on port ${ctx.config.port}; waiting for it`);
          probing = true;
        }
      };
      // One request at a time; changes meanwhile are coalesced into one more.
      const post = () => {
        if (stopped) return;
        if (sending) {
          resend = true;
          return;
        }
        sending = true;
        void send().finally(() => {
          sending = false;
          if (!resend) return;
          resend = false;
          post();
        });
      };
      ctx.onCleanup(() => {
        stopped = true;
      });

      const fetchDetails = (videoId: string) => {
        void ctx.player.details().then((result) => {
          if (result?.videoId !== videoId) return;
          details = result;
          post();
        });
      };

      ctx.player.on("change", (state, previous) => {
        if (state.track && state.track.videoId !== previous.track?.videoId) fetchDetails(state.track.videoId);
        post();
      });
      post();
    },
    // The port is read for every request.
    onConfigChange() {},
  },
});
