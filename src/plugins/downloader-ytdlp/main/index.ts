import path from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

import { app, type BrowserWindow, dialog, ipcMain } from 'electron';
import is from 'electron-is';

import { getFolder, sendFeedback as sendFeedback_, setBadge } from './utils';
import {
  registerCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import { t } from '@/i18n';

import type { DownloaderPluginConfig } from '../index';
import type { BackendContext } from '@/types/contexts';
import type { GetPlayerResponse } from '@/types/get-player-response';

// Helper to send OS notification if notifications plugin is enabled
async function sendOsNotification(title: string, body: string) {
  try {
    // First try to use Electron's built-in Notification API
    const { Notification } = await import('electron');

    if (Notification.isSupported()) {
      const notification = new Notification({
        title,
        body,
        silent: false,
      });
      notification.show();
      return true;
    }
  } catch (error) {
    logToFrontend('warn', '⚠️ Could not send notification:', error);
  }
  return false;
}

// Helper to clean URL and convert music.youtube.com to youtube.com for better yt-dlp compatibility
function cleanAndConvertUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // Convert music.youtube.com to youtube.com
    if (urlObj.hostname === 'music.youtube.com') {
      urlObj.hostname = 'youtube.com';
    }

    // Remove playlist parameters to prevent downloading entire playlists
    const params = new URLSearchParams(urlObj.search);
    if (params.has('list')) {
      params.delete('list');
    }
    if (params.has('index')) {
      params.delete('index');
    }

    urlObj.search = params.toString();
    return urlObj.toString();
  } catch (error) {
    console.warn('[Downloader] Failed to clean URL, using original:', error);
    return url;
  }
}

// Cached yt-dlp path to reduce path checks and verbose logging
let cachedYtDlpPath: string | undefined;
let cachedConfig: DownloaderPluginConfig | null = null;

// Helper function to log both to backend console and frontend
function logToFrontend(
  level: 'info' | 'warn' | 'error',
  message: string,
  ...args: unknown[]
) {
  const formattedMessage =
    args.length > 0 ? `${message} ${args.join(' ')}` : message;

  console[level](`[Downloader] ${formattedMessage}`);

  // Also log to frontend for production debugging
  try {
    win?.webContents?.executeJavaScript(
      `console.${level}('[Downloader] ${formattedMessage.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}');`,
    );
  } catch {
    // Ignore errors if window not available
  }
}

// Helper to find yt-dlp path, with caching to reduce verbose logging
function getYtDlpPath(customPath?: string): string | undefined {
  // Check cache first to avoid redundant file system checks
  if (cachedYtDlpPath && cachedConfig?.advanced?.ytDlpPath === customPath) {
    return cachedYtDlpPath;
  }

  const checkedPaths: string[] = [];
  if (customPath) {
    checkedPaths.push(`[custom] ${customPath}`);
    if (existsSync(customPath)) {
      // Only log yt-dlp path once when plugin loads, not for every download
      if (!cachedYtDlpPath) {
        logToFrontend('info', '🔧 Using custom yt-dlp path:', customPath);
      }
      cachedYtDlpPath = customPath;
      return customPath;
    }
  }

  if (is.windows()) {
    const candidates = [
      'C:/yt-dlp.exe',
      path.join(homedir(), 'Downloads', 'yt-dlp.exe'),
      'C:/utils/yt-dlp.exe',
    ];
    for (const p of candidates) {
      checkedPaths.push(p);
      if (existsSync(p)) {
        // Only log yt-dlp path once when plugin loads, not for every download
        if (!cachedYtDlpPath) {
          logToFrontend('info', '🔧 Found yt-dlp at:', p);
        }
        cachedYtDlpPath = p;
        return p;
      }
    }
  } else if (is.linux()) {
    checkedPaths.push('/usr/bin/yt-dlp');
    if (existsSync('/usr/bin/yt-dlp')) {
      // Only log yt-dlp path once when plugin loads, not for every download
      if (!cachedYtDlpPath) {
        logToFrontend('info', '🔧 Found yt-dlp at: /usr/bin/yt-dlp');
      }
      cachedYtDlpPath = '/usr/bin/yt-dlp';
      return '/usr/bin/yt-dlp';
    }
  } else if (is.macOS()) {
    const macCandidates = ['/usr/local/bin/yt-dlp', '/opt/homebrew/bin/yt-dlp'];
    for (const p of macCandidates) {
      checkedPaths.push(p);
      if (existsSync(p)) {
        // Only log yt-dlp path once when plugin loads, not for every download
        if (!cachedYtDlpPath) {
          logToFrontend('info', '🔧 Found yt-dlp at:', p);
        }
        cachedYtDlpPath = p;
        return p;
      }
    }
  }

  logToFrontend('warn', '⚠️ yt-dlp not found. Paths checked:', checkedPaths);
  cachedYtDlpPath = undefined;
  return undefined;
}

