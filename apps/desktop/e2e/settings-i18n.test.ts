// The app follows the chosen language, with pear-desktop's translations.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures.ts";
import { openSettings, pluginRow, searchbox } from "./helpers/settings.ts";

test.use({ appOptions: { core: { general: { language: "de" } } } });

test("follows the chosen language, with English for untranslated texts", async ({ page }) => {
  const de = JSON.parse(readFileSync(join(import.meta.dirname, "../../../src/i18n/resources/de.json"), "utf8"));
  await page.waitForFunction(() => window.__pearRuntime?.settings);
  // pear-desktop's translated plugin names.
  const name = await page.evaluate(() => window.__pearRuntime!.plugins.plugins.find((p) => p.id === "clock")!.name);
  expect(name).toBe(de.plugins.clock.name);
  await openSettings(page);
  await searchbox(page).fill(de.plugins.clock.name);
  await expect(pluginRow(page, "clock")).toContainText(de.plugins.clock.name);
  // Texts Weblate hasn't translated yet fall back to English.
  expect(await page.evaluate(() => window.__pearRuntime!.plugins.t("settings-ui.no-such-key", "fallback"))).toBe("fallback");
});
