import type { AudioGraph, PageContextOf } from "@pear/sdk";

/**
 * Vudio and Wave connect their analyser to the context's output; this hands them
 * a context whose output is silent, so the track isn't played twice, and a tap
 * of the graph as their source.
 */
export function quietAudio(ctx: Pick<PageContextOf<{}>, "onCleanup">, graph: AudioGraph) {
  const tap = graph.context.createGain();
  graph.tap(tap);
  const silent = graph.context.createGain();
  silent.gain.value = 0;
  silent.connect(graph.context.destination);
  ctx.onCleanup(() => {
    tap.disconnect();
    silent.disconnect();
  });
  const context = new Proxy(graph.context, {
    get(target, key) {
      if (key === "destination") return silent;
      // Vudio builds its source from a MediaStream; hand it the tap instead.
      if (key === "createMediaStreamSource") return () => tap;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { context, tap };
}