let win: BrowserWindow;
let playingUrl: string;
let config: DownloaderPluginConfig;

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

  // Print full error to console for debugging
  console.error('[Downloader] Error:', message);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  console.trace(error);

  // Try to extract command info from error message
  let commandInfo = '';
  const match = message.match(/Command: ([^\n]+)/);
  if (match) {
    commandInfo = `\n\nCommand attempted: ${match[1]}`;
  }

  // Detect common yt-dlp errors and suggest workarounds
  let userTip = '';
  if (
    /403 Forbidden|unable to download video data|age.restrict/i.test(message)
  ) {
    userTip =
      '\n\nTip: This video may be age-restricted or region-blocked. Try logging in with cookies, or enable geo-bypass in yt-dlp settings.';
  }

  // Log error to frontend console for copy/paste
  logToFrontend(
    'error',
    '❌ Download failed:',
    message + commandInfo + userTip,
  );

  // Send error to renderer for toast display (non-blocking)
  try {
    win.webContents.send('downloader-error-toast', {
      message: message + commandInfo + userTip,
      title: t('plugins.downloader.backend.dialog.error.title'),
    });
  } catch (e) {
    logToFrontend('warn', '⚠️ Could not send error toast:', e);
  }

  // Optionally, show a non-blocking notification (OS toast)
  sendOsNotification(
    t('plugins.downloader.backend.dialog.error.title'),
    message + userTip,
  ).catch(() => {});
};

export const onMainLoad = async ({
  window: _win,
  getConfig,
  ipc,
}: BackendContext<DownloaderPluginConfig>) => {
  win = _win;
  config = await getConfig();

  // Update cache when config changes
  cachedConfig = config;

  ipc.handle('download-song', (url: string) => downloadSong(url));
  ipc.on('ytmd:video-src-changed', (data: GetPlayerResponse) => {
    playingUrl = data.microformat.microformatDataRenderer.urlCanonical;
  });
  ipc.handle('download-playlist-request', async (url: string) =>
    downloadPlaylist(url),
  );

  downloadSongOnFinishSetup({ ipc, getConfig });
};

export const onConfigChange = (newConfig: DownloaderPluginConfig) => {
  config = newConfig;
  // Update cache when config changes
  cachedConfig = newConfig;

  // Reset yt-dlp path cache if custom path changed
  if (cachedConfig?.advanced?.ytDlpPath !== newConfig.advanced?.ytDlpPath) {
    cachedYtDlpPath = undefined;
  }
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

  ipcMain.on('ytmd:player-api-loaded', () => {
    ipc.send('ytmd:setup-time-changed-listener');
  });
}

