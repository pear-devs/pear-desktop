import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

import { app } from 'electron';

import phonePage from './phone.html?raw';

export const PHONE_PORT = 26539;

const MAX_BODY_BYTES = 1024;
const ACTIONS = new Set([
  'toggle-play',
  'previous',
  'next',
  'seek',
  'vocals',
  'nudge-lyrics',
  'toggle-karaoke',
]);

export type PhoneLine = { t: number; d: number; x: string };

let server: Server | null = null;
let listening = false;
let state: Record<string, unknown> = {};
let lines: PhoneLine[] = [];

export const setPhoneState = (next: Record<string, unknown>) => {
  state = next;
};

export const setPhoneLines = (next: PhoneLine[]) => {
  lines = next;
};

/** The secret in the link. Without it the server answers nothing. */
const getKey = () => {
  const folder = join(app.getPath('userData'), 'karaoke');
  mkdirSync(folder, { recursive: true });

  const path = join(folder, 'phone-key.txt');
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();

  const key = randomBytes(9).toString('hex');
  writeFileSync(path, key);
  return key;
};

const isVirtualAdapter = (name: string) =>
  /vpn|radmin|hamachi|tailscale|zerotier|vmware|virtualbox|hyper-v|wsl|vethernet/i.test(
    name,
  );

const isHomeAddress = (address: string) =>
  /^(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address);

export const isPhoneServerRunning = () => listening;

export const getPhoneLink = () => {
  const addresses = Object.entries(networkInterfaces()).flatMap(
    ([name, entries]) =>
      (entries ?? [])
        .filter(
          (entry) =>
            entry.family === 'IPv4' &&
            !entry.internal &&
            !isVirtualAdapter(name) &&
            isHomeAddress(entry.address),
        )
        .map((entry) => entry.address),
  );

  const address = addresses[0];
  return address ? `http://${address}:${PHONE_PORT}/?k=${getKey()}` : null;
};

const hasKey = (given: string | null, key: string) => {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const startPhoneServer = (
  onCommand: (action: string, value: unknown) => void,
) => {
  if (server) return;

  const key = getKey();

  server = createServer((request, response) => {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://phone');
    } catch {
      response.writeHead(400).end();
      return;
    }

    if (!hasKey(url.searchParams.get('k'), key)) {
      response.writeHead(403).end();
      return;
    }

    const json = (body: unknown) => {
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(body));
    };

    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(phonePage);
    } else if (request.method === 'GET' && url.pathname === '/state') {
      json(state);
    } else if (request.method === 'GET' && url.pathname === '/lyrics') {
      json(lines);
    } else if (request.method === 'POST' && url.pathname === '/control') {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
        if (body.length > MAX_BODY_BYTES) request.destroy();
      });
      request.on('end', () => {
        try {
          const { action, value } = JSON.parse(body) as {
            action: string;
            value?: unknown;
          };
          if (!ACTIONS.has(action)) throw new Error('Unknown action');
          onCommand(action, value);
          response.writeHead(204).end();
        } catch {
          response.writeHead(400).end();
        }
      });
    } else {
      response.writeHead(404).end();
    }
  });

  server.on('listening', () => {
    listening = true;
  });
  server.on('error', (error) => {
    console.error('[karaoke] Phone remote could not start:', error);
    listening = false;
    server = null;
  });
  server.listen(PHONE_PORT, '0.0.0.0');
};

export const stopPhoneServer = () => {
  server?.close();
  server = null;
  listening = false;
};
