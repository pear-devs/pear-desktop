import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

const CUSTOM = css`
  sel(player.native_av_toggle) {
    display: none !important;
  }
  .pear-video-toggle {
    position: absolute;
    top: 16px;
    left: 16px;
    right: 16px;
    z-index: 10;
    display: flex;
    justify-content: var(--pear-video-toggle-align, flex-start);
    pointer-events: none;
  }
  .pear-video-toggle[hidden] {
    display: none;
  }
  .pear-video-toggle [role="radiogroup"] {
    display: flex;
    padding: 3px;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.45);
    backdrop-filter: blur(12px);
    pointer-events: auto;
  }
  .pear-video-toggle button {
    min-width: 76px;
    padding: 7px 16px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: rgb(255 255 255 / 0.7);
    font: 500 14px/1 "\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Sans", Roboto, sans-serif;
    cursor: pointer;
    transition: background-color 150ms, color 150ms;
  }
  .pear-video-toggle button:hover {
    color: #fff;
  }
  .pear-video-toggle button[aria-checked="true"] {
    background: rgb(255 255 255 / 0.18);
    color: #fff;
  }
`;

const FORCE_HIDE = css`
  sel(player.main_panel) {
    display: none !important;
  }
  sel(player.side_panel) {
    max-width: 100% !important;
    width: 100% !important;
    margin: 0 !important;
  }
`;

const ALIGN = { left: "flex-start", middle: "center", right: "flex-end" } as const;

interface PlayerElement extends HTMLElement {
  videoMode_?: boolean;
}

