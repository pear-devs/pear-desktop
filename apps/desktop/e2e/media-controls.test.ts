// media-controls exposes a working MPRIS player on the session bus (Linux).

import * as dbus from "@jellybrick/dbus-next";
import { expect, test } from "@playwright/test";
import { launchApp, mainWindow, playTestTrack, TEST_TRACK } from "./launch.ts";

// D-Bus proxy methods are generated at runtime from introspection.
interface DBusDaemon {
  ListNames(): Promise<string[]>;
  GetConnectionUnixProcessID(name: string): Promise<number>;
}
interface Properties {
  Get(iface: string, name: string): Promise<{ value: any }>;
}
interface MprisPlayer {
  Pause(): Promise<void>;
  Play(): Promise<void>;
}
const iface = <T>(object: dbus.ProxyObject, name: string) => object.getInterface(name) as unknown as T;

test.skip(process.platform !== "linux", "MPRIS is Linux-only");

test("MPRIS reflects the track and controls playback", async () => {
  test.setTimeout(150_000);
  const app = await launchApp();
  const bus = dbus.sessionBus();
  try {
    const page = await mainWindow(app);
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

    const status = () => page.evaluate(() => window.__pearRuntime!.player.state.status);
    await player.Pause();
    await expect.poll(status).toBe("paused");
    await expect.poll(() => get("PlaybackStatus")).toBe("Paused");

    await player.Play();
    await expect.poll(status, { timeout: 60_000 }).toMatch(/playing|buffering/);
  } finally {
    bus.disconnect();
    await app.close();
  }
});
