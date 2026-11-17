import { test, expect } from '@playwright/test';

import { isSameTitle } from './title-match';

const videoTitle =
  'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)';

test('matches a clean title inside a video title', () => {
  expect(isSameTitle('Never Gonna Give You Up', [videoTitle])).toBe(true);
});

test('rejects a provider result for a different song', () => {
  expect(isSameTitle('NOKIA', [videoTitle])).toBe(false);
});

test('ignores case, punctuation and accents', () => {
  expect(isSameTitle("DON'T STOP ME NOW", ['Dont Stop Me Now'])).toBe(true);
  expect(isSameTitle('Déjà Vu', ['Deja Vu'])).toBe(true);
});

test('matches when the lyrics title is the longer one', () => {
  expect(isSameTitle('Song Name (feat. Someone)', ['Song Name'])).toBe(true);
});

test('checks the alternative title too', () => {
  expect(isSameTitle('夜に駆ける', ['Yoru ni Kakeru', '夜に駆ける'])).toBe(
    true,
  );
});

test('rejects a different song whose title contains this one', () => {
  expect(isSameTitle('Love', ['Love Story'])).toBe(false);
  expect(isSameTitle('Love Story', ['Love'])).toBe(false);
});

test('matches a title with a trailing feat. credit', () => {
  expect(isSameTitle('Song Name', ['Song Name feat. Someone'])).toBe(true);
});

test('does not match two songs by the same artist', () => {
  expect(isSameTitle('Artist - First Song', ['Artist - Second Song'])).toBe(
    false,
  );
  expect(isSameTitle('Artist', ['Artist - Second Song'])).toBe(false);
});

test('matches a title with a trailing recording note', () => {
  expect(isSameTitle('Song Name', ['Song Name - Remastered 2011'])).toBe(true);
  expect(isSameTitle('Song Name - Live', ['Song Name'])).toBe(true);
});

test('does not treat empty titles as a match', () => {
  expect(isSameTitle('', [videoTitle])).toBe(false);
  expect(isSameTitle('...', [videoTitle])).toBe(false);
  expect(isSameTitle('Song', [''])).toBe(false);
});
