import { expect, test } from '@playwright/test';

import { parseLibraryPlaylists } from './playlists';

test('extracts playable playlist IDs and continuations from a library response', () => {
  const result = parseLibraryPlaylists({
    gridRenderer: {
      items: [
        {
          musicTwoRowItemRenderer: {
            title: {
              runs: [
                {
                  text: 'First playlist',
                  navigationEndpoint: {
                    browseEndpoint: { browseId: 'VLPLfirst' },
                  },
                },
              ],
            },
            subtitle: { runs: [{ text: 'Playlist' }, { text: ' · 3 songs' }] },
          },
        },
        {
          musicTwoRowItemRenderer: {
            title: {
              runs: [
                {
                  text: 'Second playlist',
                  navigationEndpoint: {
                    browseEndpoint: { browseId: 'VLPLsecond' },
                  },
                },
              ],
            },
          },
        },
        {
          musicTwoRowItemRenderer: {
            title: {
              runs: [
                {
                  text: 'An album',
                  navigationEndpoint: {
                    browseEndpoint: { browseId: 'MPREb_album' },
                  },
                },
              ],
            },
          },
        },
      ],
      continuations: [
        { nextContinuationData: { continuation: 'next-page-token' } },
      ],
    },
  });

  expect(result).toEqual({
    items: [
      {
        playlistId: 'PLfirst',
        title: 'First playlist',
        subtitle: 'Playlist · 3 songs',
      },
      { playlistId: 'PLsecond', title: 'Second playlist', subtitle: undefined },
    ],
    continuation: 'next-page-token',
  });
});
