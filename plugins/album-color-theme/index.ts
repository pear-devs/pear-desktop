import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { averageColor, formatRgb, themeColors } from "./color.ts";

const ACTIVE = "pear-album-color";
const SAMPLE_SIZE = 32;

// YTM's dark palette, each color mixed with the artwork color. The colors come
// in as custom properties; `--pear-transparent-opacity` is set by transparent-player.
const THEME = css`
  html.pear-album-color {
    --ytmusic-color-black1: color-mix(in srgb, #212121, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --ytmusic-color-black2: color-mix(in srgb, #181818, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --ytmusic-color-black3: color-mix(in srgb, #030303, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --ytmusic-color-black4: color-mix(in srgb, #030303, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --ytmusic-color-blackpure: color-mix(in srgb, #000, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --dark-theme-background-color: color-mix(in srgb, #212121, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-base-background: color-mix(in srgb, #0f0f0f, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-raised-background: color-mix(in srgb, #212121, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-menu-background: color-mix(in srgb, #282828, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-static-brand-black: color-mix(in srgb, #212121, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-static-overlay-background-solid: color-mix(in srgb, #000, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-static-overlay-background-heavy: color-mix(in srgb, rgb(0 0 0 / 0.8), rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-static-overlay-background-medium: color-mix(in srgb, rgb(0 0 0 / 0.6), rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-static-overlay-background-medium-light: color-mix(in srgb, rgb(0 0 0 / 0.3), rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-static-overlay-background-light: color-mix(in srgb, rgb(0 0 0 / 0.1), rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-general-background-a: color-mix(in srgb, #181818, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-general-background-b: color-mix(in srgb, #0f0f0f, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-general-background-c: color-mix(in srgb, #030303, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-snackbar-background: color-mix(in srgb, #030303, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-filled-button-text: color-mix(in srgb, #030303, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-black-1: color-mix(in srgb, #282828, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-black-2: color-mix(in srgb, #1f1f1f, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-black-3: color-mix(in srgb, #161616, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-black-4: color-mix(in srgb, #0d0d0d, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-black-pure: color-mix(in srgb, #000, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-black-pure-alpha-5: color-mix(in srgb, rgb(0 0 0 / 0.05), rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-black-pure-alpha-10: color-mix(in srgb, rgb(0 0 0 / 0.1), rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-black-pure-alpha-15: color-mix(in srgb, rgb(0 0 0 / 0.15), rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-black-pure-alpha-30: color-mix(in srgb, rgb(0 0 0 / 0.3), rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-black-pure-alpha-60: color-mix(in srgb, rgb(0 0 0 / 0.6), rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-black-pure-alpha-80: color-mix(in srgb, rgb(0 0 0 / 0.8), rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-black-1-alpha-98: color-mix(in srgb, rgb(40 40 40 / 0.98), rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --yt-spec-black-1-alpha-95: color-mix(in srgb, rgb(40 40 40 / 0.95), rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --paper-toast-background-color: color-mix(in srgb, #323232, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --ytmusic-search-background: color-mix(in srgb, #030303, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --paper-slider-knob-color: color-mix(in srgb, #f03, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --paper-dialog-background-color: color-mix(in srgb, #212121, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    --paper-progress-active-color-1: color-mix(in srgb, #f03, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) min(100%, var(--pear-album-ratio) * 1.75)) !important;
    --paper-progress-active-color-2: color-mix(in srgb, #ff2791, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) min(100%, var(--pear-album-ratio) * 1.75)) !important;
    --yt-spec-inverted-background: color-mix(in srgb, #f3f3f3, rgba(var(--pear-album-color), var(--pear-transparent-opacity, 1)) min(100%, var(--pear-album-ratio) * 1.75)) !important;
    --ytmusic-background: color-mix(in srgb, #030303, rgba(var(--pear-album-color-dark), var(--pear-transparent-opacity, 1)) var(--pear-album-ratio)) !important;
    background: var(--ytmusic-background) !important;
  }
  html.pear-album-color body {
    background: var(--ytmusic-background) !important;
  }
  sel(nav_bar.background),
  sel(player_bar.background),
  sel(guide.background),
  sel(guide.mini_background),
  sel(player.page) {
    transition: background-color 300ms cubic-bezier(0.2, 0, 0.6, 1) !important;
  }
  html.pear-album-color sel(player_bar) {
    color: rgb(255 255 255 / 0.6) !important;
  }
`;

const SEEKBAR = css`
  html.pear-album-color sel(player_bar.progress) {
    --paper-slider-active-color: linear-gradient(to right, var(--paper-progress-active-color-1) 80%, var(--paper-progress-active-color-2) 100%) !important;
    --paper-slider-knob-color: var(--paper-progress-active-color-1) !important;
    --paper-slider-knob-start-color: var(--paper-progress-active-color-2) !important;
  }
`;

export default definePlugin({
  id: "album-color-theme",
  name: "Album color theme",
  description: "Tints the interface with the colors of the current track's artwork.",
  config: {
    ratio: config.number(50, { label: "Color strength", min: 0, max: 100, step: 5, unit: "%" }),
    enableSeekbar: config.bool(true, { label: "Color the progress bar" }),
  },
  style: (config) => `${THEME}${config.enableSeekbar ? SEEKBAR : ""}:root{--pear-album-ratio:${config.ratio}%}`,
  page: (ctx) => {
    const root = document.documentElement;
    const colors = ctx.addStyle("");
    ctx.onCleanup(() => root.classList.remove(ACTIVE));

    let generation = 0;
    const apply = async () => {
      const current = ++generation;
      const url = thumbnailUrl(ctx.player.api?.getPlayerResponse().videoDetails?.thumbnail?.thumbnails) ??
        ctx.player.state.track?.artworkUrl;
      const average = url ? await sampleImage(url).catch((error) => ctx.log.warn("couldn't sample artwork", error)) : undefined;
      if (current !== generation || ctx.signal.aborted) return;
      if (!average) {
        root.classList.remove(ACTIVE);
        return;
      }
      const { color, dark } = themeColors(average);
      colors.update(`:root{--pear-album-color:${formatRgb(color)};--pear-album-color-dark:${formatRgb(dark)}}`);
      root.classList.add(ACTIVE);
    };
    ctx.player.on("trackChange", () => void apply());
    if (ctx.player.state.track) void apply();
  },
});

/** The smallest thumbnail is plenty for an average and loads fastest. */
function thumbnailUrl(thumbnails: { url: string; width: number }[] | undefined) {
  return thumbnails?.toSorted((a, b) => a.width - b.width)[0]?.url;
}

async function sampleImage(url: string) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return averageColor(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
}
