import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { definePlugin, type HostContext } from "@pear/sdk";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Settings } from "../src/main/config.ts";
import { MenuItems } from "../src/main/menu-items.ts";
import { PluginHost } from "../src/main/plugins.ts";
import { WebRequestRouter } from "../src/main/web-request.ts";

vi.mock("electron", () => ({}));

/** A plugin whose `start` waits for `release()` and then hands over its context. */
function slowPlugin() {
  let release!: () => void;
  const started = new Promise<void>((resolve) => (release = resolve));
  let ctx!: HostContext<Record<string, never>>;
  const plugin = definePlugin({
    id: "slow",
    name: "Slow",
    host: {
      async start(context) {
        ctx = context;
        await started;
      },
    },
  });
  return { plugin, release, context: () => ctx };
}

function setup(plugin: ReturnType<typeof slowPlugin>["plugin"]) {
  const userData = mkdtempSync(join(tmpdir(), "pear-lifetime-"));
  const settings = new Settings(userData, [plugin], "4.0.0");
  const host = new PluginHost([plugin], settings, "linux");
  const off = vi.fn();
  const player = { state: {}, on: vi.fn(() => off), control() {} };
  const webRequestListeners: Record<string, unknown> = {};
  const session = {
    webRequest: new Proxy({}, { get: (_, event: string) => (listener: unknown) => void (webRequestListeners[event] = listener) }),
  };
  const router = new WebRequestRouter(session as never);
  host.attach({
    app: {} as never,
    window: {} as never,
    session: session as never,
    router,
    player: player as never,
    requests: {} as never,
    send() {},
    openSettings() {},
    focusWindow() {},
    menuItems: new MenuItems(),
    broadcast() {},
    onProtocol: () => () => {},
    onDisabled() {},
  });
  const fire = (event: string, details: object) => (webRequestListeners[event] as (d: object) => void)(details);
  return { host, off, fire };
}

describe("plugin lifetime", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("what a plugin registers after it stopped is undone at once", async () => {
    const slow = slowPlugin();
    const { host, off } = setup(slow.plugin);
    const starting = host.setEnabled("slow", true);
    await vi.waitFor(() => expect(slow.context()).toBeDefined());
    await host.setEnabled("slow", false);
    slow.release();
    await starting;

    const ctx = slow.context();
    const cleanup = vi.fn();
    ctx.onCleanup(cleanup);
    expect(cleanup).toHaveBeenCalledOnce();

    ctx.player.on("change", () => {});
    expect(off).toHaveBeenCalledOnce();

    const emitter = new EventEmitter();
    ctx.listen(emitter, "ping", () => {});
    expect(emitter.listenerCount("ping")).toBe(0);

    const fired = vi.fn();
    ctx.setTimeout(fired, 10);
    ctx.setInterval(fired, 10);
    vi.advanceTimersByTime(100);
    expect(fired).not.toHaveBeenCalled();
  });

  test("a stopped plugin's webRequest calls don't touch its successor's", async () => {
    const slow = slowPlugin();
    const { host, fire } = setup(slow.plugin);
    slow.release();
    await host.setEnabled("slow", true);
    const stale = slow.context();
    await host.setEnabled("slow", false);
    await host.setEnabled("slow", true);
    const current = slow.context();
    expect(current).not.toBe(stale);

    const listener = vi.fn();
    const staleListener = vi.fn();
    current.webRequest.onCompleted(listener);
    stale.webRequest.onCompleted(null);
    stale.session.webRequest.onCompleted(staleListener);
    fire("onCompleted", { url: "https://a.com/" });
    expect(listener).toHaveBeenCalledOnce();
    expect(staleListener).not.toHaveBeenCalled();
  });

  test("a manual unsubscribe runs once, not again when the plugin stops", async () => {
    const slow = slowPlugin();
    const { host, off } = setup(slow.plugin);
    slow.release();
    await host.setEnabled("slow", true);
    const unsubscribe = slow.context().player.on("change", () => {});
    unsubscribe();
    expect(off).toHaveBeenCalledOnce();
    await host.setEnabled("slow", false);
    expect(off).toHaveBeenCalledOnce();
  });
});
