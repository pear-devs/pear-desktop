import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Mutex } from 'async-mutex';
import { BG, type BgConfig } from 'bgutils-js';
import { app, type BrowserWindow, dialog, ipcMain } from 'electron';
import is from 'electron-is';
import filenamify from 'filenamify';
import lazyVar from 'lazy-var';
import NodeID3 from 'node-id3';
import {
  Innertube,
  Log,
  UniversalCache,
  Utils,
  YTNodes,
  Platform,
  type YT,
  type YTMusic,
  type Types,
} from '\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js';

import { t } from '@/i18n';
import { getNetFetchAsFetch } from '@/plugins/utils/main';
import {
  registerCallback,
  cleanupName,
  getImage,
  MediaType,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';

import {
  attachWindow,
  clearFinishedTasks,
  createTask,
  dismissTask,
  DownloadCancelledError,
  finishTask,
  getTask,
  isCancelRequested,
  releaseCancel,
  requestCancel,
  resendState,
  throwIfCancelled,
  updateTask,
} from './progress';
import { enqueue, isQueued } from './queue';
import {
  cropMaxWidth,
  getFolder,
  sendFeedback as sendFeedback_,
} from './utils';

import {
  DefaultPresetList,
  DownloaderIPC,
  type PlaybackProgress,
  type Preset,
  VideoFormatList,
} from '../types';

import type { DownloaderPluginConfig } from '../index';
import type { BackendContext } from '@/types/contexts';
import type { GetPlayerResponse } from '@/types/get-player-response';

type CustomSongInfo = SongInfo & { trackId?: string };

/**
 * A failure that repeating cannot fix, such as an unplayable video. Everything
 * else is treated as temporary - deciding that by error message would depend
 * on the language the app happens to run in.
 */
class PermanentDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentDownloadError';
  }
}

/** A single song download, either triggered manually or automatically */
interface SongRequest {
  /** Resolved video id; preferred over `url` */
  id?: string;
  /** Watch URL, used when no id is known yet */
  url?: string;
  /** Target folder; falls back to the configured download folder */
  folder?: string;
  trackId?: string;
  playlistTitle?: string;
  playlistIndex?: number;
  playlistSize?: number;
  automatic?: boolean;
}

/** Share of the task progress that is spent on downloading vs. converting */
const DOWNLOAD_PROGRESS_SHARE = 0.45;
const CONVERT_PROGRESS_SHARE = 0.5;
/** How often the premium check is re-evaluated */
const PREMIUM_CACHE_TTL = 60_000;
/** Attempts per download before it is reported as failed */
const MAX_ATTEMPTS = 3;
/** Grace period before a failed download is attempted again */
const RETRY_DELAY = 4000;
/** Waiting times before a request is sent over both routes again */
const REQUEST_RETRY_DELAYS = [500, 2000, 6000];
/** Breather between two songs of a playlist */
const PLAYLIST_ITEM_PAUSE = 750;
/** Upper bound for the "already downloaded automatically" memory */
const AUTO_DOWNLOAD_MEMORY = 500;

/** Resolves after the given delay */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ffmpeg = lazyVar.lazy(async () =>
  (await import('@ffmpeg.wasm/main')).createFFmpeg({
    log: false,
    logger() {}, // Console.log,
    progress() {}, // Console.log,
  }),
);
const ffmpegMutex = new Mutex();

Platform.shim.eval = (
  data: Types.BuildScriptResult,
  env: Record<string, Types.VMPrimative>,
) => {
  const properties = [];

  if (env.n) {
    properties.push(`n: exportedVars.nFunction("${env.n}")`);
  }

  if (env.sig) {
    properties.push(`sig: exportedVars.sigFunction("${env.sig}")`);
  }

  const code = `${data.output}\nreturn { ${properties.join(', ')} }`;

  // oxlint-disable-next-line typescript/no-unsafe-return,typescript/no-implied-eval,typescript/no-unsafe-call
  return new Function(code)();
};

let yt: Innertube;
let win: BrowserWindow;
let playingUrl: string;
let config: DownloaderPluginConfig;

let premiumCache: { value: boolean; checkedAt: number } | undefined;

/** Whether the signed-in account has Premium, cached for a short while */
const isPremium = async () => {
  if (premiumCache && Date.now() - premiumCache.checkedAt < PREMIUM_CACHE_TTL) {
    return premiumCache.value;
  }

  const value = await resolveIsPremium();
  premiumCache = { value, checkedAt: Date.now() };
  return value;
};

/** Reads the sign-in state and the upgrade entry out of the page */
const resolveIsPremium = async () => {
  // If signed out, it is understood as non-premium
  const isSignedIn = (await win.webContents.executeJavaScript(
    '!!yt.config_.LOGGED_IN',
  )) as boolean;

  if (!isSignedIn) return false;

  // If signed in, check if the upgrade button is present
  const upgradeBtnIconPathData = (await win.webContents.executeJavaScript(
    'document.querySelector(\'iron-iconset-svg[name="yt-sys-icons"] #\u0079\u006f\u0075\u0074\u0075\u0062\u0065_music_monochrome\')?.firstChild?.getAttribute("d")?.substring(0, 15)',
  )) as string | null;

  // Fallback to non-premium if the icon is not found
  if (!upgradeBtnIconPathData) return false;

  const upgradeButton = `ytmusic-guide-entry-renderer:has(> tp-yt-paper-item > yt-icon path[d^="${upgradeBtnIconPathData}"])`;

  return (await win.webContents.executeJavaScript(
    `!document.querySelector('${upgradeButton}')`,
  )) as boolean;
};

