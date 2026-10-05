import { test, expect } from '@playwright/test';

import {
  configureElectronTransport,
  electronTransport,
} from './electron-transport';
import { bounded, lyricsHttp, LyricsError } from './http';

test('HTTP text/JSON helpers and optional schema validation', async () => {
  const transport = () => Promise.resolve(new Response('{"ok":true}'));
  expect(await lyricsHttp.text('test', { transport })).toBe('{"ok":true}');
  expect(
    await lyricsHttp.json('test', { transport }, (value) => {
      if (!(value as { ok?: boolean }).ok) throw new Error('missing ok');
      return value;
    }),
  ).toEqual({ ok: true });
  await expect(
    lyricsHttp.json('test', {
      transport: () => Promise.resolve(new Response('invalid')),
    }),
  ).rejects.toMatchObject({ kind: 'parse/schema' });
  await expect(
    lyricsHttp.json('test', { transport }, () => {
      throw new Error('schema');
    }),
  ).rejects.toMatchObject({ kind: 'parse/schema' });
});

test('HTTP status and network failures retain classified errors', async () => {
  for (const [status, kind] of [
    [429, 'rate-limited'],
    [401, 'auth'],
    [403, 'auth'],
    [500, 'http'],
  ] as const) {
    await expect(
      lyricsHttp.text('test', {
        transport: () => Promise.resolve(new Response('', { status })),
      }),
    ).rejects.toMatchObject({ kind, status });
  }
  await expect(
    lyricsHttp.text('test', {
      transport: () => Promise.reject(new TypeError('network')),
    }),
  ).rejects.toMatchObject({ kind: 'provider unavailable' });
});

test('timeout/abort also bounds response bodies and permanently hung transports', async () => {
  let signal: AbortSignal | null | undefined;
  await expect(
    lyricsHttp.text('test', {
      timeoutMs: 20,
      transport: async (_, init) => {
        signal = init.signal;
        return new Promise(() => {});
      },
    }),
  ).rejects.toMatchObject({ kind: 'timeout' });
  expect(signal?.aborted).toBe(true);
  const controller = new AbortController();
  const pending = lyricsHttp.text('test', {
    signal: controller.signal,
    transport: (_, init) => {
      signal = init.signal;
      return Promise.resolve(new Response(new ReadableStream({ start() {} })));
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  expect(signal?.aborted).toBe(true);
  let called = false;
  await expect(
    bounded(() => {
      called = true;
      return Promise.resolve();
    }, controller.signal),
  ).rejects.toMatchObject({ kind: 'aborted' });
  expect(called).toBe(false);
});

test('safe retries bounded, auth/schema/POST not retried; abort cancels backoff', async () => {
  let calls = 0;
  const transport = () => {
    calls++;
    return Promise.resolve(new Response('', { status: 503 }));
  };
  await expect(
    lyricsHttp.text('test', { transport, retries: 99 }),
  ).rejects.toMatchObject({ kind: 'http' });
  expect(calls).toBe(3);
  calls = 0;
  await expect(
    lyricsHttp.text('test', { transport, retries: 2, method: 'POST' }),
  ).rejects.toMatchObject({ status: 503 });
  expect(calls).toBe(1);
  calls = 0;
  await expect(
    lyricsHttp.json('test', {
      retries: 2,
      transport: () => {
        calls++;
        return Promise.resolve(new Response('bad'));
      },
    }),
  ).rejects.toMatchObject({ kind: 'parse/schema' });
  expect(calls).toBe(1);
  const controller = new AbortController();
  calls = 0;
  const pending = lyricsHttp.text('test', {
    transport,
    retries: 2,
    signal: controller.signal,
  });
  await expect.poll(() => calls).toBe(1);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  expect(calls).toBe(1);
});

test('privileged transport forwards cancellation ID, not AbortSignal across IPC', async () => {
  const calls: { channel: string; args: unknown[] }[] = [];
  let release!: (value: unknown) => void;
  configureElectronTransport(async (channel, ...args) => {
    calls.push({ channel, args });
    if (channel.endsWith(':cancel')) return;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  try {
    const controller = new AbortController();
    const pending = electronTransport('test', {
      signal: controller.signal,
      headers: { 'User-Agent': 'test' },
    });
    controller.abort(new LyricsError('aborted', 'Stopped'));
    expect(calls[1].channel).toBe('synced-lyrics:cancel');
    expect(calls[1].args[0]).toBe(calls[0].args[0]);
    expect(calls[0].args[2]).not.toHaveProperty('signal');
    release({ status: 200, body: 'text', headers: {} });
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  } finally {
    configureElectronTransport(undefined);
  }
});
