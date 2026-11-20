import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { expect, test } from '@playwright/test';

const MEDIA_NS = 'urn:x-cast:com.google.cast.media';
type TestSession = {
  loadMedia: (request: unknown, success: () => void) => void;
  media: Array<{
    supportedMediaCommands: string[];
    getStatus: (success: () => void) => void;
    pause: (
      success: () => void,
      error: (failure: { code: string }) => void,
    ) => void;
    playerState: string;
  }>;
};

test('Cast callbacks wait for the matching receiver reply', async () => {
  let onEvent: (event: unknown) => void = () => {};
  const sent: Array<{ requestId: number; type: string }> = [];
  const snapshot = {
    handle: 'cast-test',
    sessionId: 'session-test',
    appId: 'CC1AD845',
    displayName: 'Cast',
    status: 'connected',
    statusText: null,
    namespaces: [],
    receiver: { name: 'Speaker', volume: { level: 1, muted: false } },
  };
  const bridge = {
    onEvent: (listener: typeof onEvent) => {
      onEvent = listener;
    },
    initialize: () => Promise.resolve(),
    resumeSession: () => Promise.resolve({ snapshot: null, fallbackUrl: null }),
    requestSession: () => Promise.resolve(snapshot),
    loadMedia: (_handle: string, request: { requestId: number }) => {
      sent.push({ requestId: request.requestId, type: 'LOAD' });
      return Promise.resolve();
    },
    sendMessage: (_handle: string, _ns: string, data: string) => {
      sent.push(JSON.parse(data) as { requestId: number; type: string });
      return Promise.resolve();
    },
  };
  const cast: Record<string, unknown> = {
    media: { MediaCommand: { PAUSE: 'pause', SEEK: 'seek' } },
  };
  const window = {
    __ytmdCastBridge: bridge,
    __ytmdCastConnected: false,
    chrome: { cast },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
    dispatchEvent: () => {},
  };
  runInNewContext(
    readFileSync(new URL('./page-api.js', import.meta.url), 'utf8'),
    {
      window,
      document: { addEventListener: () => {} },
      CustomEvent: class {},
      location: { pathname: '/', search: '' },
    },
  );
  const initialize = cast.initialize as (
    config: unknown,
    success: () => void,
  ) => void;
  const requestSession = cast.requestSession as (
    success: (session: TestSession) => void,
  ) => void;
  await new Promise<void>((resolve) => initialize({}, resolve));
  const session = await new Promise<TestSession>((resolve) =>
    requestSession(resolve),
  );

  let loaded = false;
  session.loadMedia({ media: { contentId: 'same-song' } }, () => {
    loaded = true;
  });
  const loadId = sent.at(-1)!.requestId;
  onEvent({
    type: 'message',
    handle: snapshot.handle,
    namespace: MEDIA_NS,
    data: JSON.stringify({
      type: 'MEDIA_STATUS',
      requestId: 0,
      status: [
        {
          mediaSessionId: 1,
          playerState: 'PLAYING',
          media: { contentId: 'same-song' },
          supportedMediaCommands: 3,
        },
      ],
    }),
  });
  expect(loaded).toBe(false);
  expect(session.media[0].supportedMediaCommands).toEqual(['pause', 'seek']);
  onEvent({
    type: 'message',
    handle: snapshot.handle,
    namespace: MEDIA_NS,
    data: JSON.stringify({
      type: 'MEDIA_STATUS',
      requestId: loadId,
      status: [
        {
          mediaSessionId: 2,
          playerState: 'PLAYING',
          media: { contentId: 'same-song' },
        },
      ],
    }),
  });
  expect(loaded).toBe(true);

  let statusSucceeded = false;
  session.media[1].getStatus(() => {
    statusSucceeded = true;
  });
  const statusId = sent.at(-1)!.requestId;
  expect(statusSucceeded).toBe(false);
  onEvent({
    type: 'message',
    handle: snapshot.handle,
    namespace: MEDIA_NS,
    data: JSON.stringify({
      type: 'MEDIA_STATUS',
      requestId: statusId,
      status: [
        {
          mediaSessionId: 2,
          playerState: 'PAUSED',
        },
      ],
    }),
  });
  expect(statusSucceeded).toBe(true);
  expect(session.media[1].playerState).toBe('PAUSED');

  onEvent({
    type: 'message',
    handle: snapshot.handle,
    namespace: MEDIA_NS,
    data: JSON.stringify({
      type: 'MEDIA_STATUS',
      requestId: 0,
      status: [
        {
          mediaSessionId: 1,
          playerState: 'IDLE',
          idleReason: 'INTERRUPTED',
        },
      ],
    }),
  });
  expect(session.media).toHaveLength(1);

  let secondRejected = false;
  session.media[0].pause(
    () => {},
    () => {
      throw new Error('page callback failed');
    },
  );
  session.media[0].pause(
    () => {},
    () => {
      secondRejected = true;
    },
  );
  onEvent({ type: 'stopped', handle: snapshot.handle });
  expect(secondRejected).toBe(true);
  expect(window.__ytmdCastConnected).toBe(false);
});
