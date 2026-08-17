import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app } from 'electron';

import { getSongControls } from '@/providers/song-controls';
import {
  registerCallback,
  SongInfoEvent,
  unregisterCallback,
  type SongInfo,
} from '@/providers/song-info';
import { createBackend, LoggerPrefix } from '@/utils';

import { shouldSkipTrack } from './match';
import {
  COMMUNITY_ARTISTS_URL,
  COMMUNITY_REFRESH_INTERVAL_MS,
  type SkipAiMusicPluginConfig,
} from './types';

type CommunityCache = {
  artists: string[];
  fetchedAt: number;
};

type CommunityArtistEntry = {
  name?: string;
  removed?: boolean;
};

let pluginConfig: SkipAiMusicPluginConfig | null = null;
let communityArtists: string[] = [];
let communityFetchedAt = 0;
let refreshTimer: NodeJS.Timeout | null = null;
let lastSongInfo: SongInfo | null = null;
let lastSkippedVideoId = '';
let lastSkipAt = 0;
let consecutiveSkips = 0;
let skipTimer: NodeJS.Timeout | null = null;
let pluginWindow: Electron.BrowserWindow | null = null;

const MAX_CONSECUTIVE_SKIPS = 12;
const SKIP_WINDOW_MS = 30_000;
const SKIP_RETRY_MS = 5_000;
const DISLIKE_THEN_SKIP_MS = 350;

const cachePath = () =>
  path.join(app.getPath('userData'), 'skip-ai-music', 'artists.json');

export const getCommunityStatus = () => ({
  count: communityArtists.length,
  fetchedAt: communityFetchedAt,
});

const parseCommunityArtists = (data: unknown): string[] => {
  const names: string[] = [];

  const pushName = (value: unknown) => {
    if (typeof value == 'string' && value.trim()) {
      names.push(value.trim());
    }
  };

  if (Array.isArray(data)) {
    for (const entry of data) {
      if (typeof entry == 'string') {
        pushName(entry);
        continue;
      }

      if (entry && typeof entry == 'object') {
        const item = entry as CommunityArtistEntry;
        if (item.removed) {
          continue;
        }
        pushName(item.name);
      }
    }
    return names;
  }

  if (data && typeof data == 'object') {
    const record = data as { artists?: unknown };
    if (Array.isArray(record.artists)) {
      return parseCommunityArtists(record.artists);
    }
  }

  return names;
};

const loadCachedArtists = async () => {
  try {
    const raw = await readFile(cachePath(), 'utf8');
    const parsed = JSON.parse(raw) as CommunityCache;
    if (!Array.isArray(parsed.artists)) {
      return;
    }

    communityArtists = parsed.artists.filter(
      (name) => typeof name == 'string' && name.trim().length > 0,
    );
    communityFetchedAt = Number(parsed.fetchedAt) || 0;
  } catch {
    // First run or a corrupt cache is fine; a network refresh follows.
  }
};

const saveCachedArtists = async () => {
  const file = cachePath();
  await mkdir(path.dirname(file), { recursive: true });
  const payload: CommunityCache = {
    artists: communityArtists,
    fetchedAt: communityFetchedAt,
  };
  await writeFile(file, JSON.stringify(payload), 'utf8');
};

export const refreshCommunityArtists = async (force = false) => {
  if (
    !force &&
    communityArtists.length > 0 &&
    Date.now() - communityFetchedAt < COMMUNITY_REFRESH_INTERVAL_MS
  ) {
    return communityArtists;
  }

  const response = await fetch(COMMUNITY_ARTISTS_URL);
  if (!response.ok) {
    throw new Error(`Community list HTTP ${response.status}`);
  }

  const data: unknown = await response.json();
  const names = parseCommunityArtists(data);
  if (names.length == 0) {
    throw new Error('Community list was empty');
  }

  communityArtists = names;
  communityFetchedAt = Date.now();
  await saveCachedArtists();
  console.log(
    LoggerPrefix,
    `skip-ai-music: loaded ${communityArtists.length} community artists`,
  );
  return communityArtists;
};

const clearSkipTimer = () => {
  if (skipTimer) {
    clearTimeout(skipTimer);
    skipTimer = null;
  }
};

