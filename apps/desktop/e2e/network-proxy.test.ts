// auth-proxy-adapter: all traffic goes through an authenticated HTTP proxy from
// the first request on, and stops when the plugin is disabled.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { startConnectProxy, YTM_HOST } from "./helpers/network.ts";
import { pluginError, setConfig, setEnabled } from "./helpers/plugins.ts";
import { mainWindow } from "./launch.ts";

/** Reloads the page and waits for the runtime. */
async function reload(page: Page) {
  await page.reload();
  await page.waitForFunction(() => window.__pearRuntime, undefined, { timeout: 30_000 });
}

const CREDENTIALS = { username: "alice", password: "s3cret" };
/** Disabling applies once the session settles. */
const SETTLE_MS = 500;

test("auth-proxy-adapter routes everything through an authenticated proxy, live", async ({ launch, defer }) => {
  test.setTimeout(120_000);
  const proxy = await startConnectProxy({ credentials: CREDENTIALS });
  defer(proxy.close);
  const config = { url: proxy.url, ...CREDENTIALS };
  const app = await launch({ plugins: { "auth-proxy-adapter": { enabled: true, config } } });
  // Requests are held until the proxy applies, so even the first page load is tunnelled.
  const page = await mainWindow(app);
  expect(proxy.tunnels[0]).toBe(`${YTM_HOST}:443`);
  expect(proxy.challenges()).toBeGreaterThan(0);

  // Disabling restores direct connections.
  await setEnabled(page, "auth-proxy-adapter", false);
  await page.waitForTimeout(SETTLE_MS);
  let before = proxy.tunnels.length;
  await reload(page);
  expect(proxy.tunnels.length).toBe(before);

  // Enabling again applies live.
  await setEnabled(page, "auth-proxy-adapter", true);
  before = proxy.tunnels.length;
  await reload(page);
  expect(proxy.tunnels.length).toBeGreaterThan(before);

  // A bad address surfaces as an error in settings instead of silently going direct.
  await setConfig(page, "auth-proxy-adapter", { url: "ftp://nope" });
  await expect
    .poll(() => pluginError(page, "auth-proxy-adapter"))
    .toMatch(/Unsupported proxy type/);
});

test("turning the plugin off hands the proxy back to advanced.proxy", async ({ launch, defer }) => {
  test.setTimeout(120_000);
  const core = await startConnectProxy();
  defer(core.close);
  const plugin = await startConnectProxy({ credentials: CREDENTIALS });
  defer(plugin.close);
  const app = await launch({
    core: { advanced: { proxy: core.url } },
    plugins: { "auth-proxy-adapter": { enabled: true, config: { url: plugin.url, ...CREDENTIALS } } },
  });
  // The plugin takes precedence while it's on.
  const page = await mainWindow(app);
  expect(plugin.tunnels[0]).toBe(`${YTM_HOST}:443`);
  expect(core.tunnels).toHaveLength(0);

  await setEnabled(page, "auth-proxy-adapter", false);
  await page.waitForTimeout(SETTLE_MS);
  const before = plugin.tunnels.length;
  await reload(page);
  expect(plugin.tunnels.length).toBe(before);
  expect(core.tunnels).toContain(`${YTM_HOST}:443`);
});
