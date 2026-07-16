// Reads the account-wide YouTube Music listening history (which includes
// plays from the phone app) and Google Takeout watch-history exports.
// Main-process only — everything Node/Electron is imported dynamically.

import type { BrowserWindow } from 'electron';
import type { Innertube } from 'youtubei.js';

export interface RemotePlayItem {
  videoId: string;
  title: string;
  artist: string;
  artistId: string;
  album?: string;
  thumbnailUrl?: string;
  durationSeconds: number;
}

export interface HistoryGroup {
  groupTitle: string;
  items: RemotePlayItem[];
}

export interface TakeoutPlay {
  videoId: string;
  title: string;
  artist: string;
  artistId?: string;
  timestamp: number;
}

/**
 * Authenticated Innertube session using the logged-in window's cookies —
 * same pattern as the downloader plugin. `lang: 'en'` keeps the history
 * group titles ("Today", "Yesterday", weekday names) parseable.
 */
export async function createInnertube(
  window: BrowserWindow,
): Promise<Innertube> {
  const { Innertube: InnertubeClass, UniversalCache } = await import(
    'youtubei.js'
  );
  const { getNetFetchAsFetch } = await import('@/plugins/utils/main');

  const cookie = (
    await window.webContents.session.cookies.get({
      url: 'https://music.youtube.com',
    })
  )
    .map((it) => `${it.name}=${it.value}`)
    .join(';');

  return await InnertubeClass.create({
    cookie,
    lang: 'en',
    retrieve_player: false,
    generate_session_locally: true,
    cache: new UniversalCache(false),
    fetch: getNetFetchAsFetch(),
  });
}

// ─── History feed (FEmusic_history) ─────────────────────────────────────

interface TextRuns {
  runs?: Array<{
    text?: string;
    navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
  }>;
}

interface HistoryItemRenderer {
  playlistItemData?: { videoId?: string };
  flexColumns?: Array<{
    musicResponsiveListItemFlexColumnRenderer?: { text?: TextRuns };
  }>;
  fixedColumns?: Array<{
    musicResponsiveListItemFixedColumnRenderer?: { text?: TextRuns };
  }>;
  thumbnail?: {
    musicThumbnailRenderer?: {
      thumbnail?: { thumbnails?: Array<{ url?: string }> };
    };
  };
}

interface HistoryResponse {
  contents?: {
    singleColumnBrowseResultsRenderer?: {
      tabs?: Array<{
        tabRenderer?: {
          content?: {
            sectionListRenderer?: {
              contents?: Array<{
                musicShelfRenderer?: {
                  title?: TextRuns;
                  contents?: Array<{
                    musicResponsiveListItemRenderer?: HistoryItemRenderer;
                  }>;
                };
              }>;
            };
          };
        };
      }>;
    };
  };
}

export async function fetchHistory(yt: Innertube): Promise<HistoryGroup[]> {
  const response = await yt.actions.execute('/browse', {
    browse_id: 'FEmusic_history',
    client: 'YTMUSIC',
  });

  const data = response.data as HistoryResponse;
  const sections =
    data.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
      ?.content?.sectionListRenderer?.contents ?? [];

  const groups: HistoryGroup[] = [];
  for (const section of sections) {
    const shelf = section.musicShelfRenderer;
    if (!shelf) continue;
    const groupTitle = shelf.title?.runs?.[0]?.text ?? '';
    if (!groupTitle) continue;

    const items: RemotePlayItem[] = [];
    for (const entry of shelf.contents ?? []) {
      const item = parseHistoryItem(entry.musicResponsiveListItemRenderer);
      if (item) items.push(item);
    }
    if (items.length) groups.push({ groupTitle, items });
  }
  return groups;
}

