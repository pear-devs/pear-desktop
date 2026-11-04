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

test('does not treat empty titles as a match', () => {
  expect(isSameTitle('', [videoTitle])).toBe(false);
  expect(isSameTitle('...', [videoTitle])).toBe(false);
  expect(isSameTitle('Song', [''])).toBe(false);
});
