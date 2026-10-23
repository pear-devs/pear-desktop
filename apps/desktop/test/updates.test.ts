import { describe, expect, test, vi } from "vitest";
import { isNewerVersion, newerRelease, RELEASES_URL, shouldCheck } from "../src/main/updates.ts";

vi.mock("electron", () => ({}));

describe("isNewerVersion", () => {
  test.each([
    ["v4.0.1", "4.0.0", true],
    ["4.1.0", "4.0.9", true],
    ["v5.0.0", "4.12.3", true],
    ["4.10.0", "4.9.0", true],
    ["v4.0.0", "4.0.0", false],
    ["v3.11.0", "4.0.0", false],
    ["4.0", "4.0.0", false],
    // A release is newer than its own prereleases, never the other way round.
    ["v4.0.0", "4.0.0-beta.1", true],
    ["v4.0.0-beta.2", "4.0.0", false],
    ["v4.0.0-beta.10", "4.0.0-beta.9", true],
    ["v4.0.0-rc.1", "4.0.0-beta.3", true],
    ["v4.0.0-beta", "4.0.0-beta.1", false],
    ["v4.0.0+build.7", "4.0.0", false],
    ["nightly", "4.0.0", false],
    ["", "4.0.0", false],
  ])("%s vs %s → %s", (latest, current, expected) => {
    expect(isNewerVersion(latest, current)).toBe(expected);
  });
});

test("only packaged builds with the option on check", () => {
  expect(shouldCheck({ packaged: true, enabled: true })).toBe(true);
  expect(shouldCheck({ packaged: false, enabled: true })).toBe(false);
  expect(shouldCheck({ packaged: true, enabled: false })).toBe(false);
});

describe("newerRelease", () => {
  const github = (body: unknown, status = 200) =>
    vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

  test("asks GitHub for pear-desktop's latest release", async () => {
    const fetch = github({ tag_name: "v4.2.0", html_url: "https://github.com/pear-devs/pear-desktop/releases/tag/v4.2.0" });
    expect(await newerRelease("4.0.0", fetch)).toEqual({
      version: "4.2.0",
      url: "https://github.com/pear-devs/pear-desktop/releases/tag/v4.2.0",
    });
    expect(fetch.mock.calls[0]![0]).toBe("https://api.github.com/repos/pear-devs/pear-desktop/releases/latest");
  });

  test("nothing when the release isn't newer, or is a draft or prerelease", async () => {
    expect(await newerRelease("4.0.0", github({ tag_name: "v4.0.0" }))).toBeUndefined();
    expect(await newerRelease("4.0.0", github({ tag_name: "v4.1.0", prerelease: true }))).toBeUndefined();
    expect(await newerRelease("4.0.0", github({ tag_name: "v4.1.0", draft: true }))).toBeUndefined();
    expect(await newerRelease("4.0.0", github({ message: "Not Found" }))).toBeUndefined();
  });

  test("links to the releases page unless GitHub names one on github.com", async () => {
    expect((await newerRelease("4.0.0", github({ tag_name: "v4.1.0", html_url: "https://evil.example/" })))?.url).toBe(RELEASES_URL);
    expect((await newerRelease("4.0.0", github({ tag_name: "v4.1.0" })))?.url).toBe(RELEASES_URL);
  });

  test("errors (rate limits, offline) reject, for the caller to log", async () => {
    await expect(newerRelease("4.0.0", github({ message: "rate limited" }, 403))).rejects.toThrow("403");
  });
});
