// The core API server: REST endpoints, auth, WebSocket updates against a real
// track, and plugins' RPC methods.

import { ytmUrl } from "@pear/sdk/util";
import { expect, test } from "./fixtures.ts";
import { randomPort, waitForApi } from "./helpers/network.ts";
import { waitForTrackPlaying } from "./helpers/playback.ts";
import { setCore, setEnabled } from "./helpers/plugins.ts";
import { mainWindow, playTestTrack, TEST_TRACK } from "./launch.ts";

// The API server's WebSocket close codes.
const GOING_AWAY = 1001;
const POLICY_VIOLATION = 1008;
/** The API server's defaults. */
const DEFAULT_PORT = 26538;

/** A local API server without auth, on a free port. */
const openServer = (port: number) => ({ apiServer: { enabled: true, hostname: "127.0.0.1", port, authStrategy: "NONE" } });

interface Message {
  type: string;
  [key: string]: unknown;
}

/** Opens a WebSocket and records every message (and the close event). */
function connect(url: string) {
  const socket = new WebSocket(url);
  const messages: Message[] = [];
  let closed: { code: number; reason: string } | undefined;
  socket.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data))));
  socket.addEventListener("close", (event) => {
    closed = { code: event.code, reason: event.reason };
  });
  return { socket, messages, closed: () => closed };
}

test("REST endpoints and WebSocket reflect and control playback", async ({ launch, defer }) => {
  test.setTimeout(180_000);
  const port = randomPort();
  const base = `http://127.0.0.1:${port}`;
  const page = await mainWindow(await launch({ core: openServer(port) }));
  const api = (path: string, init?: RequestInit) => fetch(`${base}/api/v1${path}`, init);
  const post = (path: string, body?: unknown) =>
    api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

  await waitForApi(base);
  const doc = await (await fetch(`${base}/doc`)).json();
  expect(doc.openapi).toBe("3.1.0");
  expect(Object.keys(doc.paths)).toContain("/api/v1/song");
  const ws = connect(`ws://127.0.0.1:${port}/api/v1/ws`);
  defer(() => ws.socket.close());
  const { messages } = ws;

  await playTestTrack(page);
  const song = await api("/song");
  expect(song.status).toBe(200);
  const info = await song.json();
  expect(info).toMatchObject({ videoId: TEST_TRACK, url: ytmUrl(`/watch?v=${TEST_TRACK}`) });
  expect(info.title.length).toBeGreaterThan(0);
  expect(info.songDuration).toBeGreaterThan(60);
  expect(typeof info.isPaused).toBe("boolean");

  // The WebSocket greets with the full player state, then streams position updates.
  await expect.poll(() => messages[0]?.type).toBe("PLAYER_INFO");
  // It connected before a track loaded; a VIDEO_CHANGED follows once one does.
  await expect
    .poll(() => messages.find((m) => m.type === "VIDEO_CHANGED")?.song)
    .toMatchObject({ videoId: TEST_TRACK });

  // Logged-out sessions may get a pre-roll ad first; once the track itself
  // plays, POSITION_CHANGED messages arrive.
  const status = () => page.evaluate(() => window.__pearRuntime!.player.state);
  expect((await post("/play")).status).toBe(204);
  await waitForTrackPlaying(page);
  await expect
    .poll(() => messages.filter((m) => m.type === "POSITION_CHANGED" && (m.position as number) > 0).length)
    .toBeGreaterThan(1);

  // Retried: an ad starting right now would swallow a single pause.
  await expect
    .poll(async () => {
      expect((await post("/pause")).status).toBe(204);
      return (await status()).status;
    })
    .toBe("paused");
  await expect
    .poll(() => messages.some((m) => m.type === "PLAYER_STATE_CHANGED" && m.isPlaying === false))
    .toBe(true);

  // Volume is in YTM slider units (what the user sees), not the curved audio level.
  expect((await post("/volume", { volume: 37 })).status).toBe(204);
  await expect.poll(() => messages.findLast((m) => m.type === "VOLUME_CHANGED")?.volume).toBe(37);
  await expect.poll(async () => (await (await api("/volume")).json()).state).toBe(37);

  expect((await post("/seek-to", { seconds: 30 })).status).toBe(204);
  await expect.poll(async () => Math.round((await status()).positionSeconds)).toBe(30);

  expect((await post("/seek-to", { seconds: "soon" })).status).toBe(400);
  expect((await api("/nope")).status).toBe(404);
  expect(await (await api("/repeat-mode")).json()).toEqual({ mode: "NONE" });
  expect(await (await api("/shuffle")).json()).toEqual({ state: false });

  // Queue data comes from the page part.
  const queue = await api("/queue");
  expect(queue.status).toBe(200);
  expect(Array.isArray((await queue.json()).items)).toBe(true);

  // Disabling stops the server live; enabling brings it back.
  await setCore(page, "apiServer", { enabled: false });
  await expect.poll(() => ws.closed()?.code).toBe(GOING_AWAY);
  await expect.poll(async () => (await api("/song").catch(() => null))?.status ?? "down").toBe("down");
  await setCore(page, "apiServer", { enabled: true });
  await expect.poll(async () => (await api("/song").catch(() => null))?.status).toBe(200);
});

