import { config, type ConfigOf } from '@/plugins/utils/common/config';

import type { ProviderName } from './providers';
import type { SongInfo } from '@/providers/song-info';

export const syncedLyricsConfig = {
  // "Preferred Provider" (undefined = none) and "Default character between
  // lyrics" are custom menu items (see menu.ts).
  preferredProvider: config.hidden<ProviderName | undefined>(undefined),
  preciseTiming: config.bool(true, {
    label: 'plugins.synced-lyrics.menu.precise-timing.label',
    description: 'plugins.synced-lyrics.menu.precise-timing.tooltip',
  }),
  lineEffect: config.select(
    'fancy',
    [
      {
        value: 'fancy',
        label: 'plugins.synced-lyrics.menu.line-effect.submenu.fancy.label',
      },
      {
        value: 'scale',
        label: 'plugins.synced-lyrics.menu.line-effect.submenu.scale.label',
      },
      {
        value: 'offset',
        label: 'plugins.synced-lyrics.menu.line-effect.submenu.offset.label',
      },
      {
        value: 'focus',
        label: 'plugins.synced-lyrics.menu.line-effect.submenu.focus.label',
      },
    ],
    {
      label: 'plugins.synced-lyrics.menu.line-effect.label',
      description: 'plugins.synced-lyrics.menu.line-effect.tooltip',
    },
  ),
  defaultTextString: config.hidden<string | string[]>('♪'),
  romanization: config.bool(true, {
    label: 'plugins.synced-lyrics.menu.romanization.label',
    description: 'plugins.synced-lyrics.menu.romanization.tooltip',
  }),
  // Not stored until picked; a missing value means 'disabled'.
  convertChineseCharacter: config.select(
    'disabled',
    [
      {
        value: 'disabled',
        label:
          'plugins.synced-lyrics.menu.convert-chinese-character.submenu.disabled.label',
      },
      {
        value: 'simplifiedToTraditional',
        label:
          'plugins.synced-lyrics.menu.convert-chinese-character.submenu.simplified-to-traditional.label',
      },
      {
        value: 'traditionalToSimplified',
        label:
          'plugins.synced-lyrics.menu.convert-chinese-character.submenu.traditional-to-simplified.label',
      },
    ],
    {
      label: 'plugins.synced-lyrics.menu.convert-chinese-character.label',
      description:
        'plugins.synced-lyrics.menu.convert-chinese-character.tooltip',
    },
  ),
  showTimeCodes: config.bool(false, {
    label: 'plugins.synced-lyrics.menu.show-time-codes.label',
    description: 'plugins.synced-lyrics.menu.show-time-codes.tooltip',
  }),
  showLyricsEvenIfInexact: config.bool(true, {
    label: 'plugins.synced-lyrics.menu.show-lyrics-even-if-inexact.label',
    description:
      'plugins.synced-lyrics.menu.show-lyrics-even-if-inexact.tooltip',
  }),
};

export type SyncedLyricsConfig = ConfigOf<typeof syncedLyricsConfig>;

/** The config as stored (used by the migrations in src/config/store.ts). */
export type SyncedLyricsPluginConfig = SyncedLyricsConfig & {
  enabled: boolean;
};

export type LineLyricsStatus = 'previous' | 'current' | 'upcoming';

export type LineLyrics = {
  time: string;
  timeInMs: number;
  duration: number;

  text: string;
  status: LineLyricsStatus;
};

export interface LyricResult {
  title: string;
  artists: string[];

  lyrics?: string;
  lines?: LineLyrics[];
}

// prettier-ignore
export type SearchSongInfo = Pick<SongInfo, 'title' | 'alternativeTitle' | 'artist' | 'album' | 'songDuration' | 'videoId' | 'tags'>;

export interface LyricProvider {
  name: string;
  baseUrl: string;

  search(songInfo: SearchSongInfo): Promise<LyricResult | null>;
}
