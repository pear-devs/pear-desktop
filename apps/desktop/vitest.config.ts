import { resolve } from "node:path";
import pear from "@pear/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The real plugins (virtual:pear/host-plugins), for tests of their stored settings.
  plugins: [pear({ pluginsDir: resolve(import.meta.dirname, "../../plugins") })],
  test: {
    include: ["test/**/*.test.ts"],
    // Vitest handles electron itself, so a test's vi.mock("electron") reaches every
    // named import of it. Left to Node (since electron 44.10's lazy-download
    // index.js), the source files' named imports bypassed the mock and got undefined.
    server: { deps: { inline: ["electron"] } },
  },
});
