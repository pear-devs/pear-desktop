// Milestone 1: the page runtime runs before YTM's scripts, CSP is stripped,
// and the typed bridge round-trips to the host. Requires `nub run build` first.

import { expect, test } from "@playwright/test";
import { launchApp, mainWindow, playTestTrack } from "./launch.ts";

test("runtime is injected before page scripts and the bridge works", async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForURL(/music\.\u0079\u006f\u0075\u0074\u0075\u0062\u0065\.com/);

    const marker = await page.waitForFunction(() => window.__pearRuntime?.marker).then((h) => h.jsonValue());
    expect(marker).toMatchObject({ readyState: "loading", scriptsBefore: 0 });

    expect(await page.evaluate(() => window.__pear!.invoke("ping", "hello from page"))).toBe("pong: hello from page");

    const meta = await page.evaluate(() =>
      document.querySelector('meta[http-equiv="Content-Security-Policy" i]')?.getAttribute("content"),
    );
    expect(meta ?? null).toBeNull();

    const ua = await page.evaluate(() => navigator.userAgent);
    expect(ua).not.toMatch(/Electron|th-ch/);
  } finally {
    await app.close();
  }
});

test("fresh profile skips the cookie-consent screen with essential-only consent", async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__pearRuntime);
    expect(new URL(page.url()).hostname).toBe("music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com");
    const socs = await page.context().cookies("https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com");
    expect(socs.find((c) => c.name === "SOCS")?.value).toBe("CAI");
  } finally {
    await app.close();
  }
});

test("quits while a track is playing (YTM's beforeunload must not cancel it)", async () => {
  test.setTimeout(120_000);
  const app = await launchApp();
  const page = await mainWindow(app);
  await playTestTrack(page);
  await expect
    .poll(() => page.evaluate(() => window.__pearRuntime!.player.state.status), { timeout: 60_000 })
    .toBe("playing");
  const closed = app.close().then(() => "closed");
  const hung = new Promise((resolve) => setTimeout(() => resolve("hung"), 10_000));
  expect(await Promise.race([closed, hung])).toBe("closed");
});
