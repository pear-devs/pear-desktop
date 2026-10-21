import { test, expect } from '@playwright/test';

import { LyricsFile } from './lyricsfile';

const SAMPLE = `\
version: "1.0"
metadata:
  title: Example Song
  artist: Example Artist
  instrumental: false
lines:
  - text: Hello world
    words:
      - text: "Hello "
        start_ms: 1200
        end_ms: 1900
      - text: world
        start_ms: 1900
        end_ms: 2800
    start_ms: 1200
    end_ms: 2800
  - text: And we move like sa-te-llites
    words:
      - text: "And "
        start_ms: 43655
      - text: "we "
        start_ms: 44146
      - text: "move "
        start_ms: 44828
      - text: "like "
        start_ms: 46546
      - text: sa-
        start_ms: 46951
      - text: te-
        start_ms: 48220
      - text: llites
        start_ms: 49703
    start_ms: 43655
    end_ms: 51484
  - text: Mhmh
    words: []
    start_ms: 181015
    end_ms: 183495
plain: |-
  Hello world
`;

test('parses word-synced lyricsfile yaml', () => {
  const { lines } = LyricsFile.parse(SAMPLE);

  expect(lines[0]).toStrictEqual({
    duration: 1200,
    text: '',
    words: [],
    time: '00:00:00',
    timeInMs: 0,
  });

  expect(lines[1]).toMatchObject({
    text: 'Hello world',
    time: '00:01:20',
    timeInMs: 1200,
    duration: 1600,
    words: [
      { timeInMs: 1200, word: 'Hello ' },
      { timeInMs: 1900, word: 'world' },
    ],
  });

  const satellites = lines[2];
  expect(satellites.words.map((word) => word.word).join('')).toBe(
    'And we move like sa-te-llites',
  );
  expect(satellites.words[4]).toMatchObject({
    word: 'sa-',
    timeInMs: 46951,
  });

  expect(lines[3]).toMatchObject({
    text: 'Mhmh',
    timeInMs: 181015,
    duration: 2480,
    words: [],
  });
});

test('uses next line start when end_ms is missing', () => {
  const { lines } = LyricsFile.parse(`\
version: "1.0"
metadata:
  title: Example
  artist: Artist
lines:
  - text: One
    start_ms: 1000
    words:
      - text: One
        start_ms: 1000
  - text: Two
    start_ms: 2500
    words:
      - text: Two
        start_ms: 2500
`);

  expect(lines[1]?.duration).toBe(1500);
  expect(lines[2]?.duration).toBe(Infinity);
});

test('parses lrclib supernova lyricsfile payload', () => {
  const { lines } = LyricsFile.parse(`\
version: "1.0"
metadata:
  title: Supernova
  artist: Hybrid Minds, Catching Cairo
  instrumental: false
  album: Supernova
  duration_ms: 297960
lines:
  - text: Said I'd look for you
    words:
      - text: "Said "
        start_ms: 20610
      - text: "I'd "
        start_ms: 21049
      - text: "look "
        start_ms: 21809
      - text: "for "
        start_ms: 22529
      - text: you
        start_ms: 22929
    start_ms: 20610
    end_ms: 23890
  - text: "'Cause you're the super-nova"
    words:
      - text: "'Cause "
        start_ms: 139720
      - text: "you're "
        start_ms: 139912
      - text: "the "
        start_ms: 140307
      - text: super-
        start_ms: 140659
      - text: nova
        start_ms: 141341
    start_ms: 139720
    end_ms: 142050
`);

  const firstSung = lines.find((line) => line.text === "Said I'd look for you");
  expect(firstSung).toMatchObject({
    timeInMs: 20610,
    duration: 3280,
    words: [
      { timeInMs: 20610, word: 'Said ' },
      { timeInMs: 21049, word: "I'd " },
      { timeInMs: 21809, word: 'look ' },
      { timeInMs: 22529, word: 'for ' },
      { timeInMs: 22929, word: 'you' },
    ],
  });

  const quoted = lines.find(
    (line) => line.text === "'Cause you're the super-nova",
  );
  expect(quoted?.words.map((word) => word.word).join('')).toBe(
    "'Cause you're the super-nova",
  );
});
