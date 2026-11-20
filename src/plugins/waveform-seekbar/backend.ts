// Backend (main process). Fetches a track's audio ONCE via the app's youtubei.js
// engine (same one the Downloader uses) so the renderer can decode the whole track and
// draw a complete, stable waveform. Kept in its own module so these Node/youtubei.js
// imports are tree-shaken out of the preload/renderer bundles (index.ts references
// backendStart only from the `backend` property, which the loader strips elsewhere).

import { BotGuardClient, getChallenge } from 'bgutils-js/botguard';
import { buildURL, getHeaders } from 'bgutils-js/utils';
import { WebPoMinter } from 'bgutils-js/webpo';
import { Innertube, UniversalCache } from 'youtubei.js';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { performance as perfHooks } from 'node:perf_hooks';

import { getNetFetchAsFetch } from '@/plugins/utils/main';

import type { WaveformProgressConfig } from './index';
import type { BackendContext } from '@/types/contexts';
import type {
  FetchFunction,
  IBotguardClientSideBgChallenge,
  IntegrityTokenData,
  WebPoSignalOutput,
} from 'bgutils-js/shared-types';
import type { BrowserWindow } from 'electron';

const MAX_AUDIO_BYTES = 40 * 1024 * 1024; // sanity cap (~40MB)

// End-to-end deadline for one full-fetch attempt, across both type attempts and every
// stream read. A trickle that delivers a few bytes just under the inactivity timer would
// otherwise hold a backend slot (and the renderer's `fullFetching` flag) indefinitely —
// long after the user changed tracks. On expiry the active stream is cancelled and the
// renderer gets a structured timeout so a later track can try full mode.
const TOTAL_FETCH_TIMEOUT_MS = 120_000;

// Upper bound for the decoded PCM of one track, separate from the download-byte cap: a
// long low-bitrate stream can fit under 40 MiB yet decode into gigabytes of float32 PCM
// (48 kHz stereo ≈ 23 MB per minute), which decodeAudioData must hold all at once. Such
// tracks stay on the progressive path. The default 30-minute length cap (≈ 690 MB worst
// case) still fits under this.
const MAX_PCM_BYTES = 768 * 1024 * 1024;

let yt: Innertube | null = null;
let creating: Promise<Innertube> | null = null;

const getCookie = async (win?: BrowserWindow): Promise<string | undefined> => {
  if (!win) return undefined;
  try {
    const cookies = await win.webContents.session.cookies.get({
      url: 'https://music.youtube.com',
    });
    return cookies.map((c) => `${c.name}=${c.value}`).join(';');
  } catch {
    return undefined;
  }
};

/**
 * Generate a PoToken and attach it to the session — WITHOUT it YouTube refuses to hand
 * over audio bytes (empty/403 stream), which is why a bare Innertube fetch was failing.
 * Mirrors the Downloader plugin's setup so this fetch is just as reliable. Best-effort:
 * on any failure we leave the session without a token (some tracks still download).
 */
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

/** Run BotGuard, exchange its snapshot for an integrity token, and mint a PoToken. */
const mintPoToken = async (
  fetchFunction: FetchFunction,
  identifier: string,
  { program, globalName }: IBotguardClientSideBgChallenge,
  interpreterJavascript: string,
  window: unknown,
  document: unknown,
): Promise<string> => {
  // The challenge interpreter is REMOTE code: evaluate it in a restricted VM context with
  // no Node globals (process, require, ...), no Electron/IPC, and no session cookies — just
  // the DOM it needs plus explicit fetch/timers. Only plain data (the snapshot output and
  // the minted token) crosses back into the main process. The bgutils driver calls below
  // are trusted library code, same as the Downloader plugin uses.
  const sandbox: Record<string, unknown> = {
    window,
    document,
    navigator: (window as { navigator?: unknown }).navigator,
    location: (window as { location?: unknown }).location,
    console,
    fetch: fetchFunction,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    performance: perfHooks,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    URL,
  };
  vm.createContext(sandbox);
  // NOTE: no `codeGeneration: { strings: false }` here on purpose — the legitimate
  // BotGuard interpreter itself evaluates generated code internally, so blocking string
  // compilation breaks minting entirely (verified: "Code generation from strings
  // disallowed"). The isolation stands on *not exposing* Node/Electron/cookie access,
  // not on blocking eval. A formal boundary would need a separate process (see the
  // follow-up note on the review thread); node:vm explicitly is not one.
  // Bound the interpreter's own CPU: a poisoned challenge must not spin the main process.
  // Use the SAME budget as the setup deadline (not a longer one) so the block can never
  // outlive the timer that would otherwise fall back to tokenless operation.
  vm.runInContext(interpreterJavascript, sandbox, {
    timeout: POTOKEN_TIMEOUT_MS,
  });
  const botguard = await BotGuardClient.create({
    program,
    globalName,
    globalObject: sandbox,
  });

  const webPoSignalOutput: WebPoSignalOutput = [];
  // Explicit snapshot timeout (bgutils defaults to 3 s): a VM callback that never fires
  // must reject instead of hanging setupPoToken — and with it the serial PoToken queue.
  const botguardResponse = await botguard.snapshot(
    { webPoSignalOutput },
    SNAPSHOT_TIMEOUT_MS,
  );

  const integrityTokenResponse = await fetchFunction(buildURL('GenerateIT'), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
  });
  const [
    integrityToken,
    estimatedTtlSecs,
    mintRefreshThreshold,
    websafeFallbackToken,
  ] = (await integrityTokenResponse.json()) as [
    IntegrityTokenData['integrityToken'],
    IntegrityTokenData['estimatedTtlSecs'],
    IntegrityTokenData['mintRefreshThreshold'],
    IntegrityTokenData['websafeFallbackToken'],
  ];

  const webPoMinter = await WebPoMinter.create(
    {
      integrityToken,
      estimatedTtlSecs,
      mintRefreshThreshold,
      websafeFallbackToken,
    },
    webPoSignalOutput,
  );
  return webPoMinter.mintAsWebsafeString(identifier);
};

