import type { Renderer, Stage } from "../config.ts";
import { importSource } from "../load.ts";

// The loaded module, kept across restarts.
let butterchurn: Promise<ButterchurnModule> | undefined;

/** Milkdrop presets on WebGL; drawn by the page's frame loop. */
export async function butterchurnRenderer({ ctx, graph, canvas, size }: Stage): Promise<Renderer | undefined> {
  butterchurn ??= ctx.host.invoke("butterchurn").then((source) => importSource<ButterchurnModule>(source));
  const [module, preset] = await Promise.all([butterchurn, ctx.host.invoke("preset", ctx.config.preset)]);
  if (ctx.signal.aborted) return;
  const input = graph.context.createGain();
  ctx.onCleanup(() => input.disconnect());
  graph.tap(input);
  const visualizer = module.default.createVisualizer(graph.context, canvas, size());
  ctx.onCleanup(() => visualizer.loseGLContext());
  visualizer.connectAudio(input);
  await visualizer.loadPreset(preset, ctx.config.blendTimeInSeconds);
  ctx.player.on("trackChange", (track) => {
    if (ctx.config.songTitle) visualizer.launchSongTitleAnim(`${track.artist} - ${track.title}`);
  });
  return {
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
      visualizer.setRendererSize(width, height);
    },
    render: () => visualizer.render(),
  };
}
