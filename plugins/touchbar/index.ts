import { definePlugin, type NowPlaying, type PlayerAction } from "@pear/sdk";
import { pearIconBitmap } from "@pear/sdk/icon";
import { nativeImage, net, type NativeImage, TouchBar } from "electron";

const ARTWORK_HEIGHT = 23;

export default definePlugin({
  id: "touchbar",
  name: "Touch Bar",
  description: "The current track and playback controls on the MacBook Touch Bar.",
  platforms: ["darwin"],
  host: {
    start(ctx) {
      const { TouchBarButton, TouchBarLabel, TouchBarSpacer, TouchBarSegmentedControl, TouchBarScrubber } = TouchBar;
      const fallbackIcon = nativeImage
        .createFromBitmap(pearIconBitmap(64), { width: 64, height: 64 })
        .resize({ height: ARTWORK_HEIGHT });

      const title = new TouchBarLabel({ label: "" });
      const artwork: { icon?: NativeImage } = { icon: fallbackIcon };
      const playPause = new TouchBarButton({ label: "▶️" });
      const actions: PlayerAction[] = [
        { type: "previous" },
        { type: "toggle" },
        { type: "next" },
        { type: "dislike" },
        { type: "like" },
      ];
      const controls = new TouchBarSegmentedControl({
        mode: "buttons",
        segments: [
          new TouchBarButton({ label: "⏮" }),
          playPause,
          new TouchBarButton({ label: "⏭" }),
          new TouchBarButton({ label: "👎" }),
          new TouchBarButton({ label: "👍" }),
        ],
        change: (index) => {
          const action = actions[index];
          if (action) ctx.player.control(action);
        },
      });
      const touchBar = new TouchBar({
        items: [
          new TouchBarScrubber({ items: [artwork, title], continuous: false }),
          new TouchBarSpacer({ size: "flexible" }),
          controls,
        ],
      });

      let stopped = false;
      let artworkUrl: string | undefined;
      const loadArtwork = async (url: string | undefined) => {
        artworkUrl = url;
        let icon = fallbackIcon;
        if (url) {
          try {
            const response = await net.fetch(url);
            const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
            if (!image.isEmpty()) icon = image.resize({ height: ARTWORK_HEIGHT });
          } catch (error) {
            ctx.log.warn("couldn't load artwork", error);
          }
        }
        // A newer track may have arrived meanwhile.
        if (stopped || url !== artworkUrl || ctx.window.isDestroyed()) return;
        artwork.icon = icon;
        ctx.window.setTouchBar(touchBar);
      };

      const update = (state: NowPlaying, previous?: NowPlaying) => {
        title.label = state.track ? `${state.track.title} — ${state.track.artist}` : "";
        playPause.label = state.status === "playing" || state.status === "buffering" ? "⏸" : "▶️";
        if (state.track?.artworkUrl !== previous?.track?.artworkUrl) void loadArtwork(state.track?.artworkUrl);
      };
      update(ctx.player.state);
      ctx.player.on("change", update);
      ctx.window.setTouchBar(touchBar);
      ctx.onCleanup(() => {
        stopped = true;
        if (!ctx.window.isDestroyed()) ctx.window.setTouchBar(null);
      });
    },
  },
});