/** Full error text for the dialog and the log, including the cause */
const describeError = (error: unknown, source?: string) => {
  const causeOf = (err: Error) =>
    err.cause
      ? `\n\n${
          // oxlint-disable-next-line typescript/no-base-to-string,typescript/restrict-template-expressions
          err.cause instanceof Error ? err.cause.toString() : err.cause
        }`
      : '';

  const message =
    error instanceof Error
      ? `${error.toString()}${causeOf(error)}`
      : String(error);

  return source ? `${message}\nin ${source}` : message;
};

/** One-line error text, as it is shown in the progress panel */
const shortErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * A request body can only be sent once, so requests that carry a stream or a
 * blob are handed through without retrying.
 */
const canRepeatRequest = (input: RequestInfo | URL, init?: RequestInit) => {
  if (input instanceof Request && input.body) return false;

  const body = init?.body;
  return (
    body === undefined ||
    body === null ||
    typeof body === 'string' ||
    body instanceof URLSearchParams ||
    ArrayBuffer.isView(body) ||
    body instanceof ArrayBuffer
  );
};

/** Host and path of a request, to keep the log lines readable */
const describeRequest = (input: RequestInfo | URL) => {
  const raw =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  const url = URL.parse(raw);
  return url ? `${url.host}${url.pathname}` : raw;
};

/**
 * Node's own fetch. Electron's `net.fetch` runs through Chromium, which
 * rejects requests that are perfectly fine for a plain HTTP client - the
 * `net::ERR_FAILED` bursts this plugin used to die on. Innertube sends its
 * cookies as headers, so a request does not lose anything on this route.
 */
const nodeFetch: typeof fetch = (input, init) => {
  if (init?.body && !init.method) {
    init = { ...init, method: 'POST' };
  }

  return globalThis.fetch(input, init);
};

type TransportName = 'electron' | 'node';

/**
 * Sends a request over both transports before giving up, waiting a little
 * longer after every full round.
 *
 * Only rejected requests are repeated; a response with an error status is
 * passed through untouched, as is a request whose body can be sent only once.
 */
const createRetryingFetch = (): typeof fetch => {
  const transports: Record<TransportName, typeof fetch> = {
    electron: getNetFetchAsFetch(),
    node: nodeFetch,
  };

  // Once one route proves to be the working one, it goes first
  let preferred: TransportName = 'electron';
  let rescues = 0;

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    // A body that can only be read once stays on the original route
    const repeatable = canRepeatRequest(input, init);
    const order: TransportName[] = !repeatable
      ? ['electron']
      : preferred === 'electron'
        ? ['electron', 'node']
        : ['node', 'electron'];
    let lastError: unknown;

    for (let round = 0; round <= REQUEST_RETRY_DELAYS.length; round++) {
      for (const transport of order) {
        try {
          const response = await transports[transport](input, init);

          if (transport !== preferred) {
            rescues++;
            if (rescues >= 3) {
              console.log(
                `[downloader] switching to the ${transport} network stack for this session`,
              );
              preferred = transport;
              rescues = 0;
            }
          }

          return response;
        } catch (error: unknown) {
          lastError = error;

          if (
            (error as Error | undefined)?.name === 'AbortError' ||
            !repeatable
          ) {
            throw error;
          }
        }
      }

      const delay = REQUEST_RETRY_DELAYS[round];
      if (delay === undefined) break;

      console.warn(
        `[downloader] ${describeRequest(input)} failed on both routes (${shortErrorMessage(
          lastError,
        )}), retrying in ${delay}ms`,
      );
      await sleep(delay);
    }

    throw lastError;
  }) as typeof fetch;
};

/** Logs the message and puts it in front of the user */
const showErrorDialog = (message: string) => {
  console.error(message);
  dialog.showMessageBox(win, {
    type: 'info',
    buttons: [t('plugins.downloader.backend.dialog.error.buttons.ok')],
    title: t('plugins.downloader.backend.dialog.error.title'),
    message: t('plugins.downloader.backend.dialog.error.message'),
    detail: message,
  });
};

/** Reports an error that happened outside of a concrete download task */
const sendError = (error: Error, source?: string) => {
  sendFeedback_(win); // Reset feedback
  showErrorDialog(describeError(error, source));
};

/** Session cookies of the window, Innertube needs them to act as signed in */
export const getCookieFromWindow = async (win: BrowserWindow) => {
  return (
    await win.webContents.session.cookies.get({
      url: 'https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com',
    })
  )
    .map((it) => it.name + '=' + it.value)
    .join(';');
};

