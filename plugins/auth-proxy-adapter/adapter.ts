// A local, credential-less SOCKS5 server that forwards every CONNECT through
// an authenticated upstream SOCKS proxy (Chromium can't authenticate to SOCKS).

import { createServer, type AddressInfo, type Socket } from "node:net";
import { SocksClient } from "socks";
import type { Logger } from "@pear/sdk";
import { errorMessage } from "@pear/sdk/util";

export interface Upstream {
  host: string;
  port: number;
  type: 4 | 5;
  username: string;
  password: string;
}

export interface Adapter {
  host: string;
  port: number;
  close(): void;
}

const CONNECT_TIMEOUT_MS = 30_000;
const reply = (code: number) => Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
const REPLY = { ok: 0x00, failure: 0x01, unreachable: 0x05, unsupportedCommand: 0x07, unsupportedAddress: 0x08 };

export function startAdapter(upstream: Upstream, listen: { host: string; port: number }, log: Logger): Promise<Adapter> {
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("error", () => client.destroy());
    void handle(client, upstream).catch((error: unknown) => {
      log.warn("SOCKS connection failed:", errorMessage(error));
      client.destroy();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listen.port, listen.host, () => {
      server.off("error", reject);
      server.on("error", (error) => log.error("SOCKS adapter error", error));
      const address = server.address() as AddressInfo;
      resolve({
        host: listen.host,
        port: address.port,
        close() {
          server.close();
          for (const socket of sockets) socket.destroy();
        },
      });
    });
  });
}

async function handle(client: Socket, upstream: Upstream) {
  const read = reader(client);
  // Greeting: VER NMETHODS METHODS…; we only offer "no authentication".
  const [version = 0, methodCount = 0] = await read(2);
  if (version !== 0x05) return void client.destroy();
  const methods = await read(methodCount);
  if (!methods.includes(0x00)) return void client.end(Buffer.from([0x05, 0xff]));
  client.write(Buffer.from([0x05, 0x00]));

  // Request: VER CMD RSV ATYP DST.ADDR DST.PORT
  const [, command, , addressType] = await read(4);
  let host: string;
  if (addressType === 0x01) host = [...(await read(4))].join(".");
  else if (addressType === 0x03) host = (await read((await read(1))[0]!)).toString();
  else if (addressType === 0x04) {
    const bytes = await read(16);
    host = Array.from({ length: 8 }, (_, i) => bytes.readUInt16BE(i * 2).toString(16)).join(":");
  } else return void client.end(reply(REPLY.unsupportedAddress));
  const port = (await read(2)).readUInt16BE(0);
  if (command !== 0x01) return void client.end(reply(REPLY.unsupportedCommand));

  let remote: Socket;
  try {
    ({ socket: remote } = await SocksClient.createConnection({
      command: "connect",
      destination: { host, port },
      timeout: CONNECT_TIMEOUT_MS,
      proxy: {
        host: upstream.host,
        port: upstream.port,
        type: upstream.type,
        ...(upstream.username ? { userId: upstream.username, password: upstream.password } : {}),
      },
    }));
  } catch (error) {
    client.end(reply(REPLY.unreachable));
    throw error;
  }
  if (client.destroyed) return void remote.destroy();
  client.write(reply(REPLY.ok));
  const leftover = read.rest();
  if (leftover.length > 0) remote.write(leftover);
  remote.on("error", () => client.destroy());
  remote.on("close", () => client.destroy());
  client.on("close", () => remote.destroy());
  remote.pipe(client);
  client.pipe(remote);
}

/** Reads exact byte counts from a socket; `rest()` hands back anything read ahead and stops reading. */
function reader(socket: Socket) {
  let buffered = Buffer.alloc(0);
  let waiting: { n: number; resolve(data: Buffer): void; reject(error: Error): void } | undefined;
  const flush = () => {
    if (!waiting || buffered.length < waiting.n) return;
    const { n, resolve } = waiting;
    waiting = undefined;
    const data = buffered.subarray(0, n);
    buffered = buffered.subarray(n);
    resolve(data);
  };
  const onData = (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    flush();
  };
  const onEnd = () => waiting?.reject(new Error("client closed the connection during the handshake"));
  socket.on("data", onData);
  socket.on("close", onEnd);
  const read = (n: number) =>
    new Promise<Buffer>((resolve, reject) => {
      waiting = { n, resolve, reject };
      flush();
    });
  return Object.assign(read, {
    rest() {
      socket.off("data", onData);
      socket.off("close", onEnd);
      return buffered;
    },
  });
}