async function downloadSongUnsafe(
  isId: boolean,
  idOrUrl: string,
  setName: (name: string) => void,
  playlistFolder: string | undefined = undefined,
  _trackId: string | undefined = undefined,
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

  sendFeedback(t('plugins.downloader.backend.feedback.downloading'), 0.1);

  let url: string;
  if (isId) {
    url = `https://youtube.com/watch?v=${idOrUrl}`;
  } else {
    // Clean up the URL and convert music.youtube.com to youtube.com
    url = cleanAndConvertUrl(idOrUrl);
  }

  const dir =
    playlistFolder || config.downloadFolder || app.getPath('downloads');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Find yt-dlp path using cached value or search
  const ytDlpPath = getYtDlpPath(config.advanced?.ytDlpPath);
  if (!ytDlpPath) {
    const allPaths = [
      config.advanced?.ytDlpPath
        ? `[custom] ${config.advanced.ytDlpPath}`
        : null,
      ...(is.windows()
        ? [
            'C:/yt-dlp.exe',
            path.join(homedir(), 'Downloads', 'yt-dlp.exe'),
            'C:/utils/yt-dlp.exe',
          ]
        : is.linux()
          ? ['/usr/bin/yt-dlp']
          : is.macOS()
            ? ['/usr/local/bin/yt-dlp', '/opt/homebrew/bin/yt-dlp']
            : []),
    ].filter(Boolean);

    logToFrontend('error', '❌ yt-dlp not found. Paths checked:', allPaths);
    throw new Error(
      'yt-dlp executable not found.\nPaths checked:\n' +
        allPaths.join('\n') +
        '\nPlease set the path in the Downloader plugin menu.',
    );
  }

  // Enhanced output template with artist and title, higher quality, metadata
  const outTemplate = `${dir}/%(artist)s - %(title)s.%(ext)s`;

  // Check if file already exists when skipExisting is enabled
  if (config.skipExisting) {
    try {
      // Get the expected filename by running yt-dlp with --print option first
      const infoArgs = ['--print', '%(artist)s - %(title)s.%(ext)s', url];
      const infoProcess = spawn(ytDlpPath, infoArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });

      let infoOutput = '';
      infoProcess.stdout?.on('data', (data: Buffer) => {
        infoOutput += data.toString();
      });

      const infoExitCode = await new Promise<number>((resolve) => {
        infoProcess.on('close', resolve);
      });

      if (infoExitCode === 0) {
        const expectedFilename = infoOutput
          .trim()
          .replace('.webm', '.mp3')
          .replace('.m4a', '.mp3');
        const expectedPath = path.join(dir, expectedFilename);

        if (existsSync(expectedPath)) {
          logToFrontend(
            'info',
            '⏭️ File already exists, skipping:',
            expectedPath,
          );
          sendFeedback(
            t('plugins.downloader.backend.feedback.file-already-exists'),
            -1,
          );
          setName(expectedPath);
          return; // Skip download
        }
      }
    } catch (error) {
      logToFrontend('warn', '⚠️ Could not check for existing file:', error);
      // Continue with download if check fails
    }
  }

  // Enhanced args with higher quality and metadata embedding (NO separate thumbnail downloads)
  const args = [
    '-x',
    '--audio-format',
    'mp3',
    '--audio-quality',
    '320K', // Higher bitrate
    '--embed-thumbnail', // Embed album art into the MP3
    '--embed-metadata', // Embed ID3 tags
    '--add-metadata', // Additional metadata
    '--convert-thumbnails',
    'jpg', // Convert to standard format (for embedded only, no separate files)

    '-o',
    outTemplate,
    url,
  ];

  // Add skip existing flag if enabled
  if (config.skipExisting) {
    args.push('--no-overwrites');
  }

  // Enhanced colored logging with unicode icons
  logToFrontend('info', '⬇️ Starting download...');
  logToFrontend('info', '🎵 URL:', url);

  setName(url); // We'll update this when we get the actual filename

  try {
    const ytDlpProcess = spawn(ytDlpPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false, // Only spawn once, no shell wrapping
    });

    let output = '';
    let errorOutput = '';
    let downloadedFile = '';

    ytDlpProcess.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;

      // Parse for actual downloaded filename to show correct path in logs
      const destinationMatch = chunk.match(
        /\[ExtractAudio\] Destination: (.+)/,
      );
      if (destinationMatch) {
        downloadedFile = destinationMatch[1];
        logToFrontend('info', '📁 Saving to:', downloadedFile);
        setName(downloadedFile);
      }

      // Parse progress with multiple patterns for better compatibility
      let progressMatch = chunk.match(/(\d+(?:\.\d+)?)%/); // Look for percentage with optional decimal
      if (!progressMatch) {
        progressMatch = output.match(/(\d+(?:\.\d+)?)%/); // Also check accumulated output
      }

      if (progressMatch) {
        const progress = parseFloat(progressMatch[1]) / 100;
        if (!isNaN(progress) && progress > 0) {
          logToFrontend('info', `📊 Progress: ${Math.floor(progress * 100)}%`);
          sendFeedback(
            t('plugins.downloader.backend.feedback.download-progress', {
              percent: Math.floor(progress * 100),
            }),
            progress,
          );
          increasePlaylistProgress(progress);
        }
      }

      // Detect conversion phase
      if (chunk.includes('[ExtractAudio]') || chunk.includes('Converting')) {
        sendFeedback(t('plugins.downloader.backend.feedback.converting'));
      }
    });

    ytDlpProcess.stderr?.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      ytDlpProcess.on('close', resolve);
    });

    if (exitCode !== 0) {
      throw new Error(
        `yt-dlp failed with exit code ${exitCode}: ${errorOutput}` +
          `\nCommand: ${ytDlpPath} ${args.join(' ')}`,
      );
    }

    sendFeedback(null, -1);

    // Try to determine the final file location more accurately
    let finalFile = downloadedFile;
    if (!finalFile || finalFile === '') {
      // Try to find the file by looking for mp3 files in the directory
      try {
        const fs = await import('fs');
        const files = fs.readdirSync(dir);
        const mp3Files = files.filter((f) => f.endsWith('.mp3'));
        if (mp3Files.length > 0) {
          // Sort by modification time, get the newest
          const fullPaths = mp3Files.map((f) => path.join(dir, f));
          const newest = fullPaths.reduce((a, b) => {
            const aStat = fs.statSync(a);
            const bStat = fs.statSync(b);
            return aStat.mtime > bStat.mtime ? a : b;
          });
          finalFile = newest;
          logToFrontend('info', '🔍 Found downloaded file:', finalFile);
        }
      } catch (error) {
        logToFrontend(
          'warn',
          '⚠️ Could not determine final file location:',
          error,
        );
      }
    }

    if (!finalFile) {
      finalFile = 'Unknown location (check download folder)';
    }

    logToFrontend('info', '✅ Download complete!');
    logToFrontend('info', '📂 File saved:', finalFile);
    sendOsNotification(
      'Download complete!',
      `Downloaded: ${path.basename(finalFile)}`,
    ).catch(() => {});
  } catch (error) {
    logToFrontend('error', '❌ Download failed:', error);
    sendOsNotification('Download failed!', String(error)).catch(() => {});
    throw new Error(`Download failed: ${String(error)}`);
  }
}

