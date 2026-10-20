import { definePlugin } from "@pear/sdk";
import { injectCpuTamerByAnimationFrame } from "./scripts/cpu-tamer-by-animationframe.js";
import { injectCpuTamerByDomMutation } from "./scripts/cpu-tamer-by-dom-mutation.js";
import { injectRm3 } from "./scripts/rm3.js";

/** Whether WebGL works, i.e. animation frames are cheap (from pear-desktop). */
function hasGpuAcceleration() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

export default definePlugin({
  id: "performance-improvement",
  name: "Performance improvement",
  description:
    "Lowers CPU use with CY Fung's scripts: batches the page's timers onto animation frames and reuses \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music's list elements. Takes effect after a restart.",
  // The scripts replace setTimeout/setInterval and hook element creation for
  // the whole page; that can't be undone live, so the page part only runs
  // when the plugin was enabled at page load (see PluginDef.restartRequired).
  restartRequired: true,
  page: {
    runAt: "start",
    start(ctx) {
      const gpu = hasGpuAcceleration();
      injectRm3();
      if (gpu) injectCpuTamerByAnimationFrame(null);
      else injectCpuTamerByDomMutation(null);
      ctx.log.info(`timers tamed by ${gpu ? "animation frames" : "DOM mutations"}`);
    },
  },
});
