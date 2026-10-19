import { config, definePlugin } from "@pear/sdk";
import { clipboard, net } from "electron";
import { mountTogether } from "./page/mount.tsx";
import type { TrackInfo } from "./session.ts";

export default definePlugin({
  id: "music-together",
  name: "Music Together",
  description: "Listen in sync with friends: host a session, share the code, and everyone hears the same thing.",
  config: {
    displayName: config.string("", { label: "Your name", placeholder: "Guest 1234", description: "Shown to others in a session." }),
    defaultPermission: config.select(
      "suggest",
      [
        { value: "host-only", label: "Listen only" },
        { value: "suggest", label: "Suggest songs" },
        { value: "control", label: "Full control" },
      ],
      { label: "What guests can do", description: "Default for new sessions; change it any time while hosting." },
    ),
  },
  host: {
    // Nothing runs on the host; config changes only matter to the page.
    onConfigChange() {},
    commands: {
      /** Title and artist for a suggested video (oEmbed needs no API key and isn't subject to page CORS). */
      async trackInfo(videoId: string): Promise<TrackInfo> {
        const url = `https://www.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/oembed?format=json&url=${encodeURIComponent(`https://www.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=${videoId}`)}`;
        const response = await net.fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`oEmbed responded ${response.status}`);
        const data = (await response.json()) as { title?: string; author_name?: string };
        return { title: data.title ?? videoId, artist: (data.author_name ?? "").replace(/ - Topic$/, "") };
      },
      copy(text: string) {
        clipboard.writeText(text);
      },
    },
  },
  page: {
    start(ctx) {
      mountTogether(ctx);
    },
    // Name and default permission are read when needed; no restart (it would drop the session).
    onConfigChange() {},
  },
});
