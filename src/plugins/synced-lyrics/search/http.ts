export type FailureKind =
  | 'aborted'
  | 'timeout'
  | 'rate-limited'
  | 'auth'
  | 'http'
  | 'parse/schema'
  | 'provider unavailable'
  | 'no match';

export class LyricsError extends Error {
  constructor(
    public readonly kind: FailureKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'LyricsError';
  }
}

export const classifyFailure = (error: unknown): LyricsError =>
  error instanceof LyricsError
    ? error
    : new LyricsError(
        'provider unavailable',
        error instanceof Error ? error.message : String(error),
      );

// Race even non-cooperative work, while forwarding cancellation to cooperative work.
export async function bounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = 12000,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('Invalid lyrics timeout');
  const controller = new AbortController();
  const abort = () =>
    controller.abort(
      signal?.reason instanceof LyricsError
        ? signal.reason
        : new LyricsError('aborted', 'Lyrics search aborted'),
    );
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(
    () =>
      controller.abort(new LyricsError('timeout', 'Lyrics request timed out')),
    timeoutMs,
  );
  let rejectAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(classifyFailure(controller.signal.reason));
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    if (controller.signal.aborted) rejectAbort();
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return work(controller.signal);
      }),
      cancelled,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}

export type Transport = (url: string, init: RequestInit) => Promise<Response>;
export type RequestOptions = RequestInit & {
  timeoutMs?: number;
  retries?: number;
  transport?: Transport;
};

const statusError = (status: number) =>
  new LyricsError(
    status === 429
      ? 'rate-limited'
      : status === 401 || status === 403
        ? 'auth'
        : 'http',
    `Lyrics HTTP ${status}`,
    status,
  );

export const lyricsHttp = {
  async text(url: string, options: RequestOptions = {}): Promise<string> {
    const {
      timeoutMs = 10000,
      retries = 0,
      transport = fetch,
      ...init
    } = options;
    const attempts = Math.min(2, Math.max(0, Math.floor(retries) || 0));
    return bounded(
      async (signal) => {
        for (let attempt = 0; ; attempt++) {
          signal.throwIfAborted();
          try {
            const response = await transport(url, { ...init, signal });
            if (!response.ok) throw statusError(response.status);
            return await response.text();
          } catch (error) {
            signal.throwIfAborted();
            const failure = classifyFailure(error);
            const safe = !init.method || init.method.toUpperCase() === 'GET';
            const transient =
              failure.kind === 'provider unavailable' ||
              failure.status === 408 ||
              failure.status === 425 ||
              failure.status === 429 ||
              (failure.status ?? 0) >= 500;
            if (!safe || !transient || attempt >= attempts) throw failure;
            await bounded(
              () =>
                new Promise<void>((resolve) => {
                  const timer = setTimeout(done, 250 * Math.pow(2, attempt));
                  function done() {
                    signal.removeEventListener('abort', stop);
                    resolve();
                  }
                  function stop() {
                    clearTimeout(timer);
                    signal.removeEventListener('abort', stop);
                    resolve();
                  }
                  signal.addEventListener('abort', stop, { once: true });
                }),
              signal,
              timeoutMs,
            );
          }
        }
      },
      init.signal ?? undefined,
      timeoutMs,
    );
  },
  async json<T>(
    url: string,
    options: RequestOptions = {},
    validate?: (value: unknown) => T,
  ): Promise<T> {
    const text = await this.text(url, options);
    try {
      const value: unknown = JSON.parse(text);
      return validate ? validate(value) : (value as T);
    } catch (error) {
      throw new LyricsError(
        'parse/schema',
        error instanceof Error ? error.message : 'Invalid lyrics JSON',
      );
    }
  },
};