// Upper bound for the whole PoToken setup (challenge fetch + token exchange + reading the
// response body). Without it a request that sends headers but then stalls would leave
// Innertube initialisation pending forever, so every later track's full-fetch would wait on it.
// On timeout the requests are aborted and we fall back to a session without a token.
const POTOKEN_TIMEOUT_MS = 20000;
// Bound for one BotGuard snapshot call: the VM callback must resolve or reject within this,
// so a callback that never fires can't hang setupPoToken (and with it the serial queue).
const SNAPSHOT_TIMEOUT_MS = 15000;

// Monotonic clock for all download deadlines: a wall-clock jump (NTP, daylight saving,
// user change) must not extend or shrink a fetch budget mid-flight.
const nowMs = (): number => perfHooks.now();

const setupPoToken = async (
  visitorData: string,
  fetchFunction: FetchFunction,
): Promise<string | undefined> => {
  // eslint-disable-next-line
  const happyDom = await import('happy-dom');
  const window = new happyDom.Window({ width: 1920, height: 1080, console });
  const document = window.document;
  try {
    const bgChallenge = await getChallenge({
      requestKey: REQUEST_KEY,
      fetchFunction,
    });
    const interpreterJavascript =
      bgChallenge.interpreterJavascript
        ?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!interpreterJavascript) return undefined;

    // The interpreter is evaluated inside mintPoToken's restricted VM (see above) — the
    // main-process globalThis is never touched, so there is nothing to clean up here and
    // overlapping attempts cannot disturb each other. sessionGen still guards the engine.
    const token = await mintPoToken(
      fetchFunction,
      visitorData,
      bgChallenge,
      interpreterJavascript,
      window,
      document,
    );
    console.info('[Waveform] backend: PoToken attached');
    return token;
  } finally {
    try {
      (window as unknown as { close?: () => void }).close?.();
    } catch {
      /* ignore */
    }
  }
};

// Token setups run one at a time: each installs window/document on the shared globalThis,
// so overlapping attempts could capture or restore each other's DOM — an older attempt's
// cleanup must not delete a newer attempt's globals, and a newer attempt must not restore
// the older one's abandoned globals as its "previous" values. The queue always resolves
// (rejections are swallowed into it), so one failed setup never blocks the next.
let poTokenQueue: Promise<void> = Promise.resolve();

