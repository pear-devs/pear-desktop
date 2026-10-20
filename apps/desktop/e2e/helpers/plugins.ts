// Plugin and core settings, changed from the page the way the settings dialog does.

import type { Page } from "@playwright/test";

export const setEnabled = (page: Page, id: string, enabled: boolean) =>
  page.evaluate(([id, enabled]) => window.__pear!.invoke("plugin:set-enabled", id, enabled), [id, enabled] as const);

export const setConfig = (page: Page, id: string, patch: Record<string, unknown>) =>
  page.evaluate(([id, patch]) => window.__pear!.invoke("plugin:set-config", id, patch), [id, patch] as const);

/** A core settings section, e.g. `setCore(page, "appearance", { … })`. */
export const setCore = (page: Page, section: string, patch: Record<string, unknown>) =>
  page.evaluate(([section, patch]) => window.__pear!.invoke("core:set-config", section as never, patch), [section, patch] as const);

export const pluginEnabled = (page: Page, id: string) => page.evaluate((id) => window.__pearRuntime!.plugins.state(id)?.enabled, id);

export const pluginConfig = (page: Page, id: string) => page.evaluate((id) => window.__pearRuntime!.plugins.state(id)?.config, id);

/** The error on the plugin's settings card ("" without one). */
export const pluginError = (page: Page, id: string) => page.evaluate((id) => window.__pearRuntime!.plugins.error(id) ?? "", id);

/** The status line on the plugin's settings card ("" without one). */
export const pluginStatus = (page: Page, id: string) => page.evaluate((id) => window.__pearRuntime!.plugins.status(id) ?? "", id);

export const coreError = (page: Page, section: string) =>
  page.evaluate((section) => window.__pearRuntime!.plugins.core(section as never).error ?? "", section);

/** Calls a host command of a plugin from the page, like its page part would. */
export function invoke<T>(page: Page, plugin: string, command: string, ...args: unknown[]) {
  return page.evaluate(
    ([plugin, command, args]) => window.__pear!.invoke("plugin:invoke", plugin, command, args),
    [plugin, command, args] as const,
  ) as Promise<T>;
}
