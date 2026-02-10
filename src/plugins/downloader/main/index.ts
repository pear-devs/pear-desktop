import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { app, type BrowserWindow, dialog, ipcMain } from 'electron';
import {
  Innertube,
  UniversalCache,
  Utils,
  YTNodes,
  Platform,
} from '\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js';
import is from 'electron-is';
import filenamify from 'filenamify';
import { Mutex } from 'async-mutex';
import * as NodeID3 from 'node-id3';
import { BG, type BgConfig } from 'bgutils-js';
import { lazy } from 'lazy-var';

import {
  cropMaxWidth,
  getFolder,
  sendFeedback as sendFeedback_,
  setBadge,
} from './utils';
import {
  registerCallback,
  cleanupName,
  getImage,
  MediaType,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import { getNetFetchAsFetch } from '@/plugins/utils/main';
import { t } from '@/i18n';

import { DefaultPresetList, type Preset, VideoFormatList } from '../types';

import type { DownloaderPluginConfig } from '../index';
import type { BackendContext } from '@/types/contexts';
import type { GetPlayerResponse } from '@/types/get-player-response';
import type { FormatOptions } from 'node_modules/\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js/dist/src/types';
import type { VideoInfo } from 'node_modules/\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js/dist/src/parser/\u0079\u006f\u0075\u0074\u0075\u0062\u0065';
import type { PlayerErrorMessage } from 'node_modules/\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js/dist/src/parser/nodes';
import type {
  TrackInfo,
  Playlist,
} from 'node_modules/\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js/dist/src/parser/ytmusic';

type CustomSongInfo = SongInfo & { trackId?: string };

const ffmpeg = lazy(async () =>
  (await import('@ffmpeg.wasm/main')).createFFmpeg({
    log: false,
    logger() {}, // Console.log,
    progress() {}, // Console.log,
  }),
);
const ffmpegMutex = new Mutex();

Platform.shim.eval = async (data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) => {
  const properties = [];

  if(env.n) {
    properties.push(`n: exportedVars.nFunction("${env.n}")`)
  }

  if (env.sig) {
    properties.push(`sig: exportedVars.sigFunction("${env.sig}")`)
  }

  const code = `${data.output}\nreturn { ${properties.join(', ')} }`;

  return new Function(code)();
}

let yt: Innertube;
let win: BrowserWindow;
let playingUrl: string;

const isPremium = async () => {
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

const sendError = (error: Error, source?: string) => {
  win.setProgressBar(-1); // Close progress bar
  setBadge(0); // Close badge
  sendFeedback_(win); // Reset feedback

  const songNameMessage = source ? `\nin ${source}` : '';
  const cause = error.cause
    ? `\n\n${
        // eslint-disable-next-line @typescript-eslint/no-base-to-string,@typescript-eslint/restrict-template-expressions
        error.cause instanceof Error ? error.cause.toString() : error.cause
      }`
    : '';
  const message = `${error.toString()}${songNameMessage}${cause}`;

  console.error(message);
  console.trace(error);
  dialog.showMessageBox(win, {
    type: 'info',
    buttons: [t('plugins.downloader.backend.dialog.error.buttons.ok')],
    title: t('plugins.downloader.backend.dialog.error.title'),
    message: t('plugins.downloader.backend.dialog.error.message'),
    detail: message,
  });
};

export const getCookieFromWindow = async (win: BrowserWindow) => {
  return (
    await win.webContents.session.cookies.get({
      url: 'https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com',
    })
  )
    .map((it) => it.name + '=' + it.value)
    .join(';');
};

let config: DownloaderPluginConfig;

export const onMainLoad = async ({
  window: _win,
  getConfig,
  ipc,
}: BackendContext<DownloaderPluginConfig>) => {
  win = _win;
  config = await getConfig();

  yt = await Innertube.create({
    cache: new UniversalCache(false),
    cookie: await getCookieFromWindow(win),
    generate_session_locally: true,
    fetch: getNetFetchAsFetch(),
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
        fetch: getNetFetchAsFetch(),
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
        // eslint-disable-next-line @typescript-eslint/no-implied-eval,@typescript-eslint/no-unsafe-call
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

  ipc.handle('download-song', (url: string) => downloadSong(url));
  ipc.on('peard:video-src-changed', (data: GetPlayerResponse) => {
    playingUrl = data.microformat.microformatDataRenderer.urlCanonical;
  });
  ipc.handle('download-playlist-request', async (url: string) =>
    downloadPlaylist(url),
  );

  downloadSongOnFinishSetup({ ipc, getConfig });
};

export const onConfigChange = (newConfig: DownloaderPluginConfig) => {
  config = newConfig;
};

export async function downloadSong(
  url: string,
  playlistFolder: string | undefined = undefined,
  trackId: string | undefined = undefined,
  increasePlaylistProgress: (value: number) => void = () => {},
) {
  let resolvedName;
  try {
    await downloadSongUnsafe(
      false,
      url,
      (name: string) => (resolvedName = name),
      playlistFolder,
      trackId,
      increasePlaylistProgress,
    );
  } catch (error: unknown) {
    sendError(error as Error, resolvedName || url);
  }
}

export async function downloadSongFromId(
  id: string,
  playlistFolder: string | undefined = undefined,
  trackId: string | undefined = undefined,
  increasePlaylistProgress: (value: number) => void = () => {},
) {
  let resolvedName;
  try {
    await downloadSongUnsafe(
      true,
      id,
      (name: string) => (resolvedName = name),
      playlistFolder,
      trackId,
      increasePlaylistProgress,
    );
  } catch (error: unknown) {
    sendError(error as Error, resolvedName || id);
  }
}

function downloadSongOnFinishSetup({
  ipc,
}: Pick<BackendContext<DownloaderPluginConfig>, 'ipc' | 'getConfig'>) {
  let currentUrl: string | undefined;
  let duration: number | undefined;
  let time = 0;

  const defaultDownloadFolder = app.getPath('downloads');

  registerCallback((songInfo: SongInfo, event) => {
    if (event === SongInfoEvent.TimeChanged) {
      const elapsedSeconds = songInfo.elapsedSeconds ?? 0;
      if (elapsedSeconds > time) time = elapsedSeconds;
      return;
    }
    if (
      !songInfo.isPaused &&
      songInfo.url !== currentUrl &&
      config.downloadOnFinish?.enabled
    ) {
      if (typeof currentUrl === 'string' && duration && duration > 0) {
        if (
          config.downloadOnFinish.mode === 'seconds' &&
          duration - time <= config.downloadOnFinish.seconds
        ) {
          downloadSong(
            currentUrl,
            config.downloadOnFinish.folder ??
              config.downloadFolder ??
              defaultDownloadFolder,
          );
        } else if (
          config.downloadOnFinish.mode === 'percent' &&
          time >= duration * (config.downloadOnFinish.percent / 100)
        ) {
          downloadSong(
            currentUrl,
            config.downloadOnFinish.folder ??
              config.downloadFolder ??
              defaultDownloadFolder,
          );
        }
      }

      currentUrl = songInfo.url;
      duration = songInfo.songDuration;
      time = 0;
    }
  });

  ipcMain.on('peard:player-api-loaded', () => {
    ipc.send('peard:setup-time-changed-listener');
  });
}

async function downloadSongUnsafe(
  isId: boolean,
  idOrUrl: string,
  setName: (name: string) => void,
  playlistFolder: string | undefined = undefined,
  trackId: string | undefined = undefined,
  increasePlaylistProgress: (value: number) => void = () => {},
) {
  const sendFeedback = (message: unknown, progress?: number) => {
    if (!playlistFolder) {
      sendFeedback_(win, message);
      if (progress && !isNaN(progress)) {
        win.setProgressBar(progress);
      }
    }
  };

  sendFeedback(t('plugins.downloader.backend.feedback.downloading'), 2);

  let id: string | null;
  if (isId) {
    id = idOrUrl;
  } else {
    id = getVideoId(idOrUrl);
    if (typeof id !== 'string')
      throw new Error(
        t('plugins.downloader.backend.feedback.video-id-not-found'),
      );
  }

  let info: TrackInfo | VideoInfo = await yt.music.getInfo(id);

  if (!info) {
    throw new Error(
      t('plugins.downloader.backend.feedback.video-id-not-found'),
    );
  }

  const metadata = getMetadata(info);
  if (metadata.album === 'N/A') {
    metadata.album = '';
  }

  metadata.trackId = trackId;

  const dir =
    playlistFolder || config.downloadFolder || app.getPath('downloads');
  const name = `${metadata.artist ? `${metadata.artist} - ` : ''}${
    metadata.title
  }`;
  setName(name);

  let playabilityStatus = info.playability_status;
  let bypassedResult = null;
  if (playabilityStatus?.status === 'LOGIN_REQUIRED') {
    // Try to bypass the age restriction
    bypassedResult = await getAndroidTvInfo(id);
    playabilityStatus = bypassedResult.playability_status;

    if (playabilityStatus?.status === 'LOGIN_REQUIRED') {
      throw new Error(
        `[${playabilityStatus.status}] ${playabilityStatus.reason}`,
      );
    }

    info = bypassedResult;
  }

  if (playabilityStatus?.status === 'UNPLAYABLE') {
    const errorScreen =
      playabilityStatus.error_screen as PlayerErrorMessage | null;
    throw new Error(
      `[${playabilityStatus.status}] ${errorScreen?.reason.text}: ${errorScreen?.subreason.text}`,
    );
  }

  const selectedPreset = config.selectedPreset ?? 'mp3 (256kbps)';
  let presetSetting: Preset;
  if (selectedPreset === 'Custom') {
    presetSetting = config.customPresetSetting ?? DefaultPresetList['Custom'];
  } else if (selectedPreset === 'Source') {
    presetSetting = DefaultPresetList['Source'];
  } else {
    presetSetting = DefaultPresetList['mp3 (256kbps)'];
  }

  const downloadOptions: FormatOptions = {
    type: (await isPremium()) ? 'audio' : 'video+audio', // Audio, video or video+audio
    quality: 'best', // Best, bestefficiency, 144p, 240p, 480p, 720p and so on.
    format: 'any', // Media container format
  };

  const format = info.chooseFormat(downloadOptions);

  let targetFileExtension: string;
  if (!presetSetting?.extension) {
    targetFileExtension =
      VideoFormatList.find((it) => it.itag === format.itag)?.container ??
      'mp3';
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
    sendFeedback(null, -1);
    return;
  }

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
    mkdirSync(dir);
  }

  let fileBuffer = await iterableStreamToProcessedUint8Array(
    iterableStream,
    targetFileExtension,
    metadata,
    presetSetting?.ffmpegArgs ?? [],
    format.content_length ?? 0,
    sendFeedback,
    increasePlaylistProgress,
  );

  if (fileBuffer && targetFileExtension === 'mp3') {
    fileBuffer = await writeID3(
      Buffer.from(fileBuffer),
      metadata,
      sendFeedback,
    );
  }

  if (fileBuffer) {
    writeFileSync(filePath, fileBuffer);
  }

  sendFeedback(null, -1);
  console.info(
    t('plugins.downloader.backend.feedback.done', {
      filePath,
    }),
  );
}

async function downloadChunks(
  stream: AsyncGenerator<Uint8Array, void>,
  contentLength: number,
  sendFeedback: (str: string, value?: number) => void,
  increasePlaylistProgress: (value: number) => void = () => {},
) {
  const chunks = [];
  let downloaded = 0;
  for await (const chunk of stream) {
    downloaded += chunk.length;
    chunks.push(chunk);
    const ratio = downloaded / contentLength;
    const progress = Math.floor(ratio * 100);
    sendFeedback(
      t('plugins.downloader.backend.feedback.download-progress', {
        percent: progress,
      }),
      ratio,
    );
    // 15% for download, 85% for conversion
    // This is a very rough estimate, trying to make the progress bar look nice
    increasePlaylistProgress(ratio * 0.15);
  }
  return chunks;
}

async function iterableStreamToProcessedUint8Array(
  stream: AsyncGenerator<Uint8Array, void>,
  extension: string,
  metadata: CustomSongInfo,
  presetFfmpegArgs: string[],
  contentLength: number,
  sendFeedback: (str: string, value?: number) => void,
  increasePlaylistProgress: (value: number) => void = () => {},
): Promise<Uint8Array | null> {
  sendFeedback(t('plugins.downloader.backend.feedback.loading'), 2); // Indefinite progress bar after download

  const safeVideoName = randomBytes(32).toString('hex');

  return await ffmpegMutex.runExclusive(async () => {
    try {
      const ffmpegInstance = await ffmpeg.get();
      if (!ffmpegInstance.isLoaded()) {
        await ffmpegInstance.load();
      }

      sendFeedback(t('plugins.downloader.backend.feedback.preparing-file'));
      ffmpegInstance.FS(
        'writeFile',
        safeVideoName,
        Buffer.concat(
          await downloadChunks(
            stream,
            contentLength,
            sendFeedback,
            increasePlaylistProgress,
          ),
        ),
      );

      sendFeedback(t('plugins.downloader.backend.feedback.converting'));

      ffmpegInstance.setProgress(({ ratio }) => {
        sendFeedback(
          t('plugins.downloader.backend.feedback.conversion-progress', {
            percent: Math.floor(ratio * 100),
          }),
          ratio,
        );
        increasePlaylistProgress(0.15 + ratio * 0.85);
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
        ffmpegInstance.FS('unlink', safeVideoName);
      }

      sendFeedback(t('plugins.downloader.backend.feedback.saving'));

      try {
        return ffmpegInstance.FS('readFile', safeVideoNameWithExtension);
      } finally {
        ffmpegInstance.FS('unlink', safeVideoNameWithExtension);
      }
    } catch (error: unknown) {
      sendError(error as Error, safeVideoName);
    }
    return null;
  });
}

const getCoverBuffer = async (url: string) => {
  const nativeImage = cropMaxWidth(await getImage(url));
  return nativeImage && !nativeImage.isEmpty() ? nativeImage.toPNG() : null;
};

async function writeID3(
  buffer: Buffer,
  metadata: CustomSongInfo,
  sendFeedback: (str: string, value?: number) => void,
) {
  try {
    sendFeedback(t('plugins.downloader.backend.feedback.writing-id3'));
    const tags: NodeID3.Tags = {};

    // Create the metadata tags
    tags.title = metadata.title;
    tags.artist = metadata.artist;

    if (metadata.album) {
      tags.album = metadata.album;
    }

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

    if (metadata.trackId) {
      tags.trackNumber = metadata.trackId;
    }

    return NodeID3.write(tags, buffer);
  } catch (error: unknown) {
    sendError(error as Error, `${metadata.artist} - ${metadata.title}`);
    return null;
  }
}

export async function downloadPlaylist(givenUrl?: string | URL) {
  try {
    givenUrl = new URL(givenUrl ?? '');
  } catch {
    givenUrl = new URL(win.webContents.getURL());
  }

  const playlistId =
    getPlaylistID(givenUrl) || getPlaylistID(new URL(playingUrl));

  if (!playlistId) {
    sendError(
      new Error(t('plugins.downloader.backend.feedback.playlist-id-not-found')),
    );
    return;
  }

  const sendFeedback = (message?: unknown) => sendFeedback_(win, message);

  console.log(
    t('plugins.downloader.backend.feedback.trying-to-get-playlist-id', {
      playlistId,
    }),
  );
  sendFeedback(t('plugins.downloader.backend.feedback.getting-playlist-info'));
  let playlist: Playlist;
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

  while (playlist.has_continuation) {
    playlist = await playlist.getContinuation();

    const filteredItems = playlist.items.filter(
      (item): item is YTNodes.MusicResponsiveListItem =>
        item instanceof YTNodes.MusicResponsiveListItem,
    );

    items.push(...filteredItems);
  }

  if (items.length === 1) {
    sendFeedback(
      t('plugins.downloader.backend.feedback.playlist-has-only-one-song'),
    );
    await downloadSongFromId(items.at(0)!.id!);
    return;
  }

  let safePlaylistTitle = filenamify(playlistTitle, { replacement: ' ' });
  if (!is.macOS()) {
    safePlaylistTitle = safePlaylistTitle.normalize('NFC');
  }

  const folder = getFolder(config.downloadFolder ?? '');
  const playlistFolder = join(folder, safePlaylistTitle);
  if (existsSync(playlistFolder)) {
    if (!config.skipExisting) {
      sendError(
        new Error(
          t('plugins.downloader.backend.feedback.folder-already-exists', {
            playlistFolder,
          }),
        ),
      );
      return;
    }
  } else {
    mkdirSync(playlistFolder, { recursive: true });
  }

  dialog.showMessageBox(win, {
    type: 'info',
    buttons: [
      t('plugins.downloader.backend.dialog.start-download-playlist.buttons.ok'),
    ],
    title: t('plugins.downloader.backend.dialog.start-download-playlist.title'),
    message: t(
      'plugins.downloader.backend.dialog.start-download-playlist.message',
      {
        playlistTitle,
      },
    ),
    detail: t(
      'plugins.downloader.backend.dialog.start-download-playlist.detail',
      {
        playlistSize: items.length,
      },
    ),
  });

  if (is.dev()) {
    console.log(
      t('plugins.downloader.backend.feedback.downloading-playlist', {
        playlistTitle,
        playlistSize: items.length,
        playlistId,
      }),
    );
  }

  win.setProgressBar(2); // Starts with indefinite bar

  setBadge(items.length);

  let counter = 1;

  const progressStep = 1 / items.length;

  const increaseProgress = (itemPercentage: number) => {
    const currentProgress = (counter - 1) / (items.length ?? 1);
    const newProgress = currentProgress + progressStep * itemPercentage;
    win.setProgressBar(newProgress);
  };

  try {
    for (const song of items) {
      sendFeedback(
        t('plugins.downloader.backend.feedback.downloading-counter', {
          current: counter,
          total: items.length,
        }),
      );
      const trackId = isAlbum ? counter : undefined;
      await downloadSongFromId(
        song.id!,
        playlistFolder,
        trackId?.toString(),
        increaseProgress,
      ).catch((error) =>
        sendError(
          new Error(
            t('plugins.downloader.backend.feedback.error-while-downloading', {
              author: song.author!.name,
              title: song.title!,
              error: String(error),
            }),
          ),
        ),
      );

      win.setProgressBar(counter / items.length);
      setBadge(items.length - counter);
      counter++;
    }
  } catch (error: unknown) {
    sendError(error as Error);
  } finally {
    win.setProgressBar(-1); // Close progress bar
    setBadge(0); // Close badge counter
    sendFeedback(); // Clear feedback
  }
}

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

const getPlaylistID = (aURL?: URL): string | null | undefined => {
  const result =
    aURL?.searchParams.get('list') || aURL?.searchParams.get('playlist');
  if (result?.startsWith(INVALID_PLAYLIST_MODIFIER)) {
    return result.slice(INVALID_PLAYLIST_MODIFIER.length);
  }

  return result;
};

const getVideoId = (url: URL | string): string | null => {
  return new URL(url).searchParams.get('v');
};

const getMetadata = (info: TrackInfo): CustomSongInfo => ({
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

// This is used to bypass age restrictions
const getAndroidTvInfo = async (id: string): Promise<VideoInfo> => {
  // GetInfo 404s with the bypass, so we use getBasicInfo instead
  // that's fine as we only need the streaming data
  return await yt.getBasicInfo(id, {
    client: 'TV_EMBEDDED',
  });
};