const attachPoToken = async (engine: Innertube, gen: number): Promise<void> => {
  const visitorData = engine.session.context.client.visitorData;
  if (!visitorData) return;

  // Every request in the flow shares one AbortSignal, so the deadline cancels the network
  // activity (including a stalled body read), not just our wait for it.
  const controller = new AbortController();
  const netFetch = getNetFetchAsFetch();
  const fetchFunction = ((input: RequestInfo | URL, init?: RequestInit) =>
    netFetch(input, { ...init, signal: controller.signal })) as typeof fetch;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new Error(`PoToken setup timed out after ${POTOKEN_TIMEOUT_MS}ms`),
      );
    }, POTOKEN_TIMEOUT_MS);
  });

  try {
    // Serialized with any other in-flight setup (see poTokenQueue): this attempt's work
    // can't interleave with another attempt's. A stalled predecessor still settles on its
    // own deadline, bounding how long this attempt waits. If THIS attempt's own deadline
    // expired while queued, skip it without touching anything at all.
    const work = poTokenQueue.then(() => {
      if (controller.signal.aborted) {
        throw new Error('PoToken setup expired while queued');
      }
      // A stop/restart while queued must not start token setup for a dead activation —
      // its failure timestamp would otherwise postpone the new activation's retry.
      if (gen !== sessionGen) {
        throw new Error('PoToken setup superseded by a newer activation');
      }
      return setupPoToken(visitorData, fetchFunction);
    });
    // Advance the queue when this attempt settles OR when a bounded wait elapses, so a
    // hung predecessor can't wedge it forever. Overlap after the bound is safe: each setup
    // owns only its VM sandbox now (nothing shared on globalThis), and sessionGen still
    // guards the cached engine.
    const releaseAfterMs = POTOKEN_TIMEOUT_MS + 5000;
    poTokenQueue = Promise.race([
      work.then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, releaseAfterMs);
        if (typeof t === 'object' && t !== null && 'unref' in t) {
          (t as unknown as { unref: () => void }).unref();
        }
      }),
    ]);
    work.catch(() => undefined); // a late rejection after the deadline must not go unhandled
    // Attach the token ONLY if this setup wins its deadline race. A mint that finishes
    // late (after the race rejected) must not mutate the cached engine while requests
    // may already be using it — the late result is simply dropped.
    const token = await Promise.race([work, deadline]);
    // Only the current activation may publish results: a setup that finished after a
    // stop/restart must not attach a token to the discarded engine, nor overwrite the
    // new activation's retry backoff with its own (lack of) token.
    if (gen !== sessionGen) return;
    if (typeof token === 'string' && token.length > 0) {
      engine.session.po_token = token;
      // youtubei reads the session token for metadata, but the media download path
      // (Player.decipher, which appends ?pot=) reads the SEPARATE Player.po_token field.
      // The player was created at session init, before the mint — propagate the token
      // there too, or downloads would decipher without it while we report poToken=true.
      if (engine.session.player) engine.session.player.po_token = token;
    }
    // No token attached (timeout or tokenless setup): record when, tied to this
    // activation, so a later fetch can retry once the service may have recovered.
    if (!engine.session.po_token) poTokenFailed = { gen, at: nowMs() };
  } catch (err) {
    if (gen === sessionGen) poTokenFailed = { gen, at: nowMs() };
    console.info(
      '[Waveform] backend: PoToken generation failed (continuing without):',
      err,
    );
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Settle within `ms` no matter what `work` does. Used for requests we cannot abort (the
 * youtubei.js calls below don't take an AbortSignal, and the adapter forwards no signal):
 * a request that never answers would otherwise leave the IPC call — and the renderer's
 * `fullFetching` flag — pending forever, blocking full-fetch for every later track. If
 * `work` completes after the deadline, `discard` receives the late value so it can release
 * it (e.g. cancel a stream). Streams ARE cancelled on settle (see collectStream); only the
 * wait for unanswered headers/metadata is wait-side, bounded by this deadline plus the
 * two-slot concurrency bound.
 */
const withDeadline = async <T>(
  work: Promise<T>,
  ms: number,
  label: string,
  discard?: (late: T) => void,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  work
    .then((late) => {
      if (timedOut) discard?.(late);
    })
    .catch(() => undefined); // a late rejection after the deadline must not go unhandled
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const INNERTUBE_INIT_TIMEOUT_MS = 30000;
// Bound the cookie lookup separately: it runs BEFORE the init deadline and could otherwise
// hang the shared `creating` promise forever.
const COOKIE_TIMEOUT_MS = 5000;
const BASIC_INFO_TIMEOUT_MS = 20000;
const DOWNLOAD_OPEN_TIMEOUT_MS = 20000;

// Bumped when the plugin stops, so an initialisation still in flight can tell it is outdated.
let sessionGen = 0;

// When the last PoToken setup finished without a token, and which activation suffered it.
// A tokenless engine is still cached (playback works, and muxed fallbacks download fine),
// but token-gated tracks stay progressive — so after a backoff, the next full fetch
// re-initialises and retries the token instead of reusing the tokenless session forever.
// The generation ties the backoff to the activation that failed: a failure from a stopped
// activation must not postpone a fresh activation's retry. Concurrent callers share one
// `creating` attempt.
let poTokenFailed: { gen: number; at: number } | null = null;
const POTOKEN_RETRY_BACKOFF_MS = 5 * 60 * 1000;

const getYt = async (win?: BrowserWindow): Promise<Innertube> => {
  if (yt) {
    if (
      !yt.session.po_token &&
      poTokenFailed !== null &&
      poTokenFailed.gen === sessionGen &&
      nowMs() - poTokenFailed.at > POTOKEN_RETRY_BACKOFF_MS
    ) {
      // Token service may have recovered — drop the tokenless session so this fetch
      // re-initialises (and retries PoToken once); concurrent callers share the attempt.
      yt = null;
      creating = null;
    } else {
      return yt;
    }
  }
  if (!creating) {
    const gen = sessionGen;
    // Publish the shared promise before the first await (cookie lookup) so concurrent
    // first callers reuse this attempt instead of starting a second initialisation —
    // two attempts could otherwise run attachPoToken() against the same temp globals.
    const attempt: Promise<Innertube> = (async () => {
      // The cookie lookup is its own await BEFORE the init deadline starts, so bound it too:
      // if the cookie service hangs, `creating` would stay pending and every later fetch
      // would wait on it. A failed/timed-out lookup simply initialises without cookies.
      let cookie: string | undefined;
      try {
        cookie = await withDeadline(
          getCookie(win),
          COOKIE_TIMEOUT_MS,
          'getCookie',
        );
      } catch {
        cookie = undefined;
      }
      // The plugin may have been stopped while the cookie lookup was pending: don't start
      // the (networked) init for a dead activation.
      if (gen !== sessionGen) throw new Error('initialisation superseded');
      const created = await withDeadline(
        Innertube.create({
          cache: new UniversalCache(false),
          cookie,
          generate_session_locally: true,
          fetch: getNetFetchAsFetch(),
        }),
        INNERTUBE_INIT_TIMEOUT_MS,
        'Innertube init',
      );
      await attachPoToken(created, gen);
      // Publish only if the plugin wasn't stopped (and possibly restarted) while this attempt
      // was pending; otherwise a stale session would overwrite or pre-empt the new one.
      if (gen === sessionGen) yt = created;
      return created;
    })();
    // Drop the cached promise if this attempt rejects (only if it still owns `creating`),
    // so a later track can retry instead of inheriting the same rejection forever.
    attempt.catch(() => {
      if (creating === attempt) creating = null;
    });
    creating = attempt;
  }
  return creating;
};

/** Result of a fetch attempt. On failure carries a reason the renderer can log/surface. */
export type FetchAudioResult =
  | { data: ArrayBuffer }
  | { error: string; status?: string; poToken?: boolean };

// Give up if no bytes arrive for this long. Without it, a stalled read never settles, the
// renderer's `await` (and its `finally`) never runs, and `fullFetching` stays set — blocking
// full-fetch for every subsequent track. On a stall we bail (null → structured error) so the
// current track falls back to progressive and the next track can try full mode again.
const STREAM_STALL_MS = 20000;

// Reads the stream's reader directly rather than through youtubei.js's async iterator: that
// iterator awaits `reader.read()` inside a generator, so once a read is stuck, `return()` queues
// behind it and never completes — the stall would be detected but this function could not settle.
const collectStream = async (
  stream: ReadableStream<Uint8Array>,
  deadlineAt: number,
  epoch: number,
): Promise<ArrayBuffer | null> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let reachedEnd = false;
  try {
    for (;;) {
      // A trickle that delivers a few bytes just under the inactivity timer never trips
      // the stall check — bound this read by the remaining end-to-end budget instead of a
      // fresh full stall timer, so a read starting near the deadline can't overrun it.
      // Also stop if the plugin was disabled mid-fetch (epoch changed): the finally below
      // cancels the transfer, and the caller reports the attempt as aborted.
      const remainingMs = deadlineAt - nowMs();
      if (remainingMs <= 0 || epoch !== fetchEpoch) return null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stall = new Promise<'stall'>((resolve) => {
        timer = setTimeout(
          () => resolve('stall'),
          Math.min(STREAM_STALL_MS, remainingMs),
        );
      });
      let step: ReadableStreamReadResult<Uint8Array> | 'stall';
      try {
        step = await Promise.race([reader.read(), stall]);
      } finally {
        clearTimeout(timer);
      }
      // Expired mid-read (deadline or plugin stop): don't accept the data (or EOF) as
      // success — the bytes after that point belong to a settled attempt.
      if (nowMs() >= deadlineAt || epoch !== fetchEpoch) return null;
      if (step === 'stall') return null; // deadline hit with no new data
      if (step.done) {
        reachedEnd = true;
        break;
      }
      chunks.push(step.value);
      total += step.value.length;
      if (total > MAX_AUDIO_BYTES) return null; // over the sanity cap
    }
  } finally {
    if (reachedEnd) {
      reader.releaseLock();
    } else {
      // Stalled, over the cap, or errored: stop the transfer, but never wait for it. A hung
      // read may not honour cancel() promptly, and settling must not depend on it.
      reader.cancel().catch(() => undefined);
    }
  }
  if (total === 0) return null;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged.buffer;
};

/**
 * Download the current track's audio and return the raw bytes, or a structured error.
 * The error (playability status, whether a PoToken was attached, the download exception)
 * is returned so the renderer can log the real reason in DevTools — main-process
 * console.info isn't visible there, which is why "full waveform" failures looked silent.
 */
const fetchAudio = async (
  videoId: string,
  win: BrowserWindow | undefined,
  epoch: number,
): Promise<FetchAudioResult> => {
  if (!videoId) return { error: 'no-videoId' };
  if (epoch !== fetchEpoch) return { error: 'fetch-aborted' };
  const engine = await getYt(win);
  // Stopped (or re-enabled) while init was in flight: getYt handed back the previous
  // activation's engine — do not open a new cookie-backed request on it.
  if (epoch !== fetchEpoch) return { error: 'fetch-aborted' };
  const releaseInfo = reserveRaw();
  if (!releaseInfo) return { error: 'backend-busy' };
  const rawInfo = watchRaw(engine.getBasicInfo(videoId), releaseInfo);
  const info = await withDeadline(
    rawInfo,
    BASIC_INFO_TIMEOUT_MS,
    'getBasicInfo',
  );
  // Same check after metadata: a stop during getBasicInfo must not open downloads after it.
  if (epoch !== fetchEpoch) return { error: 'fetch-aborted' };
  const status = info.playability_status?.status;
  const poToken = !!engine.session.po_token;
  console.info(
    `[Waveform] backend: ${videoId} playability=${status} poToken=${poToken}`,
  );
  if (status && status !== 'OK')
    return { error: `playability:${status}`, status, poToken };

  // Decoded PCM can vastly exceed the download size (48 kHz stereo ≈ 23 MB/min), and
  // decodeAudioData holds it all at once. Check it PER RENDITION (the channels of the
  // format we are about to download) rather than rejecting the whole track because some
  // multichannel variant exists — that would skip a fitting stereo rendition needlessly.
  const trackLenSec = info.basic_info?.duration;
  const pcmLenSec =
    typeof trackLenSec === 'number' && isFinite(trackLenSec) && trackLenSec > 0
      ? trackLenSec
      : null;
  // Without a duration we can't bound the decoded PCM at all (a 45-min stereo track is
  // ~989 MiB), so treat it as NOT fitting — progressive carries it.
  const pcmFits = (channels: number): boolean =>
    pcmLenSec !== null && pcmLenSec * 48000 * channels * 4 <= MAX_PCM_BYTES;
  const channelsForItag = (itag: number): number => {
    const all = [
      ...(info.streaming_data?.formats ?? []),
      ...(info.streaming_data?.adaptive_formats ?? []),
    ];
    const f = all.find((x) => x.itag === itag);
    return f?.audio_channels ?? 2;
  };

  const deadlineAt = nowMs() + TOTAL_FETCH_TIMEOUT_MS;
  const timedOut = (): boolean => nowMs() >= deadlineAt;
  // Activation epoch of THIS attempt, captured synchronously at admission (see the
  // handler below): backendStop() bumps the global on disable, so any attempt that
  // survives it — even one still waiting in getYt/getBasicInfo above — stops opening
  // new downloads and drains without recording. Slots still release through the
  // handler's finally — never by resetting the counter, which would admit new work
  // while the old requests are still running.
  // Opening a download also waits for response headers — bound it by the remaining
  // end-to-end budget, not the full open timeout, once the deadline is near.
  const openTimeout = (): number =>
    Math.max(1, Math.min(DOWNLOAD_OPEN_TIMEOUT_MS, deadlineAt - nowMs()));

  /** One download attempt: open (bounded by the remaining budget), collect (stall +
   *  total deadlines, plugin-stop epoch), return bytes, 'timeout'/'aborted', or null. */
  const tryDownload = async (
    label: string,
    open: () => Promise<ReadableStream<Uint8Array>>,
  ): Promise<{ data: ArrayBuffer } | { timeout: true } | { aborted: true } | null> => {
    if (epoch !== fetchEpoch) return { aborted: true };
    if (timedOut()) return { timeout: true };
    // Reserve synchronously with the open: two concurrent attempts can't both slip past
    // the cap between check and start. Released on settle, error, or the bounded wait.
    const release = reserveRaw();
    if (!release) return { aborted: true };
    try {
      const raw = open();
      watchRaw(raw, release);
      const stream = await withDeadline(raw, openTimeout(), `download(${label})`, (late) => {
        late.cancel().catch(() => undefined);
      });
      const buf = await collectStream(stream, deadlineAt, epoch);
      if (buf) {
        console.info(
          `[Waveform] backend: got ${Math.round(buf.byteLength / 1024)}KB via ${label}`,
        );
        return { data: buf };
      }
    } catch (err) {
      console.info(`[Waveform] backend: download(${label}) failed:`, err);
    }
    if (epoch !== fetchEpoch) return { aborted: true };
    return timedOut() ? { timeout: true } : null;
  };

  // 1. Audio-only first (smallest fitting first): resolve fitting audio-only candidates
  // up front and try them in order — if the best one fails (e.g. HTTP 403), a smaller one
  // can still succeed. The old generic selection could hand back an unbounded or oversized
  // stream that burns the whole deadline before the cap rejects it.
  // 2. Ranked fitting muxed: covers tracks with no fitting audio-only format AND a failed
  // audio attempt — the generic fallback below would just re-pick the biggest muxed and
  // hit the cap again. 3. Generic video+audio only when no fitting format of either kind
  // is known (unknown lengths; the cap protects us).
  const audioItags = pickFittingAudioItags(info.streaming_data);
  const fittingItags = pickFittingMuxedItags(info.streaming_data);
  type AttemptResult =
    | { data: ArrayBuffer }
    | { timeout: true }
    | { aborted: true }
    | null;
  const settle = (res: AttemptResult): FetchAudioResult | null => {
    if (!res) return null;
    if ('data' in res) return { data: res.data };
    if ('timeout' in res) return { error: 'fetch-timeout', status, poToken };
    return { error: 'fetch-aborted', status, poToken };
  };
  let r: AttemptResult = null;
  for (const itag of audioItags.filter((it) => pcmFits(channelsForItag(it))).slice(0, 3)) {
    r = await tryDownload(`audio itag ${itag}`, () =>
      info.download({ itag, type: 'audio' }),
    );
    const done = settle(r);
    if (done) return done;
  }
  // Unknown-length audio-only candidates: no size to rank or cap-check up front, so try
  // a bounded few directly. An explicit itag reads the whole response (the generic
  // ranged type:'audio' path treats a missing length as the end of the first range),
  // while the byte cap + total deadline still guard every attempt.
  for (const itag of pickUnknownAudioItags(info.streaming_data).filter((it) => pcmFits(channelsForItag(it))).slice(0, 3)) {
    r = await tryDownload(`audio itag ${itag} (unknown length)`, () =>
      info.download({ itag }),
    );
    const done = settle(r);
    if (done) return done;
  }
  let triedMuxed = false;
  if (fittingItags.length > 0) {
    triedMuxed = true;
    for (const itag of fittingItags.filter((it) => pcmFits(channelsForItag(it))).slice(0, 3)) {
      r = await tryDownload(`itag ${itag}`, () => info.download({ itag }));
      const done = settle(r);
      if (done) return done;
    }
  }
  // Muxed renditions with NO reported length: an explicit itag reads the whole response, and
  // the byte cap + deadline still bound each attempt — so a small unknown-size muxed file can
  // succeed even when the only KNOWN-length ones are oversized.
  for (const itag of pickUnknownMuxedItags(info.streaming_data).filter((it) => pcmFits(channelsForItag(it))).slice(0, 3)) {
    triedMuxed = true;
    r = await tryDownload(`itag ${itag} (unknown length)`, () =>
      info.download({ itag }),
    );
    const done = settle(r);
    if (done) return done;
  }
  if (triedMuxed) return { error: 'download-failed', status, poToken };
  // No muxed attempt was possible — but if muxed renditions exist with a KNOWN length that is
  // already over the cap, the generic selection would download the whole oversized file
  // before rejecting it. Skip that attempt instead of burning the deadline on a known loss.
  if (hasKnownOversizedMuxed(info.streaming_data)) {
    console.info(
      '[Waveform] backend: only oversized muxed renditions available; using progressive',
    );
    return { error: 'download-failed', status, poToken };
  }
  // Generic video+audio has no explicit itag, so its channels are unknown up front: guard
  // with the widest audio channel count we could get.
  if (!pcmFits(pcmChannelsBound(info.streaming_data))) {
    console.info(
      '[Waveform] backend: generic video+audio could exceed the PCM budget; using progressive',
    );
    return { error: 'too-large', status, poToken };
  }
  r = await tryDownload(
    'video+audio',
    () => info.download({ type: 'video+audio', quality: 'best', format: 'any' }),
  );
  {
    const done = settle(r);
    if (done) return done;
  }
  return { error: 'download-failed', status, poToken };
};

const FETCH_AUDIO_CHANNEL = 'waveform:fetch-audio';

// YouTube video IDs are 11 URL-safe base64 characters. The renderer is not a trusted caller of
// this privileged (cookie-backed) request, so reject anything else before touching the session.
const VIDEO_ID_PATTERN = /^[\w-]{11}$/;

// Bound concurrent fetches: each holds up to MAX_AUDIO_BYTES in memory while downloading, and
// the renderer only ever needs one at a time (rapid track changes could otherwise stack several
// in the main process). Excess requests fail fast so the renderer falls back to progressive.
let activeFetches = 0;
const MAX_CONCURRENT_FETCHES = 2;

// Raw requests that outlived their IPC wait (unanswered headers/metadata can't be aborted —
// youtubei takes no AbortSignal). Counted separately from the IPC slots so a stall storm
// can't pile up unbounded sockets: admissions stop while too many are unaccounted for.
// Each entry clears when its request settles OR after a bounded wait, so a hung socket
// can't wedge admissions forever (Chromium also times out dead sockets on its own).
let unsettledRaw = 0;
const MAX_UNSETTLED_RAW = 4;
const UNSETTLED_RELEASE_MS = 5 * 60 * 1000;
// Reserve one unit synchronously; returns its release (idempotent). The check-then-act
// pair MUST stay synchronous: two IPC handlers can otherwise both pass the gate before
// either reaches its first download. Call sites reserve immediately before opening each
// raw request, never after an await.
const reserveRaw = (): (() => void) | null => {
  if (unsettledRaw >= MAX_UNSETTLED_RAW) return null;
  unsettledRaw++;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    if (done) return;
    done = true;
    // Clear the fallback timer on settlement: otherwise every completed request leaves a
    // 5-minute timer queued, and they accumulate with request volume.
    clearTimeout(timer);
    unsettledRaw = Math.max(0, unsettledRaw - 1);
  };
  timer = setTimeout(release, UNSETTLED_RELEASE_MS);
  // Never keep the process alive just for an accounting timer.
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    (timer as unknown as { unref: () => void }).unref();
  }
  return release;
};
// Attach settlement-based release to an already-reserved raw request. The reservation is
// NOT re-checked here — reserveRaw did that synchronously at the open site.
const watchRaw = <T>(p: Promise<T>, release: () => void): Promise<T> => {
  p.then(release, release);
  return p;
};
// Bumped on backendStop: attempts from a stopped activation observe the change and stop
// opening new downloads / settle without recording, so re-enabling starts clean. Slots
// still release through each handler's own finally — never by resetting the counter,
// which would admit new work while the old requests are still running.
let fetchEpoch = 0;