/** Registers the IPC handlers of the plugin and starts the Innertube session */
export const onMainLoad = async ({
  window: _win,
  getConfig,
  ipc,
}: BackendContext<DownloaderPluginConfig>) => {
  win = _win;
  config = await getConfig();
  attachWindow(win);

  // Registered before the (slow) session setup, otherwise early events from the
  // renderer - like the first playback updates - would be lost
  ipc.handle('download-song', (url: string) => downloadSong(url));
  ipc.on('peard:video-src-changed', (data: GetPlayerResponse) => {
    playingUrl = data.microformat.microformatDataRenderer.urlCanonical;
  });
  ipc.handle('download-playlist-request', async (url: string) =>
    downloadPlaylist(url),
  );

  // Progress panel interactions
  ipc.on(DownloaderIPC.cancel, (id: string) => requestCancel(id));
  ipc.on(DownloaderIPC.dismiss, (id: string) => {
    retryRequests.delete(id);
    dismissTask(id);
  });
  ipc.on(DownloaderIPC.clearFinished, () => clearFinishedTasks());
  ipc.on(DownloaderIPC.retry, (id: string) => retryTask(id));
  ipc.on(DownloaderIPC.rendererReady, () => {
    // The renderer may have reloaded: make sure it knows about running jobs
    resendState();
    // Ask the song-info provider to report playback time (fallback trigger)
    ipc.send('peard:setup-time-changed-listener');
  });

  setupAutomaticDownloads({ ipc });

  sessionReady = setupSession();
  await sessionReady;
};

/** Resolves once the Innertube session is usable */
let sessionReady: Promise<void> | undefined;

/** Creates the Innertube session and, when possible, a PoToken for it */
const setupSession = async () => {
  // Parser mismatches are reported for pages this plugin does not even look
  // at; they are noise between the actual download messages
  Log.setLevel(Log.Level.ERROR);

  yt = await Innertube.create({
    cache: new UniversalCache(false),
    cookie: await getCookieFromWindow(win),
    generate_session_locally: true,
    fetch: createRetryingFetch(),
  });

  const requestKey = 'O43z0dpjhgX20SCx4KAo';
  const visitorData = yt.session.context.client.visitorData;

  if (visitorData) {
    const cleanUp = (context: Partial<typeof globalThis>) => {
      delete context.window;
      delete context.document;
    };

    try {
      const [width, height] = win.getSize();
      // emulate jsdom using linkedom
      const window = new (await import('happy-dom')).Window({
        width,
        height,
        console,
      });
      const document = window.document;

      Object.assign(globalThis, {
        window,
        document,
      });

      const bgConfig: BgConfig = {
        fetch: createRetryingFetch(),
        globalObj: globalThis,
        identifier: visitorData,
        requestKey,
      };

      const bgChallenge = await BG.Challenge.create(bgConfig);
      const interpreterJavascript =
        bgChallenge?.interpreterJavascript
          .privateDoNotAccessOrElseSafeScriptWrappedValue;

      if (interpreterJavascript) {
        // This is a workaround to run the interpreterJavascript code
        // Maybe there is a better way to do this (e.g. https://github.com/Siubaak/sval ?)
        // oxlint-disable-next-line typescript/no-implied-eval,typescript/no-unsafe-call
        new Function(interpreterJavascript)();

        const poTokenResult = await BG.PoToken.generate({
          program: bgChallenge.program,
          globalName: bgChallenge.globalName,
          bgConfig,
        }).finally(() => {
          cleanUp(globalThis);
        });

        yt.session.po_token = poTokenResult.poToken;
      } else {
        cleanUp(globalThis);
      }
    } catch {
      cleanUp(globalThis);
    }
  }
};

/** Waits for the session, so downloads can be queued while it is still loading */
const waitForSession = async () => {
  if (!sessionReady) {
    sessionReady = setupSession();
  }

  await sessionReady;
};

/** Keeps the local copy of the plugin config up to date */
export const onConfigChange = (newConfig: DownloaderPluginConfig) => {
  config = newConfig;
};

/** Configured download folder, or the one of the system */
const defaultDownloadFolder = () =>
  config.downloadFolder || app.getPath('downloads');

/** Key a request is deduplicated by inside the queue */
const requestKeyOf = (request: SongRequest) =>
  `song:${request.id ?? request.url ?? ''}:${request.folder ?? ''}`;

/** Placeholder for the panel, until the real title is resolved */
const taskLabelOf = (request: SongRequest) =>
  request.id ?? request.url ?? t('plugins.downloader.templates.button');

/** Queues a single song download and returns the created task id */
const queueSongDownload = (request: SongRequest): string | null => {
  const key = requestKeyOf(request);
  if (isQueued(key)) {
    return null;
  }

  const taskId = createTask({
    title: taskLabelOf(request),
    automatic: request.automatic ?? false,
    playlistTitle: request.playlistTitle,
    playlistIndex: request.playlistIndex,
    playlistSize: request.playlistSize,
    retryable: true,
  });

  enqueue(key, async () => {
    await runSongDownload(request, taskId);
  });
  return taskId;
};

/** Keeps failed downloads around so the panel can offer a retry */
const retryRequests = new Map<string, SongRequest>();
const MAX_RETRY_REQUESTS = 200;

/** Stores the request behind a task, dropping the oldest ones when it gets full */
const rememberRetryRequest = (taskId: string, request: SongRequest) => {
  if (retryRequests.size >= MAX_RETRY_REQUESTS) {
    retryRequests.delete(retryRequests.keys().next().value!);
  }

  retryRequests.set(taskId, request);
};

/** Queues a failed task again and takes the old entry out of the panel */
const retryTask = (taskId: string) => {
  const request = retryRequests.get(taskId);
  const task = getTask(taskId);
  if (!request || !task) return;

  dismissTask(taskId);
  retryRequests.delete(taskId);
  queueSongDownload(request);
};