const skipCurrent = (
  window: Electron.BrowserWindow,
  songInfo: SongInfo,
  dislike: boolean,
) => {
  const controls = getSongControls(window);
  lastSkippedVideoId = songInfo.videoId;
  lastSkipAt = Date.now();

  if (dislike) {
    controls.dislike();
    clearSkipTimer();
    skipTimer = setTimeout(() => {
      if (lastSongInfo?.videoId == songInfo.videoId) {
        controls.next();
      }
      skipTimer = null;
    }, DISLIKE_THEN_SKIP_MS);
    return;
  }

  controls.next();
};

const maybeSkip = (window: Electron.BrowserWindow, songInfo: SongInfo) => {
  if (!pluginConfig?.enabled) {
    return;
  }

  if (!songInfo.title && !songInfo.artist) {
    return;
  }

  const result = shouldSkipTrack(
    { artist: songInfo.artist, title: songInfo.title },
    pluginConfig,
    communityArtists,
  );

  if (!result.skip) {
    consecutiveSkips = 0;
    return;
  }

  const now = Date.now();
  if (
    lastSkippedVideoId == songInfo.videoId &&
    now - lastSkipAt < SKIP_RETRY_MS
  ) {
    return;
  }

  if (now - lastSkipAt < SKIP_WINDOW_MS) {
    consecutiveSkips += 1;
  } else {
    consecutiveSkips = 1;
  }

  if (consecutiveSkips > MAX_CONSECUTIVE_SKIPS) {
    console.warn(
      LoggerPrefix,
      'skip-ai-music: too many consecutive skips, pausing playback',
    );
    getSongControls(window).pause();
    consecutiveSkips = 0;
    return;
  }

  console.log(
    LoggerPrefix,
    `skip-ai-music: skipping "${songInfo.artist} - ${songInfo.title}" (${result.reason}: ${result.matched})`,
  );
  skipCurrent(window, songInfo, pluginConfig.dislikeOnSkip);
};

const onSongInfo: (
  window: Electron.BrowserWindow,
) => (songInfo: SongInfo, event: SongInfoEvent) => void =
  (window) => (songInfo, event) => {
    lastSongInfo = songInfo;
    if (event != SongInfoEvent.VideoSrcChanged) {
      return;
    }
    maybeSkip(window, songInfo);
  };

const startCommunityRefresh = async () => {
  try {
    await refreshCommunityArtists();
  } catch (error) {
    console.warn(
      LoggerPrefix,
      'skip-ai-music: failed to refresh community list',
      error,
    );
  }

  if (refreshTimer) {
    return;
  }

  refreshTimer = setInterval(() => {
    refreshCommunityArtists().catch((error: unknown) => {
      console.warn(
        LoggerPrefix,
        'skip-ai-music: failed to refresh community list',
        error,
      );
    });
  }, COMMUNITY_REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
};

const stopCommunityRefresh = () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
};

export const backend = createBackend<
  {
    onSongInfo?: ReturnType<typeof onSongInfo>;
  },
  SkipAiMusicPluginConfig
>({
  async start({ getConfig, window }) {
    pluginConfig = await getConfig();
    pluginWindow = window;
    await loadCachedArtists();

    if (pluginConfig.useCommunityList) {
      await startCommunityRefresh();
    }

    this.onSongInfo = onSongInfo(window);
    registerCallback(this.onSongInfo);
  },
  stop() {
    if (this.onSongInfo) {
      unregisterCallback(this.onSongInfo);
      this.onSongInfo = undefined;
    }
    stopCommunityRefresh();
    clearSkipTimer();
    pluginConfig = null;
    pluginWindow = null;
    lastSongInfo = null;
  },
  onConfigChange(newConfig) {
    const shouldStartCommunity =
      newConfig.useCommunityList && !pluginConfig?.useCommunityList;
    pluginConfig = newConfig;

    if (shouldStartCommunity) {
      startCommunityRefresh();
    } else if (!newConfig.useCommunityList) {
      stopCommunityRefresh();
    }

    if (pluginWindow && lastSongInfo) {
      maybeSkip(pluginWindow, lastSongInfo);
    }
  },
});
