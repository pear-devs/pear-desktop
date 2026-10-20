import { describe, expect, test } from "vitest";
import { installPruner, prune } from "../prune.ts";

const response = () => ({
  videoDetails: { videoId: "dQw4w9WgXcQ" },
  playerAds: [{ ad: 1 }],
  adPlacements: [{ ad: 2 }],
  adSlots: [{ ad: 3 }],
  playerResponse: { streamingData: {}, adPlacements: [], playerAds: [] },
});

describe("prune", () => {
  test("removes ad placements from a response and the player responses inside it", () => {
    expect(prune(response())).toEqual({ videoDetails: { videoId: "dQw4w9WgXcQ" }, playerResponse: { streamingData: {} } });
  });
  test("leaves other values alone", () => {
    expect(prune(null)).toBe(null);
    expect(prune("adPlacements")).toBe("adPlacements");
    expect(prune([1, 2])).toEqual([1, 2]);
  });
});

describe("installPruner", () => {
  function fakeWindow() {
    class FakeResponse {
      constructor(private body: string) {}
      json() {
        return Promise.resolve(JSON.parse(this.body));
      }
    }
    const parse = JSON.parse;
    return { JSON: { parse }, Response: FakeResponse, ytInitialPlayerResponse: response() } as unknown as Parameters<
      typeof installPruner
    >[0] & { ytInitialPlayerResponse: unknown; playerResponse?: unknown };
  }

  test("prunes parsed JSON, fetched JSON and the inline globals, and undoes it all", async () => {
    const win = fakeWindow();
    const parse = win.JSON.parse;
    const json = win.Response.prototype.json;
    const undo = installPruner(win);

    const text = JSON.stringify(response());
    expect(win.JSON.parse(text)).not.toHaveProperty("adPlacements");
    const fetched = await new (win.Response as unknown as new (body: string) => { json(): Promise<unknown> })(text).json();
    expect(fetched).not.toHaveProperty("playerAds");
    // Already set before the pruner ran, and set later by the page.
    expect(win.ytInitialPlayerResponse).not.toHaveProperty("adSlots");
    win.playerResponse = response();
    expect(win.playerResponse).not.toHaveProperty("adPlacements");

    undo();
    expect(win.JSON.parse).toBe(parse);
    expect(win.Response.prototype.json).toBe(json);
    expect(win.JSON.parse(text)).toHaveProperty("adPlacements");
    win.playerResponse = response();
    expect(win.playerResponse).toHaveProperty("adPlacements");
    expect(Object.getOwnPropertyDescriptor(win, "ytInitialPlayerResponse")).toHaveProperty("writable", true);
  });

  test("removes globals it created when the page never set them", () => {
    const win = fakeWindow();
    const undo = installPruner(win);
    undo();
    expect("playerResponse" in win).toBe(false);
  });
});