/** Cancellations and permanently unplayable videos are not worth another attempt */
const isRetryableError = (error: unknown) =>
  !(error instanceof DownloadCancelledError) &&
  !(error instanceof PermanentDownloadError);

type DownloadOutcome = 'done' | 'cancelled' | 'error';

/** Runs a download job, handles retries and reports the result to the panel */
const runSongDownload = async (
  request: SongRequest,
  taskId: string,
): Promise<DownloadOutcome> => {
  try {
    rememberRetryRequest(taskId, request);

    if (isCancelRequested(taskId)) {
      finishTask(taskId, 'cancelled');
      return 'cancelled';
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await downloadSongUnsafe(request, taskId);
        retryRequests.delete(taskId);
        return 'done';
      } catch (error: unknown) {
        if (error instanceof DownloadCancelledError) {
          finishTask(taskId, 'cancelled');
          retryRequests.delete(taskId);
          if (!request.playlistTitle) sendFeedback_(win);
          return 'cancelled';
        }

        if (attempt < MAX_ATTEMPTS && isRetryableError(error)) {
          console.warn(
            `[downloader] attempt ${attempt} failed, retrying`,
            shortErrorMessage(error),
          );
          updateTask(taskId, { status: 'queued', progress: -1 });
          await sleep(RETRY_DELAY * attempt);
          if (isCancelRequested(taskId)) {
            finishTask(taskId, 'cancelled');
            return 'cancelled';
          }
          continue;
        }

        const task = getTask(taskId);
        const source =
          task && task.title !== taskLabelOf(request)
            ? `${task.artist ? `${task.artist} - ` : ''}${task.title}`
            : taskLabelOf(request);

        finishTask(taskId, 'error', shortErrorMessage(error));
        console.error(describeError(error, source));

        // Playlist items stay silent, a modal per failed song would be
        // unusable. Automatic downloads only speak up when the progress panel
        // is switched off, so a failure is never completely silent
        const reportedByPanel =
          !!request.playlistTitle || (request.automatic && config.showProgress);
        if (!reportedByPanel) {
          sendFeedback_(win);
          showErrorDialog(describeError(error, source));
        }
        return 'error';
      }
    }

    return 'error';
  } finally {
    releaseCancel(taskId);
  }
};

/** Queues the song behind a watch URL */
export function downloadSong(url: string, folder?: string) {
  queueSongDownload({ url, folder: folder ?? defaultDownloadFolder() });
}

/** Queues a song by its video id */
export function downloadSongFromId(id: string, folder?: string) {
  queueSongDownload({ id, folder: folder ?? defaultDownloadFolder() });
}

/* ------------------------------ auto download ----------------------------- */

const automaticallyDownloaded = new Set<string>();

/** Notes a video as automatically downloaded, forgetting the oldest ones */
const rememberAutomaticDownload = (videoId: string) => {
  if (automaticallyDownloaded.size >= AUTO_DOWNLOAD_MEMORY) {
    // Drop the oldest entry, insertion order is guaranteed for Set
    automaticallyDownloaded.delete(
      automaticallyDownloaded.values().next().value!,
    );
  }

  automaticallyDownloaded.add(videoId);
};

interface PlaybackSnapshot {
  videoId: string;
  /** Furthest position reached in this song */
  elapsed: number;
  duration: number;
}

let currentPlayback: PlaybackSnapshot | undefined;

/** Whether the song has played far enough for the configured trigger */
const thresholdReached = (snapshot: PlaybackSnapshot) => {
  const settings = config.downloadOnFinish;
  if (!settings) return false;

  return settings.mode === 'percent'
    ? snapshot.elapsed >= snapshot.duration * (settings.percent / 100)
    : snapshot.duration - snapshot.elapsed <= settings.seconds;
};

/** Starts the automatic download of a song, at most once per video */
const maybeDownloadAutomatically = (
  snapshot: PlaybackSnapshot,
  reason: 'threshold' | 'song-change',
) => {
  const settings = config.downloadOnFinish;
  if (!settings?.enabled) return;
  if (automaticallyDownloaded.has(snapshot.videoId)) return;
  if (!thresholdReached(snapshot)) return;

  rememberAutomaticDownload(snapshot.videoId);
  console.log(
    `[downloader] automatic download (${reason}) of ${snapshot.videoId} at ${Math.floor(
      snapshot.elapsed,
    )}/${Math.floor(snapshot.duration)}s`,
  );

  queueSongDownload({
    id: snapshot.videoId,
    folder: settings.folder || defaultDownloadFolder(),
    automatic: true,
  });
};

/**
 * Keeps track of what is playing and triggers the automatic download.
 *
 * Fed by two independent sources (the plugin renderer and the song-info
 * provider), so a missing event from one of them is not fatal. The download
 * starts as soon as the configured threshold is reached; if those updates stop
 * coming - a stalled player, a closed menu, an unloaded renderer - the song
 * still gets its chance when the next one starts, which is how the feature
 * behaved before.
 */