/** Minimal shape of a youtubei format for pre-selecting a fitting muxed download. */
interface StreamFormat {
  itag: number;
  has_audio: boolean;
  has_video: boolean;
  bitrate: number;
  content_length?: number;
  audio_channels?: number;
}

const isStereoish = (f: StreamFormat): boolean => (f.audio_channels ?? 2) <= 2;

/** Sort with stereo-ish as the PRIMARY key and bitrate as the secondary one, so a later
 *  bitrate sort can never put a multichannel rendition ahead of a fitting stereo one. */
const sortByChannelThenBitrate = <T extends StreamFormat>(
  list: T[],
  dir: 'asc' | 'desc',
): T[] => {
  const sign = dir === 'asc' ? 1 : -1;
  return list.sort((a, b) => {
    const ca = isStereoish(a) ? 0 : 1;
    const cb = isStereoish(b) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return sign * ((a.bitrate ?? 0) - (b.bitrate ?? 0));
  });
};

/** First entry per itag, in youtubei's selection order (explicit itag = first match). */
const firstByItagMap = (streamingData?: {
  formats?: StreamFormat[];
  adaptive_formats?: StreamFormat[];
}): Map<number, StreamFormat> => {
  const map = new Map<number, StreamFormat>();
  for (const f of [
    ...(streamingData?.formats ?? []),
    ...(streamingData?.adaptive_formats ?? []),
  ]) {
    if (!map.has(f.itag)) map.set(f.itag, f);
  }
  return map;
};

