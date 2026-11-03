import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { ytmUrl } from "@pear/sdk/util";
import { E2E_DISPLAY } from "./global-setup.ts";

export interface LaunchOptions {
  /** Initial plugin states, written to config.json before launch. */
  plugins?: Record<string, { enabled: boolean; config?: Record<string, unknown> }>;
  /** Initial core settings sections, e.g. `{ apiServer: { enabled: true } }`. */
  core?: Record<string, Record<string, unknown>>;
  /** A config.json to start from verbatim (e.g. one pear-desktop 3.x wrote). */
  config?: Record<string, unknown>;
  /** Extra environment variables for the app. */
  env?: Record<string, string>;
  /** A profile to launch with (kept when the app closes), e.g. to launch it again. Default: a fresh one. */
  userData?: string;
}

/** How long the page runtime and the test track get to load. */
const LOAD_TIMEOUT_MS = 30_000;

const APP_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** The options above in config.json's layout (see src/main/config.ts). */
function configFile({ plugins = {}, core = {} }: LaunchOptions) {
  const { apiServer, ...options } = core;
  const entries: Record<string, Record<string, unknown>> = {};
  for (const [id, { enabled, config }] of Object.entries(plugins)) entries[id] = { enabled, ...config };
  if (apiServer) entries["api-server"] = apiServer;
  return {
    plugins: entries,
    options: Object.assign({}, ...Object.values(options)),
    __internal__: { migrations: { version: APP_VERSION } },
  };
}

/** Launch the built app with a fresh, isolated profile. */
export async function launchApp(options: LaunchOptions = {}) {
  const userData = options.userData ?? mkdtempSync(join(tmpdir(), "pear-e2e-"));
  if (options.config || options.plugins || options.core) {
    writeFileSync(join(userData, "config.json"), JSON.stringify(options.config ?? configFile(options)));
  }
  const virtual = process.env[E2E_DISPLAY];
  const app = await electron.launch({
    // No GPU there: WebGL (the visualizer) renders in software.
    args: [".", ...(virtual ? ["--ozone-platform=x11", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [])],
    env: { ...(virtual ? virtualDisplayEnv(virtual) : process.env), ...options.env, PEAR_USER_DATA: userData },
  });
  // Profiles are ~40 MB each, and /tmp is often RAM-backed.
  if (!options.userData) app.on("close", () => rmSync(userData, { recursive: true, force: true }));
  return Object.assign(app, { userData });
}

/** The environment for an X11 app on the virtual display (global-setup.ts). */
function virtualDisplayEnv(display: string): Record<string, string | undefined> {
  const { WAYLAND_DISPLAY: _wayland, ...env } = process.env;
  return { ...env, DISPLAY: display };
}

/**
 * The virtual display has no window manager, so nothing maximizes or minimizes
 * there; tests of that run with PEAR_E2E_SHOW=1 (on the desktop).
 */
export const NO_WINDOW_MANAGER = process.env[E2E_DISPLAY] ? "the virtual display has no window manager; PEAR_E2E_SHOW=1 runs it" : "";

export type App = Awaited<ReturnType<typeof launchApp>>;

/** A track that is reliably available on YTM without signing in. */
export const TEST_TRACK = "dQw4w9WgXcQ";

/** Opens the test track and waits until the runtime has loaded it. */
export async function playTestTrack(page: Page) {
  await page.goto(ytmUrl(`/watch?v=${TEST_TRACK}`));
  await page.waitForFunction(
    (id) => window.__pearRuntime?.player.state.track?.videoId === id,
    TEST_TRACK,
    { timeout: LOAD_TIMEOUT_MS },
  );
}

export async function mainWindow(app: ElectronApplication) {
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__pearRuntime, undefined, { timeout: LOAD_TIMEOUT_MS });
  return page;
}
