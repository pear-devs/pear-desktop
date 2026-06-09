import { LoggerPrefix } from '@/utils';

import { computeLanIp, parseRange } from './util';

// Type-only; the values are dynamically imported to keep this module
// side-effect-free (so the renderer build never pulls electron/node deps).
import type {
  Innertube,
  YT,
  Types as YtTypes,
} from '\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js';

/**
 * Minimal shape of the bundled ffmpeg.wasm instance we use. The package ships
 * no type definitions, so we declare just the methods we call here (rather than
 * leaking `any` and disabling the no-unsafe-* lint rules everywhere).
 */
interface FfmpegInstance {
  isLoaded(): boolean;
  load(): Promise<void>;
  run(...args: string[]): Promise<void>;
  FS(method: 'writeFile', path: string, data: Uint8Array): void;
  FS(method: 'readFile', path: string): Uint8Array;
  FS(method: 'unlink', path: string): void;
}

type CreateFfmpeg = (opts: {
  log: boolean;
  logger: () => void;
  progress: () => void;
}) => FfmpegInstance;

interface ResolvedStream {
  bytes: Uint8Array;
  contentType: string;
  expiresAt: number;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

interface DownloadAttempt {
  opts: YtTypes.DownloadOptions;
  // Whether the resulting audio is AAC (so ffmpeg can stream-copy it into
  // ADTS losslessly) or must be re-encoded to AAC (e.g. Opus/WebM).
  aac: boolean;
}

/**
 * Local HTTP server that the Cast device fetches audio from.
 *
 * YouTube's high-quality audio-only formats (itag 140 AAC, 251 Opus, ...) are
 * delivered as *fragmented* (DASH) MP4/WebM, which the Chromecast Default Media
 * Receiver's progressive player cannot play (it errors with idleReason=ERROR).
 * Muxed formats are progressive but low quality and waste video bandwidth.
 *
 * So we download the best audio on this machine (via youtubei.js, which handles
 * the segmented/range fetching and any deciphering through the Electron `net`
 * fetch) and **remux** it — without re-encoding where possible — into a
 * progressive ADTS/AAC stream using the bundled ffmpeg.wasm. The result is
 * cached in memory and served to the speaker with full HTTP Range support.
 *
 * Every node/electron dependency is imported lazily so this module stays
 * side-effect-free and never reaches (or crashes) the renderer bundle.
 */
export class AudioProxy {
  private yt: Innertube | null = null;
  private server: { close: () => void } | null = null;
  private port = 26539;
  private lanIpAddr = '127.0.0.1';
  private readonly cache = new Map<string, ResolvedStream>();
  private readonly inflight = new Map<string, Promise<ResolvedStream>>();

  // Lazily-created bundled ffmpeg.wasm instance + a lock to serialise runs
  // (ffmpeg.wasm has a single shared FS, so concurrent runs would collide).
  private ffmpeg: FfmpegInstance | null = null;
  private ffmpegLock: Promise<unknown> = Promise.resolve();
  private streamToIterable:
    | ((stream: ReadableStream<Uint8Array>) => AsyncIterable<Uint8Array>)
    | null = null;
  private randomName: (() => string) | null = null;
  // Unguessable per-session token in the media URL path, so other devices on
  // the LAN can't hit the endpoint and trigger expensive download+remux work.
  private token = '';

  async start(port: number) {
    this.port = port;

    const [yt, honoMod, nodeServer, utilsMain, os, nodeCrypto] =
      await Promise.all([
        import('\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js'),
        import('hono'),
        import('@hono/node-server'),
        import('@/plugins/utils/main'),
        import('node:os'),
        import('node:crypto'),
      ]);

    const upstreamFetch = utilsMain.getNetFetchAsFetch();
    this.lanIpAddr = computeLanIp(os.networkInterfaces());
    this.yt = await yt.Innertube.create({
      fetch: upstreamFetch,
      generate_session_locally: true,
    });
    this.streamToIterable = yt.Utils.streamToIterable;
    this.randomName = () => nodeCrypto.randomBytes(16).toString('hex');
    this.token = nodeCrypto.randomBytes(16).toString('hex');

    // No CORS middleware: the consumer is the Cast receiver (not a browser),
    // so we deliberately avoid advertising the endpoint to web origins.
    const app = new honoMod.Hono();
    app.get('/audio/:token/:videoId', (c) => {
      if (c.req.param('token') !== this.token) {
        return new Response('Not found', { status: 404 });
      }
      return this.handleAudio(c.req.raw, c.req.param('videoId'));
    });

    try {
      this.server = nodeServer.serve({
        fetch: app.fetch.bind(app),
        port: this.port,
        hostname: '0.0.0.0',
      });
    } catch (err) {
      console.error(
        LoggerPrefix,
        `[chromecast] failed to start audio proxy on port ${this.port} (is it in use?)`,
        err,
      );
      throw err;
    }
    console.log(
      LoggerPrefix,
      `[chromecast] audio proxy on http://${this.lanIpAddr}:${this.port}`,
    );
  }

  stop() {
    this.server?.close();
    this.server = null;
    this.cache.clear();
    this.inflight.clear();
  }

  /** The URL to hand the Cast device for a given video. */
  mediaUrl(videoId: string): string {
    return `http://${this.lanIpAddr}:${this.port}/audio/${this.token}/${videoId}`;
  }

  /**
   * Resolve (download + remux + cache) and return the content type for the
   * LOAD command. The controller awaits this before issuing LOAD, so by the
   * time the device fetches `/audio/:videoId` the bytes are already cached.
   */
  async contentType(videoId: string): Promise<string> {
    return (await this.resolve(videoId)).contentType;
  }

