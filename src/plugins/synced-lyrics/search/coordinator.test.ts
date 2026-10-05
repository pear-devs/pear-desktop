import { test, expect } from '@playwright/test';

import { LyricsCache } from './cache';
import { fingerprint, SearchCoordinator } from './coordinator';
import { LyricsError } from './http';

import type {
  LyricCandidate,
  LyricProvider,
  LyricResult,
  SearchSongInfo,
} from '../types';

const info: SearchSongInfo = {
  videoId: 'one',
  title: 'Song',
  artist: 'Artist',
  songDuration: 10,
};
const result: LyricResult = {
  title: 'Song',
  artists: ['Artist'],
  syncLevel: 'plain',
  lyrics: '  Hello! 世界 ',
};
const options = { showLyricsEvenIfInexact: false };
const candidates = (name = 'p', content = result): LyricCandidate[] => [
  { provider: name, id: 'one', sourceId: 'one', result: content },
];
const provider = (search: LyricProvider['search']): LyricProvider => ({
  name: 'test',
  baseUrl: '',
  search,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('providers complete progressively in either order; same session shares completion', async () => {
  for (const first of ['a', 'b']) {
    const a = deferred<LyricCandidate[]>();
    const b = deferred<LyricCandidate[]>();
    const coordinator = new SearchCoordinator({
      a: provider(() => a.promise),
      b: provider(() => b.promise),
    });
    const snapshots: string[][] = [];
    coordinator.subscribe((session) =>
      snapshots.push(
        Object.keys(session.states).filter(
          (name) => session.states[name].candidates.length,
        ),
      ),
    );
    const session = coordinator.search(info);
    expect(coordinator.search(info)).toBe(session);
    const completion = session.completion;
    expect(coordinator.search(info).completion).toBe(completion);
    (first === 'a' ? a : b).resolve(candidates(first));
    await expect.poll(() => session.states[first].state).toBe('done');
    expect(session.complete).toBe(false);
    expect(
      Object.keys(session.states).filter(
        (name) => session.states[name].candidates.length,
      ),
    ).toEqual([first]);
    expect(snapshots.some((snapshot) => snapshot.length === 1)).toBe(true);
    (first === 'a' ? b : a).resolve([]);
    await session.completion;
    expect(session.complete).toBe(true);
    coordinator.dispose();
  }
});

test('hung and slow providers time out and abort without blocking fast results or global completion', async () => {
  let hungSignal: AbortSignal | undefined;
  const late = deferred<LyricCandidate[]>();
  const coordinator = new SearchCoordinator(
    {
      fast: provider(() => Promise.resolve(candidates('fast'))),
      hung: provider((_, context) => {
        hungSignal = context?.signal;
        return new Promise(() => {});
      }),
      slow: provider(() => late.promise),
      broken: provider(() => {
        throw new Error('broken');
      }),
    },
    new LyricsCache(),
    30,
  );
  const session = coordinator.search(info);
  await session.completion;
  expect(session.states.fast.candidates).toEqual(candidates('fast'));
  expect(session.states.broken.error?.message).toBe('broken');
  expect((session.states.hung.error as LyricsError).kind).toBe('timeout');
  expect((session.states.slow.error as LyricsError).kind).toBe('timeout');
  expect(hungSignal?.aborted).toBe(true);
  expect(session.complete).toBe(true);
  late.resolve(candidates('slow'));
  await Promise.resolve();
  expect(session.states.slow.candidates).toEqual([]);
  coordinator.dispose();
});

test('track switch aborts underlying work and rejects stale completions/cache writes', async () => {
  const old = deferred<LyricCandidate[]>();
  let signal: AbortSignal | undefined;
  const coordinator = new SearchCoordinator({
    p: provider((song, context) => {
      if (song.videoId === 'one') {
        signal = context?.signal;
        return old.promise;
      }
      return Promise.resolve(candidates());
    }),
  });
  const first = coordinator.search(info);
  await Promise.resolve();
  await Promise.resolve();
  const next = coordinator.search({ ...info, videoId: 'two' });
  expect(signal?.aborted).toBe(true);
  await next.completion;
  await first.completion;
  old.resolve(candidates('p', { ...result, lyrics: 'stale' }));
  await Promise.resolve();
  expect(coordinator.current).toBe(next);
  expect(next.states.p.candidates[0].result.lyrics).toBe(result.lyrics);
  expect(coordinator.cache.get(first.fingerprint, 'p')).toBeUndefined();
  coordinator.dispose();
});

test('retry replaces failure cache; revisit cannot resurrect failed state', async () => {
  let attempts = 0;
  const coordinator = new SearchCoordinator({
    p: provider(() => {
      if (++attempts === 1)
        return Promise.reject(new LyricsError('http', 'failed', 500));
      return Promise.resolve(candidates());
    }),
  });
  const session = coordinator.search(info);
  await session.completion;
  expect(session.states.p.state).toBe('error');
  expect(coordinator.retry('p', info)).toBe(session);
  await session.completion;
  expect(session.states.p.candidates).toEqual(candidates());
  await coordinator.search({ ...info, videoId: 'two' }).completion;
  const revisit = coordinator.search(info);
  await revisit.completion;
  expect(revisit.states.p.candidates).toEqual(candidates());
  expect(attempts).toBe(3);
  coordinator.dispose();
});

test('retry while loading aborts superseded provider; late completion cannot overwrite retry', async () => {
  let attempts = 0;
  let oldSignal: AbortSignal | undefined;
  const old = deferred<LyricCandidate[]>();
  const coordinator = new SearchCoordinator({
    p: provider((_, context) => {
      if (++attempts === 1) {
        oldSignal = context?.signal;
        return old.promise;
      }
      return Promise.resolve(candidates());
    }),
  });
  const session = coordinator.search(info);
  await Promise.resolve();
  await Promise.resolve();
  coordinator.retry('p', info);
  expect(oldSignal?.aborted).toBe(true);
  await session.completion;
  old.resolve(candidates('p', { ...result, lyrics: 'old' }));
  await Promise.resolve();
  expect(session.states.p.candidates).toEqual(candidates());
  expect(coordinator.cache.get(session.fingerprint, 'p')?.candidates).toEqual(
    candidates(),
  );
  coordinator.dispose();
});

test('aborted searches are not permanent failures and disposal unsubscribes/aborts work', async () => {
  let signal: AbortSignal | undefined;
  let calls = 0;
  let emitted = 0;
  const coordinator = new SearchCoordinator({
    p: provider((_, context) => {
      signal = context?.signal;
      calls++;
      return new Promise(() => {});
    }),
  });
  coordinator.subscribe(() => emitted++);
  const session = coordinator.search(info);
  await Promise.resolve();
  await Promise.resolve();
  coordinator.cancel();
  expect(signal?.aborted).toBe(true);
  await session.completion;
  expect(coordinator.cache.get(session.fingerprint, 'p')).toBeUndefined();
  const next = coordinator.search(info);
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toBe(2);
  const before = emitted;
  coordinator.dispose();
  await next.completion;
  expect(signal?.aborted).toBe(true);
  expect(emitted).toBe(before);
  expect(coordinator.current).toBeUndefined();
  expect(coordinator.cache.size).toBe(0);
  expect(() => coordinator.search(info)).toThrow('disposed');
});

test('fingerprint covers metadata, matching configuration and provider/search version', () => {
  const key = fingerprint(info, options, ['a', 'b']);
  for (const change of [
    { title: 'Other' },
    { alternativeTitle: 'Other' },
    { artist: 'Other' },
    { album: 'Other' },
    { songDuration: 11 },
    { tags: ['Other'] },
    { videoId: 'two' },
  ]) {
    expect(fingerprint({ ...info, ...change }, options, ['a', 'b'])).not.toBe(
      key,
    );
  }
  expect(
    fingerprint(info, { showLyricsEvenIfInexact: true }, ['a', 'b']),
  ).not.toBe(key);
  expect(fingerprint(info, options, ['a'])).not.toBe(key);
  expect(fingerprint(info, options, ['b', 'a'])).toBe(key);
});

test('invalid provider domain is a schema failure, not a successful cached result', async () => {
  const coordinator = new SearchCoordinator({
    p: provider(() =>
      Promise.resolve(
        candidates('p', {
          ...result,
          syncLevel: 'word',
          lines: [
            {
              text: 'bad',
              startMs: 0,
              segments: [{ text: 'bad', startMs: Infinity }],
            },
          ],
        }),
      ),
    ),
  });
  const session = coordinator.search(info);
  await session.completion;
  expect((session.states.p.error as LyricsError).kind).toBe('parse/schema');
  expect(session.states.p.candidates).toEqual([]);
  coordinator.dispose();
});

test('stale retry cannot replace current track/session or overwrite its cache', async () => {
  let calls = 0;
  const coordinator = new SearchCoordinator({
    p: provider(() => {
      calls++;
      return Promise.resolve(candidates());
    }),
  });
  await coordinator.search(info).completion;
  const current = coordinator.search({ ...info, videoId: 'two' });
  await current.completion;
  expect(coordinator.retry('p', info)).toBeUndefined();
  expect(coordinator.current).toBe(current);
  expect(current.controller.signal.aborted).toBe(false);
  expect(calls).toBe(2);
  coordinator.dispose();
});

test('multiple candidates from one provider survive progressive publish/cache/revisit', async () => {
  let calls = 0;
  const values = [
    ...candidates(),
    {
      ...candidates()[0],
      id: 'two',
      sourceId: 'two',
      language: 'ja',
      album: 'Album',
      durationMs: 10000,
    },
  ];
  const coordinator = new SearchCoordinator({
    p: provider(() => {
      calls++;
      return Promise.resolve(values);
    }),
  });
  const session = coordinator.search(info);
  await session.completion;
  expect(session.states.p.candidates).toEqual(values);
  expect(coordinator.cache.get(session.fingerprint, 'p')?.candidates).toEqual(
    values,
  );
  session.states.p.candidates[0].result.lyrics = 'mutated';
  await coordinator.search({ ...info, videoId: 'two' }).completion;
  const revisit = coordinator.search(info);
  await revisit.completion;
  expect(revisit.states.p.candidates[0].result.lyrics).toBe(result.lyrics);
  expect(calls).toBe(2);
  coordinator.dispose();
});
