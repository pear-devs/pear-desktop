/** @jsxImportSource @pear/sdk */
import { config, definePlugin, type ConfigOf, type PageContextOf } from "@pear/sdk";
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

const schema = {
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
};

type Config = ConfigOf<typeof schema>;
type Ctx = PageContextOf<typeof schema>;
type SetAttribute = (element: Element | null, name: string, value: string | null) => void;

const OMV = "OMV_PREFERRED";
const ATV = "ATV_PREFERRED";

export default definePlugin({
  id: "video-toggle",
  name: "Video toggle",
  description: "Switch between a track's music video and its cover art, or hide the video entirely.",
  config: schema,
  style,
  page(ctx) {
    if (ctx.config.forceHide) return;
    const setAttribute = attributeRestorer(ctx);
    if (ctx.config.mode === "custom") customSwitch(ctx, setAttribute);
    else nativeSwitch(ctx, setAttribute);
  },
});

function style(config: Config) {
  if (config.forceHide) return FORCE_HIDE;
  if (config.mode !== "custom") return "";
  return `${CUSTOM}:root{--pear-video-toggle-align:${ALIGN[config.align]}}`;
}

/** Sets attributes like `setAttribute`, putting the original values back on cleanup. */
function attributeRestorer(ctx: Ctx): SetAttribute {
  const restore = new Map<Element, [string, string | null][]>();
  ctx.onCleanup(() => {
    for (const [element, saved] of restore) {
      for (const [name, value] of saved) writeAttribute(element, name, value);
    }
  });
  return (element, name, value) => {
    if (!element || element.getAttribute(name) === value) return;
    const saved = restore.get(element) ?? [];
    if (!saved.some(([n]) => n === name)) saved.push([name, element.getAttribute(name)]);
    restore.set(element, saved);
    writeAttribute(element, name, value);
  };
}

function writeAttribute(element: Element, name: string, value: string | null) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

/** Enables or disables YTM's own song/video switch. */
function nativeSwitch(ctx: Ctx, setAttribute: SetAttribute) {
  const enable = ctx.config.mode === "native";
  const apply = () => {
    const hasSwitcher = enable ? "" : null;
    setAttribute(ctx.$("player.page"), "has-av-switcher", hasSwitcher);
    setAttribute(ctx.$("player.container"), "has-av-switcher", hasSwitcher);
    setAttribute(ctx.$("player.av_toggle"), "toggle-disabled", enable ? null : "");
  };
  void ctx.waitFor("player.av_toggle").then(() => {
    apply();
    // YTM resets these when a track loads.
    ctx.player.on("trackChange", apply);
  }, () => {});
}

/** Pear's own Song / Video switch over the player. */
function customSwitch(ctx: Ctx, setAttribute: SetAttribute) {
  let showVideo = !ctx.config.hideVideo;
  let hasVideo = true;
  const visible = () => showVideo && hasVideo;

  const setVideoState = (show: boolean, remember = true) => {
    showVideo = show;
    if (remember && ctx.config.hideVideo === show) ctx.setConfig({ hideVideo: !show });
    apply();
  };

  const songButton = choice(ctx.t("plugins.video-toggle.templates.button-song", "Song"), () => setVideoState(false));
  const videoButton = choice(ctx.t("plugins.video-toggle.templates.button-video", "Video"), () => setVideoState(true));
  // Clicks on the player would toggle playback.
  const container = (
    <div class="pear-video-toggle" onClick={(event) => event.stopPropagation()}>
      <div role="radiogroup" aria-label={ctx.t("plugins.video-toggle.templates.group", "Show")}>
        {songButton}
        {videoButton}
      </div>
    </div>
  );
  ctx.onCleanup(() => container.remove());

  const apply = () => {
    const player = ctx.$<PlayerElement>("player.container");
    const songVideo = ctx.$("player.song_video");
    const songImage = ctx.$("player.song_image");
    const shown = visible();
    songButton.setAttribute("aria-checked", String(!shown));
    videoButton.setAttribute("aria-checked", String(shown));
    container.hidden = !hasVideo;
    if (!player || !songVideo || !songImage) return;
    setAttribute(player, "playback-mode", shown ? OMV : ATV);
    songVideo.style.display = shown ? "block" : "none";
    songImage.style.display = shown ? "none" : "block";
    if (!shown) forceThumbnail(ctx);
  };
  ctx.onCleanup(() => {
    for (const name of ["player.song_video", "player.song_image"] as const) {
      const element = ctx.$(name);
      if (element) element.style.display = "";
    }
  });

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
    const keepChoice = () => {
      const wanted = visible() ? OMV : ATV;
      if (player.getAttribute("playback-mode") !== wanted) apply();
      if (!visible()) forceThumbnail(ctx);
    };
    ctx.observe(player, { attributes: true, attributeFilter: ["playback-mode"] }, keepChoice);
    const image = ctx.$("player.song_image_img");
    if (image) ctx.observe(image, { attributes: true, attributeFilter: ["src"] }, keepChoice);
  }, () => {});

  // The switch writes hideVideo itself; apply that (and edits from settings) without a restart.
  const layout = layoutKey(ctx.config);
  ctx.onConfigChange((config) => {
    if (layoutKey(config) !== layout) return "restart";
    if (showVideo === config.hideVideo) setVideoState(!config.hideVideo, false);
  });
}

// For video tracks YTM leaves a placeholder in the cover-art slot; use the video's thumbnail.
function forceThumbnail(ctx: Ctx) {
  const image = ctx.$<HTMLImageElement>("player.song_image_img");
  const thumbnails = ctx.player.api?.getPlayerResponse().videoDetails?.thumbnail?.thumbnails ?? [];
  const best = thumbnails.toSorted((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!image || !best || !image.src.startsWith("data:")) return;
  image.src = best.url.split("?")[0]!;
}

/** The settings that need a restart: all but hideVideo. */
const layoutKey = ({ mode, align, forceHide }: Config) => `${mode}/${align}/${forceHide}`;

function choice(label: string, onSelect: () => void) {
  return (
    <button type="button" role="radio" onClick={onSelect}>
      {label}
    </button>
  );
}