/** Channel count the PCM budget must assume. Selectors prefer stereo-ish renditions, but the
 *  fallbacks can still land on a multichannel one, and the budget is checked ONCE before any
 *  attempt — so it has to cover the widest audio-bearing rendition we could end up
 *  downloading. decodeAudioData allocates every channel of the chosen format. */
const pcmChannelsBound = (streamingData?: {
  formats?: StreamFormat[];
  adaptive_formats?: StreamFormat[];
}): number => {
  const all = [
    ...(streamingData?.formats ?? []),
    ...(streamingData?.adaptive_formats ?? []),
  ].filter((f) => f.has_audio);
  let max = 2;
  for (const f of all) {
    const c = f.audio_channels ?? 2;
    if (c > max) max = c;
  }
  return Math.min(max, 8);
};

/**
 * Fitting audio-only itags, best quality first (up to a few). youtubei's generic audio
 * selection picks the biggest audio-only candidate, which can be an oversized file that
 * burns the whole deadline before the stream cap rejects it — while a smaller fitting
 * audio-only format would have succeeded without any muxed fallback.
 */
const pickFittingAudioItags = (streamingData?: {
  formats?: StreamFormat[];
  adaptive_formats?: StreamFormat[];
}): number[] => {
  const all = [
    ...(streamingData?.formats ?? []),
    ...(streamingData?.adaptive_formats ?? []),
  ];
  const fitting = all.filter(
    (f) =>
      f.has_audio &&
      !f.has_video &&
      isFinite(f.content_length ?? NaN) &&
      (f.content_length as number) > 0 &&
      (f.content_length as number) <= MAX_AUDIO_BYTES,
  );
  if (!fitting.length) return [];
  // Rank stereo-ish renditions first (a multichannel one usually has a higher bitrate and
  // would otherwise win, quadrupling the PCM allocation for no benefit), but KEEP fitting
  // multichannel renditions as later fallbacks — a failing stereo file must not strand full
  // mode when a multichannel one still fits both caps.
  const pool = fitting;
  // An itag only identifies a rendition if youtubei resolves it to the same entry:
  // explicit itag selection returns the FIRST match, so verify each winning itag
  // against the first entry with that itag in selection order — a later same-itag
  // rendition with a fitting size must not stand in for an oversized first match.
  const inOrder = [...(streamingData?.formats ?? []), ...(streamingData?.adaptive_formats ?? [])];
  sortByChannelThenBitrate(pool, 'desc'); // quality within the stereo-first order
  const out: number[] = [];
  for (const f of pool) {
    const first = inOrder.find((g) => g.itag === f.itag);
    if (
      first &&
      first.has_audio &&
      !first.has_video &&
      isFinite(first.content_length ?? NaN) &&
      (first.content_length as number) > 0 &&
      (first.content_length as number) <= MAX_AUDIO_BYTES
    ) {
      if (!out.includes(f.itag)) out.push(f.itag);
      if (out.length >= 3) break;
    }
  }
  return out;
};

