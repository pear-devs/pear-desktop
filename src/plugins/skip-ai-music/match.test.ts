import { expect, test } from '@playwright/test';

import { hasWholePhrase, shouldSkipTrack, splitArtists } from './match';
import { defaultConfig, type SkipAiMusicPluginConfig } from './types';

const config = (
  overrides: Partial<SkipAiMusicPluginConfig> = {},
): SkipAiMusicPluginConfig => ({
  ...defaultConfig,
  ...overrides,
});

test('blocking Prince does not block Princess Nokia', () => {
  const result = shouldSkipTrack(
    { artist: 'Princess Nokia', title: 'Mine' },
    config({ blockedArtists: ['Prince'] }),
  );

  expect(result.skip).toBe(false);
});

test('exact artist match skips the track', () => {
  const result = shouldSkipTrack(
    { artist: 'Fake AI Band', title: 'A Song' },
    config({ blockedArtists: ['Fake AI Band'] }),
  );

  expect(result.skip).toBe(true);
  expect(result.reason).toBe('blocked-artist');
});

test('featured artists are matched independently', () => {
  const result = shouldSkipTrack(
    { artist: 'Real Artist feat. Fake AI Band', title: 'Collab' },
    config({ blockedArtists: ['Fake AI Band'] }),
  );

  expect(result.skip).toBe(true);
  expect(result.reason).toBe('blocked-artist');
});

test('community artists skip unless allowlisted', () => {
  const skipped = shouldSkipTrack(
    { artist: 'Slop Studio', title: 'Track' },
    config({ useCommunityList: true }),
    ['Slop Studio'],
  );
  expect(skipped.skip).toBe(true);
  expect(skipped.reason).toBe('community-artist');

  const allowed = shouldSkipTrack(
    { artist: 'Slop Studio', title: 'Track' },
    config({ allowedArtists: ['Slop Studio'], useCommunityList: true }),
    ['Slop Studio'],
  );
  expect(allowed.skip).toBe(false);
  expect(allowed.reason).toBe('allowed-artist');
});

test('blocked songs require both title and artist', () => {
  const blocked = shouldSkipTrack(
    { artist: 'Original', title: 'Cover Song' },
    config({
      blockedSongs: [{ artist: 'Original', title: 'Cover Song' }],
    }),
  );
  expect(blocked.skip).toBe(true);

  const cover = shouldSkipTrack(
    { artist: 'Someone Else', title: 'Cover Song' },
    config({
      blockedSongs: [{ artist: 'Original', title: 'Cover Song' }],
    }),
  );
  expect(cover.skip).toBe(false);
});

test('blocked songs match featured artist tokens', () => {
  const result = shouldSkipTrack(
    { artist: 'Original feat. Someone', title: 'Cover Song' },
    config({
      blockedSongs: [{ artist: 'Original', title: 'Cover Song' }],
    }),
  );

  expect(result.skip).toBe(true);
  expect(result.reason).toBe('blocked-song');
});

test('title-only blocked songs skip any artist', () => {
  const result = shouldSkipTrack(
    { artist: 'Anyone', title: 'Cover Song' },
    config({
      blockedSongs: [{ artist: '', title: 'Cover Song' }],
    }),
  );

  expect(result.skip).toBe(true);
  expect(result.reason).toBe('blocked-song');
});

test('keywords use whole-phrase matching', () => {
  expect(hasWholePhrase('Song (Sped Up)', 'sped up')).toBe(true);
  expect(hasWholePhrase('Afterpiece', 'after')).toBe(false);

  const result = shouldSkipTrack(
    { artist: 'Band', title: 'Hit (Sped Up)' },
    config({ blockedKeywords: ['sped up'] }),
  );
  expect(result.skip).toBe(true);
  expect(result.reason).toBe('keyword');
});

test('common AI keywords are opt-in', () => {
  const off = shouldSkipTrack(
    { artist: 'Band', title: 'Love (AI Cover)' },
    config({ skipCommonKeywords: false }),
  );
  expect(off.skip).toBe(false);

  const on = shouldSkipTrack(
    { artist: 'Band', title: 'Love (AI Cover)' },
    config({ skipCommonKeywords: true }),
  );
  expect(on.skip).toBe(true);
  expect(on.matched).toBe('ai cover');
});

test('splitArtists keeps the full byline and each credited name', () => {
  expect(splitArtists('A & B feat. C • Topic')).toEqual([
    'a & b feat. c',
    'a',
    'b',
    'c',
  ]);
});
