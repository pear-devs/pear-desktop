import type { ElectronApplication, Page } from "@playwright/test";

/** Closes the app; pauses first, as quitting mid-playback can hang the test runner. */
export async function closeApp(app: ElectronApplication, page: Page | undefined) {
  await page
    ?.evaluate(() => {
      window.__pearRuntime?.player.control({ type: "pause" });
      document.querySelector("video")?.pause();
    })
    .catch(() => {});
  await app.close();
}

/** Calls a host command of a plugin from the page, like its page part would. */
export function invoke<T>(page: Page, plugin: string, command: string, ...args: unknown[]) {
  return page.evaluate(
    ([plugin, command, args]) => window.__pear!.invoke("plugin:invoke", plugin, command, args),
    [plugin, command, args] as const,
  ) as Promise<T>;
}
