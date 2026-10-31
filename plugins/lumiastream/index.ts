// Sends song changes, play/pause and progress to Lumia Stream's local media API.

import { definePlugin, livePosition, type NowPlaying, type Track } from "@pear/sdk";
import type { SongDetails } from "@pear/sdk/song-details";
import { isPlaying } from "@pear/sdk/util";
import { net } from "electron";

const PORT = 39231;
const PROGRESS_MS = 1000;
/** Lumia Stream's public token for this integration. */
const TOKEN = "lsmedia_ytmsI7812";
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Origin": "*",
};

/** A position jump bigger than this (beyond normal playback) is a seek. */
const SEEK_THRESHOLD_S = 1.5;

const isPaused = (state: NowPlaying) => state.ad || !isPlaying(state);

type EventType = "switchSong" | "playPause";

/** Lumia's media event, in pear-desktop's shape. */
function mediaEvent(eventType: EventType, state: NowPlaying, track: Track, details: SongDetails | undefined) {
  const extra = details?.videoId === track.videoId ? details : undefined;
  const paused = isPaused(state);
  return {
    origin: "\u0079\u006f\u0075\u0074\u0075\u0062\u0065music",
    eventType,
    url: track.url,
    videoId: track.videoId,
    ...(track.playlistId ? { playlistId: track.playlistId } : {}),
    cover: track.artworkUrl ?? null,
    cover_url: track.artworkUrl ?? null,
    album_url: track.artworkUrl ?? null,
    title: track.title,
    artists: [track.artist],
    status: paused ? "stopped" : "playing",
    isPaused: paused,
    progress: Math.round(livePosition(state) * 1000),
    duration: Math.round(track.durationSeconds * 1000),
    album: track.album ?? null,
    ...(extra?.views !== undefined ? { views: extra.views } : {}),
  };
}

export default definePlugin({
  id: "lumiastream",
  name: "Lumia Stream",
  description: "Let Lumia Stream react to the songs you play.",
  host: {
    start(ctx) {
      let details: SongDetails | undefined;
      let unreachable = false;
      let stopped = false;
      ctx.onCleanup(() => {
        stopped = true;
      });

      const post = (eventType: EventType) => {
        const state = ctx.player.state;
        const track = state.track;
        if (stopped || !track || (!track.title && !track.artist)) return;
        const data = mediaEvent(eventType, state, track, details);
        net
          .fetch(`http://127.0.0.1:${PORT}/api/media`, {
            method: "POST",
            headers: HEADERS,
            body: JSON.stringify({ token: TOKEN, data }),
          })
          .then(() => {
            if (unreachable) ctx.log.info("Lumia Stream is reachable again");
            unreachable = false;
          })
          .catch((error: unknown) => {
            if (!unreachable) ctx.log.info(`Lumia Stream isn't reachable on port ${PORT}`, error);
            unreachable = true;
          });
      };

      // Views come from the page part; resend once they're known.
      const fetchDetails = (videoId: string) => {
        void ctx.player.details().then((result) => {
          if (result?.videoId !== videoId || ctx.player.state.track?.videoId !== videoId) return;
          details = result;
          post("switchSong");
        });
      };

      ctx.player.on("change", (state, previous) => {
        if (!state.track) return;
        const seeked = Math.abs(livePosition(previous, state.updatedAt) - state.positionSeconds) > SEEK_THRESHOLD_S;
        if (state.track.videoId !== previous.track?.videoId) {
          details = undefined;
          post("switchSong");
          fetchDetails(state.track.videoId);
        } else if (isPaused(state) !== isPaused(previous)) {
          post("playPause");
        } else if (seeked) {
          post("switchSong");
        }
      });
      if (ctx.player.state.track) post("switchSong");
      // Like pear-desktop, keep Lumia's progress current: an update every second while playing.
      ctx.setInterval(() => {
        if (!isPaused(ctx.player.state)) post("switchSong");
      }, PROGRESS_MS);
    },
  },
});
