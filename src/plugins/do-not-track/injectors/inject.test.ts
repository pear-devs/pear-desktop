import { test, expect } from '@playwright/test';

import { pruneResponse } from './inject';

test('pruning preserves null, primitive and array JSON values', () => {
  for (const value of [null, false, true, 0, 'fixture', ['fixture'], {}]) {
    expect(pruneResponse(value)).toBe(value);
  }
});

test('pruning removes only ad fields from supported player response objects', () => {
  const response = {
    playerAds: [1],
    adPlacements: [2],
    adSlots: [3],
    videoDetails: { title: 'Fixture' },
    playerResponse: { playerAds: [1], streamingData: { formats: [] } },
    ytInitialPlayerResponse: { adSlots: [1], playbackTracking: {} },
    entries: [
      {
        command: {
          reelWatchEndpoint: { adClientParams: { isAd: true, keep: true } },
        },
      },
    ],
  };
  expect(pruneResponse(response)).toEqual({
    videoDetails: { title: 'Fixture' },
    playerResponse: { streamingData: { formats: [] } },
    ytInitialPlayerResponse: { playbackTracking: {} },
    entries: [
      { command: { reelWatchEndpoint: { adClientParams: { keep: true } } } },
    ],
  });
});

test('malformed nested player responses do not break JSON parsing', () => {
  for (const value of [null, false, 3, 'fixture', []]) {
    const response = {
      playerResponse: value,
      ytInitialPlayerResponse: value,
      keep: true,
    };
    expect(pruneResponse(response)).toBe(response);
    expect(response.playerResponse).toBe(value);
  }
});
