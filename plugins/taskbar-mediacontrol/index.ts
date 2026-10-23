import { definePlugin, type NowPlaying } from "@pear/sdk";
import { isPlaying } from "@pear/sdk/util";
import { nativeImage, nativeTheme, type NativeImage, type ThumbarButton } from "electron";

type Point = readonly [number, number];
type Icon = "play" | "pause" | "next" | "previous";

// Glyphs as polygons in a 16×16 design space, rasterized in code so no asset files are needed.
const DESIGN_SIZE = 16;
const GLYPHS: Record<Icon, Point[][]> = {
  play: [[[4, 2.5], [13.5, 8], [4, 13.5]]],
  pause: [
    [[3.5, 2.5], [6.5, 2.5], [6.5, 13.5], [3.5, 13.5]],
    [[9.5, 2.5], [12.5, 2.5], [12.5, 13.5], [9.5, 13.5]],
  ],
  next: [
    [[2.5, 2.5], [10.5, 8], [2.5, 13.5]],
    [[11, 2.5], [13.5, 2.5], [13.5, 13.5], [11, 13.5]],
  ],
  previous: [
    [[13.5, 2.5], [5.5, 8], [13.5, 13.5]],
    [[2.5, 2.5], [5, 2.5], [5, 13.5], [2.5, 13.5]],
  ],
};

/** The buttons' bitmap size: 16 px at scale factor 2. */
const SIZE = 32;
const SAMPLES = 4;

export default definePlugin({
  id: "taskbar-mediacontrol",
  name: "Taskbar media controls",
  description: "Previous, play/pause and next buttons in the window's taskbar thumbnail.",
  platforms: ["win32"],
  host: {
    start(ctx) {
      const { window } = ctx;
      let icons = renderIcons();

      const update = (state: NowPlaying = ctx.player.state) => {
        if (window.isDestroyed()) return;
        // Nothing to control until a track is loaded.
        if (!state.track) return void window.setThumbarButtons([]);
        const playing = isPlaying(state);
        const buttons: ThumbarButton[] = [
          { tooltip: ctx.t("main.tray.previous", "Previous"), icon: icons.previous, click: () => ctx.player.control({ type: "previous" }) },
          {
            tooltip: playing ? ctx.t("plugins.taskbar-mediacontrol.pause", "Pause") : ctx.t("plugins.taskbar-mediacontrol.play", "Play"),
            icon: playing ? icons.pause : icons.play,
            click: () => ctx.player.control({ type: "toggle" }),
          },
          { tooltip: ctx.t("main.tray.next", "Next"), icon: icons.next, click: () => ctx.player.control({ type: "next" }) },
        ];
        window.setThumbarButtons(buttons);
      };

      ctx.player.on("change", (state, previous) => {
        const trackChanged = !!state.track !== !!previous.track;
        if (trackChanged || isPlaying(previous) !== isPlaying(state)) update(state);
      });
      const onTheme = () => {
        icons = renderIcons();
        update();
      };
      ctx.listen(nativeTheme, "updated", onTheme);
      // Windows forgets the buttons when the window is hidden.
      ctx.listen(window, "show", () => update());
      update();
      ctx.onCleanup(() => {
        if (!window.isDestroyed()) window.setThumbarButtons([]);
      });
    },
  },
});

function renderIcons(): Record<Icon, NativeImage> {
  const color: [number, number, number] = nativeTheme.shouldUseDarkColors ? [255, 255, 255] : [0, 0, 0];
  const entries = (Object.keys(GLYPHS) as Icon[]).map((name) => [
    name,
    nativeImage.createFromBitmap(rasterize(GLYPHS[name], color), { width: SIZE, height: SIZE, scaleFactor: 2 }),
  ]);
  return Object.fromEntries(entries);
}

/** BGRA, premultiplied, antialiased by supersampling. */
function rasterize(polygons: Point[][], [r, g, b]: [number, number, number]) {
  const buffer = Buffer.alloc(SIZE * SIZE * 4);
  const scale = DESIGN_SIZE / SIZE;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) * scale;
          const y = (py + (sy + 0.5) / SAMPLES) * scale;
          if (polygons.some((polygon) => inside(polygon, x, y))) hits++;
        }
      }
      const alpha = hits / (SAMPLES * SAMPLES);
      const offset = (py * SIZE + px) * 4;
      buffer[offset] = Math.round(b * alpha);
      buffer[offset + 1] = Math.round(g * alpha);
      buffer[offset + 2] = Math.round(r * alpha);
      buffer[offset + 3] = Math.round(255 * alpha);
    }
  }
  return buffer;
}

function inside(polygon: Point[], x: number, y: number) {
  // Even-odd rule: count the edges a ray to the right crosses.
  let result = false;
  for (let i = 0; i < polygon.length; i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[(i + polygon.length - 1) % polygon.length]!;
    const spansY = yi > y !== yj > y;
    if (spansY && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) result = !result;
  }
  return result;
}
