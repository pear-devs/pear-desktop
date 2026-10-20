// media-controls exposes a working MPRIS player on the session bus (Linux).

import * as dbus from "@jellybrick/dbus-next";
import { ytmUrl } from "@pear/sdk/util";
import { expect, test } from "./fixtures.ts";
import { playerStatus } from "./helpers/playback.ts";
import { playTestTrack, TEST_TRACK } from "./launch.ts";
import { sel } from "./helpers/player-bar.ts";

// D-Bus proxy methods are generated at runtime from introspection.
interface DBusDaemon {
  ListNames(): Promise<string[]>;
  GetConnectionUnixProcessID(name: string): Promise<number>;
}
interface Properties {
  Get(iface: string, name: string): Promise<{ value: any }>;
  Set(iface: string, name: string, value: dbus.Variant): Promise<void>;
}
interface MprisPlayer {
  Pause(): Promise<void>;
  Play(): Promise<void>;
  OpenUri(uri: string): Promise<void>;
}
const iface = <T>(object: dbus.ProxyObject, name: string) => object.getInterface(name) as unknown as T;

test.skip(process.platform !== "linux", "MPRIS is Linux-only");

test("MPRIS reflects the track and controls playback", async ({ app, page, defer }) => {
  test.setTimeout(150_000);
  const bus = dbus.sessionBus();
  defer(() => bus.disconnect());
  await playTestTrack(page);
  const pid = app.process().pid!;

  const daemon = iface<DBusDaemon>(await bus.getProxyObject("org.freedesktop.DBus", "/org/freedesktop/DBus"), "org.freedesktop.DBus");
  const ownedBy = async (prefix: string) => {
    const names = (await daemon.ListNames()).filter((n) => n.startsWith(prefix));
    const owned: string[] = [];
    for (const name of names) if ((await daemon.GetConnectionUnixProcessID(name)) === pid) owned.push(name);
    return owned;
  };

  let service: string | undefined;
  await expect.poll(async () => (service = (await ownedBy("org.mpris.MediaPlayer2.\u0059\u006f\u0075\u0074\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063"))[0])).toBeTruthy();
  // Chromium's own MediaSessionService player is disabled.
  expect(await ownedBy("org.mpris.MediaPlayer2.chromium")).toEqual([]);

  const object = await bus.getProxyObject(service!, "/org/mpris/MediaPlayer2");
  const props = iface<Properties>(object, "org.freedesktop.DBus.Properties");
  const player = iface<MprisPlayer>(object, "org.mpris.MediaPlayer2.Player");
  const get = async (name: string) => (await props.Get("org.mpris.MediaPlayer2.Player", name)).value;

  const title = await page.evaluate(() => window.__pearRuntime!.player.state.track!.title);
  await expect
    .poll(async () => {
      const metadata = await get("Metadata");
      return metadata["xesam:title"]?.value;
    })
    .toBe(title);
  const metadata = await get("Metadata");
  expect(metadata["mpris:trackid"].value).toContain(TEST_TRACK.replace(/[^A-Za-z0-9_]/g, "_"));
  expect(Number(metadata["mpris:length"].value)).toBeGreaterThan(60e6);

  const status = () => playerStatus(page);
  await player.Pause();
  await expect.poll(status).toBe("paused");
  await expect.poll(() => get("PlaybackStatus")).toBe("Paused");

  await player.Play();
  await expect.poll(status, { timeout: 60_000 }).toMatch(/playing|buffering/);

  // Like pear-desktop: no "previous" at the start of the queue, "next" while tracks follow.
  await expect.poll(() => get("CanGoPrevious")).toBe(false);
  await expect.poll(() => get("CanGoNext")).toBe(true);

  // Full screen is YTM's full-screen player, both ways.
  const root = (name: string) => props.Get("org.mpris.MediaPlayer2", name).then((v) => v.value);
  expect(await root("CanSetFullscreen")).toBe(true);
  await props.Set("org.mpris.MediaPlayer2", "Fullscreen", new dbus.Variant("b", true));
  await expect(page.locator(sel("integrations.fullscreen"))).toBeAttached();
  await expect.poll(() => root("Fullscreen")).toBe(true);
  await props.Set("org.mpris.MediaPlayer2", "Fullscreen", new dbus.Variant("b", false));
  await expect(page.locator(sel("integrations.fullscreen"))).toHaveCount(0);
  await expect.poll(() => root("Fullscreen")).toBe(false);

  // OpenUri opens YTM links in the window (and nothing else).
  await player.OpenUri("https://example.com/");
  await player.OpenUri(ytmUrl("/explore"));
  await expect.poll(() => page.url()).toBe(ytmUrl("/explore"));
});
