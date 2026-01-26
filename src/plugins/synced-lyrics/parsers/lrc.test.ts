import { test, expect } from '@playwright/test';

import { LRC } from './lrc';

test('empty string', () => {
  const lrc = LRC.parse('');
  expect(lrc).toStrictEqual({ lines: [], tags: [] });
});

test('chorus', () => {
  const lrc = LRC.parse(`\
[00:12.00]Line 1 lyrics
[00:17.20]Line 2 lyrics
[00:21.10][00:45.10]Repeating lyrics (e.g. chorus)
[mm:ss.xx]Last lyrics line\
`);

  expect(lrc).toStrictEqual({
    lines: [
      { duration: 12000, text: '', words: [], time: '00:00:00', timeInMs: 0 },
      {
        duration: 5020,
        text: 'Line 1 lyrics',
        words: [],
        time: '00:12:00',
        timeInMs: 12000,
      },
      {
        duration: 3990,
        text: 'Line 2 lyrics',
        words: [],
        time: '00:17:20',
        timeInMs: 17020,
      },
      {
        duration: 24000,
        text: 'Repeating lyrics (e.g. chorus)',
        words: [],
        time: '00:21:10',
        timeInMs: 21010,
      },
      {
        duration: Infinity,
        text: 'Repeating lyrics (e.g. chorus)',
        words: [],
        time: '00:45:10',
        timeInMs: 45010,
      },
    ],
    tags: [],
  });
});

test('attributes', () => {
  const lrc = LRC.parse(
    `[ar:Chubby Checker oppure  Beatles, The]
[al:Hits Of The 60's - Vol. 2 – Oldies]
[ti:Let's Twist Again]
[au:Written by Kal Mann / Dave Appell, 1961]
[length: 2:23]

[00:12.00]Naku Penda Piya-Naku Taka Piya-Mpenziwe
[00:15.30]Some more lyrics ...`,
  );

  expect(lrc).toStrictEqual({
    lines: [
      { duration: 12000, text: '', words: [], time: '00:00:00', timeInMs: 0 },
      {
        duration: 3030,
        text: 'Naku Penda Piya-Naku Taka Piya-Mpenziwe',
        words: [],
        time: '00:12:00',
        timeInMs: 12000,
      },
      {
        duration: Infinity,
        text: 'Some more lyrics ...',
        words: [],
        time: '00:15:30',
        timeInMs: 15030,
      },
    ],
    tags: [
      { tag: 'ar', value: 'Chubby Checker oppure  Beatles, The' },
      { tag: 'al', value: "Hits Of The 60's - Vol. 2 – Oldies" },
      { tag: 'ti', value: "Let's Twist Again" },
      { tag: 'au', value: 'Written by Kal Mann / Dave Appell, 1961' },
      { tag: 'length', value: '2:23' },
    ],
  });
});

test('karaoke', () => {
  const lrc = LRC.parse(
    '[00:00.00] <00:00.04> When <00:00.16> the <00:00.82> truth <00:01.29> is <00:01.63> found <00:03.09> to <00:03.37> be <00:05.92> lies',
  );

  expect(lrc).toStrictEqual({
    lines: [
      {
        duration: Infinity,
        text: 'When the truth is found to be lies',
        time: '00:00:00',
        timeInMs: 0,
        words: [
          {
            timeInMs: 4,
            word: 'When',
          },
          {
            timeInMs: 16,
            word: 'the',
          },
          {
            timeInMs: 82,
            word: 'truth',
          },
          {
            timeInMs: 1029,
            word: 'is',
          },
          {
            timeInMs: 1063,
            word: 'found',
          },
          {
            timeInMs: 3009,
            word: 'to',
          },
          {
            timeInMs: 3037,
            word: 'be',
          },
          {
            timeInMs: 5092,
            word: 'lies',
          },
        ],
      },
    ],
    tags: [],
  });
});
