// do-not-track: "With blocklists" filters requests (next to the core's own
// listeners, without replacing them); "In player" strips ad placements from the
// player's data without breaking playback.

import { existsSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { ytmUrl } from "@pear/sdk/util";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { YTM_HOST } from "./helpers/network.ts";
import { waitForTrackPlaying } from "./helpers/playback.ts";
import { invoke, setConfig, setEnabled } from "./helpers/plugins.ts";
import { mainWindow, playTestTrack } from "./launch.ts";

interface Stats {
  active: boolean;
  blocked: number;
  lists: number;
}

/** A filter list served locally, blocking a probe URL no default list knows. */
async function serveList() {
  const server = createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(`[Adblock Plus 2.0]\n||${YTM_HOST}/pear-dnt-probe^\n${YTM_HOST}##.pear-dnt-cosmetic-probe\n##.pear-dnt-generic-probe\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/list.txt`, close: () => server.close() };
}

/** Whether a request from the page gets through (a 404 counts) or is blocked by the client. */
const probe = (page: Page, path: string) =>
  page.evaluate((url) => fetch(url).then(() => "through", () => "blocked"), ytmUrl(`/${path}`));

test("with blocklists: blocks requests and caches the engine", async ({ launch, defer }) => {
  test.setTimeout(120_000);
  const list = await serveList();
  defer(list.close);
  const app = await launch({
    plugins: {
      "do-not-track": {
        enabled: true,
        config: { blocker: "With blocklists", disableDefaultLists: true, additionalBlockLists: [list.url] },
      },
    },
  });
  // The runtime injects: the blocker didn't replace the core's CSP stripping.
  const page = await mainWindow(app);
  const stats = () => invoke<Stats>(page, "do-not-track", "stats");
  await expect.poll(async () => (await stats()).active, { timeout: 30_000 }).toBe(true);
  expect((await stats()).lists).toBe(1);

  const before = (await stats()).blocked;
  expect(await probe(page, "pear-dnt-probe")).toBe("blocked");
  expect(await probe(page, "pear-dnt-other")).toBe("through");
  expect((await stats()).blocked).toBe(before + 1);
  // The lists' element hiding applies too (site-specific and generic rules), and playback is fine.
  const hidden = (className: string) =>
    page.evaluate((className) => {
      if (!document.body) return null;
      let element = document.querySelector(`.${className}`) as HTMLElement | null;
      if (!element) {
        element = Object.assign(document.createElement("div"), { className, textContent: "probe" });
        document.body.append(element);
      }
      return getComputedStyle(element).display === "none";
    }, className);
  await expect.poll(() => hidden("pear-dnt-cosmetic-probe"), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => hidden("pear-dnt-generic-probe"), { timeout: 20_000 }).toBe(true);
  expect(await hidden("pear-dnt-not-filtered")).toBe(false);
  await playTestTrack(page);
  await waitForTrackPlaying(page);
  // The engine is cached for the next launch.
  const cache = join(app.userData, "tb_cache");
  expect(existsSync(cache) && readdirSync(cache).some((f) => /^engine-\w+\.bin$/.test(f))).toBe(true);

  // Back to the default mode live: request filtering stops.
  await setConfig(page, "do-not-track", { blocker: "In player" });
  await expect.poll(async () => (await stats()).active).toBe(false);
  expect(await probe(page, "pear-dnt-probe")).toBe("through");
});

test("in player: the player gets no ad placements and the track plays", async ({ launch }) => {
  test.setTimeout(120_000);
  const page = await mainWindow(await launch({ plugins: { "do-not-track": { enabled: true } } }));
  const pruned = () => page.evaluate(() => JSON.parse('{"adPlacements":[1],"playerAds":[2],"keep":3}') as object);
  expect(await pruned()).toEqual({ keep: 3 });

  await playTestTrack(page);
  const response = await page.evaluate(() => {
    const r = window.__pearRuntime!.player.api!.getPlayerResponse() as Record<string, unknown>;
    return { video: Boolean(r.videoDetails), ads: ["adPlacements", "playerAds", "adSlots"].filter((key) => key in r) };
  });
  expect(response).toEqual({ video: true, ads: [] });

  await waitForTrackPlaying(page);

  // Disabling undoes the patches live.
  await setEnabled(page, "do-not-track", false);
  await expect.poll(pruned).toEqual({ adPlacements: [1], playerAds: [2], keep: 3 });
});