function parseHistoryItem(
  renderer: HistoryItemRenderer | undefined,
): RemotePlayItem | null {
  if (!renderer) return null;
  const videoId = renderer.playlistItemData?.videoId;
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;

  const flexText = (index: number) =>
    renderer.flexColumns?.[index]?.musicResponsiveListItemFlexColumnRenderer
      ?.text;

  const title = flexText(0)?.runs?.[0]?.text;
  if (!title) return null;

  const artistRun = flexText(1)?.runs?.[0];
  const artist = artistRun?.text || 'Unknown Artist';
  const browseId = artistRun?.navigationEndpoint?.browseEndpoint?.browseId;
  const artistId = browseId?.startsWith('UC') ? browseId : artist;

  const album = flexText(2)?.runs?.[0]?.text;

  const durationText =
    renderer.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text
      ?.runs?.[0]?.text;
  const durationSeconds = parseDurationText(durationText);

  const thumbnailUrl =
    renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at(
      -1,
    )?.url;

  return {
    videoId,
    title,
    artist,
    artistId,
    album,
    thumbnailUrl,
    durationSeconds,
  };
}

/** "3:21" → 201, "1:02:33" → 3753. Unparseable → 0 (caller substitutes). */
export function parseDurationText(text?: string): number {
  if (!text) return 0;
  const parts = text
    .trim()
    .split(':')
    .map((p) => Number(p));
  if (!parts.length || parts.some((p) => !Number.isFinite(p))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * Maps a history group title to a local YYYY-MM-DD key. Only the past week
 * is resolvable ("Today", "Yesterday", weekday names) — older groups have
 * no usable date and return null; Takeout covers those.
 */
export function resolveGroupDayKey(
  groupTitle: string,
  now: Date,
): string | null {
  const dayKeyOf = (offsetDays: number) => {
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - offsetDays,
      12,
    );
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  if (groupTitle === 'Today') return dayKeyOf(0);
  if (groupTitle === 'Yesterday') return dayKeyOf(1);

  const weekday = WEEKDAYS.indexOf(groupTitle);
  if (weekday >= 0) {
    let diff = (now.getDay() - weekday + 7) % 7;
    // "Today" covers offset 0, so a matching weekday name means last week.
    if (diff === 0) diff = 7;
    return dayKeyOf(diff);
  }
  return null;
}

// ─── Google Takeout (watch-history.json) ────────────────────────────────

interface TakeoutEntry {
  header?: string;
  title?: string;
  titleUrl?: string;
  subtitles?: Array<{ name?: string; url?: string }>;
  time?: string;
}

/**
 * Extracts YouTube Music plays from a Takeout watch-history.json export.
 * Entries carry exact timestamps but no durations.
 */
export function parseTakeout(jsonText: string): TakeoutPlay[] {
  let entries: unknown;
  try {
    entries = JSON.parse(jsonText);
  } catch {
    throw new Error(
      'Not a valid JSON file. In Takeout, set the history format to JSON.',
    );
  }
  if (!Array.isArray(entries)) {
    throw new Error('Unexpected file format — expected watch-history.json.');
  }

  const plays: TakeoutPlay[] = [];
  for (const raw of entries as TakeoutEntry[]) {
    if (raw?.header !== 'YouTube Music') continue;

    const videoId = raw.titleUrl?.match(/[?&]v=([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId || !raw.time) continue;

    const timestamp = Date.parse(raw.time);
    if (!Number.isFinite(timestamp)) continue;

    const title = cleanTakeoutTitle(raw.title);
    if (!title) continue;

    const artistName = raw.subtitles?.[0]?.name?.replace(/\s-\sTopic$/, '');
    const artistId = raw.subtitles?.[0]?.url?.match(/channel\/(UC[\w-]+)/)?.[1];

    plays.push({
      videoId,
      title,
      artist: artistName || 'Unknown Artist',
      artistId,
      timestamp,
    });
  }
  return plays;
}

/** Strips Takeout's localized "Watched …" wrappers from the song title. */
function cleanTakeoutTitle(title?: string): string {
  if (!title) return '';
  return title
    .replace(/^Watched\s+/, '') // en
    .replace(/^Du hast\s+/, '') // de (prefix)
    .replace(/\s+angesehen$/, '') // de (suffix)
    .trim();
}
