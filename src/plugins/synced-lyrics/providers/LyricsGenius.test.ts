import { test, expect } from '@playwright/test';

import { LyricsGenius } from './LyricsGenius';

test('Genius retrieves multiple hits without adapter identity ranking; partial 404 does not lose valid hit', async () => {
  const originalFetch = globalThis.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    value: class {
      parseFromString(html: string) {
        return {
          querySelectorAll: () => [
            {
              textContent: `window.__PRELOADED_STATE__ = JSON.parse('{"body":{"html":"${html}","children":[]}}');`,
            },
          ],
          body: { innerText: html },
        };
      }
    },
  });
  let missing = false;
  const sources = [
    {
      id: 1,
      title: 'Song',
      path: '/one',
      primary_artist: { url: 'artist' },
      primary_artists: [{ name: 'Artist' }],
    },
    {
      id: 2,
      title: 'Song (Live)',
      path: '/two',
      primary_artist: { url: 'artist' },
      primary_artists: [{ name: 'Artist' }],
    },
  ];
  globalThis.fetch = (input) => {
    const url = input instanceof Request ? input.url : String(input);
    return Promise.resolve(
      String(url).includes('/api/search')
        ? new Response(
            JSON.stringify({
              response: {
                sections: [{ hits: sources.map((result) => ({ result })) }],
              },
            }),
          )
        : missing && String(url).endsWith('/two')
          ? new Response('', { status: 404 })
          : new Response(
              `  Text ${String(url).endsWith('/one') ? 'one' : 'two'}! `,
            ),
    );
  };
  try {
    const info = {
      title: 'Song',
      artist: 'Artist',
      songDuration: 200,
      videoId: 'one',
    };
    const candidates = await new LyricsGenius().search(info);
    expect(candidates.map((item) => item.id)).toEqual(['1', '2']);
    expect(candidates[1].result.title).toBe('Song (Live)');
    expect(candidates[0].result.lyrics).toBe('  Text one! ');
    missing = true;
    expect(
      (await new LyricsGenius().search(info)).map((item) => item.id),
    ).toEqual(['1']);
  } finally {
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, 'DOMParser', descriptor);
    else Reflect.deleteProperty(globalThis, 'DOMParser');
  }
});