export default definePlugin({
  id: "video-toggle",
  name: "Video toggle",
  description: "Switch between a track's music video and its cover art, or hide the video entirely.",
  config: {
    mode: config.select(
      "custom",
      [
        { value: "custom", label: "Pear Desktop's switch" },
        { value: "native", label: "\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music's switch" },
        { value: "disabled", label: "No switch" },
      ],
      { label: "Switch" },
    ),
    align: config.select(
      "left",
      [
        { value: "left", label: "Left" },
        { value: "middle", label: "Middle" },
        { value: "right", label: "Right" },
      ],
      { label: "Switch position" },
    ),
    hideVideo: config.bool(false, {
      label: "Show cover art instead of video",
      description: "Remembered when you use the switch.",
    }),
    forceHide: config.bool(false, {
      label: "Hide the player completely",
      description: "The queue and lyrics take the whole player page.",
    }),
  },
  style: (config) =>
    config.forceHide
      ? FORCE_HIDE
      : config.mode === "custom"
        ? `${CUSTOM}:root{--pear-video-toggle-align:${ALIGN[config.align]}}`
        : "",
  page: {
    start(ctx) {
      if (ctx.config.forceHide) return;
      const restore = new Map<Element, [string, string | null][]>();
      /** Sets an attribute, remembering the original value for cleanup. */
      const setAttribute = (element: Element | null, name: string, value: string | null) => {
        if (!element || element.getAttribute(name) === value) return;
        const saved = restore.get(element) ?? [];
        if (!saved.some(([n]) => n === name)) saved.push([name, element.getAttribute(name)]);
        restore.set(element, saved);
        if (value === null) element.removeAttribute(name);
        else element.setAttribute(name, value);
      };
      ctx.onCleanup(() => {
        for (const [element, saved] of restore) {
          for (const [name, value] of saved) {
            if (value === null) element.removeAttribute(name);
            else element.setAttribute(name, value);
          }
        }
      });

      if (ctx.config.mode !== "custom") {
        // Enable or disable YTM's own song/video switch.
        const enable = ctx.config.mode === "native";
        const apply = () => {
          const flag = enable ? "" : null;
          setAttribute(ctx.$("player.page"), "has-av-switcher", flag);
          setAttribute(ctx.$("player.container"), "has-av-switcher", flag);
          setAttribute(ctx.$("player.av_toggle"), "toggle-disabled", enable ? null : "");
        };
        void ctx.waitFor("player.av_toggle").then(() => {
          apply();
          // YTM resets these when a track loads.
          ctx.player.on("trackChange", apply);
        }, () => {});
        return;
      }

      const container = document.createElement("div");
      container.className = "pear-video-toggle";
      const group = document.createElement("div");
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-label", "Show");
      const songButton = choice("Song", () => setVideoState(false));
      const videoButton = choice("Video", () => setVideoState(true));
      group.append(songButton, videoButton);
      container.append(group);
      // Clicks on the player would toggle playback.
      container.addEventListener("click", (event) => event.stopPropagation());
      ctx.onCleanup(() => container.remove());

      let showVideo = !ctx.config.hideVideo;
      let hasVideo = true;

      const setVideoState = (show: boolean, remember = true) => {
        showVideo = show;
        if (remember && ctx.config.hideVideo === show) ctx.setConfig({ hideVideo: !show });
        apply();
      };

      const apply = () => {
        const player = ctx.$<PlayerElement>("player.container");
        const songVideo = ctx.$("player.song_video");
        const songImage = ctx.$("player.song_image");
        const visible = showVideo && hasVideo;
        songButton.setAttribute("aria-checked", String(!visible));
        videoButton.setAttribute("aria-checked", String(visible));
        container.hidden = !hasVideo;
        if (!player || !songVideo || !songImage) return;
        setAttribute(player, "playback-mode", visible ? "OMV_PREFERRED" : "ATV_PREFERRED");
        songVideo.style.display = visible ? "block" : "none";
        songImage.style.display = visible ? "none" : "block";
        if (!visible) forceThumbnail();
      };
      ctx.onCleanup(() => {
        for (const name of ["player.song_video", "player.song_image"] as const) {
          const element = ctx.$(name);
          if (element) element.style.display = "";
        }
      });

      // For video tracks YTM leaves a placeholder in the cover-art slot; use the video's thumbnail.
      const forceThumbnail = () => {
        const image = ctx.$<HTMLImageElement>("player.song_image_img");
        const thumbnails = ctx.player.api?.getPlayerResponse().videoDetails?.thumbnail?.thumbnails ?? [];
        const best = thumbnails.toSorted((a, b) => b.width * b.height - a.width * a.height)[0];
        if (!image || !best || !image.src.startsWith("data:")) return;
        image.src = best.url.split("?")[0]!;
      };

      const onTrack = () => {
        // Audio-only tracks have no video to switch to.
        hasVideo = ctx.player.state.track?.mediaType !== "audio";
        apply();
      };

      void ctx.waitFor("player.container").then((player) => {
        player.prepend(container);
        ctx.player.on("trackChange", onTrack);
        onTrack();
        // YTM switches playback-mode back after loading; keep the user's choice.
        const observer = new MutationObserver(() => {
          const wanted = showVideo && hasVideo ? "OMV_PREFERRED" : "ATV_PREFERRED";
          if (player.getAttribute("playback-mode") !== wanted) apply();
          if (!(showVideo && hasVideo)) forceThumbnail();
        });
        observer.observe(player, { attributes: true, attributeFilter: ["playback-mode"] });
        const image = ctx.$("player.song_image_img");
        if (image) observer.observe(image, { attributes: true, attributeFilter: ["src"] });
        ctx.onCleanup(() => observer.disconnect());
      }, () => {});

      // The switch writes hideVideo itself; apply that (and edits from settings) without a restart.
      const others = settingsKey(ctx.config);
      liveUpdates.set(ctx, (config) => {
        if (settingsKey(config) !== others) return false;
        if (showVideo === config.hideVideo) setVideoState(!config.hideVideo, false);
        return true;
      });
      },
    onConfigChange(config, ctx) {
      return liveUpdates.get(ctx)?.(config) ? undefined : "restart";
    },
  },
});

interface VideoToggleConfig {
  mode: string;
  align: string;
  hideVideo: boolean;
  forceHide: boolean;
}

const liveUpdates = new WeakMap<object, (config: VideoToggleConfig) => boolean>();

const settingsKey = ({ mode, align, forceHide }: VideoToggleConfig) => `${mode}/${align}/${forceHide}`;

function choice(label: string, onSelect: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "radio");
  button.textContent = label;
  button.addEventListener("click", onSelect);
  return button;
}
