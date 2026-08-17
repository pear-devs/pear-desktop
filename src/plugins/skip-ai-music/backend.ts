import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app } from 'electron';

import { store } from '@/config/store';
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
  COMMUNITY_CACHE_VERSION,
  COMMUNITY_REFRESH_INTERVAL_MS,
  clampCommunityMinScore,
  type SkipAiMusicPluginConfig,
} from './types';

type ScoredArtist = {
  name: string;
  score: number;
};

type CommunityCache = {
  artists: ScoredArtist[];
  fetchedAt: number;
  version?: number;
};

type CommunityArtistEntry = {
  name?: string;
  removed?: boolean;
  submithub_score?: unknown;
};

let pluginConfig: SkipAiMusicPluginConfig | null = null;
let scoredArtists: ScoredArtist[] = [];
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
  minScore: clampCommunityMinScore(pluginConfig?.communityMinScore),
});

const minScoreFromConfig = () =>
  clampCommunityMinScore(pluginConfig?.communityMinScore);

const applyScoreFilter = () => {
  const minScore = minScoreFromConfig();
  communityArtists = scoredArtists
    .filter((artist) => artist.score >= minScore)
    .map((artist) => artist.name);
};

const parseCommunityArtists = (data: unknown): ScoredArtist[] => {
  const artists: ScoredArtist[] = [];

  const pushArtist = (name: unknown, score: unknown) => {
    if (typeof name != 'string' || !name.trim()) {
      return;
    }
    const value = Number(score);
    if (!Number.isFinite(value)) {
      return;
    }
    artists.push({ name: name.trim(), score: value });
  };

  if (Array.isArray(data)) {
    for (const entry of data) {
      if (!entry || typeof entry != 'object') {
        continue;
      }

      const item = entry as CommunityArtistEntry;
      if (item.removed) {
        continue;
      }
      pushArtist(item.name, item.submithub_score);
    }
    return artists;
  }

  if (data && typeof data == 'object') {
    const record = data as { artists?: unknown };
    if (Array.isArray(record.artists)) {
      return parseCommunityArtists(record.artists);
    }
  }

  return artists;
};

const loadCachedArtists = async () => {
  try {
    const raw = await readFile(cachePath(), 'utf8');
    const parsed = JSON.parse(raw) as CommunityCache;
    if (!Array.isArray(parsed.artists)) {
      return;
    }

    const cached: ScoredArtist[] = [];
    for (const entry of parsed.artists) {
      if (!entry || typeof entry != 'object') {
        continue;
      }
      if (typeof entry.name != 'string' || !entry.name.trim()) {
        continue;
      }
      const score = Number(entry.score);
      if (!Number.isFinite(score)) {
        continue;
      }
      cached.push({ name: entry.name.trim(), score });
    }

    scoredArtists = cached;
    applyScoreFilter();
    communityFetchedAt =
      Number(parsed.version) == COMMUNITY_CACHE_VERSION && cached.length > 0
        ? Number(parsed.fetchedAt) || 0
        : 0;
  } catch {
    // First run or a corrupt cache is fine; a network refresh follows.
  }
};

const saveCachedArtists = async () => {
  const file = cachePath();
  await mkdir(path.dirname(file), { recursive: true });
  const payload: CommunityCache = {
    artists: scoredArtists,
    fetchedAt: communityFetchedAt,
    version: COMMUNITY_CACHE_VERSION,
  };
  await writeFile(file, JSON.stringify(payload), 'utf8');
};

export const refreshCommunityArtists = async (
  force = false,
  minScoreOverride?: number,
) => {
  if (minScoreOverride != null && pluginConfig) {
    pluginConfig = {
      ...pluginConfig,
      communityMinScore: clampCommunityMinScore(minScoreOverride),
    };
  }

  if (
    !force &&
    scoredArtists.length > 0 &&
    Date.now() - communityFetchedAt < COMMUNITY_REFRESH_INTERVAL_MS
  ) {
    applyScoreFilter();
    return communityArtists;
  }

  const response = await fetch(COMMUNITY_ARTISTS_URL);
  if (!response.ok) {
    throw new Error(`Community list HTTP ${response.status}`);
  }

  const data: unknown = await response.json();
  const artists = parseCommunityArtists(data);
  if (artists.length == 0) {
    throw new Error('Community list was empty');
  }

  scoredArtists = artists;
  applyScoreFilter();
  communityFetchedAt = Date.now();
  await saveCachedArtists();
  console.log(
    LoggerPrefix,
    `skip-ai-music: loaded ${communityArtists.length} community artists at ${minScoreFromConfig()}%+`,
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
    if (store.get('plugins.skip-ai-music.showPlayerButtons') != null) {
      store.delete('plugins.skip-ai-music.showPlayerButtons');
    }

    pluginConfig = await getConfig();
    pluginConfig.communityMinScore = clampCommunityMinScore(
      pluginConfig.communityMinScore,
    );
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
    const scoreChanged =
      clampCommunityMinScore(newConfig.communityMinScore) !=
      clampCommunityMinScore(pluginConfig?.communityMinScore);
    pluginConfig = {
      ...newConfig,
      communityMinScore: clampCommunityMinScore(newConfig.communityMinScore),
    };

    if (scoreChanged) {
      applyScoreFilter();
    }

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
