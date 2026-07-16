import type { BrowserWindow, IpcMain } from 'electron';
// CRITICAL: Use "import type" so nothing Node-only is bundled for the browser
import type { StatsDatabase } from './database';
import type { RemotePlayItem, TakeoutPlay } from './device-history';
import type { SongInfo } from '@/providers/song-info';
import type {
  PlayRecord,
  RankedArtist,
  RankedSong,
  StatsConfig,
  StatsData,
  StatsRange,
} from './types';

// Define channels statically to ensure we can clean them up reliably
const IPC_CHANNELS = {
  GET_STATS: 'music-stats:get-stats',
  PLAY_SONG: 'music-stats:play-song',
  EXPORT: 'music-stats:export-data',
  IMPORT: 'music-stats:import-data',
  SAVE_FILE: 'music-stats:save-export-file',
  LOAD_FILE: 'music-stats:load-import-file',
  HISTORY_SYNC: 'music-stats:history-sync',
  TAKEOUT_IMPORT: 'music-stats:import-takeout',
  DRIVE_CONNECT: 'music-stats:drive-connect',
  DRIVE_SYNC: 'music-stats:drive-sync',
  DRIVE_STATUS: 'music-stats:drive-status',
  DRIVE_DISCONNECT: 'music-stats:drive-disconnect',
};

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE_FILE_NAME = 'music-stats.json';

// Plays shorter than this are noise (accidental clicks) and aren't stored.
const MIN_RECORD_SECONDS = 5;
// A stored play only counts as a "play" once it passes this (or completes).
const QUALIFIED_PLAY_SECONDS = 30;
// Reaching this fraction of the song counts as completing it.
const COMPLETED_FRACTION = 0.95;
// Leaving a song before this fraction counts as skipping it.
const SKIP_FRACTION = 0.65;
// Time deltas larger than this (seek, sleep/resume) are not "listening".
const MAX_TICK_SECONDS = 3;

interface ActivePlayback {
  videoId: string;
  title: string;
  artist: string;
  artistId: string;
  artistUrl?: string;
  album?: string;
  imageSrc?: string;
  duration: number;
  mediaType: string;
  startTime: number;
  listenedSeconds: number;
  lastElapsed: number;
}

interface BackendCtx {
  getConfig: () => Promise<StatsConfig> | StatsConfig;
  setConfig: (
    conf: Partial<Omit<StatsConfig, 'enabled'>>,
  ) => Promise<void> | void;
  window: BrowserWindow;
}

/** Local-timezone YYYY-MM-DD (toISOString would bucket by UTC). */
function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local-timezone YYYY-MM. */
function toLocalMonthKey(date: Date): string {
  return toLocalDateKey(date).slice(0, 7);
}

