import { test, expect } from '@playwright/test';

import { providerIndicator } from './picker-presentation';

import { LyricsError } from '../search/http';

test('states select original indicators instead of visible enum text; stale abort is hidden', () => {
  expect(
    providerIndicator({ state: 'done', candidates: [], error: null }, true),
  ).toBe('success');
  expect(
    providerIndicator({ state: 'done', candidates: [], error: null }, false),
  ).toBe('unavailable');
  expect(
    providerIndicator(
      { state: 'fetching', candidates: [], error: null },
      false,
    ),
  ).toBe('searching');
  expect(
    providerIndicator(
      { state: 'error', candidates: [], error: new Error('broken') },
      false,
    ),
  ).toBe('failure');
  expect(
    providerIndicator(
      {
        state: 'error',
        candidates: [],
        error: new LyricsError('aborted', 'cancelled'),
      },
      false,
    ),
  ).toBe('hidden');
});
