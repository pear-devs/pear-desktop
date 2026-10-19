import pear from "@pear/vite-plugin";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    build: { rollupOptions: { input: "src/main/index.ts" } },
  },
  preload: {
    plugins: [pear()],
    build: {
      rollupOptions: {
        input: "src/preload/index.ts",
        // Sandboxed preloads must be CommonJS.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
});
