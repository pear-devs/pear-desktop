import { definePlugin } from "@pear/sdk";
import { net } from "electron";
import { Innertube } from "\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js";
import { startCrossfade } from "./page.ts";
import { schema } from "./schema.ts";

export default definePlugin({
  id: "crossfade",
  name: "Crossfade",
  description: "Fades out the end of a track while the next one fades in.",
  config: schema,
  host: {
    commands: {
      /**
       * A direct audio stream of a track, as pear-desktop fetched one to play the
       * end of the track while the next one starts.
       */
      async audioUrl(videoId: string) {
        innertube ??= Innertube.create({ retrieve_player: true, fetch: (input, init) => net.fetch(input as string, init) }).catch(
          (error: unknown) => {
            innertube = undefined;
            throw error;
          },
        );
        const yt = await innertube;
        let lastError: unknown;
        // The iOS client's streams play without extra tokens; the web client's as a fallback.
        for (const client of ["IOS", undefined] as const) {
          try {
            const info = await yt.getBasicInfo(videoId, client ? { client } : undefined);
            const format = info.chooseFormat({ type: "audio", quality: "best" });
            return await format.decipher(yt.session.player);
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError;
      },
    },
  },
  page: startCrossfade,
});

// Host: the InnerTube client for audio URLs, created on first use.
let innertube: Promise<Innertube> | undefined;
