import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

// Re-check for view changes the observer misses (miniplayer, video/song switch).
const FALLBACK_SYNC_MS = 1000;

export default definePlugin({
  id: "ambient-mode",
  name: "Ambient mode",
  description: "Surrounds the video or cover art with a soft glow of its own colors.",
  config: {
    interpolationTime: config.number(1500, {
      label: "Transition smoothness",
      description: "How long the glow takes to follow the video.",
      min: 0,
      max: 5000,
      step: 100,
      unit: "ms",
    }),
    quality: config.number(50, { label: "Quality", min: 10, max: 500, step: 10, unit: "px" }),
    size: config.number(100, { label: "Size", min: 100, max: 300, step: 5, unit: "%" }),
    buffer: config.number(30, { label: "Frame rate", min: 1, max: 60, step: 1, unit: "fps" }),
    opacity: config.number(100, { label: "Opacity", min: 0, max: 100, step: 5, unit: "%" }),
    blur: config.number(100, { label: "Blur", min: 0, max: 500, step: 5, unit: "px" }),
    fullscreen: config.bool(false, {
      label: "Fill the window",
      description: "Let the video's glow cover the whole player page.",
    }),
  },
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
    sel(player.player):not([video-mode]):not([player-ui-state='MINIPLAYER']) {
      overflow: visible;
    }
    sel(player.side_panel) {
      z-index: 0;
    }
    sel(player.av_toggle) {
      z-index: 1;
    }
  `,
  page: {
    start(ctx) {
      // Config changes restart the page part, which rebuilds the glow.
      const glow = { remove: () => {} };
      ctx.onCleanup(() => glow.remove());
      let mounted: "video" | "image" | null = null;
      let mountedSource = "";

      const applyStyle = (element: HTMLElement) => {
        element.style.setProperty("--pear-ambient-size", `${ctx.config.size}%`);
        element.style.setProperty("--pear-ambient-blur", `${ctx.config.blur}px`);
        element.style.setProperty("--pear-ambient-opacity", `${ctx.config.opacity / 100}`);
      };

      const mountImage = (container: HTMLElement, source: HTMLImageElement) => {
        const image = document.createElement("img");
        image.className = "pear-ambient";
        image.alt = "";
        image.src = source.src;
        applyStyle(image);
        container.prepend(image);
        glow.remove = () => image.remove();
      };

      const mountVideo = (wrapper: HTMLElement, video: HTMLVideoElement) => {
        const canvas = document.createElement("canvas");
        canvas.className = "pear-ambient";
        const context = canvas.getContext("2d")!;
        const resize = () => {
          const width = ctx.config.quality;
          const aspect = video.videoHeight && video.videoWidth ? video.videoHeight / video.videoWidth : 9 / 16;
          canvas.width = width;
          canvas.height = Math.max(1, Math.round(width * aspect));
        };
        // Each frame is blended over the previous ones, so the glow eases toward the video.
        const draw = () => {
          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
          const frameMs = 1000 / ctx.config.buffer;
          context.globalAlpha = ctx.config.interpolationTime > 0 ? Math.min(1, frameMs / ctx.config.interpolationTime) : 1;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
        };
        let timer: ReturnType<typeof setInterval> | undefined;
        const run = () => {
          clearInterval(timer);
          timer = video.paused ? undefined : setInterval(draw, Math.max(1, Math.ceil(1000 / ctx.config.buffer)));
        };
        applyStyle(canvas);
        canvas.classList.toggle("fullscreen", ctx.config.fullscreen);
        resize();
        context.globalAlpha = 1;
        draw();
        run();
        video.addEventListener("play", run);
        video.addEventListener("pause", run);
        video.addEventListener("loadedmetadata", resize);
        wrapper.prepend(canvas);
        glow.remove = () => {
          clearInterval(timer);
          video.removeEventListener("play", run);
          video.removeEventListener("pause", run);
          video.removeEventListener("loadedmetadata", resize);
          canvas.remove();
        };
      };

      const sync = () => {
        const open = ctx.$("app.layout")?.hasAttribute("player-page-open") ?? false;
        const songVideo = ctx.$("player.song_video");
        const isVideo = !!songVideo && getComputedStyle(songVideo).display !== "none";
        const video = ctx.player.video();
        const image = ctx.$<HTMLImageElement>("player.song_image_img");
        const wanted = !open ? null : isVideo ? "video" : "image";
        const source = wanted === "video" ? (video?.src ?? "") : wanted === "image" ? (image?.src ?? "") : "";
        if (wanted === mounted && source === mountedSource) return;
        glow.remove();
        glow.remove = () => {};
        mounted = null;
        mountedSource = "";
        if (wanted === "video") {
          const wrapper = ctx.$("player.song_video_wrapper");
          if (!wrapper || !video) return;
          mountVideo(wrapper, video);
        } else if (wanted === "image") {
          const container = ctx.$("player.song_image");
          // YTM shows a transparent placeholder until the artwork loads.
          if (!container || !image || image.src.startsWith("data:")) return;
          mountImage(container, image);
        } else {
          return;
        }
        mounted = wanted;
        mountedSource = source;
      };

      void ctx.waitFor("player.page").then((page) => {
        const observer = new MutationObserver(sync);
        observer.observe(page, { attributes: true });
        ctx.onCleanup(() => observer.disconnect());
        sync();
      }, () => {});
      const interval = setInterval(sync, FALLBACK_SYNC_MS);
      ctx.onCleanup(() => clearInterval(interval));
    },
  },
});
