/** @jsxImportSource @pear/sdk */
import { config, definePlugin, type PageContextOf } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

// Re-check for view changes the observer misses (miniplayer, video/song switch).
const FALLBACK_SYNC_MS = 1000;
// Until the video reports its size.
const DEFAULT_ASPECT = 9 / 16;

const schema = {
  interpolationTime: config.number(1500, {
    label: "Transition smoothness",
    description: "How long the glow takes to follow the video.",
    min: 0,
    max: 5000,
    step: 100,
    unit: "ms",
  }),
  quality: config.number(50, { label: "Quality", min: 10, max: 1000, step: 10, unit: "px" }),
  size: config.number(100, { label: "Size", min: 100, max: 300, step: 5, unit: "%" }),
  buffer: config.number(30, { label: "Frame rate", min: 1, max: 60, step: 1, unit: "fps" }),
  opacity: config.number(100, { label: "Opacity", min: 0, max: 100, step: 5, unit: "%" }),
  blur: config.number(100, { label: "Blur", min: 0, max: 500, step: 5, unit: "px" }),
  fullscreen: config.bool(false, {
    label: "Fill the window",
    description: "Let the video's glow cover the whole player page.",
  }),
};

type Ctx = PageContextOf<typeof schema>;
type GlowKind = "video" | "image";

export default definePlugin({
  id: "ambient-mode",
  name: "Ambient mode",
  description: "Surrounds the video or cover art with a soft glow of its own colors.",
  config: schema,
  style: css`
    .pear-ambient {
      position: absolute;
      left: 50%;
      top: 50%;
      width: var(--pear-ambient-size, 100%);
      height: var(--pear-ambient-size, 100%);
      transform: translate(-50%, -50%);
      filter: blur(var(--pear-ambient-blur, 100px));
      opacity: var(--pear-ambient-opacity, 1);
      object-fit: cover;
      pointer-events: none;
    }
    canvas.pear-ambient.fullscreen {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      transform: none;
    }
    sel(player.container):not([video-mode]):not([player-ui-state='MINIPLAYER']) {
      overflow: visible;
    }
    sel(player.side_panel) {
      z-index: 0;
    }
    sel(player.av_toggle) {
      z-index: 1;
    }
  `,
  page(ctx) {
    // Config changes restart the page part, which rebuilds the glow.
    let glow: { kind: GlowKind; source: string; remove(): void } | null = null;
    ctx.onCleanup(() => glow?.remove());

    const sync = () => {
      const wanted = wantedGlow(ctx);
      if (glowKey(wanted) === glowKey(glow)) return;
      glow?.remove();
      glow = null;
      if (!wanted) return;
      const remove = wanted.kind === "video" ? mountVideo(ctx) : mountImage(ctx);
      if (remove) glow = { ...wanted, remove };
    };

    ctx.observe("player.page", { attributes: true }, sync);
    void ctx.waitFor("player.page").then(sync, () => {});
    ctx.setInterval(sync, FALLBACK_SYNC_MS);
  },
});

/** What the glow should follow right now: nothing while the player page is closed. */
function wantedGlow(ctx: Ctx): { kind: GlowKind; source: string } | null {
  const open = ctx.$("app.layout")?.hasAttribute("player-page-open") ?? false;
  if (!open) return null;
  const songVideo = ctx.$("player.song_video");
  const isVideo = !!songVideo && getComputedStyle(songVideo).display !== "none";
  if (isVideo) return { kind: "video", source: ctx.player.video()?.src ?? "" };
  return { kind: "image", source: ctx.$<HTMLImageElement>("player.song_image_img")?.src ?? "" };
}

const glowKey = (glow: { kind: GlowKind; source: string } | null) => (glow ? `${glow.kind} ${glow.source}` : "");

function applyStyle(ctx: Ctx, element: HTMLElement) {
  element.style.setProperty("--pear-ambient-size", `${ctx.config.size}%`);
  element.style.setProperty("--pear-ambient-blur", `${ctx.config.blur}px`);
  element.style.setProperty("--pear-ambient-opacity", `${ctx.config.opacity / 100}`);
}

/** A blurred copy of the cover art; returns its removal, or nothing if there is no artwork yet. */
function mountImage(ctx: Ctx) {
  const container = ctx.$("player.song_image");
  const source = ctx.$<HTMLImageElement>("player.song_image_img");
  // YTM shows a transparent placeholder until the artwork loads.
  if (!container || !source || source.src.startsWith("data:")) return;
  const image = <img class="pear-ambient" alt="" src={source.src} />;
  applyStyle(ctx, image);
  container.prepend(image);
  return () => image.remove();
}

/** A small canvas painted from the video; returns its removal, or nothing if there is no video. */
function mountVideo(ctx: Ctx) {
  const wrapper = ctx.$("player.song_video_wrapper");
  const video = ctx.player.video();
  if (!wrapper || !video) return;
  const canvas = (<canvas class="pear-ambient" />) as HTMLCanvasElement;
  const context = canvas.getContext("2d")!;
  const resize = () => {
    const width = ctx.config.quality;
    const aspect = video.videoHeight && video.videoWidth ? video.videoHeight / video.videoWidth : DEFAULT_ASPECT;
    canvas.width = width;
    canvas.height = Math.max(1, Math.round(width * aspect));
  };
  // Each frame is blended over the previous ones, so the glow eases toward the video.
  const draw = () => {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !ctx.isWindowVisible()) return;
    context.globalAlpha = blendAlpha(ctx);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  const run = () => {
    ctx.clearInterval(timer);
    timer = video.paused ? undefined : ctx.setInterval(draw, Math.max(1, Math.ceil(1000 / ctx.config.buffer)));
  };
  applyStyle(ctx, canvas);
  canvas.classList.toggle("fullscreen", ctx.config.fullscreen);
  resize();
  context.globalAlpha = 1;
  draw();
  run();
  // This glow's listeners go with it; the plugin stopping removes it too.
  const removed = new AbortController();
  video.addEventListener("play", run, { signal: removed.signal });
  video.addEventListener("pause", run, { signal: removed.signal });
  video.addEventListener("loadedmetadata", resize, { signal: removed.signal });
  wrapper.prepend(canvas);
  return () => {
    ctx.clearInterval(timer);
    removed.abort();
    canvas.remove();
  };
}

/** How much of each new frame shows through: the share of the transition one frame covers. */
function blendAlpha(ctx: Ctx) {
  if (ctx.config.interpolationTime <= 0) return 1;
  const frameMs = 1000 / ctx.config.buffer;
  return Math.min(1, frameMs / ctx.config.interpolationTime);
}
