import { expect, test } from '@playwright/test';

import { playPlaylist, playVideo } from './play-video';

test('navigates the app to the selected video', () => {
  const app = new EventTarget();
  let event: CustomEvent | undefined;

  app.addEventListener('yt-navigate', (receivedEvent) => {
    event = receivedEvent as CustomEvent;
  });

  playVideo(app, 'mcp-video-id');

  expect(event).toBeDefined();
  expect(event?.bubbles).toBe(true);
  expect(event?.composed).toBe(true);
  expect(event?.detail).toEqual({
    endpoint: {
      clickTrackingParams: '',
      commandMetadata: {
        webCommandMetadata: {
          rootVe: 3832,
          url: '/watch?v=mcp-video-id',
          webPageType: 'WEB_PAGE_TYPE_WATCH',
        },
      },
      watchEndpoint: { videoId: 'mcp-video-id' },
    },
  });
});

test('navigates the app to the first video in a playlist', () => {
  const app = new EventTarget();
  let event: CustomEvent | undefined;

  app.addEventListener('yt-navigate', (receivedEvent) => {
    event = receivedEvent as CustomEvent;
  });

  playPlaylist(app, 'mcp-playlist-id');

  expect(event).toBeDefined();
  expect(event?.detail).toEqual({
    endpoint: {
      clickTrackingParams: '',
      commandMetadata: {
        webCommandMetadata: {
          rootVe: 3832,
          url: '/watch?list=mcp-playlist-id',
          webPageType: 'WEB_PAGE_TYPE_WATCH',
        },
      },
      watchEndpoint: { playlistId: 'mcp-playlist-id' },
    },
  });
});
