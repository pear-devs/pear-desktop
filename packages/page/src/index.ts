// Page runtime: runs in YTM's main world before any of its own scripts.

import type { Bridge, RuntimeMarker } from "./bridge.ts";

export type { Bridge, RuntimeMarker } from "./bridge.ts";

const marker: RuntimeMarker = {
  injectedAt: performance.now(),
  readyState: document.readyState,
  scriptsBefore: document.scripts.length,
};
window.__pearRuntime = marker;
console.info("[pear] runtime injected", marker);

const bridge: Bridge | undefined = window.__pear;

document.addEventListener("DOMContentLoaded", async () => {
  if (!bridge) {
    console.error("[pear] bridge missing; preload did not expose __pear");
    return;
  }
  const pong = await bridge.invoke("ping", "hello from page");
  console.info("[pear] ping →", pong);
});