test("requires a token for authorized clients unless auth is off", async ({ launch }) => {
  const port = randomPort();
  const base = `http://127.0.0.1:${port}`;
  const app = await launch({
    core: {
      apiServer: {
        enabled: true,
        hostname: "127.0.0.1",
        port,
        authStrategy: "AUTH_AT_FIRST",
        authorizedClients: ["e2e-remote"],
        secret: "e2e-secret",
      },
    },
  });
  const page = await mainWindow(app);
  await waitForApi(base);

  expect((await fetch(`${base}/api/v1/volume`)).status).toBe(401);
  expect((await fetch(`${base}/api/v1/volume`, { headers: { Authorization: "Bearer forged.token.here" } })).status).toBe(401);

  // A client that is already authorized gets a token without a prompt.
  const auth = await fetch(`${base}/auth/e2e-remote`, { method: "POST" });
  expect(auth.status).toBe(200);
  const { accessToken } = await auth.json();
  const authorized = await fetch(`${base}/api/v1/volume`, { headers: { Authorization: `Bearer ${accessToken}` } });
  expect(authorized.status).toBe(200);
  expect(await authorized.json()).toMatchObject({ isMuted: expect.any(Boolean) });

  const rejected = connect(`ws://127.0.0.1:${port}/api/v1/ws`);
  await expect.poll(() => rejected.closed()?.code).toBe(POLICY_VIOLATION);
  const accepted = connect(`ws://127.0.0.1:${port}/api/v1/ws?token=${accessToken}`);
  await expect.poll(() => accepted.messages[0]?.type).toBe("PLAYER_INFO");
  accepted.socket.close();

  // Revoking the client in settings applies live.
  await setCore(page, "apiServer", { authorizedClients: [] });
  await expect
    .poll(async () => (await fetch(`${base}/api/v1/volume`, { headers: { Authorization: `Bearer ${accessToken}` } })).status)
    .toBe(401);
});

test("asks in the app's language before authorizing a new client", async ({ launch }) => {
  const port = randomPort();
  const base = `http://127.0.0.1:${port}`;
  const app = await launch({
    core: {
      general: { language: "de" },
      apiServer: { enabled: true, hostname: "127.0.0.1", port, authStrategy: "AUTH_AT_FIRST", secret: "e2e-secret" },
    },
  });
  await mainWindow(app);
  await waitForApi(base);
  // Answers the prompt with "Allow" and keeps what it showed.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async (_window: unknown, options: Electron.MessageBoxOptions) => {
      (globalThis as { shownDialog?: unknown }).shownDialog = options;
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });

  expect((await fetch(`${base}/auth/e2e-new`, { method: "POST" })).status).toBe(200);
  const shown = await app.evaluate(() => (globalThis as { shownDialog?: Electron.MessageBoxOptions }).shownDialog);
  expect(shown).toMatchObject({ title: "API-Autorisierungs-Anfrage", buttons: ["Erlauben", "Ablehnen"] });
  expect(shown?.message).toMatch(/^e2e-new \(.+\) den Zugriff zur API erlauben\?$/);
});

