import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { bundlePage } from "../src/index.ts";

const fixtures = resolve(import.meta.dirname, "fixtures");
const entry = resolve(fixtures, "entry.ts");

describe("page bundle", () => {
  test("expands macros and contains no host code", async () => {
    const { code } = await bundlePage(entry, { pluginsDir: resolve(fixtures, "good") });
    expect(code).toContain('"#nav-bar-divider{display:none!important}"');
    expect(code).toContain('"ytmusic-player-bar .next-button, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytmusicPlayerControlsNextButton button"');
    expect(code).not.toContain("HOST_ONLY_MARKER");
    expect(code).not.toContain("node:fs");
    expect(code).not.toContain("lightningcss");
  });

  test("fails the build on an unknown selector", async () => {
    await expect(bundlePage(entry, { pluginsDir: resolve(fixtures, "bad") })).rejects.toThrow(
      /unknown selector "does.not.exist"/,
    );
  });
});
