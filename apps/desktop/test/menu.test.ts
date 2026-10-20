import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, test, vi } from "vitest";
import { menuTemplate } from "../src/main/menu.ts";

vi.mock("electron", () => ({ app: { name: "App" } }));

describe("menuTemplate", () => {
  const env = (platform: NodeJS.Platform) => ({
    platform,
    t: (_key: string, fallback?: string) => fallback ?? "",
    window: () => undefined,
    openSettings: vi.fn(),
    alwaysOnTop: () => true,
    setAlwaysOnTop: vi.fn(),
    settingsPath: "/config.json",
    restart: vi.fn(),
  });
  const labels = (items: MenuItemConstructorOptions[]) => items.map((item) => item.label ?? item.role ?? item.type);
  const submenu = (item: MenuItemConstructorOptions | undefined) => item?.submenu as MenuItemConstructorOptions[];

  test("pear-desktop's menus, with Settings instead of Plugins and Options", () => {
    const template = menuTemplate(env("linux"));
    expect(labels(template)).toEqual(["Options", "View", "Navigation", "About"]);
    const options = submenu(template[0]);
    expect(labels(options)).toEqual(["Settings…", "separator", "Always on top", "separator", "Toggle DevTools", "Edit config.json"]);
    expect(options[2]).toMatchObject({ type: "checkbox", checked: true });
    // The page handles Ctrl+, itself (it toggles the dialog).
    expect(options[0]).toMatchObject({ accelerator: "CmdOrCtrl+,", registerAccelerator: false });
  });

  test("macOS gets the app menu, with Settings in it", () => {
    const template = menuTemplate(env("darwin"));
    expect(labels(template)).toEqual(["App", "Options", "View", "Navigation", "About"]);
    expect(labels(submenu(template[0])).slice(0, 3)).toEqual(["about", "separator", "Settings…"]);
    expect(labels(submenu(template[1]))).not.toContain("Settings…");
  });

  test("menu items call back into the core", () => {
    const e = env("win32");
    const options = submenu(menuTemplate(e)[0]);
    (options[0]!.click as () => void)();
    expect(e.openSettings).toHaveBeenCalled();
    (options[2]!.click as (item: { checked: boolean }) => void)({ checked: false });
    expect(e.setAlwaysOnTop).toHaveBeenCalledWith(false);
  });
});
