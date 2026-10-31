import { definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { pipConfig } from "./config.ts";
import { startPage } from "./page.tsx";
import { SmallWindow } from "./small-window.ts";

export default definePlugin({
  id: "picture-in-picture",
  name: "Picture in picture",
  description: "Watch in a small floating window, from the track menu or a hotkey.",
  config: pipConfig,
  host: {
    start(ctx) {
      const smallWindow = new SmallWindow(ctx);
      smallWindows.set(ctx, smallWindow);
      ctx.onCleanup(() => {
        smallWindow.dispose();
        smallWindows.delete(ctx);
      });
    },
    // Settings are read when entering the small window.
    onConfigChange() {},
    commands: {
      toggle() {
        const smallWindow = smallWindows.get(this);
        smallWindow?.toggle();
        return smallWindow?.active ?? false;
      },
      exit() {
        smallWindows.get(this)?.exit();
      },
      active() {
        return smallWindows.get(this)?.active ?? false;
      },
    },
  },
  style: css`
    /* pear-desktop's small-window styling of YTM's full-screen player. */
    /* Newer YTM draws its full-screen controls with ytmusic-player-controls. */
    html.pear-pip sel(player_bar) svg,
    html.pear-pip sel(player_bar.time),
    html.pear-pip sel(player_bar) yt-formatted-string,
    html.pear-pip sel(player_bar) .yt-formatted-string,
    html.pear-pip ytmusic-player-controls svg,
    html.pear-pip ytmusic-player-controls .time-info {
      filter: drop-shadow(2px 4px 6px black);
      color: white !important;
      fill: white !important;
    }
    html.pear-pip ytmusic-player-expanding-menu {
      border-radius: 30px;
      background-color: rgb(0 0 0 / 0.3);
      backdrop-filter: blur(5px) brightness(20%);
    }
    html.pear-pip sel(player_bar) .content-info-wrapper,
    html.pear-pip sel(player_bar) .thumbnail-image-wrapper,
    html.pear-pip sel(player_bar) ytmusic-menu-renderer,
    html.pear-pip ytmusic-player-controls .content-info-wrapper,
    html.pear-pip ytmusic-player-controls ytmusic-menu-renderer,
    html.pear-pip .video-switch-button,
    html.pear-pip .pear-video-toggle {
      display: none !important;
    }
    /* The bar stays clickable under the drag strip. */
    html.pear-pip sel(player_bar) {
      -webkit-app-region: no-drag;
    }
    .pear-pip-drag {
      position: fixed;
      top: 0;
      left: 56px;
      right: 56px;
      height: 32px;
      z-index: 2147483647;
      -webkit-app-region: drag;
    }
  `,
  page: startPage,
});

// Commands run with the host context as `this`; this finds its small window.
const smallWindows = new WeakMap<object, SmallWindow>();