export async function downloadPlaylist(givenUrl?: string | URL) {
  logToFrontend('info', '🎵 Starting playlist download...');

  try {
    givenUrl = new URL(givenUrl ?? '');
  } catch {
    givenUrl = new URL(win.webContents.getURL());
  }

  const playlistId =
    getPlaylistID(givenUrl) || getPlaylistID(new URL(playingUrl));

  if (!playlistId) {
    logToFrontend('error', '❌ No playlist ID found');
    sendError(
      new Error(t('plugins.downloader.backend.feedback.playlist-id-not-found')),
    );
    return;
  }

  logToFrontend('info', '🆔 Playlist ID:', playlistId);

  const sendFeedback = (message?: unknown, progress?: number) => {
    sendFeedback_(win, message);
    if (typeof progress === 'number' && !isNaN(progress)) {
      win.setProgressBar(progress);
    }
  };

  console.log(
    t('plugins.downloader.backend.feedback.trying-to-get-playlist-id', {
      playlistId,
    }),
  );
  sendFeedback(t('plugins.downloader.backend.feedback.getting-playlist-info'));

  const dir = getFolder(config.downloadFolder ?? '');
  const playlistUrl = `https://music.youtube.com/playlist?list=${playlistId}`;

  logToFrontend('info', '📁 Download directory:', dir);
  logToFrontend('info', '🔗 Playlist URL:', playlistUrl);

  // Find yt-dlp path using cached and fallback logic
  const ytDlpPath = getYtDlpPath(config.advanced?.ytDlpPath);
  if (!ytDlpPath) {
    const allPaths = [
      config.advanced?.ytDlpPath
        ? `[custom] ${config.advanced.ytDlpPath}`
        : null,
      ...(is.windows()
        ? [
            'C:/yt-dlp.exe',
            path.join(homedir(), 'Downloads', 'yt-dlp.exe'),
            'C:/utils/yt-dlp.exe',
          ]
        : is.linux()
          ? ['/usr/bin/yt-dlp']
          : is.macOS()
            ? ['/usr/local/bin/yt-dlp', '/opt/homebrew/bin/yt-dlp']
            : []),
    ].filter(Boolean);

    logToFrontend(
      'error',
      '❌ yt-dlp not found for playlist. Paths checked:',
      allPaths,
    );
    sendError(
      new Error(
        'yt-dlp executable not found.\nPaths checked:\n' +
          allPaths.join('\n') +
          '\nPlease set the path in the Downloader plugin menu.',
      ),
    );
    return;
  }

  const args = [
    '-x',
    '--audio-format',
    'mp3',
    '--audio-quality',
    '320K', // Higher bitrate
    '--embed-thumbnail', // Embed album art
    '--embed-metadata', // Embed ID3 tags
    '--add-metadata', // Additional metadata
    '-o',
    `${dir}/%(playlist_title)s/%(title)s.%(ext)s`,
    playlistUrl,
  ];

  // Add skip existing flag if enabled
  if (config.skipExisting) {
    args.push('--no-overwrites');
  }

  try {
    logToFrontend('info', '💬 Showing playlist download dialog...');

    const dialogResult = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: [
        t(
          'plugins.downloader.backend.dialog.start-download-playlist.buttons.ok',
        ),
        'Cancel',
      ],
      title: t(
        'plugins.downloader.backend.dialog.start-download-playlist.title',
      ),
      message: t(
        'plugins.downloader.backend.dialog.start-download-playlist.message',
        {
          playlistTitle: playlistId,
        },
      ),
      detail: t(
        'plugins.downloader.backend.dialog.start-download-playlist.detail',
        {
          playlistSize: 'Unknown',
        },
      ),
    });

    // Check if user cancelled
    if (dialogResult.response !== 0) {
      logToFrontend('info', '❌ User cancelled playlist download');
      sendFeedback('Download cancelled', -1);
      return;
    }

    logToFrontend('info', '🚀 Starting yt-dlp process...');
    win.setProgressBar(0.1); // Start with indefinite bar

    logToFrontend(
      'info',
      '⚙️ yt-dlp command:',
      `${ytDlpPath} ${args.join(' ')}`,
    );

    const ytDlpProcess = spawn(ytDlpPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false, // Use shell: false for better stability
    });

    let output = '';
    let errorOutput = '';
    let lastProgressUpdate = 0;

    logToFrontend('info', '📊 yt-dlp process started, PID:', ytDlpProcess.pid);

    ytDlpProcess.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;

      // Log chunks for debugging (but limit the amount)
      if (chunk.trim()) {
        logToFrontend(
          'info',
          '📥 yt-dlp output:',
          chunk.trim().substring(0, 200),
        );
      }

      // Parse progress with multiple patterns for better compatibility
      let progressMatch = chunk.match(/(\d+(?:\.\d+)?)%/);
      if (!progressMatch) {
        progressMatch = output.match(/(\d+(?:\.\d+)?)%/);
      }

      if (progressMatch) {
        const progress = parseFloat(progressMatch[1]) / 100;
        if (
          !isNaN(progress) &&
          progress > 0 &&
          progress !== lastProgressUpdate
        ) {
          lastProgressUpdate = progress;
          logToFrontend(
            'info',
            `📊 Playlist progress: ${Math.floor(progress * 100)}%`,
          );
          sendFeedback(
            `Downloading... ${Math.floor(progress * 100)}%`,
            progress,
          );
        }
      }

      // Detect conversion step
      if (chunk.includes('[ExtractAudio]') || chunk.includes('Converting')) {
        logToFrontend('info', '🔄 Converting audio...');
        sendFeedback('Converting to mp3...');
      }

      // Detect download completion for individual tracks
      if (chunk.includes('[ExtractAudio] Destination:')) {
        const filename = chunk.match(/\[ExtractAudio\] Destination: (.+)/);
        if (filename) {
          logToFrontend(
            'info',
            '✅ Track completed:',
            path.basename(filename[1]),
          );
        }
      }

      // Detect download start for tracks
      if (chunk.includes('[youtube]') || chunk.includes('[download]')) {
        if (chunk.includes('Downloading webpage')) {
          logToFrontend('info', '🌐 Fetching track info...');
        }
      }
    });

    ytDlpProcess.stderr?.on('data', (data: Buffer) => {
      const errorChunk = data.toString();
      errorOutput += errorChunk;
      logToFrontend(
        'warn',
        '⚠️ yt-dlp stderr:',
        errorChunk.trim().substring(0, 200),
      );
    });

    ytDlpProcess.on('error', (error) => {
      logToFrontend('error', '💥 yt-dlp process error:', error);
    });

    const exitCode = await new Promise<number>((resolve) => {
      ytDlpProcess.on('close', (code) => {
        logToFrontend('info', '🏁 yt-dlp process closed with code:', code);
        resolve(code || 0);
      });
    });

    if (exitCode !== 0) {
      logToFrontend('error', '❌ yt-dlp failed with exit code:', exitCode);
      logToFrontend('error', '📄 Error output:', errorOutput);
      throw new Error(
        `yt-dlp failed with exit code ${exitCode}: ${errorOutput}` +
          `\nCommand: ${ytDlpPath} ${args.join(' ')}`,
      );
    }

    logToFrontend('info', '🎉 Playlist download completed successfully!');
    sendFeedback('Download complete!', -1);
    sendOsNotification('Download complete!', `Saved to: ${dir}`).catch(
      () => {},
    );
    logToFrontend('info', '✅ Playlist download complete!', `Saved to: ${dir}`);
    console.info(
      t('plugins.downloader.backend.feedback.done', {
        filePath: dir,
      }),
    );
  } catch (error: unknown) {
    logToFrontend('error', '💥 Playlist download error:', error);
    sendFeedback('Download failed!', -1);
    sendOsNotification('Download failed!', String(error)).catch(() => {});
    sendError(error as Error);
  } finally {
    logToFrontend('info', '🧹 Cleaning up playlist download...');
    win.setProgressBar(-1); // Close progress bar
    setBadge(0); // Close badge counter
    sendFeedback(); // Clear feedback
  }
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
