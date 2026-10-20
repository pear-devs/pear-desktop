import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { clipboard } from "electron";
import { mountTogether } from "./page/mount.tsx";

export default definePlugin({
  id: "music-together",
  name: "Music Together",
  description: "Share a playlist with others. When the host plays a song, everyone else will hear the same song.",
  config: {
    displayName: config.string("", { label: "Your name", placeholder: "Guest 1234", description: "Shown to others in a session." }),
    // pear-desktop's permissions (it started every session at "playlist").
    defaultPermission: config.select(
      "playlist",
      [
        { value: "host-only", label: "Listen only" },
        { value: "playlist", label: "Change the queue" },
        { value: "all", label: "Full control" },
      ],
      { label: "What guests can do", description: "Default for new sessions; change it any time while hosting." },
    ),
  },
  style: css`
    /* Who added each queue item, as pear-desktop showed it. */
    .music-together-owner {
      width: 24px;
      height: 24px;
      flex-shrink: 0;
      border-radius: 50%;
      margin-left: 8px;
    }
    .music-together-name {
      display: none;
      color: #fff;
      font-size: 14px;
      margin-left: 8px;
    }
    ytmusic-player-queue-item:hover .music-together-name {
      display: unset;
    }
  `,
  host: {
    // Nothing runs on the host; config changes only matter to the page.
    onConfigChange() {},
    commands: {
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
