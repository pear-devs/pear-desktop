// Google sign-in sees Electron's unmodified UA (header and navigator) and no
// pear runtime. Never submits the form: automated sign-in attempts trip
// Google's abuse detection (captchas) for the whole IP.

import { YTM_ORIGIN, ytmUrl } from "@pear/sdk/util";
import { expect, test } from "./fixtures.ts";

test("accounts.google.com sees the honest Electron UA", async ({ app }) => {
  const page = await app.firstWindow();
  await page.waitForURL((url) => url.origin === YTM_ORIGIN);
  const ytmUserAgent = await page.evaluate(() => navigator.userAgent);
  expect(ytmUserAgent).not.toMatch(/Electron/);

  const request = page.waitForRequest((r) => r.url().startsWith("https://accounts.google.com/"));
  await page.goto("https://accounts.google.com/ServiceLogin?service=\u0079\u006f\u0075\u0074\u0075\u0062\u0065");

  const seen = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    runtime: window.__pearRuntime ?? null,
    bridge: typeof window.__pear,
  }));
  expect(seen.userAgent).toMatch(/Electron\/\d+/);
  expect(seen.runtime).toBeNull();
  expect(seen.bridge).toBe("undefined");
  expect((await (await request).allHeaders())["user-agent"]).toBe(seen.userAgent);

  // Navigating back restores the YTM UA.
  await page.goto(ytmUrl("/"));
  expect(await page.evaluate(() => navigator.userAgent)).toBe(ytmUserAgent);
});

test("YTM's sign-in link opens Google sign-in in the window", async ({ app }) => {
  const page = await app.firstWindow();
  await page.waitForURL((url) => url.origin === YTM_ORIGIN);
  // Page-initiated, so it goes through will-navigate (unlike page.goto above).
  await page.locator('a[href^="https://accounts.google.com/"]').first().click();
  await page.waitForURL((url) => url.origin === "https://accounts.google.com");
});
