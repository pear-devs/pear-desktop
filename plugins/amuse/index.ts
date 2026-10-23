// Serves the current song in the format of the Amuse now-playing widget (6K Labs).

import { createServer } from "node:http";
import { config, definePlugin, livePosition, type NowPlaying } from "@pear/sdk";
import { isPlaying } from "@pear/sdk/util";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

function songInfo(state: NowPlaying) {
  const track = state.track;
  return {
    player: {
      hasSong: !!(track?.title && track.artist),
      isPaused: state.ad || !isPlaying(state),
      seekbarCurrentPosition: Math.floor(livePosition(state)),
    },
    track: {
      duration: track?.durationSeconds ?? 0,
      title: track?.title ?? "",
      author: track?.artist ?? "",
      cover: track?.artworkUrl ?? "",
      url: track?.url ?? "",
      id: track?.videoId ?? "",
      isAdvertisement: state.ad,
    },
  };
}

export default definePlugin({
  id: "amuse",
  name: "Amuse",
  description: "Show the current song in the Amuse now-playing widget by 6K Labs.",
  config: {
    port: config.number(9863, {
      label: "Port",
      min: 1,
      max: 65535,
      step: 1,
      description: "Amuse expects 9863.",
    }),
    hostname: config.string("0.0.0.0", {
      label: "Address to listen on",
      description: "0.0.0.0 (as pear-desktop) lets widgets on other devices reach it; 127.0.0.1 keeps it to this computer.",
      placeholder: "0.0.0.0",
    }),
  },
  host: {
    async start(ctx) {
      const server = createServer((req, res) => {
        const path = new URL(req.url ?? "/", "http://localhost").pathname;
        if (req.method === "OPTIONS") {
          res.writeHead(204, CORS).end();
        } else if (req.method === "GET" && (path === "/query" || path === "/api")) {
          res.writeHead(200, { ...CORS, "Content-Type": "application/json" }).end(JSON.stringify(songInfo(ctx.player.state)));
        } else if (req.method === "GET" && path === "/") {
          res.writeHead(200, { ...CORS, "Content-Type": "text/plain" }).end("Amuse API server is running. GET /query to get song info.");
        } else {
          res.writeHead(404, CORS).end();
        }
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(ctx.config.port, ctx.config.hostname || "0.0.0.0", () => {
          server.off("error", reject);
          resolve();
        });
      });
      server.on("error", (error) => ctx.log.error(error));
      return () => {
        server.close();
        server.closeAllConnections();
      };
    },
  },
});
