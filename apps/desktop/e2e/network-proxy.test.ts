// auth-proxy-adapter: all traffic goes through an authenticated HTTP proxy from
// the first request on, and stops when the plugin is disabled.

import { once } from "node:events";
import { createServer } from "node:http";
import { type AddressInfo, connect } from "node:net";
import { expect, type Page, test } from "@playwright/test";
import { launchApp, mainWindow } from "./launch.ts";
import { closeApp } from "./network-helpers.ts";

const CREDENTIALS = { username: "alice", password: "s3cret" };

/** A CONNECT proxy that requires Basic auth and records the tunnels it opened. */
async function startProxy() {
  const tunnels: string[] = [];
  let challenges = 0;
  const expected = `Basic ${Buffer.from(`${CREDENTIALS.username}:${CREDENTIALS.password}`).toString("base64")}`;
  const server = createServer((_, response) => response.writeHead(502).end());
  server.on("connect", (request, client, head) => {
    client.on("error", () => client.destroy());
    if (request.headers["proxy-authorization"] !== expected) {
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

test("auth-proxy-adapter routes everything through an authenticated proxy, live", async () => {
  test.setTimeout(120_000);
  const proxy = await startProxy();
  const config = { url: proxy.url, ...CREDENTIALS };
  const app = await launchApp({ plugins: { "auth-proxy-adapter": { enabled: true, config } } });
  let page: Page | undefined;
  try {
    // Requests are held until the proxy applies, so even the first page load is tunnelled.
    page = await mainWindow(app);
    expect(proxy.tunnels[0]).toBe("music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com:443");
    expect(proxy.challenges()).toBeGreaterThan(0);

    // Disabling restores direct connections.
    await page.evaluate(() => window.__pear!.invoke("plugin:set-enabled", "auth-proxy-adapter", false));
    await page.waitForTimeout(500);
    let before = proxy.tunnels.length;
    await page.reload();
    await page.waitForFunction(() => window.__pearRuntime, undefined, { timeout: 30_000 });
    expect(proxy.tunnels.length).toBe(before);

    // Enabling again applies live.
    await page.evaluate(() => window.__pear!.invoke("plugin:set-enabled", "auth-proxy-adapter", true));
    before = proxy.tunnels.length;
    await page.reload();
    await page.waitForFunction(() => window.__pearRuntime, undefined, { timeout: 30_000 });
    expect(proxy.tunnels.length).toBeGreaterThan(before);

    // A bad address surfaces as an error in settings instead of silently going direct.
    await page.evaluate(() => window.__pear!.invoke("plugin:set-config", "auth-proxy-adapter", { url: "ftp://nope" }));
    await expect
      .poll(() => page!.evaluate(() => window.__pearRuntime!.plugins.error("auth-proxy-adapter") ?? ""))
      .toMatch(/Unsupported proxy type/);
  } finally {
    await closeApp(app, page);
    proxy.close();
  }
});
