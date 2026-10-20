import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

export interface LaunchOptions {
  /** Initial plugin states, written to config.json before launch. */
  plugins?: Record<string, { enabled: boolean; config?: Record<string, unknown> }>;
  /** Initial core settings sections, e.g. `{ apiServer: { enabled: true } }`. */
  core?: Record<string, Record<string, unknown>>;
}

/** The options above in config.json's layout (see src/main/config.ts). */
function configFile({ plugins = {}, core = {} }: LaunchOptions) {
  const { apiServer, ...options } = core;
  const entries: Record<string, Record<string, unknown>> = {};
  for (const [id, { enabled, config }] of Object.entries(plugins)) entries[id] = { enabled, ...config };
  if (apiServer) entries["api-server"] = apiServer;
  return { plugins: entries, options: Object.assign({}, ...Object.values(options)) };
}

/** Launch the built app with a fresh, isolated profile. */
export async function launchApp(options: LaunchOptions = {}) {
  const userData = mkdtempSync(join(tmpdir(), "pear-e2e-"));
  if (options.plugins || options.core) {
    writeFileSync(join(userData, "config.json"), JSON.stringify(configFile(options)));
  }
  const app = await electron.launch({ args: ["."], env: { ...process.env, PEAR_USER_DATA: userData } });
  // Profiles are ~40 MB each, and /tmp is often RAM-backed.
  app.on("close", () => rmSync(userData, { recursive: true, force: true }));
  return Object.assign(app, { userData });
}

/** A track that is reliably available on YTM without signing in. */
export const TEST_TRACK = "dQw4w9WgXcQ";

/** Opens the test track and waits until the runtime has loaded it. */
export async function playTestTrack(page: Page) {
  await page.goto(`https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=${TEST_TRACK}`);
  await page.waitForFunction(
    (id) => window.__pearRuntime?.player.state.track?.videoId === id,
    TEST_TRACK,
    { timeout: 30_000 },
  );
}

export async function mainWindow(app: ElectronApplication) {
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__pearRuntime, undefined, { timeout: 30_000 });
  return page;
}