const trackPlayback = (
  videoId: string | undefined,
  elapsed: number,
  duration: number,
) => {
  if (!videoId) return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  if (!Number.isFinite(elapsed) || elapsed < 0) return;

  if (currentPlayback && currentPlayback.videoId !== videoId) {
    // Last chance for the song that just ended
    maybeDownloadAutomatically(currentPlayback, 'song-change');
    currentPlayback = undefined;
  }

  if (currentPlayback) {
    // Seeking backwards must not lower how far the song has been played
    currentPlayback.elapsed = Math.max(currentPlayback.elapsed, elapsed);
    currentPlayback.duration = duration;
  } else {
    currentPlayback = { videoId, elapsed, duration };
    if (is.dev()) {
      console.log(
        `[downloader] tracking ${videoId} (${Math.floor(duration)}s)`,
      );
    }
  }

  maybeDownloadAutomatically(currentPlayback, 'threshold');
};

/** Subscribes to both playback sources that feed "download on finish" */
function setupAutomaticDownloads({
  ipc,
}: Pick<BackendContext<DownloaderPluginConfig>, 'ipc'>) {
  // Primary source: the plugin renderer reports the real player position
  ipc.on(DownloaderIPC.playbackProgress, (progress: PlaybackProgress) => {
    trackPlayback(progress.videoId, progress.elapsed, progress.duration);
  });

  // Fallback source: the shared song-info provider
  registerCallback((songInfo: SongInfo, event) => {
    if (
      event !== SongInfoEvent.TimeChanged &&
      event !== SongInfoEvent.PlayOrPaused &&
      event !== SongInfoEvent.VideoSrcChanged
    ) {
      return;
    }

    trackPlayback(
      songInfo.videoId,
      songInfo.elapsedSeconds ?? 0,
      songInfo.songDuration,
    );
  });

  // The renderer might have loaded before this plugin finished booting, so the
  // listener is requested again on every player load
  ipcMain.on('peard:player-api-loaded', () => {
    ipc.send('peard:setup-time-changed-listener');
  });
}

/* ------------------------------- downloading ------------------------------ */

/** The configured ffmpeg preset, falling back to the mp3 default */
const resolvePreset = (): Preset => {
  const selected = config.selectedPreset ?? 'mp3 (256kbps)';
  if (selected === 'Custom') {
    return config.customPresetSetting ?? DefaultPresetList['Custom'];
  }

  return DefaultPresetList[selected] ?? DefaultPresetList['mp3 (256kbps)'];
};

/** Downloads, converts, tags and writes a single song, throwing on every failure */
async function downloadSongUnsafe(request: SongRequest, taskId: string) {
  const isPlaylistItem = !!request.playlistTitle;
  const feedback = (message?: unknown) => {
    if (!isPlaylistItem) {
      sendFeedback_(win, message);
    }
  };

  throwIfCancelled(taskId);
  updateTask(taskId, { status: 'preparing', progress: -1 });
  feedback(t('plugins.downloader.backend.feedback.downloading'));

  await waitForSession();

  const id = request.id ?? getVideoId(request.url ?? '');
  if (!id) {
    // No id in the URL: repeating that leads nowhere
    throw new PermanentDownloadError(
      t('plugins.downloader.backend.feedback.video-id-not-found'),
    );
  }

  let info: YTMusic.TrackInfo | YT.VideoInfo = await yt.music.getInfo(id);

  // An empty answer usually means the request did not really get through
  if (!info) {
    throw new Error(
      t('plugins.downloader.backend.feedback.video-id-not-found'),
    );
  }

  const metadata = getMetadata(info);
  if (metadata.album === 'N/A') {
    metadata.album = '';
  }

  metadata.trackId = request.trackId;

  const dir = request.folder || defaultDownloadFolder();
  const name = `${metadata.artist ? `${metadata.artist} - ` : ''}${
    metadata.title
  }`;
  updateTask(taskId, { title: metadata.title, artist: metadata.artist });

  let playabilityStatus = info.playability_status;
  let bypassedResult: YT.VideoInfo;
  if (playabilityStatus?.status === 'LOGIN_REQUIRED') {
    // Try to bypass the age restriction
    bypassedResult = await getAndroidTvInfo(id);
    playabilityStatus = bypassedResult.playability_status;

    if (playabilityStatus?.status === 'LOGIN_REQUIRED') {
      throw new PermanentDownloadError(
        `[${playabilityStatus.status}] ${playabilityStatus.reason}`,
      );
    }

    info = bypassedResult;
  }

  if (playabilityStatus?.status === 'UNPLAYABLE') {
    const errorScreen =
      playabilityStatus.error_screen as YTNodes.PlayerErrorMessage | null;
    throw new PermanentDownloadError(
      `[${playabilityStatus.status}] ${errorScreen?.reason.text}: ${errorScreen?.subreason.text}`,
    );
  }

  const presetSetting = resolvePreset();

  const downloadOptions: Types.FormatOptions = {
    type: (await isPremium()) ? 'audio' : 'video+audio', // Audio, video or video+audio
    quality: 'best', // Best, bestefficiency, 144p, 240p, 480p, 720p and so on.
    format: 'any', // Media container format
  };

  const format = info.chooseFormat(downloadOptions);

  let targetFileExtension: string;
  if (!presetSetting?.extension) {
    targetFileExtension =
      VideoFormatList.find((it) => it.itag === format.itag)?.container ?? 'mp3';
  } else {
    targetFileExtension = presetSetting?.extension ?? 'mp3';
  }

  let filename = filenamify(`${name}.${targetFileExtension}`, {
    replacement: '_',
    maxLength: 255,
  });
  if (!is.macOS()) {
    filename = filename.normalize('NFC');
  }
  const filePath = join(dir, filename);

  if (config.skipExisting && existsSync(filePath)) {
    feedback(null);
    finishTask(taskId, 'skipped');
    return;
  }

  throwIfCancelled(taskId);
  const stream = await info.download(downloadOptions);

  console.info(
    t('plugins.downloader.backend.feedback.download-info', {
      artist: metadata.artist,
      title: metadata.title,
      videoId: metadata.videoId,
    }),
  );

  const iterableStream = Utils.streamToIterable(stream);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let fileBuffer = await iterableStreamToProcessedUint8Array({
    stream: iterableStream,
    extension: targetFileExtension,
    metadata,
    presetFfmpegArgs: presetSetting?.ffmpegArgs ?? [],
    contentLength: format.content_length ?? 0,
    taskId,
    feedback,
  });

  if (fileBuffer && targetFileExtension === 'mp3') {
    updateTask(taskId, {
      status: 'tagging',
      progress: DOWNLOAD_PROGRESS_SHARE + CONVERT_PROGRESS_SHARE,
    });
    feedback(t('plugins.downloader.backend.feedback.writing-id3'));
    fileBuffer = await writeID3(Buffer.from(fileBuffer), metadata);
  }

  throwIfCancelled(taskId);

  if (fileBuffer) {
    updateTask(taskId, { status: 'saving', progress: 0.98 });
    feedback(t('plugins.downloader.backend.feedback.saving'));
    writeFileSync(filePath, fileBuffer);
  }

  feedback(null);
  finishTask(taskId, 'done');
  console.info(
    t('plugins.downloader.backend.feedback.done', {
      filePath,
    }),
  );
}

