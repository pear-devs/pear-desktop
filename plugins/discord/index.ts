// Discord Rich Presence. Connects to the local Discord client over IPC and
// quietly keeps retrying (with backoff) while Discord isn't running.

import { definePlugin } from "@pear/sdk";
import { readSongDetails } from "@pear/sdk/song-details";
import { Presence } from "./presence.ts";
import { schema } from "./schema.ts";

/** What the settings actions call on the running instance. */
interface PresenceActions {
  connectNow(): void;
  clear(): void;
}

// Typed by an interface: naming `Presence` here would keep the host-only module in the page build.
const presences = new WeakMap<object, PresenceActions>();

export default definePlugin({
  id: "discord",
  name: "Discord Rich Presence",
  description: "Show your friends what you're listening to in your Discord status.",
  config: schema,
  // pear-desktop's menu items, as settings buttons.
  actions: {
    connect: { label: "Connect", description: "Connect to Discord now instead of waiting for the next retry." },
    clearActivity: { label: "Clear activity", description: "Remove the activity until the next track or until playback resumes." },
  },
  host: {
    start(ctx) {
      const presence = new Presence(ctx);
      presences.set(ctx, presence);
      // Options are read when the activity is built; no need to reconnect.
      ctx.onConfigChange(() => presence.refresh());
      return () => {
        presences.delete(ctx);
        presence.stop();
      };
    },
    commands: {
      connect() {
        presences.get(this)?.connectNow();
      },
      clearActivity() {
        presences.get(this)?.clear();
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
