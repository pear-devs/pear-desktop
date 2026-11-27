import { test, expect } from '@playwright/test';

import { isSameArtist, isSameTitle } from './title-match';

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

test('keeps a song title that only contains a recording word', () => {
  expect(isSameTitle('Video Games', ['Lana Del Rey - Video Games'])).toBe(true);
  expect(isSameTitle('Live Forever', ['Oasis - Live Forever'])).toBe(true);
});

test('keeps a song title that is itself a recording word', () => {
  expect(isSameTitle('Video', ['Artist - Video'], 'Artist')).toBe(true);
  expect(isSameTitle('Artist', ['Artist - Video'], 'Artist')).toBe(false);
});

test('keeps part numbers that tell songs apart', () => {
  expect(
    isSameTitle('Another Brick in the Wall (Part 1)', [
      'Pink Floyd - Another Brick in the Wall (Part 2)',
    ]),
  ).toBe(false);
  expect(
    isSameTitle('Another Brick in the Wall (Part 2)', [
      'Pink Floyd - Another Brick in the Wall (Part 2) (Official Video)',
    ]),
  ).toBe(true);
});

test('matches a song that shares the artist name', () => {
  expect(
    isSameTitle('Bad Company', ['Bad Company - Bad Company'], 'Bad Company'),
  ).toBe(true);
  expect(isSameTitle('Bad Company', ['Bad Company'], 'Bad Company')).toBe(true);
});

test('keeps full-width part numbers apart', () => {
  expect(
    isSameTitle('Song (Part １)', ['Artist - Song (Part ２)'], 'Artist'),
  ).toBe(false);
  expect(
    isSameTitle('Song (Part ２)', ['Artist - Song (Part ２)'], 'Artist'),
  ).toBe(true);
});

test('keeps number-only brackets that tell songs apart', () => {
  expect(isSameTitle('Song (1)', ['Artist - Song (2)'], 'Artist')).toBe(false);
  expect(isSameTitle('Song (2)', ['Artist - Song (2)'], 'Artist')).toBe(true);
});

test('takes the part after the dash only when the artist is before it', () => {
  expect(isSameTitle('Right', ['Left - Right'], 'Artist')).toBe(false);
  expect(isSameTitle('Right', ['Artist - Right'], 'Artist')).toBe(true);
  expect(isSameTitle('Left - Right', ['Left - Right'], 'Artist')).toBe(true);
});

test('checks the artist when both sides name one', () => {
  expect(isSameArtist(['Someone Else'], 'Artist')).toBe(false);
  expect(isSameArtist(['Artist', 'Guest'], 'Artist')).toBe(true);
  expect(isSameArtist(['Artist feat. Guest'], 'Artist')).toBe(true);
  expect(isSameArtist([], 'Artist')).toBe(true);
  expect(isSameArtist(['Artist'], '')).toBe(true);
});

test('compares artists as whole names', () => {
  expect(isSameArtist(['Queen Latifah'], 'Queen')).toBe(false);
  expect(isSameArtist(['ACDC'], 'AC/DC')).toBe(true);
  expect(isSameArtist(['AC/DC'], 'ACDC')).toBe(true);
  expect(isSameArtist(['AC/DC'], 'AC/DC')).toBe(true);
  expect(isSameArtist(['Queen'], 'Queen Latifah')).toBe(false);
  expect(isSameArtist(['Simon and Garfunkel'], 'Simon & Garfunkel')).toBe(true);
  expect(isSameArtist(['Guest'], 'Artist feat. Guest')).toBe(true);
  expect(isSameArtist(['Guest'], 'Artist (feat. Guest)')).toBe(true);
  expect(isSameArtist(['Artist'], 'Artist [with Guest]')).toBe(true);
  expect(isSameArtist(['Someone'], 'Artist (feat. Guest)')).toBe(false);
  expect(isSameTitle('Right', ['Left - Right'], 'Leftfield')).toBe(false);
  expect(isSameTitle('Right', ['Artist & Guest - Right'], 'Artist')).toBe(true);
});

test('does not treat empty titles as a match', () => {
  expect(isSameTitle('', [videoTitle])).toBe(false);
  expect(isSameTitle('...', [videoTitle])).toBe(false);
  expect(isSameTitle('Song', [''])).toBe(false);
});
