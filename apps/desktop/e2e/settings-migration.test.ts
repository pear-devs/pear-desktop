// pear-desktop 3.x settings carry over: config.json is migrated in place.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ytmUrl } from "@pear/sdk/util";
import { expect, test } from "./fixtures.ts";
import { pluginConfig, pluginEnabled } from "./helpers/plugins.ts";
import { savedSettings } from "./helpers/settings.ts";
import { isAlwaysOnTop } from "./helpers/window.ts";

test.use({
  appOptions: {
    config: {
      "window-size": { width: 900, height: 700 },
      "window-maximized": false,
      "window-position": { x: -1, y: -1 },
      url: ytmUrl("/watch?v=dQw4w9WgXcQ"),
      options: { tray: false, alwaysOnTop: true, resumeOnStart: false, startingPage: "Explore", language: "el" },
      plugins: {
        clock: { enabled: true },
        "blur-nav-bar": { enabled: true, blur: 20 },
        "api-server": { enabled: false, authorizedClients: ["phone"] },
        "picture-in-picture": { "pip-position": [30, 40] },
      },
      __internal__: { migrations: { version: "3.12.0" } },
    },
  },
});

test("an existing pear-desktop 3.x config.json is migrated in place", async ({ app, page }) => {
  await expect.poll(() => new URL(page.url()).pathname).toBe("/explore");
  expect(await isAlwaysOnTop(app)).toBe(true);
  expect(await pluginEnabled(page, "clock")).toBe(true);
  expect(await pluginEnabled(page, "tray")).toBe(false);
  expect((await pluginConfig(page, "blur-nav-bar"))?.blur).toBe(20);
  const file = savedSettings(app.userData);
  expect(file.__internal__.migrations.version).toBe("4.0.0");
  // Options this version doesn't use yet are kept.
  expect(file.options.language).toBe("el");
});

test("pear-desktop's defaults apply where the rewrite's differ", async ({ app, page }) => {
  // performance-improvement on, the API server on every interface; and PiP's saved position in its own file.
  expect(await pluginEnabled(page, "performance-improvement")).toBe(true);
  expect(savedSettings(app.userData).plugins["api-server"].hostname).toBe("0.0.0.0");
  expect(JSON.parse(readFileSync(join(app.userData, "picture-in-picture.json"), "utf8"))).toEqual({ x: 30, y: 40 });
});
