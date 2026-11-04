import { providerNames } from '@/plugins/synced-lyrics/providers';
import { lyricsStore } from '@/plugins/synced-lyrics/renderer/store';
import { getSongInfo } from '@/providers/song-info-front';

import { isSameTitle } from './title-match';

import type { TimedLine } from './timing';

export type LyricsState =
  | { status: 'ready'; lines: TimedLine[] }
  | { status: 'searching' | 'not-found' };

/**
 * Reads what the Synced Lyrics plugin found for the current song. The provider
 * it has selected wins, then any other provider that has timed lines.
 *
 * Titles are checked because a provider can answer with a different song, and
 * wrong words on screen are worse than none.
 */
export const getLyricsState = (): LyricsState => {
  const candidates = [lyricsStore.provider, ...providerNames];
  const { title, alternativeTitle } = getSongInfo();
  const songTitles = [title, alternativeTitle ?? ''];

  for (const provider of candidates) {
    const result = lyricsStore.lyrics[provider].data;
    if (result?.lines?.length && isSameTitle(result.title, songTitles)) {
      return { status: 'ready', lines: result.lines };
    }
  }

  const isSearching = providerNames.some(
    (provider) => lyricsStore.lyrics[provider].state === 'fetching',
  );
  return { status: isSearching ? 'searching' : 'not-found' };
};
