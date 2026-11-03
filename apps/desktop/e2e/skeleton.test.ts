// Milestone 1: the page runtime runs before YTM's scripts, CSP is stripped,
// and the typed bridge round-trips to the host. Requires `nub run build` first.

import { YTM_ORIGIN, ytmUrl } from "@pear/sdk/util";
import { expect, test } from "./fixtures.ts";
import { playerStatus } from "./helpers/playback.ts";
import { playTestTrack } from "./launch.ts";

/** Longer than a normal quit; the fixture's closeApp would kill a hung app later. */
const QUIT_TIMEOUT_MS = 10_000;

test("runtime is injected before page scripts and the bridge works", async ({ app }) => {
  const page = await app.firstWindow();
  await page.waitForURL((url) => url.origin === YTM_ORIGIN);

  const marker = await page.waitForFunction(() => window.__pearRuntime?.marker).then((h) => h.jsonValue());
  expect(marker).toMatchObject({ readyState: "loading", scriptsBefore: 0 });

  expect(await page.evaluate(() => window.__pear!.invoke("ping", "hello from page"))).toBe("pong: hello from page");

  const meta = await page.evaluate(() =>
    document.querySelector('meta[http-equiv="Content-Security-Policy" i]')?.getAttribute("content"),
  );
  expect(meta ?? null).toBeNull();

  const ua = await page.evaluate(() => navigator.userAgent);
  expect(ua).not.toMatch(/Electron|th-ch/);
});

test("fresh profile skips the cookie-consent screen with essential-only consent", async ({ app }) => {
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__pearRuntime);
  expect(new URL(page.url()).origin).toBe(YTM_ORIGIN);
  const socs = await page.context().cookies(ytmUrl("/"));
  expect(socs.find((c) => c.name === "SOCS")?.value).toBe("CAI");
});

test("quits while a track is playing (YTM's beforeunload must not cancel it)", async ({ app, page }) => {
  test.setTimeout(120_000);
  await playTestTrack(page);
  await expect
    .poll(() => playerStatus(page), { timeout: 60_000 })
    .toBe("playing");
  const closed = app.close().then(() => "closed");
  const hung = new Promise((resolve) => setTimeout(() => resolve("hung"), QUIT_TIMEOUT_MS));
  expect(await Promise.race([closed, hung])).toBe("closed");
});
