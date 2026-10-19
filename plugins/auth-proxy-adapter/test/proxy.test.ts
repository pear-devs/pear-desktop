import { once } from "node:events";
import { type AddressInfo, connect, createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { startAdapter } from "../adapter.ts";
import { needsAdapter, parseProxy, proxyRule } from "../proxy.ts";

describe("parseProxy", () => {
  test("parses schemes, ports and credentials", () => {
    expect(parseProxy("socks5://alice:p%40ss@10.0.0.1:9050")).toEqual({
      scheme: "socks5",
      host: "10.0.0.1",
      port: 9050,
      username: "alice",
      password: "p@ss",
    });
    expect(parseProxy("proxy.example.com:3128")).toMatchObject({ scheme: "http", host: "proxy.example.com", port: 3128 });
    expect(parseProxy("socks://[::1]")).toMatchObject({ scheme: "socks5", host: "::1", port: 1080 });
    expect(parseProxy("https://h")).toMatchObject({ port: 443 });
  });
  test("explicit credentials override the URL's", () => {
    expect(parseProxy("http://a:b@h:1", { username: "c", password: "d" })).toMatchObject({ username: "c", password: "d" });
  });
  test("rejects empty and unsupported addresses with a helpful message", () => {
    expect(() => parseProxy("  ")).toThrow(/Enter a proxy address/);
    expect(() => parseProxy("ftp://h:21")).toThrow(/Unsupported proxy type/);
  });
  test("only authenticated SOCKS proxies need the adapter", () => {
    expect(needsAdapter(parseProxy("socks5://u:p@h"))).toBe(true);
    expect(needsAdapter(parseProxy("socks5://h"))).toBe(false);
    expect(needsAdapter(parseProxy("http://u:p@h"))).toBe(false);
  });
  test("formats Chromium proxy rules", () => {
    expect(proxyRule("socks5", "::1", 1080)).toBe("socks5://[::1]:1080");
    expect(proxyRule("http", "h", 8080)).toBe("http://h:8080");
  });
});

const log = { info() {}, warn() {}, error() {} };
const servers: { close(): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function listen(server: Server) {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

/** Reads from a socket until `n` bytes are available. */
function readable(socket: Socket) {
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => (buffer = Buffer.concat([buffer, chunk])));
  return async (n: number) => {
    while (buffer.length < n) await once(socket, "data");
    const out = buffer.subarray(0, n);
    buffer = buffer.subarray(n);
    return out;
  };
}

/** A minimal SOCKS5 server requiring username/password auth (RFC 1929). */
async function authenticatedSocks(username: string, password: string) {
  const seen: string[] = [];
  const port = await listen(
    createServer(async (socket) => {
      const read = readable(socket);
      const [, n = 0] = await read(2);
      const methods = await read(n);
      if (!methods.includes(0x02)) return void socket.end(Buffer.from([0x05, 0xff]));
      socket.write(Buffer.from([0x05, 0x02]));
      const [, userLength = 0] = await read(2);
      const user = (await read(userLength)).toString();
      const pass = (await read((await read(1))[0]!)).toString();
      seen.push(`${user}:${pass}`);
      if (user !== username || pass !== password) return void socket.end(Buffer.from([0x01, 0x01]));
      socket.write(Buffer.from([0x01, 0x00]));
      await read(3);
      const [atyp] = await read(1);
      const host = atyp === 0x03 ? (await read((await read(1))[0]!)).toString() : [...(await read(4))].join(".");
      const targetPort = (await read(2)).readUInt16BE(0);
      const target = connect(targetPort, host === "localhost" ? "127.0.0.1" : host, () => {
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        socket.pipe(target);
        target.pipe(socket);
      });
      target.on("error", () => socket.destroy());
    }),
  );
  return { port, seen };
}

/** Speaks credential-less SOCKS5 to the adapter, like Chromium does. */
async function connectThrough(adapterPort: number, host: string, port: number) {
  const socket = connect(adapterPort, "127.0.0.1");
  const read = readable(socket);
  socket.write(Buffer.from([0x05, 0x01, 0x00]));
  expect([...(await read(2))]).toEqual([0x05, 0x00]);
  const name = Buffer.from(host);
  const portBytes = Buffer.alloc(2);
  portBytes.writeUInt16BE(port);
  socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]), name, portBytes]));
  const [, code] = await read(10);
  return { socket, read, code };
}

describe("SOCKS adapter", () => {
  test("tunnels connections through an authenticated upstream", async () => {
    const echoPort = await listen(createServer((socket) => socket.pipe(socket)));
    const upstream = await authenticatedSocks("alice", "secret");
    const adapter = await startAdapter(
      { host: "127.0.0.1", port: upstream.port, type: 5, username: "alice", password: "secret" },
      { host: "127.0.0.1", port: 0 },
      log,
    );
    servers.push(adapter);

    const { socket, read, code } = await connectThrough(adapter.port, "localhost", echoPort);
    expect(code).toBe(0x00);
    socket.write("hello");
    expect((await read(5)).toString()).toBe("hello");
    expect(upstream.seen).toEqual(["alice:secret"]);
    socket.destroy();
  });

  test("reports a failure when the upstream rejects the credentials", async () => {
    const upstream = await authenticatedSocks("alice", "secret");
    const adapter = await startAdapter(
      { host: "127.0.0.1", port: upstream.port, type: 5, username: "alice", password: "wrong" },
      { host: "127.0.0.1", port: 0 },
      log,
    );
    servers.push(adapter);
    const { socket, code } = await connectThrough(adapter.port, "localhost", 9);
    expect(code).not.toBe(0x00);
    socket.destroy();
  });
});
