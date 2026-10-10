import { test, expect } from '@playwright/test';

import { ElectronLyricsRequests } from './electron-requests';

test('main transport cancellation aborts actual work, isolates request IDs and releases resources', async () => {
  const signals: AbortSignal[] = [];
  const requests = new ElectronLyricsRequests((_, init) => {
    signals.push(init.signal!);
    return new Promise(() => {});
  }, 100);
  const one = requests.fetch('one', 'test', {});
  const two = requests.fetch('two', 'test', {});
  await Promise.resolve();
  await Promise.resolve();
  requests.cancel('one');
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
  expect(await one).toMatchObject({ error: 'aborted' });
  requests.dispose();
  expect(await two).toMatchObject({ error: 'aborted' });
  expect(signals[1].aborted).toBe(true);
  expect(requests.size).toBe(0);
});

test('main transport deadline bounds hung request/body and can be reused after stop', async () => {
  let signal: AbortSignal | null | undefined;
  const requests = new ElectronLyricsRequests((_, init) => {
    signal = init.signal;
    return new Promise(() => {});
  }, 20);
  expect(await requests.fetch('hung', 'test', {})).toMatchObject({
    error: 'timeout',
  });
  expect(signal?.aborted).toBe(true);
  expect(requests.size).toBe(0);
  requests.dispose();
  expect(await requests.fetch('restart', 'test', {})).toMatchObject({
    error: 'timeout',
  });
  const bodies = new ElectronLyricsRequests(
    () => Promise.resolve(new Response(new ReadableStream({ start() {} }))),
    20,
  );
  expect(await bodies.fetch('body', 'test', {})).toMatchObject({
    error: 'timeout',
  });
  expect(bodies.size).toBe(0);
});
