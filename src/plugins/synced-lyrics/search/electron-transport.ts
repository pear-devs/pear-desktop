import { LyricsError, type Transport } from './http';

type Reply =
  | { status: number; body: string; headers: Record<string, string> }
  | { error: 'aborted' | 'timeout' | 'provider unavailable'; message: string };
let invoke:
  | ((channel: string, ...args: unknown[]) => Promise<unknown>)
  | undefined;
export const configureElectronTransport = (value: typeof invoke) => {
  invoke = value;
};

// AbortSignal cannot cross IPC. Forward explicit request IDs and cancellation.
export const electronTransport: Transport = async (url, init) => {
  const ipc = invoke;
  if (!ipc)
    throw new LyricsError('provider unavailable', 'Lyrics backend unavailable');
  init.signal?.throwIfAborted();
  const id = crypto.randomUUID();
  const abort = () => {
    ipc('synced-lyrics:cancel', id).catch((error: unknown) => {
      console.warn('Lyrics backend cancellation failed', error);
    });
  };
  const { signal, ...options } = init;
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const reply = (await ipc('synced-lyrics:fetch', id, url, options)) as Reply;
    signal?.throwIfAborted();
    if ('error' in reply) throw new LyricsError(reply.error, reply.message);
    return new Response(
      [204, 205, 304].includes(reply.status) ? null : reply.body,
      { status: reply.status, headers: reply.headers },
    );
  } finally {
    signal?.removeEventListener('abort', abort);
  }
};
