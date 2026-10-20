import type { Renderer, Stage } from "../config.ts";
import { loadUmd } from "../load.ts";
import { quietAudio } from "./silent.ts";

/** Vudio's bars and waves; it animates itself. */
export async function vudioRenderer({ ctx, graph, canvas }: Stage): Promise<Renderer | undefined> {
  const { context } = quietAudio(ctx, graph);
  const Vudio = await loadUmd<VudioConstructor>(ctx.host.invoke("vudio"));
  if (ctx.signal.aborted) return;
  const vudio = withAudioContext(context, () => new Vudio(new MediaStream(), canvas, vudioOptions(ctx, canvas)));
  vudio.dance();
  ctx.onCleanup(() => vudio.pause());
  return { resize: (width, height) => vudio.setOption({ width, height }) };
}

function vudioOptions({ config }: Stage["ctx"], canvas: HTMLCanvasElement) {
  const effect = config.vudioEffect;
  return {
    width: canvas.width,
    height: canvas.height,
    effect,
    accuracy: Number(config.vudioAccuracy),
    [effect]: {
      maxHeight: config.vudioMaxHeight,
      maxSize: config.vudioMaxSize,
      lineWidth: config.vudioLineWidth,
      color: config.vudioColor,
      shadowBlur: config.vudioShadowBlur,
      shadowColor: config.vudioShadowColor,
      fadeSide: config.vudioFadeSide,
      prettify: config.vudioPrettify,
      dottify: config.vudioDottify,
      horizontalAlign: config.vudioHorizontalAlign,
      verticalAlign: config.vudioVerticalAlign,
    },
  };
}

/** Vudio creates its own AudioContext and takes over window.onresize; give it ours and keep onresize. */
function withAudioContext<T>(context: AudioContext, create: () => T): T {
  const OriginalContext = window.AudioContext;
  const onresize = window.onresize;
  window.AudioContext = function () {
    return context;
  } as unknown as typeof AudioContext;
  try {
    return create();
  } finally {
    window.AudioContext = OriginalContext;
    window.onresize = onresize;
  }
}
