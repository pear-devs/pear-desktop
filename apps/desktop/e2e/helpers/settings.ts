// The in-page settings dialog and the config.json it saves to.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

export const overlay = (page: Page) => page.locator("pear-settings");
export const pluginRow = (page: Page, id: string) => overlay(page).locator(`[data-plugin="${id}"]`);
export const searchbox = (page: Page) => overlay(page).getByRole("searchbox");
export const sectionButton = (page: Page, name: string) => overlay(page).getByRole("navigation").getByRole("button", { name });
export const restartBanner = (page: Page) => overlay(page).getByRole("status").filter({ hasText: "restart" });

/** Opens the dialog with its shortcut, once the settings UI is up. */
export async function openSettings(page: Page) {
  await page.waitForFunction(() => window.__pearRuntime?.settings);
  await page.keyboard.press("Control+,");
}

export const openSection = (page: Page, name: string) => sectionButton(page, name).click();

/** config.json as saved so far ({} until the first debounced write). */
export function savedSettings(userData: string) {
  try {
    return JSON.parse(readFileSync(join(userData, "config.json"), "utf8"));
  } catch {
    return {};
  }
}
