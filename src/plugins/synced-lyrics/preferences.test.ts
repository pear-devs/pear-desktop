import { test, expect } from '@playwright/test';
import { deepmerge } from 'deepmerge-ts';

import {
  migratePreferredProvider,
  normalizePreferredProvider,
  readSongChoice,
  writeSongChoice,
} from './preferences';

test('global Auto explicitly survives serialized restart and overwrites old provider', () => {
  const old = { enabled: true, preferredProvider: 'LRCLib' };
  const updated = deepmerge(old, { preferredProvider: 'auto' });
  const restarted = JSON.parse(JSON.stringify(updated)) as {
    preferredProvider: unknown;
  };
  expect(normalizePreferredProvider(restarted.preferredProvider)).toBe('auto');
  expect(
    deepmerge({ preferredProvider: 'LRCLib' }, restarted).preferredProvider,
  ).toBe('auto');
});
test('missing/invalid/removed preferred providers migrate to Auto; valid preferences survive', () => {
  for (const value of [undefined, null, '', 'removed', 'Megalobiz', 10, 'auto'])
    expect(normalizePreferredProvider(value)).toBe('auto');
  expect(normalizePreferredProvider('LRCLib')).toBe('LRCLib');
});

test('shared config migration persists invalid/missing preference once and preserves explicit Auto', async () => {
  const writes: unknown[] = [];
  const persist = (value: unknown) => {
    writes.push(value);
    return Promise.resolve();
  };
  expect(await migratePreferredProvider(undefined, persist)).toBe('auto');
  expect(await migratePreferredProvider('removed-provider', persist)).toBe(
    'auto',
  );
  expect(writes).toEqual([
    { preferredProvider: 'auto' },
    { preferredProvider: 'auto' },
  ]);
  await migratePreferredProvider('auto', persist);
  await migratePreferredProvider('LRCLib', persist);
  expect(writes).toHaveLength(2);
});
test('legacy provider star migrates; exact variant persists; clearing cannot resurrect old source', () => {
  const values = new Map([
    ['ytmd-sl-starred-video', JSON.stringify({ provider: 'LRCLib' })],
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  expect(readSongChoice(storage, 'video')).toEqual({
    kind: 'source',
    provider: 'LRCLib',
    candidateId: null,
  });
  const choice = {
    kind: 'source',
    provider: 'LRCLib',
    candidateId: '123',
  } as const;
  writeSongChoice(storage, 'video', choice);
  expect(readSongChoice(storage, 'video')).toEqual(choice);
  writeSongChoice(storage, 'video', null);
  expect(readSongChoice(storage, 'video')).toBeNull();
  for (const bad of [
    '{bad',
    '{}',
    '{"kind":"auto","provider":"LRCLib"}',
    '{"provider":1}',
    '{"provider":"LRCLib","candidateId":10}',
  ]) {
    values.set('ytmd-sl-starred-video', bad);
    expect(readSongChoice(storage, 'video')).toBeNull();
  }
});