/** Noon (local) of a YYYY-MM-DD key — neutral time for day-only records. */
function noonOfDayKey(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isVideoId = (id: string) => /^[a-zA-Z0-9_-]{11}$/.test(id);

export class StatsBackend {
  private db: StatsDatabase | null = null;
  private syncTimer?: NodeJS.Timeout;
  private isSyncing = false;
  private historyTimer?: NodeJS.Timeout;
  private historyKickoffTimer?: NodeJS.Timeout;
  private isHistorySyncing = false;
  // False until the first history poll of this session has run. Items found
  // on the first poll could be hours old, so they get day-level timestamps;
  // items appearing between polls get "now" and count in hourly stats.
  private historySeeded = false;
  // When the previous poll ran — the listening-time budget for live items.
  private lastHistoryPollTime = 0;
  private trackingActive = false;
  private current: ActivePlayback | null = null;
  private statsCache = new Map<
    StatsRange,
    { revision: number; stats: StatsData }
  >();
  private pendingArtistFetches = new Set<string>();

  private getConfig: BackendCtx['getConfig'];
  private setConfig: BackendCtx['setConfig'];
  private window: BrowserWindow;
  private sessionAccessToken: string | null = null;
  private sessionAccessTokenExpiry = 0;

  constructor(context: BackendCtx) {
    this.getConfig = context.getConfig;
    this.setConfig = context.setConfig;
    this.window = context.window;
  }

  async initialize() {
    // Dynamically import Node.js modules here so browser doesn't crash
    const { app, ipcMain, dialog, net, shell } = await import('electron');
    const fs = (await import('node:fs/promises')).default;
    const path = (await import('node:path')).default;
    const crypto = (await import('node:crypto')).default;
    const { StatsDatabase } = await import('./database');
    const { registerCallback, SongInfoEvent } = await import(
      '@/providers/song-info'
    );

    const dbPath = path.join(app.getPath('userData'), 'music-stats.json');
    this.db = new StatsDatabase(dbPath);
    await this.db.initialize();

    this.setupIpcHandlers(ipcMain, dialog, fs, net, shell, crypto);

    // Track playback through the app's song-info provider: exact video IDs,
    // real durations, pause/seek awareness — no DOM scraping, no polling.
    this.trackingActive = true;
    registerCallback((songInfo, event) => {
      if (!this.trackingActive) return;
      try {
        if (event === SongInfoEvent.VideoSrcChanged) {
          this.onSongChanged(songInfo, net);
        } else if (event === SongInfoEvent.PlayOrPaused) {
          this.onPlayOrPaused(songInfo);
        } else if (event === SongInfoEvent.TimeChanged) {
          this.onTimeChanged(songInfo, net);
        }
      } catch (error) {
        console.error('[Music Stats] Tracking error:', error);
      }
    });

    const config = await this.getConfig();
    if (config.cloudSyncEnabled) {
      this.startSyncTimer();
    }
    if (config.remoteSyncEnabled) {
      this.startHistoryTimer();
      // First poll shortly after startup, once the session is warm.
      this.historyKickoffTimer = setTimeout(() => {
        this.syncDeviceHistory().catch(console.error);
      }, 20 * 1000);
    }
  }

  // ─── Playback tracking ────────────────────────────────────────────────

  private onSongChanged(songInfo: SongInfo, net: unknown) {
    this.finalizeCurrent();
    this.startPlayback(songInfo, net);
  }

  private startPlayback(songInfo: SongInfo, net: unknown) {
    if (!songInfo.videoId || !(songInfo.songDuration > 0)) return;

    const artistId =
      songInfo.artistUrl?.match(/channel\/(UC[\w-]+)/)?.[1] ||
      songInfo.artist ||
      'unknown';

    this.current = {
      videoId: songInfo.videoId,
      title: songInfo.title,
      artist: songInfo.artist || 'Unknown Artist',
      artistId,
      artistUrl: songInfo.artistUrl,
      album: songInfo.album ?? undefined,
      imageSrc: songInfo.imageSrc ?? undefined,
      duration: songInfo.songDuration,
      mediaType: songInfo.mediaType,
      startTime: Date.now(),
      listenedSeconds: 0,
      lastElapsed: songInfo.elapsedSeconds ?? 0,
    };

    this.ensureArtistImage(artistId, songInfo.artistUrl, net).catch(() => {});
  }

  private onPlayOrPaused(songInfo: SongInfo) {
    if (!this.current || this.current.videoId !== songInfo.videoId) return;
    if (typeof songInfo.elapsedSeconds === 'number') {
      this.current.lastElapsed = songInfo.elapsedSeconds;
    }
    // Paused at (or seeked to) the very end: the play is over — record it
    // now so it isn't lost if the queue simply stops here.
    if (
      songInfo.isPaused &&
      this.current.lastElapsed >= this.current.duration * COMPLETED_FRACTION
    ) {
      this.finalizeCurrent();
    }
  }

  private onTimeChanged(songInfo: SongInfo, net: unknown) {
    const elapsed = songInfo.elapsedSeconds;
    if (typeof elapsed !== 'number' || !Number.isFinite(elapsed)) return;

    if (!this.current || this.current.videoId !== songInfo.videoId) {
      // Song started without a VideoSrcChanged we saw (e.g. replayed after
      // being finalized at its end, or plugin enabled mid-song).
      this.finalizeCurrent();
      this.startPlayback(songInfo, net);
      return;
    }

    const delta = elapsed - this.current.lastElapsed;
    if (delta > 0 && delta <= MAX_TICK_SECONDS) {
      // Normal ticking playback. Larger jumps are seeks or a machine waking
      // from sleep — position moved, but nobody listened to that span.
      this.current.listenedSeconds += delta;
    } else if (
      delta < 0 &&
      elapsed <= MAX_TICK_SECONDS &&
      this.current.lastElapsed >= this.current.duration * COMPLETED_FRACTION
    ) {
      // Song looped back to the start: count the finished pass and track
      // the new one as its own play.
      this.finalizeCurrent();
      this.startPlayback(songInfo, net);
      return;
    }
    this.current.lastElapsed = elapsed;
  }

  private finalizeCurrent() {
    const playback = this.current;
    this.current = null;
    if (!playback || !this.db) return;
    if (playback.listenedSeconds < MIN_RECORD_SECONDS) return;

    const completed =
      playback.lastElapsed >= playback.duration * COMPLETED_FRACTION;
    const skipped =
      !completed && playback.lastElapsed < playback.duration * SKIP_FRACTION;

    const record: PlayRecord = {
      songId: playback.videoId,
      songTitle: playback.title,
      artistId: playback.artistId,
      artistName: playback.artist,
      artistImageUrl: this.db.getArtistImage(playback.artistId),
      albumName: playback.album,
      thumbnailUrl:
        playback.imageSrc ||
        (isVideoId(playback.videoId)
          ? `https://i.ytimg.com/vi/${playback.videoId}/hqdefault.jpg`
          : undefined),
      timestamp: playback.startTime,
      durationListened: Math.round(playback.listenedSeconds),
      totalDuration: Math.round(playback.duration),
      skipped,
      completed,
      mediaType: playback.mediaType,
      source: 'local',
    };

    // The streak is derived from the records themselves in computeStats,
    // so plays synced from other devices count toward it too.
    this.db.addPlayRecord(record).catch(console.error);
  }

  // ─── IPC ──────────────────────────────────────────────────────────────

  private setupIpcHandlers(
    ipcMain: IpcMain,
    dialog: Electron.Dialog,
    fs: typeof import('node:fs/promises'),
    net: Electron.Net,
    shell: Electron.Shell,
    crypto: typeof import('node:crypto'),
  ) {
    // Force remove handlers before adding them to prevent "Second handler"
    // errors when the plugin is toggled without an app restart.
    for (const channel of Object.values(IPC_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }

    ipcMain.handle(IPC_CHANNELS.GET_STATS, async (_, range?: StatsRange) => {
      if (!this.db) return null;
      return await this.computeStats(range ?? 'all');
    });

    ipcMain.handle(IPC_CHANNELS.PLAY_SONG, (_, videoId: string) => {
      if (typeof videoId !== 'string' || !isVideoId(videoId)) return false;
      // The queue handlers live in the app's renderer and listen for
      // messages from main, so relay through the window.
      this.window.webContents.send(
        'peard:add-to-queue',
        videoId,
        'INSERT_AFTER_CURRENT_VIDEO',
      );
      this.window.webContents.send('peard:next-video');
      return true;
    });

    ipcMain.handle(IPC_CHANNELS.EXPORT, async () => {
      if (!this.db) return null;
      return await this.db.exportData();
    });

    ipcMain.handle(IPC_CHANNELS.IMPORT, async (_, jsonData: string) => {
      if (!this.db) return null;
      const result = await this.db.importData(jsonData);
      return result;
    });

    ipcMain.handle(IPC_CHANNELS.SAVE_FILE, async (_, data: string) => {
      const result = await dialog.showSaveDialog({
        title: 'Export Music Stats',
        defaultPath: `music-stats-${toLocalDateKey(new Date())}.json`,
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      });

      if (!result.canceled && result.filePath) {
        await fs.writeFile(result.filePath, data, 'utf-8');
        return true;
      }
      return false;
    });

    ipcMain.handle(IPC_CHANNELS.LOAD_FILE, async () => {
      const result = await dialog.showOpenDialog({
        title: 'Import Music Stats',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        properties: ['openFile'],
      });

      if (!result.canceled && result.filePaths.length > 0) {
        return await fs.readFile(result.filePaths[0], 'utf-8');
      }
      return null;
    });

    ipcMain.handle(IPC_CHANNELS.HISTORY_SYNC, async () => {
      return await this.syncDeviceHistory(true);
    });

    ipcMain.handle(IPC_CHANNELS.TAKEOUT_IMPORT, async (_, jsonText: string) => {
      return await this.importTakeout(jsonText);
    });

    ipcMain.handle(IPC_CHANNELS.DRIVE_STATUS, async () => {
      const config = await this.getConfig();
      return {
        enabled: !!config.cloudSyncEnabled,
        connected: !!config.cloudSyncRefreshToken,
        lastSyncTime: config.cloudSyncLastSyncTime || null,
        lastError: config.cloudSyncLastError || null,
      };
    });

    ipcMain.handle(IPC_CHANNELS.DRIVE_CONNECT, async () => {
      const config = await this.getConfig();
      return await this.startDriveAuth(config, dialog, shell, net);
    });

    ipcMain.handle(IPC_CHANNELS.DRIVE_SYNC, async () => {
      const config = await this.getConfig();
      return await this.syncDriveNow(config, net, crypto);
    });

    ipcMain.handle(IPC_CHANNELS.DRIVE_DISCONNECT, async () => {
      await this.setConfig({
        cloudSyncEnabled: false,
        cloudSyncRefreshToken: '',
        cloudSyncAccessToken: '',
        cloudSyncAccessTokenExpiry: 0,
        cloudSyncFileId: '',
        cloudSyncLastHash: '',
        cloudSyncLastSyncTime: '',
        cloudSyncLastError: '',
      });
      this.sessionAccessToken = null;
      this.stopSyncTimer();
      return { ok: true, message: 'Google Drive disconnected.' };
    });
  }

  // ─── Stats ────────────────────────────────────────────────────────────

  private rangeStart(range: StatsRange, now: Date): number | undefined {
    switch (range) {
      case 'week':
        return now.getTime() - 7 * 86400000;
      case 'month':
        return now.getTime() - 30 * 86400000;
      case 'year':
        return new Date(now.getFullYear(), 0, 1).getTime();
      case 'all':
        return undefined;
    }
  }

  private async computeStats(range: StatsRange): Promise<StatsData> {
    if (!this.db) throw new Error('DB not initialized');

    const revision = this.db.getRevision();
    const cached = this.statsCache.get(range);
    if (cached && cached.revision === revision) return cached.stats;

    const now = new Date();
    const allRecords = await this.db.getPlayRecords(); // chronological
    const start = this.rangeStart(range, now);
    const records =
      start === undefined
        ? allRecords
        : allRecords.filter((r) => r.timestamp >= start);

    const isQualified = (r: PlayRecord) =>
      r.completed || r.durationListened >= QUALIFIED_PLAY_SECONDS;

    const songMap = new Map<
      string,
      {
        title: string;
        artist: string;
        plays: number;
        minutes: number;
        imageUrl?: string;
      }
    >();
    const artistMap = new Map<
      string,
      { name: string; plays: number; minutes: number; imageUrl?: string }
    >();
    const skipMap = new Map<
      string,
      {
        title: string;
        artist: string;
        skips: number;
        plays: number;
        imageUrl?: string;
      }
    >();
    const listeningClock = new Array<number>(24).fill(0);
    const dailyMap = new Map<string, number>();
    const monthlyArtists = new Map<
      string,
      Map<string, { name: string; minutes: number }>
    >();

    let totalSeconds = 0;
    let totalPlays = 0;
    let totalSkips = 0;
    let assessedRecords = 0;

    for (const record of records) {
      const qualified = isQualified(record);
      const minutes = record.durationListened / 60;
      const when = new Date(record.timestamp);
      totalSeconds += record.durationListened;
      if (qualified) totalPlays++;
      if (record.skipped) totalSkips++;
      // Skip inference needs real timing (local plays, Takeout gaps,
      // live-window syncs) — day-level records can't be judged, so they
      // don't dilute the skip rate.
      if (!record.approximateTime) assessedRecords++;

      const song = songMap.get(record.songId) ?? {
        title: record.songTitle,
        artist: record.artistName,
        plays: 0,
        minutes: 0,
        imageUrl: undefined as string | undefined,
      };
      if (qualified) song.plays++;
      song.minutes += minutes;
      song.imageUrl ||= record.thumbnailUrl;
      songMap.set(record.songId, song);

      const artist = artistMap.get(record.artistId) ?? {
        name: record.artistName,
        plays: 0,
        minutes: 0,
        imageUrl: undefined as string | undefined,
      };
      if (qualified) artist.plays++;
      artist.minutes += minutes;
      artist.imageUrl ||=
        this.db.getArtistImage(record.artistId) || record.artistImageUrl;
      artistMap.set(record.artistId, artist);

      if (record.skipped || qualified) {
        const skip = skipMap.get(record.songId) ?? {
          title: record.songTitle,
          artist: record.artistName,
          skips: 0,
          plays: 0,
          imageUrl: undefined as string | undefined,
        };
        if (record.skipped) skip.skips++;
        if (qualified) skip.plays++;
        skip.imageUrl ||= record.thumbnailUrl;
        skipMap.set(record.songId, skip);
      }

      // Day-only records (synced history) have no real time of day.
      if (!record.approximateTime) {
        listeningClock[when.getHours()] += minutes;
      }

      const dayKey = toLocalDateKey(when);
      dailyMap.set(dayKey, (dailyMap.get(dayKey) ?? 0) + minutes);

      const monthKey = toLocalMonthKey(when);
      let monthMap = monthlyArtists.get(monthKey);
      if (!monthMap) {
        monthMap = new Map();
        monthlyArtists.set(monthKey, monthMap);
      }
      const monthArtist = monthMap.get(record.artistId) ?? {
        name: record.artistName,
        minutes: 0,
      };
      monthArtist.minutes += minutes;
      monthMap.set(record.artistId, monthArtist);
    }

    const coverUrl = (id: string, imageUrl?: string) =>
      imageUrl ||
      (isVideoId(id)
        ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
        : undefined);

    const topSongs: RankedSong[] = [...songMap.entries()]
      .sort((a, b) => b[1].plays - a[1].plays || b[1].minutes - a[1].minutes)
      .slice(0, 5)
      .map(([id, data]) => ({
        id,
        title: data.title,
        artist: data.artist,
        plays: data.plays,
        minutes: Math.round(data.minutes),
        imageUrl: coverUrl(id, data.imageUrl),
      }));

    const topArtists: RankedArtist[] = [...artistMap.entries()]
      .sort((a, b) => b[1].minutes - a[1].minutes)
      .slice(0, 5)
      .map(([id, data]) => ({
        id,
        name: data.name,
        plays: data.plays,
        minutes: Math.round(data.minutes),
        imageUrl: data.imageUrl,
      }));

    let peakListeningDay: StatsData['peakListeningDay'];
    for (const [date, minutes] of dailyMap) {
      if (!peakListeningDay || minutes > peakListeningDay.minutes) {
        peakListeningDay = { date, minutes: Math.round(minutes) };
      }
    }

    const monthlyObsessions = [...monthlyArtists.entries()]
      .map(([yearMonth, artists]) => {
        let top: { name: string; minutes: number } | undefined;
        for (const artist of artists.values()) {
          if (!top || artist.minutes > top.minutes) top = artist;
        }
        return {
          yearMonth,
          artist: top?.name ?? 'Unknown',
          minutes: Math.round(top?.minutes ?? 0),
        };
      })
      .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

    const skipStats = [...skipMap.entries()]
      .filter(([, data]) => data.skips > 0)
      .sort((a, b) => b[1].skips - a[1].skips)
      .slice(0, 10)
      .map(([songId, data]) => ({ songId, ...data }));

    // Trend: minutes per day over the visible window (7 for week, else 30).
    const trendDays = range === 'week' ? 7 : 30;
    const dailyTrend: StatsData['dailyTrend'] = [];
    for (let i = trendDays - 1; i >= 0; i--) {
      const day = new Date(now.getTime() - i * 86400000);
      const key = toLocalDateKey(day);
      dailyTrend.push({
        date: key,
        minutes: Math.round(dailyMap.get(key) ?? 0),
      });
    }

    // "Firsts" are milestones — always computed from the full history.
    const firstOf = (predicate: (r: PlayRecord) => boolean) => {
      const found = allRecords.find(predicate);
      return found
        ? {
            title: found.songTitle,
            artist: found.artistName,
            date: toLocalDateKey(new Date(found.timestamp)),
          }
        : undefined;
    };
    const yearPrefix = `${now.getFullYear()}`;
    const monthPrefix = toLocalMonthKey(now);

    // Streak derived from the records themselves (so synced device plays
    // count): consecutive listening days ending today or yesterday.
    const listenDays = new Set<string>();
    for (const record of allRecords) {
      listenDays.add(toLocalDateKey(new Date(record.timestamp)));
    }
    let currentStreak = 0;
    let cursor = new Date(now);
    if (!listenDays.has(toLocalDateKey(cursor))) {
      cursor = new Date(cursor.getTime() - 86400000);
    }
    while (listenDays.has(toLocalDateKey(cursor))) {
      currentStreak++;
      cursor = new Date(cursor.getTime() - 86400000);
    }

    const stats: StatsData = {
      range,
      totalMinutes: Math.round(totalSeconds / 60),
      totalPlays,
      uniqueSongs: songMap.size,
      uniqueArtists: artistMap.size,
      topSongs,
      topArtists,
      anthem: topSongs[0]
        ? {
            id: topSongs[0].id,
            title: topSongs[0].title,
            artist: topSongs[0].artist,
            plays: topSongs[0].plays,
          }
        : undefined,
      peakListeningDay,
      listeningClock: listeningClock.map((m) => Math.round(m)),
      dailyTrend,
      currentStreak,
      firstSongEver: firstOf(() => true),
      firstSongThisYear: firstOf((r) =>
        toLocalDateKey(new Date(r.timestamp)).startsWith(yearPrefix),
      ),
      firstSongThisMonth: firstOf((r) =>
        toLocalDateKey(new Date(r.timestamp)).startsWith(monthPrefix),
      ),
      monthlyObsessions,
      skipStats,
      skipRate:
        assessedRecords > 0
          ? Math.min(100, Math.round((totalSkips / assessedRecords) * 100))
          : 0,
    };

    this.statsCache.set(range, { revision, stats });
    return stats;
  }

  // ─── Artist images ────────────────────────────────────────────────────

  private async ensureArtistImage(
    artistId: string,
    artistUrl: string | undefined,
    net: unknown,
  ) {
    if (!this.db || this.db.getArtistImage(artistId)) return;
    if (this.pendingArtistFetches.has(artistId)) return;
    this.pendingArtistFetches.add(artistId);

    try {
      const urls: string[] = [];
      if (artistUrl) urls.push(artistUrl);
      if (artistId.startsWith('UC')) {
        urls.push(`https://music.youtube.com/channel/${artistId}`);
      }

      const fetcher = net as { fetch: typeof fetch };
      for (const url of urls) {
        try {
          const response = await fetcher.fetch(url, { method: 'GET' });
          if (!response.ok) continue;
          const imageUrl = extractArtistImage(await response.text());
          if (imageUrl) {
            this.db.setArtistImage(artistId, imageUrl);
            return;
          }
        } catch {
          // Try the next candidate URL.
        }
      }
    } finally {
      this.pendingArtistFetches.delete(artistId);
    }
  }

  // ─── Plays from other devices (account history) ──────────────────────
  // YT Music history is account-wide, so plays from the phone app show up
  // in FEmusic_history. We poll it and merge anything we didn't track.

  private startHistoryTimer() {
    if (this.historyTimer) return;
    this.historyTimer = setInterval(
      () => {
        this.syncDeviceHistory().catch(console.error);
      },
      15 * 60 * 1000,
    );
  }

  private stopHistoryTimer() {
    if (this.historyTimer) {
      clearInterval(this.historyTimer);
      this.historyTimer = undefined;
    }
    if (this.historyKickoffTimer) {
      clearTimeout(this.historyKickoffTimer);
      this.historyKickoffTimer = undefined;
    }
  }

  /** `songId|localDay` keys for records at/after `since` — the dedupe set. */
  private async songDayKeys(since?: number): Promise<Set<string>> {
    const records = await this.db.getPlayRecords(since);
    return new Set(
      records.map(
        (r) => `${r.songId}|${toLocalDateKey(new Date(r.timestamp))}`,
      ),
    );
  }

  private async syncDeviceHistory(
    manual = false,
  ): Promise<{ ok: boolean; message: string }> {
    if (this.isHistorySyncing) {
      return { ok: false, message: 'Device sync already in progress.' };
    }
    if (!this.db) return { ok: false, message: 'Database not ready.' };
    const config = await this.getConfig();
    if (!config.remoteSyncEnabled && !manual) {
      return { ok: false, message: 'Device sync is disabled.' };
    }

    this.isHistorySyncing = true;
    try {
      const { createInnertube, fetchHistory, resolveGroupDayKey } =
        await import('./device-history');
      const yt = await createInnertube(this.window);
      const groups = await fetchHistory(yt);

      const now = new Date();
      const todayKey = toLocalDateKey(now);
      // Anti-farming budget: songs that appeared since the previous poll
      // can't add up to more listening time than actually passed.
      const windowSeconds =
        this.historySeeded && this.lastHistoryPollTime > 0
          ? Math.max(60, (now.getTime() - this.lastHistoryPollTime) / 1000)
          : 0;
      // The feed only resolves about a week back; dedupe over a bit more.
      const seen = await this.songDayKeys(now.getTime() - 9 * 86400000);
      const newRecords: PlayRecord[] = [];
      const liveItems: Array<{ item: RemotePlayItem; duration: number }> = [];

      const toRecord = (
        item: RemotePlayItem,
        duration: number,
        listened: number,
        live: boolean,
        dayKey: string,
      ): PlayRecord => {
        const completed = listened >= duration * COMPLETED_FRACTION;
        return {
          songId: item.videoId,
          songTitle: item.title,
          artistId: item.artistId,
          artistName: item.artist,
          artistImageUrl: this.db?.getArtistImage(item.artistId),
          albumName: item.album,
          thumbnailUrl:
            item.thumbnailUrl ||
            `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
          timestamp: live ? Date.now() : noonOfDayKey(dayKey),
          durationListened: Math.round(listened),
          totalDuration: duration,
          skipped: !completed && listened < duration * SKIP_FRACTION,
          completed,
          source: 'history',
          approximateTime: !live,
        };
      };

      for (const group of groups) {
        const dayKey = resolveGroupDayKey(group.groupTitle, now);
        if (!dayKey) continue;

        for (const item of group.items) {
          const key = `${item.videoId}|${dayKey}`;
          if (seen.has(key)) continue;
          // The song playing right now becomes a local record when it
          // finishes — don't import its history echo.
          if (dayKey === todayKey && this.current?.videoId === item.videoId) {
            continue;
          }
          seen.add(key);

          const duration =
            item.durationSeconds > 0 ? item.durationSeconds : 210;

          // Between-poll appearance in "Today" = it was just played; the
          // timestamp is real, and the window budget below decides how much
          // of it was plausibly heard. Anything found on the first poll (or
          // on older days) only has a known day and counts as one full play.
          if (this.historySeeded && dayKey === todayKey && windowSeconds > 0) {
            liveItems.push({ item, duration });
          } else {
            newRecords.push(toRecord(item, duration, duration, false, dayKey));
          }
        }
      }

      // Prorate live items so their combined listening time fits the poll
      // window, then apply the same 30s/65% play-vs-skip rules as PC plays.
      // Skipping through 40 songs on the phone yields skips, not 40 plays.
      const liveTotal = liveItems.reduce((sum, e) => sum + e.duration, 0);
      const scale = liveTotal > windowSeconds ? windowSeconds / liveTotal : 1;
      for (const { item, duration } of liveItems) {
        const listened = duration * scale;
        if (listened < MIN_RECORD_SECONDS) continue;
        newRecords.push(toRecord(item, duration, listened, true, todayKey));
      }

      await this.db.addPlayRecords(newRecords);
      this.historySeeded = true;
      this.lastHistoryPollTime = now.getTime();
      await this.setConfig({
        remoteSyncLastTime: new Date().toISOString(),
        remoteSyncLastError: '',
      });
      return {
        ok: true,
        message:
          newRecords.length > 0
            ? `Added ${newRecords.length} play${newRecords.length === 1 ? '' : 's'} from other devices.`
            : 'Plays from other devices are up to date.',
      };
    } catch (error) {
      const message = (error as Error)?.message || 'Unknown error';
      await this.setConfig({ remoteSyncLastError: message });
      return {
        ok: false,
        message: `Device sync failed — are you signed in? (${message})`,
      };
    } finally {
      this.isHistorySyncing = false;
    }
  }

  /**
   * Google Takeout watch-history.json import: exact timestamps for every
   * play (phone included), so these count in the hourly clock. Durations
   * come from songs we already know, else a capped Innertube lookup.
   */
  private async importTakeout(
    jsonText: string,
  ): Promise<{ ok: boolean; message: string }> {
    if (!this.db) return { ok: false, message: 'Database not ready.' };

    try {
      const { createInnertube, parseTakeout } = await import(
        './device-history'
      );
      const plays = parseTakeout(jsonText);
      if (!plays.length) {
        return {
          ok: false,
          message: 'No YouTube Music plays found in this file.',
        };
      }

      const seen = await this.songDayKeys();
      const knownDurations = new Map<string, number>();
      for (const record of await this.db.getPlayRecords()) {
        if (record.totalDuration > 0) {
          knownDurations.set(record.songId, record.totalDuration);
        }
      }

      // Anti-farming: you can't have heard more of a song than the time
      // until the next play started. Gaps are measured on the full timeline
      // (including plays that dedupe away) so sessions stay intact.
      plays.sort((a, b) => a.timestamp - b.timestamp);
      const fresh: Array<{ play: TakeoutPlay; gapSeconds: number }> = [];
      for (let i = 0; i < plays.length; i++) {
        const play = plays[i];
        const key = `${play.videoId}|${toLocalDateKey(new Date(play.timestamp))}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fresh.push({
          play,
          // Session ends and pauses produce huge gaps — the duration cap
          // below turns those into a full play, never more.
          gapSeconds:
            i < plays.length - 1
              ? (plays[i + 1].timestamp - play.timestamp) / 1000
              : Number.POSITIVE_INFINITY,
        });
      }
      if (!fresh.length) {
        return { ok: true, message: 'All plays in this file already exist.' };
      }

      // Look up durations for songs we've never seen, politely rate-limited
      // and capped so huge exports can't turn into request storms.
      const unknownIds = [...new Set(fresh.map((f) => f.play.videoId))].filter(
        (id) => !knownDurations.has(id),
      );
      const LOOKUP_CAP = 500;
      const toLookup = unknownIds.slice(0, LOOKUP_CAP);

      if (toLookup.length > 0) {
        this.notifyRenderer(
          `Looking up ${toLookup.length} song lengths — this can take a few minutes…`,
        );
        try {
          const yt = await createInnertube(this.window);
          for (let i = 0; i < toLookup.length; i++) {
            try {
              const info = await yt.getBasicInfo(toLookup[i]);
              const duration = info.basic_info?.duration;
              if (duration && duration > 0) {
                knownDurations.set(toLookup[i], duration);
              }
            } catch {
              // Song deleted/region-locked — falls back to the average.
            }
            if (i > 0 && i % 100 === 0) {
              this.notifyRenderer(
                `Looking up song lengths… ${i}/${toLookup.length}`,
              );
            }
            await sleep(120);
          }
        } catch {
          // No session — every unknown song falls back to the average.
        }
      }

      const FALLBACK_DURATION = 210; // ~3.5 min, typical song length
      const newRecords: PlayRecord[] = [];
      let skipCount = 0;
      for (const { play, gapSeconds } of fresh) {
        const duration = knownDurations.get(play.videoId) ?? FALLBACK_DURATION;
        // Same 30s/65% play-vs-skip rules as PC plays, applied to how long
        // the song can actually have run before the next one started.
        const listened = Math.min(duration, gapSeconds);
        if (listened < MIN_RECORD_SECONDS) continue;
        const completed = listened >= duration * COMPLETED_FRACTION;
        const skipped = !completed && listened < duration * SKIP_FRACTION;
        if (skipped) skipCount++;

        newRecords.push({
          songId: play.videoId,
          songTitle: play.title,
          artistId: play.artistId || play.artist,
          artistName: play.artist,
          artistImageUrl: this.db.getArtistImage(play.artistId || play.artist),
          thumbnailUrl: `https://i.ytimg.com/vi/${play.videoId}/hqdefault.jpg`,
          timestamp: play.timestamp,
          durationListened: Math.round(listened),
          totalDuration: duration,
          skipped,
          completed,
          source: 'takeout',
          approximateTime: false,
        });
      }

      await this.db.addPlayRecords(newRecords);
      return {
        ok: true,
        message: `Imported ${newRecords.length} play${newRecords.length === 1 ? '' : 's'} from Takeout${skipCount > 0 ? ` (${skipCount} counted as skips)` : ''}.`,
      };
    } catch (error) {
      return {
        ok: false,
        message:
          (error as Error)?.message ||
          'Takeout import failed — export your history as JSON and try again.',
      };
    }
  }

  private notifyRenderer(message: string) {
    try {
      this.window.webContents.send('music-stats:notify', message);
    } catch {
      // Window gone — nothing to notify.
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  async onConfigChange(newConfig: StatsConfig) {
    if (newConfig.cloudSyncEnabled) {
      this.startSyncTimer();
    } else {
      this.stopSyncTimer();
    }
    if (newConfig.remoteSyncEnabled) {
      const firstEnable = !this.historyTimer;
      this.startHistoryTimer();
      if (firstEnable) {
        // Kick off a sync right away when the user turns it on.
        this.syncDeviceHistory().catch(console.error);
      }
    } else {
      this.stopHistoryTimer();
    }
  }

  async cleanup() {
    this.trackingActive = false;
    // Don't lose the song that's playing right now.
    this.finalizeCurrent();
    this.stopSyncTimer();
    this.stopHistoryTimer();

    try {
      const { ipcMain } = await import('electron');
      for (const channel of Object.values(IPC_CHANNELS)) {
        ipcMain.removeHandler(channel);
      }
    } catch {
      // Electron unavailable during shutdown — handlers die with the app.
    }

    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  // ─── Google Drive sync ────────────────────────────────────────────────

  private startSyncTimer() {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(
      () => {
        Promise.resolve(this.getConfig())
          .then((config) => this.syncDriveNow(config, null, null))
          .catch(console.error);
      },
      10 * 60 * 1000,
    );
  }

  private stopSyncTimer() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
  }

  /**
   * Sync strategy: pull the remote file, merge it additively into the local
   * database, and push the merged result if it differs from the remote.
   * A union of play records is always correct (plays are immutable events),
   * so no machine can ever overwrite another machine's history.
   */
  private async syncDriveNow(
    config: StatsConfig,
    net: Electron.Net | null,
    crypto: typeof import('node:crypto') | null,
  ) {
    if (this.isSyncing)
      return { ok: false, message: 'Sync already in progress.' };
    if (!this.db) return { ok: false, message: 'Database not ready.' };
    if (!config.cloudSyncEnabled)
      return { ok: false, message: 'Cloud sync is disabled.' };
    if (!config.cloudSyncClientId || !config.cloudSyncRefreshToken) {
      return { ok: false, message: 'Connect Google Drive first.' };
    }

    this.isSyncing = true;
    try {
      if (!net || !crypto) {
        net = (await import('electron')).net;
        crypto = (await import('node:crypto')).default;
      }

      const accessToken = await this.ensureAccessToken(config, net);

      let fileId = config.cloudSyncFileId || '';
      if (!fileId) {
        const found = await this.findDriveFile(accessToken, net);
        fileId = found?.id || '';
        if (fileId) await this.setConfig({ cloudSyncFileId: fileId });
      }

      if (!fileId) {
        const created = await this.createDriveFile(
          accessToken,
          net,
          await this.db.exportData(),
        );
        await this.setConfig({
          cloudSyncFileId: created.id,
          cloudSyncLastSyncTime: new Date().toISOString(),
          cloudSyncLastHash: hashString(this.db.contentFingerprint(), crypto),
          cloudSyncLastError: '',
        });
        return { ok: true, message: 'Cloud sync initialized.' };
      }

      const remoteJson = await this.downloadDriveFile(accessToken, net, fileId);
      let pulled = 0;
      if (remoteJson) {
        try {
          pulled = (await this.db.importData(remoteJson)).added;
        } catch {
          // Remote file unreadable — it will be replaced by the upload below.
        }
      }

      const mergedFingerprint = hashString(
        this.db.contentFingerprint(),
        crypto,
      );
      const remoteFingerprint = remoteJson
        ? hashString(fingerprintOfExport(remoteJson), crypto)
        : '';

      if (mergedFingerprint !== remoteFingerprint) {
        await this.uploadDriveFile(
          accessToken,
          net,
          fileId,
          await this.db.exportData(),
        );
      }

      await this.setConfig({
        cloudSyncLastSyncTime: new Date().toISOString(),
        cloudSyncLastHash: mergedFingerprint,
        cloudSyncLastError: '',
      });
      return {
        ok: true,
        message:
          pulled > 0
            ? `Cloud sync merged ${pulled} plays.`
            : 'Cloud sync up to date.',
      };
    } catch (error) {
      const message = (error as Error)?.message || 'Unknown sync error';
      await this.setConfig({ cloudSyncLastError: message });
      return { ok: false, message: `Cloud sync failed: ${message}` };
    } finally {
      this.isSyncing = false;
    }
  }

  private async ensureAccessToken(config: StatsConfig, net: Electron.Net) {
    const now = Date.now();
    if (this.sessionAccessToken && this.sessionAccessTokenExpiry > now) {
      return this.sessionAccessToken;
    }

    const refreshToken = await unprotectSecret(
      config.cloudSyncRefreshToken || '',
    );
    if (!config.cloudSyncClientId || !refreshToken) {
      throw new Error('Missing refresh token. Reconnect Google Drive.');
    }

    const response = await net.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.cloudSyncClientId,
        client_secret: config.cloudSyncClientSecret || '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await safeReadResponse(response);
      throw new Error(
        `Failed to refresh Google token. ${errorText || ''}`.trim(),
      );
    }

    const json = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) throw new Error('Missing access token.');

    this.sessionAccessToken = json.access_token;
    this.sessionAccessTokenExpiry =
      Date.now() + (json.expires_in ?? 3600) * 1000 - 60000;
    return json.access_token;
  }

  private async startDriveAuth(
    config: StatsConfig,
    dialog: Electron.Dialog,
    shell: Electron.Shell,
    net: Electron.Net,
  ) {
    if (!config.cloudSyncClientId) {
      return { ok: false, message: 'Missing Google OAuth Client ID.' };
    }

    const http = (await import('node:http')).default;
    const crypto = (await import('node:crypto')).default;
    const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
    const codeChallenge = base64UrlEncode(
      crypto.createHash('sha256').update(codeVerifier).digest(),
    );

    return await new Promise<{ ok: boolean; message: string }>((resolve) => {
      let redirectUri = '';
      let settled = false;
      let timeoutId: NodeJS.Timeout | undefined;
      const settle = (result: { ok: boolean; message: string }) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolve(result);
      };

      const server = http.createServer(async (req, res) => {
        if (!req.url?.startsWith('/oauth2callback')) {
          res.writeHead(404);
          res.end();
          return;
        }

        const url = new URL(req.url, 'http://127.0.0.1');
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h3>You can close this window now.</h3>');
        server.close();

        if (!code || error) {
          settle({
            ok: false,
            message: 'Google authorization was cancelled or failed.',
          });
          return;
        }

        try {
          const tokenResponse = await net.fetch(
            'https://oauth2.googleapis.com/token',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                client_id: config.cloudSyncClientId,
                client_secret: config.cloudSyncClientSecret || '',
                grant_type: 'authorization_code',
                code,
                code_verifier: codeVerifier,
                redirect_uri: redirectUri,
              }).toString(),
            },
          );

          if (!tokenResponse.ok) {
            const errorText = await safeReadResponse(tokenResponse);
            const message =
              `Failed to exchange token. ${errorText || ''}`.trim();
            await this.setConfig({ cloudSyncLastError: message });
            settle({ ok: false, message });
            return;
          }

          const tokenJson = (await tokenResponse.json()) as {
            access_token?: string;
            refresh_token?: string;
            expires_in?: number;
          };
          this.sessionAccessToken = tokenJson.access_token || null;
          this.sessionAccessTokenExpiry =
            Date.now() + (tokenJson.expires_in ?? 3600) * 1000 - 60000;

          if (!tokenJson.refresh_token) {
            await this.setConfig({
              cloudSyncLastError:
                'No refresh token returned. Revoke access at myaccount.google.com/permissions and reconnect.',
            });
            settle({
              ok: false,
              message:
                'Logged in without refresh token. Revoke access and reconnect.',
            });
            return;
          }

          await this.setConfig({
            cloudSyncEnabled: true,
            cloudSyncRefreshToken: await protectSecret(tokenJson.refresh_token),
            cloudSyncLastError: '',
          });
          this.startSyncTimer();
          settle({ ok: true, message: 'Google Drive connected.' });
        } catch (err) {
          const message =
            `Google authorization failed. ${(err as Error)?.message || ''}`.trim();
          await this.setConfig({ cloudSyncLastError: message });
          settle({ ok: false, message });
        }
      });

      server.listen(0, '127.0.0.1', async () => {
        const address = server.address() as { port?: number } | null;
        const port = address?.port;
        if (!port) {
          server.close();
          settle({
            ok: false,
            message: 'Failed to start local callback server.',
          });
          return;
        }
        redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', config.cloudSyncClientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', DRIVE_SCOPE);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');

        const dialogResult = await dialog.showMessageBox({
          type: 'info',
          title: 'Google Drive Sync',
          message: 'Authorize Google Drive Sync',
          detail:
            'A browser window will open to sign in. After approving, you can close it.',
          buttons: ['Open Google', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
        });

        if (dialogResult.response === 1) {
          server.close();
          settle({ ok: false, message: 'Google authorization cancelled.' });
          return;
        }

        shell.openExternal(authUrl.toString()).catch(console.error);

        timeoutId = setTimeout(
          () => {
            try {
              server.close();
            } catch {
              // Already closed.
            }
            settle({ ok: false, message: 'Google authorization timed out.' });
          },
          5 * 60 * 1000,
        );
      });
    });
  }

  private async findDriveFile(accessToken: string, net: Electron.Net) {
    const query = encodeURIComponent(
      `name='${DRIVE_FILE_NAME}' and trashed=false`,
    );
    const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime)&q=${query}`;
    const response = await net.fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      files?: Array<{ id: string; name: string }>;
    };
    return json?.files?.[0] || null;
  }

  private async downloadDriveFile(
    accessToken: string,
    net: Electron.Net,
    fileId: string,
  ): Promise<string | null> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const response = await net.fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    return await response.text();
  }

  private async createDriveFile(
    accessToken: string,
    net: Electron.Net,
    content: string,
  ) {
    const metadata = { name: DRIVE_FILE_NAME, parents: ['appDataFolder'] };
    const body = buildMultipartBody(metadata, content);
    const response = await net.fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${body.boundary}`,
        },
        body: body.payload,
      },
    );
    if (!response.ok) throw new Error('Failed to create Drive file.');
    return (await response.json()) as { id: string };
  }

  private async uploadDriveFile(
    accessToken: string,
    net: Electron.Net,
    fileId: string,
    content: string,
  ) {
    const metadata = { name: DRIVE_FILE_NAME };
    const body = buildMultipartBody(metadata, content);
    const response = await net.fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${body.boundary}`,
        },
        body: body.payload,
      },
    );
    if (!response.ok) throw new Error('Failed to upload Drive file.');
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Same canonical form as StatsDatabase.contentFingerprint, for remote files. */
function fingerprintOfExport(jsonData: string): string {
  try {
    const parsed = JSON.parse(jsonData) as {
      playRecords?: unknown[];
      streak?: unknown;
    };
    return JSON.stringify({
      playRecords: parsed.playRecords ?? [],
      streak: parsed.streak ?? null,
    });
  } catch {
    return '';
  }
}

function hashString(value: string, crypto: typeof import('node:crypto')) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function base64UrlEncode(buffer: Buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

const SECRET_PREFIX = 'enc1:';

/** Encrypt a secret with the OS keychain when available. */
async function protectSecret(value: string): Promise<string> {
  try {
    const { safeStorage } = await import('electron');
    if (safeStorage.isEncryptionAvailable()) {
      return (
        SECRET_PREFIX + safeStorage.encryptString(value).toString('base64')
      );
    }
  } catch {
    // Fall through to plaintext (same behavior as before).
  }
  return value;
}

async function unprotectSecret(value: string): Promise<string> {
  if (!value.startsWith(SECRET_PREFIX)) return value;
  try {
    const { safeStorage } = await import('electron');
    return safeStorage.decryptString(
      Buffer.from(value.slice(SECRET_PREFIX.length), 'base64'),
    );
  } catch {
    return '';
  }
}

function buildMultipartBody(
  metadata: Record<string, unknown>,
  content: string,
) {
  const boundary = `ytm-${Date.now().toString(16)}`;
  const payload =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    `${content}\r\n` +
    `--${boundary}--`;
  return { boundary, payload };
}

async function safeReadResponse(response: { text: () => Promise<string> }) {
  try {
    const text = await response.text();
    return text?.slice(0, 300);
  } catch {
    return '';
  }
}

function extractArtistImage(html: string): string | null {
  const ogMatch = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  );
  if (ogMatch?.[1]) return ogMatch[1];

  const twitterMatch = html.match(
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  );
  if (twitterMatch?.[1]) return twitterMatch[1];

  const fallbackMatch = html.match(/https:\/\/yt3\.ggpht\.com\/[^"'\s>]+/i);
  if (fallbackMatch?.[0]) return fallbackMatch[0];

  return null;
}
