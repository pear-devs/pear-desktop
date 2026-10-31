// The e2e tests' `test`: each gets a freshly launched app (`app`, `page`), or
// launches its own (`launch`), and everything is closed after the test.
//
//   test.use({ appOptions: { plugins: { clock: { enabled: true } } } });
//   test("…", async ({ app, page }) => { … });

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, type Page } from "@playwright/test";
import { type App, launchApp, type LaunchOptions, mainWindow } from "./launch.ts";

export { expect } from "@playwright/test";

/** After pausing, a moment for YTM to settle before the window closes. */
const PAUSE_SETTLE_MS = 300;
/** app.close() can hang after media playback; past this the process is killed. */
const CLOSE_TIMEOUT_MS = 10_000;

/**
 * Closes the app: pauses first (while YTM plays, its beforeunload handler can
 * cancel the window close), and kills it if closing still hangs.
 */
export async function closeApp(app: App) {
  const process = runningProcess(app);
  if (!process) return;
  for (const page of app.windows()) {
    await page
      .evaluate(() => {
        window.__pearRuntime?.player.control({ type: "pause" });
        document.querySelector("video")?.pause();
      })
      .catch(() => {});
  }
  await new Promise((resolve) => setTimeout(resolve, PAUSE_SETTLE_MS));
  const closed = app.close().then(
    () => true,
    () => true,
  );
  const timedOut = new Promise<false>((resolve) => setTimeout(() => resolve(false), CLOSE_TIMEOUT_MS));
  if (!(await Promise.race([closed, timedOut])) && process.exitCode === null) process.kill("SIGKILL");
}

export type Launch = (options?: LaunchOptions) => Promise<App>;

/** The app's process, unless the test closed the app already. */
function runningProcess(app: App) {
  try {
    const process = app.process();
    return process.exitCode === null && process.signalCode === null ? process : undefined;
  } catch {
    // Playwright drops the process handle once the app closed.
    return undefined;
  }
}

interface Fixtures {
  /** How `app` is launched; set with `test.use({ appOptions })`. */
  appOptions: LaunchOptions;
  /** Runs `cleanup` after the test (the latest first). */
  defer(cleanup: () => unknown): void;
  /** Launches an app, closed after the test. */
  launch: Launch;
  /** A temporary folder, removed after the test. */
  tempDir(prefix: string): string;
  app: App;
  /** The app's main window, once the page runtime is up. */
  page: Page;
}

export const test = base.extend<Fixtures>({
  appOptions: [{}, { option: true }],
  // Cleanups run last-in first-out: an app closes before the folder or server it was given.
  defer: async ({}, use) => {
    const cleanups: (() => unknown)[] = [];
    await use((cleanup) => void cleanups.push(cleanup));
    for (const cleanup of cleanups.reverse()) await cleanup();
  },
  launch: async ({ defer }, use) => {
    await use(async (options = {}) => {
      const app = await launchApp(options);
      defer(() => closeApp(app));
      return app;
    });
  },
  tempDir: async ({ defer }, use) => {
    await use((prefix) => {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      defer(() => rmSync(dir, { recursive: true, force: true }));
      return dir;
    });
  },
  app: async ({ launch, appOptions }, use) => use(await launch(appOptions)),
  page: async ({ app }, use) => use(await mainWindow(app)),
});