test("is off by default", async ({ page }) => {
  const state = await page.evaluate(() => window.__pearRuntime!.plugins.core("apiServer"));
  expect(state.config).toMatchObject({ enabled: false, hostname: "127.0.0.1", port: DEFAULT_PORT });
  expect(state.status).toBeUndefined();
});

test("plugins' RPC methods are callable, validated, documented and follow the plugin's state", async ({ launch, defer, tempDir }) => {
  test.setTimeout(120_000);
  const port = randomPort();
  const base = `http://127.0.0.1:${port}`;
  const folder = tempDir("pear-e2e-rpc-");
  const app = await launch({
    core: openServer(port),
    plugins: {
      sponsorblock: { enabled: true },
      downloader: { enabled: true, config: { downloadFolder: folder } },
    },
  });
  const page = await mainWindow(app);
  const call = (path: string, body?: unknown) =>
    fetch(`${base}/api/v1/plugins/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  await waitForApi(base);

  const listed = await (await fetch(`${base}/api/v1/plugins`)).json();
  expect(listed).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ plugin: "sponsorblock", method: "segments", path: "/api/v1/plugins/sponsorblock/segments" }),
      expect.objectContaining({ plugin: "downloader", method: "download" }),
    ]),
  );
  const doc = await (await fetch(`${base}/doc`)).json();
  expect(doc.paths["/api/v1/plugins/sponsorblock/segments"].post.requestBody.content["application/json"].schema).toMatchObject({
    properties: { videoId: { type: "string" } },
    required: ["videoId"],
  });

  // A real lookup against SponsorBlock: an array of segments (possibly empty).
  const segments = await call("sponsorblock/segments", { videoId: TEST_TRACK });
  expect(segments.status).toBe(200);
  expect(Array.isArray(await segments.json())).toBe(true);

  const invalid = await call("sponsorblock/segments", { videoId: "not a video" });
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).error).toContain("videoId: not a video id");
  expect((await call("sponsorblock/segments")).status).toBe(400);
  expect((await call("sponsorblock/missing", {})).status).toBe(404);

  // Plugin events reach WebSocket clients: a cancelled download reports its result.
  const ws = connect(`ws://127.0.0.1:${port}/api/v1/ws`);
  defer(() => ws.socket.close());
  await expect.poll(() => ws.messages[0]?.type).toBe("PLAYER_INFO");
  const download = await call("downloader/download", { videoId: TEST_TRACK });
  expect(download.status).toBe(200);
  const { id } = (await download.json()) as { id: number };
  expect(id).toEqual(expect.anything());
  // Its progress, as an event and from the queue.
  await expect
    .poll(() => ws.messages.find((m) => m.type === "PLUGIN_EVENT" && m.event === "progress" && (m.data as { active?: unknown }).active), {
      timeout: 30_000,
    })
    .toMatchObject({ plugin: "downloader", data: { active: expect.objectContaining({ id }) } });
  expect(await (await call("downloader/queue")).json()).toEqual([expect.objectContaining({ id, status: "active" })]);
  expect((await call("downloader/cancel")).status).toBe(204);
  await expect
    .poll(() => ws.messages.find((m) => m.type === "PLUGIN_EVENT" && m.event === "result"), { timeout: 30_000 })
    .toMatchObject({ plugin: "downloader", data: expect.objectContaining({ cancelled: true }) });
  expect(await (await call("downloader/queue")).json()).toEqual([expect.objectContaining({ id, status: "cancelled" })]);

  // Disabling the plugin takes its methods away live.
  await setEnabled(page, "sponsorblock", false);
  expect((await call("sponsorblock/segments", { videoId: TEST_TRACK })).status).toBe(503);
  const after = await (await fetch(`${base}/doc`)).json();
  expect(after.paths["/api/v1/plugins/sponsorblock/segments"]).toBeUndefined();
});