  /** Pre-resolve a track without blocking (used to warm the next song). */
  prefetch(videoId: string) {
    this.resolve(videoId).catch(() => {
      /* best-effort */
    });
  }

  private async resolve(videoId: string): Promise<ResolvedStream> {
    const cached = this.cache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) {
      // Refresh recency so LRU eviction in put() reflects access, not insertion.
      this.cache.delete(videoId);
      this.cache.set(videoId, cached);
      return cached;
    }

    const existing = this.inflight.get(videoId);
    if (existing) return existing;

    const job = this.doResolve(videoId).finally(() =>
      this.inflight.delete(videoId),
    );
    this.inflight.set(videoId, job);
    return job;
  }

  private async doResolve(videoId: string): Promise<ResolvedStream> {
    const yt = this.yt;
    if (!yt) throw new Error('Innertube not ready');

    // IOS/ANDROID return directly-playable URLs without a po_token; WEB needs
    // deciphering (handled by youtubei.js). Try them in order of preference.
    const clients: ('IOS' | 'ANDROID' | undefined)[] = [
      'IOS',
      'ANDROID',
      undefined,
    ];
    // Prefer AAC audio-only (lossless copy → ADTS); then any audio-only
    // (re-encode Opus → AAC); finally muxed progressive (extract AAC).
    const attempts: DownloadAttempt[] = [
      { opts: { type: 'audio', quality: 'best', format: 'mp4' }, aac: true },
      { opts: { type: 'audio', quality: 'best', format: 'any' }, aac: false },
      {
        opts: { type: 'video+audio', quality: 'best', format: 'any' },
        aac: true,
      },
    ];

    let lastErr: unknown = null;
    for (const client of clients) {
      let info: YT.VideoInfo;
      try {
        info = client
          ? await yt.getInfo(videoId, { client })
          : await yt.getInfo(videoId);
      } catch (err) {
        lastErr = err;
        continue;
      }

      for (const attempt of attempts) {
        try {
          const stream = await info.download(attempt.opts);
          const input = await this.collect(stream);
          const bytes = await this.remux(input, attempt.aac);
          if (!bytes.length) throw new Error('empty remux output');

          const resolved: ResolvedStream = {
            bytes,
            contentType: 'audio/aac',
            expiresAt: Date.now() + ONE_HOUR_MS,
          };
          this.put(videoId, resolved);
          return resolved;
        } catch (err) {
          lastErr = err;
          /* try the next attempt / client */
        }
      }
    }
    throw new Error(
      `No playable format for ${videoId}: ${String(
        (lastErr as Error)?.message ?? lastErr,
      )}`,
    );
  }

  private async collect(
    stream: ReadableStream<Uint8Array>,
  ): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const iterable = this.streamToIterable!(stream);
    for await (const chunk of iterable) {
      chunks.push(chunk);
      total += chunk.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  /** Remux to progressive ADTS/AAC via bundled ffmpeg.wasm (serialised). */
  private async remux(input: Uint8Array, aac: boolean): Promise<Uint8Array> {
    const ff = await this.ensureFfmpeg();

    // Serialise ffmpeg.wasm runs (shared in-memory FS).
    const run = this.ffmpegLock.then(async () => {
      const inName = this.randomName!();
      const outName = `${inName}.aac`;
      const copyArgs = ['-i', inName, '-vn', '-acodec', 'copy', '-f', 'adts'];
      const encodeArgs = [
        '-i',
        inName,
        '-vn',
        '-acodec',
        'aac',
        '-b:a',
        '192k',
        '-f',
        'adts',
      ];
      ff.FS('writeFile', inName, input);
      try {
        try {
          await ff.run(...(aac ? copyArgs : encodeArgs), outName);
        } catch {
          // Stream-copy failed (codec mismatch) — fall back to an AAC encode.
          try {
            ff.FS('unlink', outName);
          } catch {
            /* not created */
          }
          await ff.run(...encodeArgs, outName);
        }
        return ff.FS('readFile', outName);
      } finally {
        try {
          ff.FS('unlink', inName);
        } catch {
          /* ignore */
        }
        try {
          ff.FS('unlink', outName);
        } catch {
          /* ignore */
        }
      }
    });
    this.ffmpegLock = run.catch(() => {});
    return run;
  }

  private async ensureFfmpeg(): Promise<FfmpegInstance> {
    if (this.ffmpeg?.isLoaded()) return this.ffmpeg;
    if (!this.ffmpeg) {
      const mod = (await import('@ffmpeg.wasm/main')) as unknown as {
        createFFmpeg: CreateFfmpeg;
      };
      this.ffmpeg = mod.createFFmpeg({
        log: false,
        logger() {},
        progress() {},
      });
    }
    if (!this.ffmpeg.isLoaded()) await this.ffmpeg.load();
    return this.ffmpeg;
  }

  private put(videoId: string, resolved: ResolvedStream) {
    this.cache.set(videoId, resolved);
    // Bound memory: keep only the most-recent few remuxed tracks.
    while (this.cache.size > 4) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private async handleAudio(req: Request, videoId: string): Promise<Response> {
    try {
      const { bytes, contentType } = await this.resolve(videoId);
      const total = bytes.length;
      const range = parseRange(req.headers.get('range'), total);

      if (range) {
        const { start, end } = range;
        if (start >= total || start > end) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${total}` },
          });
        }
        const chunk = bytes.subarray(start, end + 1);
        return new Response(chunk as unknown as BodyInit, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': String(chunk.length),
          },
        });
      }

      return new Response(bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(total),
        },
      });
    } catch (err) {
      console.error(LoggerPrefix, '[chromecast] proxy error', err);
      return new Response('Failed to resolve stream', { status: 502 });
    }
  }
}