/** Collects the stream, reporting the download share of the task progress */
async function downloadChunks(
  stream: AsyncGenerator<Uint8Array, void>,
  contentLength: number,
  taskId: string,
  feedback: (message?: unknown) => void,
) {
  const chunks = [];
  let downloaded = 0;
  for await (const chunk of stream) {
    throwIfCancelled(taskId);

    downloaded += chunk.length;
    chunks.push(chunk);

    const ratio = contentLength > 0 ? downloaded / contentLength : -1;
    if (ratio >= 0) {
      updateTask(taskId, { progress: ratio * DOWNLOAD_PROGRESS_SHARE });
      feedback(
        t('plugins.downloader.backend.feedback.download-progress', {
          percent: Math.floor(ratio * 100),
        }),
      );
    }
  }

  return chunks;
}

/** Downloads the stream and runs it through ffmpeg, returns the converted file */
async function iterableStreamToProcessedUint8Array({
  stream,
  extension,
  metadata,
  presetFfmpegArgs,
  contentLength,
  taskId,
  feedback,
}: {
  stream: AsyncGenerator<Uint8Array, void>;
  extension: string;
  metadata: CustomSongInfo;
  presetFfmpegArgs: string[];
  contentLength: number;
  taskId: string;
  feedback: (message?: unknown) => void;
}): Promise<Uint8Array | null> {
  updateTask(taskId, {
    status: 'downloading',
    // Without a known size the bar stays indeterminate
    progress: contentLength > 0 ? 0 : -1,
  });
  feedback(t('plugins.downloader.backend.feedback.loading'));

  const safeVideoName = randomBytes(32).toString('hex');

  const chunks = await downloadChunks(stream, contentLength, taskId, feedback);

  return await ffmpegMutex.runExclusive(async () => {
    throwIfCancelled(taskId);

    const ffmpegInstance = await ffmpeg.get();
    if (!ffmpegInstance.isLoaded()) {
      await ffmpegInstance.load();
    }

    updateTask(taskId, {
      status: 'converting',
      progress: DOWNLOAD_PROGRESS_SHARE,
    });
    feedback(t('plugins.downloader.backend.feedback.preparing-file'));
    ffmpegInstance.FS('writeFile', safeVideoName, Buffer.concat(chunks));

    feedback(t('plugins.downloader.backend.feedback.converting'));

    ffmpegInstance.setProgress(({ ratio }) => {
      if (!Number.isFinite(ratio) || ratio < 0) return;

      const converted = Math.min(ratio, 1) * CONVERT_PROGRESS_SHARE;
      updateTask(taskId, {
        progress: DOWNLOAD_PROGRESS_SHARE + converted,
      });
      feedback(
        t('plugins.downloader.backend.feedback.conversion-progress', {
          percent: Math.floor(ratio * 100),
        }),
      );
    });

    const safeVideoNameWithExtension = `${safeVideoName}.${extension}`;
    try {
      await ffmpegInstance.run(
        '-i',
        safeVideoName,
        ...presetFfmpegArgs,
        ...getFFmpegMetadataArgs(metadata),
        safeVideoNameWithExtension,
      );
    } finally {
      ffmpegInstance.setProgress(() => {});
      ffmpegInstance.FS('unlink', safeVideoName);
    }

    throwIfCancelled(taskId);

    try {
      return ffmpegInstance.FS('readFile', safeVideoNameWithExtension);
    } finally {
      ffmpegInstance.FS('unlink', safeVideoNameWithExtension);
    }
  });
}

/** Cover artwork as PNG, or null when there is none to embed */
const getCoverBuffer = async (url: string) => {
  const nativeImage = cropMaxWidth(await getImage(url));
  return nativeImage && !nativeImage.isEmpty() ? nativeImage.toPNG() : null;
};

