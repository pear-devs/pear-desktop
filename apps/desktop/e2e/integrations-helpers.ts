// Shared by the integrations e2e tests: fake local services the plugins talk to.

import { mkdtempSync, readdirSync, symlinkSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createNetServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";

/**
 * Pauses before closing: while a track plays, YTM's beforeunload handler
 * cancels the window close and app.close() never resolves.
 */
export async function closeApp(app: ElectronApplication) {
  const page = app.windows()[0];
  await page
    ?.evaluate(() => {
      window.__pearRuntime?.player.control({ type: "pause" });
      document.querySelector("video")?.pause();
    })
    .catch(() => {});
  await page?.waitForTimeout(300).catch(() => {});
  await app.close();
}

/** Keeps playing through pre-roll ads (logged out) until the track itself plays. */
export async function waitForTrackPlaying(page: Page, timeout = 120_000) {
  await page.waitForFunction(
    () => {
      const { player } = window.__pearRuntime!;
      const video = document.querySelector("video");
      if (video?.paused) void video.play();
      return !player.state.ad && player.state.status === "playing" && player.state.positionSeconds > 0;
    },
    undefined,
    { timeout, polling: 1000 },
  );
}

export interface Received {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: any;
}

/** An HTTP server that records every request and answers 200 {}. */
export async function recordingServer(port = 0) {
  const requests: Received[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {}
      requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    requests,
    port: typeof address === "object" && address ? address.port : port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * A fake Discord client speaking the local IPC protocol, in a private runtime
 * dir so the app never reaches a real Discord. Pass `env` to the app (it
 * mirrors the real XDG_RUNTIME_DIR so audio and D-Bus keep working).
 */
export function fakeDiscord() {
  const runtimeDir = mkdtempSync(join(tmpdir(), "pear-discord-"));
  const real = process.env.XDG_RUNTIME_DIR;
  if (real) {
    for (const entry of readdirSync(real)) {
      if (entry.startsWith("discord-ipc-") || entry === "snap.discord" || entry === "app") continue;
      try {
        symlinkSync(join(real, entry), join(runtimeDir, entry));
      } catch {}
    }
  }
  /** Every SET_ACTIVITY payload; null for a clear. */
  const activities: (Record<string, any> | null)[] = [];
  const sockets = new Set<Socket>();
  const frame = (op: number, data: unknown) => {
    const json = Buffer.from(JSON.stringify(data));
    const header = Buffer.alloc(8);
    header.writeUInt32LE(op, 0);
    header.writeUInt32LE(json.length, 4);
    return Buffer.concat([header, json]);
  };
  const server = createNetServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        const op = buffer.readUInt32LE(0);
        const length = buffer.readUInt32LE(4);
        if (buffer.length < 8 + length) break;
        const message = JSON.parse(buffer.subarray(8, 8 + length).toString() || "null");
        buffer = buffer.subarray(8 + length);
        if (op === 0) {
          socket.write(
            frame(1, {
              cmd: "DISPATCH",
              evt: "READY",
              data: {
                v: 1,
                config: { cdn_host: "cdn.discordapp.com", api_endpoint: "//discord.com/api", environment: "production" },
                user: { id: "1", username: "e2e", discriminator: "0", global_name: "E2E", avatar: null, flags: 0, premium_type: 0 },
              },
            }),
          );
        } else if (op === 3) {
          socket.write(frame(4, message));
        } else if (op === 1 && message?.cmd === "SET_ACTIVITY") {
          activities.push(message.args.activity ?? null);
          socket.write(frame(1, { cmd: "SET_ACTIVITY", evt: null, nonce: message.nonce, data: message.args.activity ?? null }));
        }
      }
    });
  });
  return {
    activities,
    env: { XDG_RUNTIME_DIR: runtimeDir },
    connections: () => sockets.size,
    listen: () => new Promise<void>((resolve) => server.listen(join(runtimeDir, "discord-ipc-0"), resolve)),
    close() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}