/**
 * Audio-only itags with UNKNOWN length (up to a few, best bitrate first). youtubei's
 * ranged `type: 'audio'` path treats a missing length as the end of the first range, so
 * these are downloaded with an explicit itag instead, which reads the whole response.
 * The byte cap + total deadline still guard every attempt, so an unbounded stream can't
 * run away — it just gets cut off like an oversized known one.
 */
const pickUnknownAudioItags = (streamingData?: {
  formats?: StreamFormat[];
  adaptive_formats?: StreamFormat[];
}): number[] => {
  const all = [
    ...(streamingData?.formats ?? []),
    ...(streamingData?.adaptive_formats ?? []),
  ];
  const firsts = firstByItagMap(streamingData);
  const unknown = all.filter((f) => {
    if (!(f.has_audio && !f.has_video)) return false;
    // Classify by the entry youtubei will ACTUALLY open (the first with this itag): a
    // known-oversized first match must not be tried under the guise of "unknown length".
    const first = firsts.get(f.itag);
    return (
      !!first &&
      (first.content_length === undefined ||
        !isFinite(Number(first.content_length)))
    );
  });
  if (!unknown.length) return [];
  const poolU = unknown;
  sortByChannelThenBitrate(poolU, 'desc');
  const out: number[] = [];
  for (const f of poolU) {
    if (!out.includes(f.itag)) out.push(f.itag);
    if (out.length >= 2) break;
  }
  return out;
};

