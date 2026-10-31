import { once } from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { test, expect } from '@playwright/test';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sign, verify } from 'hono/jwt';

const require = createRequire(import.meta.url);
const fromDependency = (parent) => createRequire(require.resolve(parent));

test('patched Hono adapter preserves routes, CORS and JWT verification', async () => {
  const app = new Hono();
  app.use('*', cors({ origin: 'https://fixture.invalid' }));
  app.get('/health', (context) => context.json({ ok: true }));
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/health`, {
      headers: { Origin: 'https://fixture.invalid' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://fixture.invalid',
    );
    expect(await response.json()).toEqual({ ok: true });
    // Synthetic test-only key; never use it for real authentication.
    const key = 'synthetic-test-key-with-at-least-32-bytes';
    const token = await sign({ sub: 'fixture-client' }, key, 'HS256');
    expect(await verify(token, key, 'HS256')).toMatchObject({
      sub: 'fixture-client',
    });
    await expect(
      verify(token, 'different-synthetic-test-key-with-32-bytes', 'HS256'),
    ).rejects.toThrow();
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('patched transitive parsers preserve updater YAML and DBus XML contracts', () => {
  const yaml = fromDependency('electron-updater')('js-yaml');
  expect(
    yaml.load('version: 3.12.2\nfiles:\n  - url: fixture.AppImage\n'),
  ).toEqual({
    version: '3.12.2',
    files: [{ url: 'fixture.AppImage' }],
  });
  const { XMLParser } = fromDependency('@jellybrick/dbus-next')(
    'fast-xml-parser',
  );
  expect(
    new XMLParser({ ignoreAttributes: false }).parse(
      '<node><interface name="org.fixture.Player"/></node>',
    ),
  ).toEqual({ node: { interface: { '@_name': 'org.fixture.Player' } } });
});

test('patched scoped UUID and Discord HTTP dependencies preserve their public API', async () => {
  const webRequest = fromDependency('@jellybrick/electron-better-web-request');
  const { v4, validate } = await import(
    pathToFileURL(webRequest.resolve('uuid')).href
  );
  const id = v4();
  expect(validate(id)).toBe(true);
  expect(v4()).not.toBe(id);
  const rpc = fromDependency('@xhayper/discord-rpc');
  const rest = createRequire(rpc.resolve('@discordjs/rest'));
  const { Headers, Request, Response } = rest('undici');
  expect(new Headers({ 'x-fixture': 'ok' }).get('x-fixture')).toBe('ok');
  expect(new Request('https://fixture.invalid/').method).toBe('GET');
  expect(await new Response('fixture').text()).toBe('fixture');
});