/** Writes title, artist, album and cover into the mp3 buffer */
async function writeID3(buffer: Buffer, metadata: CustomSongInfo) {
  const tags: NodeID3.Tags = {};

  // Create the metadata tags
  tags.title = metadata.title;
  tags.artist = metadata.artist;

  if (metadata.album) {
    tags.album = metadata.album;
  }

  try {
    const coverBuffer = await getCoverBuffer(metadata.imageSrc ?? '');
    if (coverBuffer) {
      tags.image = {
        mime: 'image/png',
        type: {
          id: NodeID3.TagConstants.AttachedPicture.PictureType.FRONT_COVER,
        },
        description: 'thumbnail',
        imageBuffer: coverBuffer,
      };
    }
  } catch (error: unknown) {
    // A missing cover must not fail the whole download
    console.warn(
      '[downloader] could not fetch cover',
      shortErrorMessage(error),
    );
  }

  if (metadata.trackId) {
    tags.trackNumber = metadata.trackId;
  }

  return NodeID3.write(tags, buffer);
}

/* -------------------------------- playlists ------------------------------- */

interface PlaylistItem {
  id: string;
  title: string;
  artist?: string;
  /** 1-based position inside the playlist */
  index: number;
  /** Task of the attempt that failed, dropped once a retry works */
  failedTaskId?: string;
}

/** Queues every song of a playlist, the queue then works through them one by one */
export async function downloadPlaylist(givenUrl?: string | URL) {
  await waitForSession();

  try {
    givenUrl = new URL(givenUrl ?? '');
  } catch {
    givenUrl = new URL(win.webContents.getURL());
  }

  const playlistId =
    getPlaylistID(givenUrl) ||
    (playingUrl ? getPlaylistID(new URL(playingUrl)) : null);

  if (!playlistId) {
    sendError(
      new Error(t('plugins.downloader.backend.feedback.playlist-id-not-found')),
    );
    return;
  }

  if (isQueued(`playlist:${playlistId}`)) {
    return;
  }

  const sendFeedback = (message?: unknown) => sendFeedback_(win, message);

  console.log(
    t('plugins.downloader.backend.feedback.trying-to-get-playlist-id', {
      playlistId,
    }),
  );
  sendFeedback(t('plugins.downloader.backend.feedback.getting-playlist-info'));

  let playlist: YTMusic.Playlist;
  const items: YTNodes.MusicResponsiveListItem[] = [];
  try {
    playlist = await yt.music.getPlaylist(playlistId);
    if (playlist?.items) {
      const filteredItems = playlist.items.filter(
        (item): item is YTNodes.MusicResponsiveListItem =>
          item instanceof YTNodes.MusicResponsiveListItem,
      );

      items.push(...filteredItems);
    }
  } catch (error: unknown) {
    sendFeedback();
    sendError(
      Error(
        t('plugins.downloader.backend.feedback.playlist-is-mix-or-private', {
          error: String(error),
        }),
      ),
    );
    return;
  }

  if (!playlist || !playlist.items || playlist.items.length === 0) {
    sendFeedback();
    sendError(
      new Error(t('plugins.downloader.backend.feedback.playlist-is-empty')),
    );
    return;
  }

  const normalPlaylistTitle =
    playlist.header && 'title' in playlist.header
      ? playlist.header?.title?.text
      : undefined;
  const playlistTitle =
    normalPlaylistTitle ??
    playlist.page.contents_memo
      ?.get('MusicResponsiveListItemFlexColumn')
      ?.at(2)
      ?.as(YTNodes.MusicResponsiveListItemFlexColumn)?.title?.text ??
    'NO_TITLE';
  const isAlbum = !normalPlaylistTitle;

  const maxItems = config.playlistMaxItems;
  while (playlist.has_continuation && (!maxItems || items.length < maxItems)) {
    playlist = await playlist.getContinuation();

    const filteredItems = playlist.items.filter(
      (item): item is YTNodes.MusicResponsiveListItem =>
        item instanceof YTNodes.MusicResponsiveListItem,
    );

    items.push(...filteredItems);
  }

  const selectedItems =
    maxItems && maxItems > 0 ? items.slice(0, maxItems) : items;

  if (selectedItems.length === 1) {
    sendFeedback(
      t('plugins.downloader.backend.feedback.playlist-has-only-one-song'),
    );
    downloadSongFromId(selectedItems.at(0)!.id!);
    return;
  }

  let safePlaylistTitle = filenamify(playlistTitle, { replacement: ' ' })
    .replace(/\s+/g, ' ')
    .trim();
  if (!is.macOS()) {
    safePlaylistTitle = safePlaylistTitle.normalize('NFC');
  }
  // Titles made of nothing but forbidden characters would end up as a folder
  // named " " or "."
  if (!safePlaylistTitle || /^\.+$/.test(safePlaylistTitle)) {
    safePlaylistTitle = playlistId;
  }

  const folder = getFolder(config.downloadFolder);
  const playlistFolder = join(folder, safePlaylistTitle);

  if (existsSync(playlistFolder)) {
    if (!config.skipExisting) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: [
          t(
            'plugins.downloader.backend.dialog.folder-already-exists.buttons.continue',
          ),
          t(
            'plugins.downloader.backend.dialog.folder-already-exists.buttons.cancel',
          ),
        ],
        defaultId: 0,
        cancelId: 1,
        title: t(
          'plugins.downloader.backend.dialog.folder-already-exists.title',
        ),
        message: t(
          'plugins.downloader.backend.dialog.folder-already-exists.message',
        ),
        detail: t('plugins.downloader.backend.feedback.folder-already-exists', {
          playlistFolder,
        }),
      });

      if (response !== 0) {
        sendFeedback();
        return;
      }
    }
  } else {
    mkdirSync(playlistFolder, { recursive: true });
  }

  if (is.dev()) {
    console.log(
      t('plugins.downloader.backend.feedback.downloading-playlist', {
        playlistTitle,
        playlistSize: selectedItems.length,
        playlistId,
      }),
    );
  }

  enqueue(`playlist:${playlistId}`, async () => {
    const failed: PlaylistItem[] = [];

    const downloadItem = async (item: PlaylistItem) => {
      const taskId = createTask({
        title: item.title,
        artist: item.artist,
        playlistTitle,
        playlistIndex: item.index,
        playlistSize: selectedItems.length,
        retryable: true,
      });

      // Playlist items run inline: the whole playlist is one queue entry
      const outcome = await runSongDownload(
        {
          id: item.id,
          folder: playlistFolder,
          trackId: isAlbum ? String(item.index) : undefined,
          playlistTitle,
          playlistIndex: item.index,
          playlistSize: selectedItems.length,
        },
        taskId,
      );

      return { outcome, taskId };
    };

    try {
      let counter = 1;
      for (const song of selectedItems) {
        sendFeedback(
          t('plugins.downloader.backend.feedback.downloading-counter', {
            current: counter,
            total: selectedItems.length,
          }),
        );

        const item: PlaylistItem = {
          id: song.id!,
          title: song.title ?? song.id!,
          artist: song.author?.name,
          index: counter,
        };

        const { outcome, taskId } = await downloadItem(item);
        if (outcome === 'error') {
          failed.push({ ...item, failedTaskId: taskId });
        }
        counter++;

        // A short breather keeps a long playlist from hammering the servers
        if (counter <= selectedItems.length) {
          await sleep(PLAYLIST_ITEM_PAUSE);
        }
      }

      // A second pass catches the songs that lost to a hiccup on the way
      if (failed.length > 0) {
        console.log(
          `[downloader] retrying ${failed.length} failed playlist item(s)`,
        );
        sendFeedback(
          t('plugins.downloader.backend.feedback.retrying-failed', {
            count: failed.length,
          }),
        );

        // Whatever upset the connection gets a moment to settle
        await sleep(RETRY_DELAY);

        for (const item of failed) {
          const { outcome } = await downloadItem(item);
          // The entry of the failed attempt is stale once it worked
          if (outcome === 'done' && item.failedTaskId) {
            dismissTask(item.failedTaskId);
          }
          await sleep(PLAYLIST_ITEM_PAUSE);
        }
      }
    } finally {
      sendFeedback(); // Clear feedback
    }
  });
}

