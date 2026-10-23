import { describe, expect, test } from "vitest";
import { translator } from "../src/i18n.ts";
import { YTM_NAME } from "../src/util.ts";

describe("translator", () => {
  test("fills {{applicationName}} without the caller passing it, as pear-desktop's strings expect", () => {
    const t = translator({ "plugins.amuse.description": "Adds {{applicationName}} support" });
    expect(t("plugins.amuse.description")).toBe(`Adds ${YTM_NAME} support`);
  });

  test("lets the caller's variables win, and leaves unknown placeholders alone", () => {
    const t = translator({ greeting: "{{applicationName}}: {{title}} {{missing}}" });
    expect(t("greeting", undefined, { applicationName: "X", title: "Song" })).toBe("X: Song {{missing}}");
  });
});
