import { net } from 'electron';

import { createBackend } from '@/utils';

import type { NetFetchInit } from './types';

// Used when the renderer does not ask for a specific timeout
const DEFAULT_TIMEOUT = 30_000;

const handlers = {
  // Note: This will only be used for Forbidden headers, e.g. User-Agent, Authority, Cookie, etc.
  // See: https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header
  async fetch(
    url: string,
    { timeout = DEFAULT_TIMEOUT, ...init }: NetFetchInit = {},
  ): Promise<[number, string, Record<string, string>]> {
    // aborts the request (and reading its body) once the timeout is over,
    // so a stalled request does not keep running in the background
    const res = await net.fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeout),
    });
    return [
      res.status,
      await res.text(),
      Object.fromEntries(res.headers.entries()),
    ];
  },
};

export const backend = createBackend({
  start(ctx) {
    ctx.ipc.handle('synced-lyrics:fetch', (url: string, init?: NetFetchInit) =>
      handlers.fetch(url, init),
    );
  },
  stop(ctx) {
    ctx.ipc.removeHandler('synced-lyrics:fetch');
  },
});
