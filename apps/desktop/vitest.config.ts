import { resolve } from "node:path";
import pear from "@pear/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The real plugins (virtual:pear/host-plugins), for tests of their stored settings.
  plugins: [pear({ pluginsDir: resolve(import.meta.dirname, "../../plugins") })],
  test: { include: ["test/**/*.test.ts"] },
});