/**
 * Muxed (audio+video) itags with UNKNOWN length, bounded to a couple. Used only after the
 * known-length muxed candidates have been tried, so a small unknown-size muxed rendition can
 * still be attempted when every known one is oversized. Explicit itag = whole response; the
 * byte cap + deadline still bound it.
 */
const pickUnknownMuxedItags = (streamingData?: {
  formats?: StreamFormat[];
  adaptive_formats?: StreamFormat[];
}): number[] => {
  const all = [
    ...(streamingData?.formats ?? []),
    ...(streamingData?.adaptive_formats ?? []),
  ];
  const firsts = firstByItagMap(streamingData);
  const unknown = all.filter((f) => {
    if (!(f.has_audio && f.has_video)) return false;
    const first = firsts.get(f.itag);
    return (
      !!first &&
      (first.content_length === undefined ||
        !isFinite(Number(first.content_length)))
    );
  });
  if (!unknown.length) return [];
  const pool = unknown;
  sortByChannelThenBitrate(pool, 'desc');
  const out: number[] = [];
  for (const f of pool) {
    if (!out.includes(f.itag)) out.push(f.itag);
    if (out.length >= 2) break;
  }
  return out;
};

/** True when every known-length muxed rendition is over the byte cap (so the generic
 *  selection could only pick an oversized one). Unknown lengths are not counted — the stream
 *  cap still protects those attempts. */
