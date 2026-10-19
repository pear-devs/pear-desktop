import { resolve } from "node:path";
import pear from "@pear/vite-plugin";
import { defineConfig } from "electron-vite";

const pearOptions = {
  pluginsDir: resolve(import.meta.dirname, "../../plugins"),
  ...(process.env.PEAR_ONLY_PLUGINS ? { only: process.env.PEAR_ONLY_PLUGINS.split(",") } : {}),
};

export default defineConfig({
  main: {
    plugins: [pear(pearOptions)],
  },
  preload: {
    plugins: [pear(pearOptions)],
    build: {
      rollupOptions: {
        // Sandboxed preloads must be CommonJS.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
});
