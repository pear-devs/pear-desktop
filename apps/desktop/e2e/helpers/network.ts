// Local servers the tests point the app at.

import { once } from "node:events";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { type AddressInfo, connect } from "node:net";
import { YTM_ORIGIN } from "@pear/sdk/util";
import { expect } from "@playwright/test";

/** YTM's host name, as proxies see it in CONNECT requests. */
export const YTM_HOST = new URL(YTM_ORIGIN).host;

const PORT_BASE = 30000;
const PORT_RANGE = 20000;

/** A port for a server the app opens itself (the API server, Amuse). */
export const randomPort = () => PORT_BASE + Math.floor(Math.random() * PORT_RANGE);

/** Waits until the API server at `base` answers. */
export async function waitForApi(base: string) {
  await expect.poll(async () => (await fetch(`${base}/doc`).catch(() => null))?.status).toBe(200);
}

/** A CONNECT proxy that records the tunnels it opened; with `credentials`, it requires Basic auth. */
export async function startConnectProxy({ credentials }: { credentials?: { username: string; password: string } } = {}) {
  const tunnels: string[] = [];
  let challenges = 0;
  const expected = credentials && `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
  const server = createServer((_, response) => response.writeHead(502).end());
  server.on("connect", (request, client, head) => {
    client.on("error", () => client.destroy());
    if (expected && request.headers["proxy-authorization"] !== expected) {
      challenges++;
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="pear"\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    tunnels.push(request.url ?? "");
    const [host = "", port = "443"] = (request.url ?? "").split(":");
    const upstream = connect(Number(port), host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    tunnels,
    challenges: () => challenges,
    close: () => server.close(),
  };
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
