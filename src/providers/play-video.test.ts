import { expect, test } from '@playwright/test';

import { playVideo } from './play-video';

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