const hasKnownOversizedMuxed = (streamingData?: {
  formats?: StreamFormat[];
  adaptive_formats?: StreamFormat[];
}): boolean => {
  const muxed = [
    ...(streamingData?.formats ?? []),
    ...(streamingData?.adaptive_formats ?? []),
  ].filter(
    (f) =>
      f.has_audio &&
      f.has_video &&
      isFinite(f.content_length ?? NaN) &&
      (f.content_length as number) > 0,
  );
  return muxed.length > 0 && muxed.every((f) => (f.content_length as number) > MAX_AUDIO_BYTES);
};

/**
 * Ranked muxed formats that fit the byte cap, lowest bitrate first. Built for every
 * track: after the audio-only attempt fails (e.g. HTTP 403), these are tried before any
 * generic highest-width selection (youtubei's `type` selection keeps muxed candidates when
 * no audio-only format qualifies, picks the biggest one, and our stream cap then rejects
 * it). Empty when no length is known (the stream cap still protects us).
 */
const pickFittingMuxedItags = (streamingData?: {
  formats?: StreamFormat[];
  adaptive_formats?: StreamFormat[];
}): number[] => {
  const all = [
    ...(streamingData?.formats ?? []),
    ...(streamingData?.adaptive_formats ?? []),
  ];
  const fitting = all.filter(
    (f) =>
      f.has_audio &&
      f.has_video &&
      isFinite(f.content_length ?? NaN) &&
      (f.content_length as number) > 0 &&
      (f.content_length as number) <= MAX_AUDIO_BYTES,
  );
  // An explicit itag selects the FIRST matching entry, so verify each candidate against
  // that first entry (a later same-itag entry with a fitting size must not stand in for an
  // oversized first match) and emit DISTINCT itags only — otherwise the retry slots would
  // repeat one failing selector and never reach a different fitting rendition.
  const firstByItag = new Map<number, StreamFormat>();
  for (const f of all) if (!firstByItag.has(f.itag)) firstByItag.set(f.itag, f);
  const candidates = fitting.filter((f) => {
    const first = firstByItag.get(f.itag);
    return (
      !!first &&
      first.has_audio &&
      first.has_video &&
      isFinite(first.content_length ?? NaN) &&
      (first.content_length as number) > 0 &&
      (first.content_length as number) <= MAX_AUDIO_BYTES
    );
  });
  // Stereo-ish muxed renditions first (same PCM-budget reason as audio-only), keeping
  // fitting multichannel ones as later fallbacks.
  const pool = candidates;
  sortByChannelThenBitrate(pool, 'asc');
  const out: number[] = [];
  for (const f of pool) {
    if (!out.includes(f.itag)) out.push(f.itag);
    if (out.length >= 3) break;
  }
  return out;
};

// Registered only when the plugin is enabled. The renderer calls this exclusively for
// the opt-in "full waveform" mode; the default (progressive) path never invokes it, so
// nothing is downloaded unless the user turns the option on.
export const backendStart = (ctx: BackendContext<WaveformProgressConfig>) => {
  console.info(`[Waveform] backend ready (${FETCH_AUDIO_CHANNEL} registered)`);

  ctx.ipc.handle(
    FETCH_AUDIO_CHANNEL,
    async (videoId: unknown): Promise<FetchAudioResult> => {
      if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId)) {
        return { error: 'invalid-videoId' };
      }
      if (activeFetches >= MAX_CONCURRENT_FETCHES || unsettledRaw >= MAX_UNSETTLED_RAW) {
        return { error: 'backend-busy' };
      }
      // Capture the activation epoch synchronously at admission: a stop() that lands
      // while getYt/getBasicInfo are still pending must cancel this attempt even though
      // those waits started before it.
      const epoch = fetchEpoch;
      activeFetches++;
      try {
        return await fetchAudio(videoId, ctx.window, epoch);
      } catch (err) {
        console.info('[Waveform] audio fetch failed:', err);
        return { error: String(err) };
      } finally {
        activeFetches--;
      }
    },
  );
};

// The loader forgets a plugin on stop but does not remove its IPC handlers, so without this a
// disable → enable cycle would hit Electron's "second handler" error and keep a handler bound
// to the previous window. Also drop the cached session so a re-enable starts clean.
export const backendStop = (ctx: BackendContext<WaveformProgressConfig>) => {
  ctx.ipc.removeHandler(FETCH_AUDIO_CHANNEL);
  sessionGen++; // an init still in flight must not publish its session after this point
  fetchEpoch++; // in-flight fetches stop opening new downloads instead of recording
  poTokenFailed = null;
  // Drop the queued serialiser: a new activation must not wait behind the old one's
  // still-running setup. The old work keeps its own deadline and settles harmlessly
  // (nothing is published or recorded for a superseded generation any more).
  poTokenQueue = Promise.resolve();
  yt = null;
  creating = null;
};