/** Metadata arguments for ffmpeg, for the containers that carry their own tags */
function getFFmpegMetadataArgs(metadata: CustomSongInfo) {
  if (!metadata) {
    return [];
  }

  return [
    ...(metadata.title ? ['-metadata', `title=${metadata.title}`] : []),
    ...(metadata.artist ? ['-metadata', `artist=${metadata.artist}`] : []),
    ...(metadata.album ? ['-metadata', `album=${metadata.album}`] : []),
    ...(metadata.trackId ? ['-metadata', `track=${metadata.trackId}`] : []),
  ];
}

// Playlist radio modifier needs to be cut from playlist ID
const INVALID_PLAYLIST_MODIFIER = 'RDAMPL';

/** Playlist id of a URL, with the radio modifier cut off */
const getPlaylistID = (aURL?: URL): string | null | undefined => {
  const result =
    aURL?.searchParams.get('list') || aURL?.searchParams.get('playlist');
  if (result?.startsWith(INVALID_PLAYLIST_MODIFIER)) {
    return result.slice(INVALID_PLAYLIST_MODIFIER.length);
  }

  return result;
};

/** Video id of a watch URL */
const getVideoId = (url: URL | string): string | null => {
  const parsedUrl = URL.parse(url);
  if (!parsedUrl) return null;
  return parsedUrl.searchParams.get('v');
};

/** Maps the Innertube track info onto the song info used by this plugin */
const getMetadata = (info: YTMusic.TrackInfo): CustomSongInfo => ({
  videoId: info.basic_info.id!,
  title: cleanupName(info.basic_info.title!),
  artist: cleanupName(info.basic_info.author!),
  album: info.player_overlays?.browser_media_session?.as(
    YTNodes.BrowserMediaSession,
  ).album?.text,
  imageSrc: info.basic_info.thumbnail?.find((t) => !t.url.endsWith('.webp'))
    ?.url,
  views: info.basic_info.view_count!,
  songDuration: info.basic_info.duration!,
  mediaType: MediaType.Audio,
});

/** Streaming data of a video, over the client that ignores age restrictions */
const getAndroidTvInfo = async (id: string): Promise<YT.VideoInfo> => {
  // GetInfo 404s with the bypass, so we use getBasicInfo instead
  // that's fine as we only need the streaming data
  return await yt.getBasicInfo(id, {
    client: 'TV_EMBEDDED',
  });
};
