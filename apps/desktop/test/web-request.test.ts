import { describe, expect, test } from "vitest";
import { matchPattern, WebRequestRouter } from "../src/main/web-request.ts";

function fakeSession() {
  const listeners: Record<string, (details: any, callback?: (r: any) => void) => void> = {};
  const webRequest = new Proxy({}, { get: (_, event: string) => (listener: any) => void (listeners[event] = listener) });
  const session = { webRequest, getUserAgent: () => "ua" } as any;
  const fire = (event: string, details: any) =>
    new Promise<any>((resolve) => listeners[event]!({ resourceType: "xhr", ...details }, resolve));
  return { session, listeners, fire };
}

describe("matchPattern", () => {
  test.each([
    ["<all_urls>", "https://a.com/x", true],
    ["*://*/*", "https://a.com/x?y=1", true],
    ["*://*/*", "file:///etc/hosts", false],
    ["https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/*", "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=1", true],
    ["https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/*", "https://www.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/", false],
    ["*://*.googlevideo.com/*", "https://rr1.googlevideo.com/videoplayback", true],
    ["*://*.googlevideo.com/*", "https://googlevideo.com/", true],
    ["*://*.googlevideo.com/*", "https://evilgooglevideo.com/", false],
    ["https://a.com/api/*", "https://a.com/other", false],
  ])("%s matches %s → %s", (pattern, url, expected) => {
    expect(matchPattern(pattern, url)).toBe(expected);
  });
});

describe("WebRequestRouter", () => {
  test("composes header rewrites from several owners in registration order", async () => {
    const { session, fire } = fakeSession();
    const router = new WebRequestRouter(session);
    router.scoped("a").onBeforeSendHeaders((details, callback) =>
      callback({ requestHeaders: { ...details.requestHeaders, A: "1" } }),
    );
    router.scoped("b").onBeforeSendHeaders({ urls: ["https://x.com/*"] }, (details, callback) =>
      callback({ requestHeaders: { ...details.requestHeaders, B: details.requestHeaders.A ?? "" } }),
    );
    expect(await fire("onBeforeSendHeaders", { url: "https://x.com/", requestHeaders: {} })).toEqual({
      requestHeaders: { A: "1", B: "1" },
    });
    // b's filter excludes this URL.
    expect(await fire("onBeforeSendHeaders", { url: "https://y.com/", requestHeaders: {} })).toEqual({
      requestHeaders: { A: "1" },
    });
  });

  test("cancel short-circuits, release removes an owner, re-registering replaces", async () => {
    const { session, fire } = fakeSession();
    const router = new WebRequestRouter(session);
    const seen: string[] = [];
    router.scoped("blocker").onBeforeRequest((_d, callback) => callback({ cancel: true }));
    router.scoped("logger").onBeforeRequest((_d, callback) => {
      seen.push("logger");
      callback({});
    });
    expect(await fire("onBeforeRequest", { url: "https://ads.com/" })).toEqual({ cancel: true });
    expect(seen).toEqual([]);

    router.release("blocker");
    expect(await fire("onBeforeRequest", { url: "https://ads.com/" })).toEqual({});
    expect(seen).toEqual(["logger"]);

    router.scoped("logger").onBeforeRequest(null as any);
    expect(await fire("onBeforeRequest", { url: "https://ads.com/" })).toEqual({});
    expect(seen).toEqual(["logger"]);
  });

  test("scoped session proxies everything but webRequest", () => {
    const { session } = fakeSession();
    const router = new WebRequestRouter(session);
    const scoped = router.scopedSession("p");
    expect(scoped.getUserAgent()).toBe("ua");
    expect(scoped.webRequest).not.toBe(session.webRequest);
  });

  test("scoped session's getters see the session itself (native ones refuse the proxy)", () => {
    const { session } = fakeSession();
    const cookies = {};
    Object.defineProperty(session, "cookies", {
      get(this: unknown) {
        if (this !== session) throw new TypeError("Illegal invocation");
        return cookies;
      },
    });
    expect(new WebRequestRouter(session).scopedSession("p").cookies).toBe(cookies);
  });
});
