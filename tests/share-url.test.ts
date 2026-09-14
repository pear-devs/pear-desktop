import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import { defaultConfig } from '../src/config/defaults';
import {
  createShareUrlRewriter,
  rewriteShareUrlInput,
  stripMusicSubdomain,
} from '../src/providers/share-url';

test('shared-link normalization is disabled by default', () => {
  expect(defaultConfig.options.stripMusicFromSharedLinks).toBe(false);
});

test('stripMusicSubdomain preserves the rest of a YouTube Music URL', () => {
  expect(
    stripMusicSubdomain(
      'https://music.youtube.com/watch?v=abc123&list=PL123#playing',
    ),
  ).toBe('https://youtube.com/watch?v=abc123&list=PL123#playing');
});

test('stripMusicSubdomain leaves unrelated and malformed URLs unchanged', () => {
  for (const url of [
    'https://youtube.com/watch?v=abc123',
    'https://www.youtube.com/watch?v=abc123',
    'https://notmusic.youtube.com/watch?v=abc123',
    'music.youtube.com/watch?v=abc123',
  ]) {
    expect(stripMusicSubdomain(url)).toBe(url);
  }
});

test('rewriteShareUrlInput updates the visible share field once', () => {
  const window = new Window();
  const input = window.document.createElement('input');
  input.id = 'share-url';
  input.value = 'https://music.youtube.com/watch?v=abc123';
  window.document.body.append(input);

  expect(rewriteShareUrlInput(window.document as unknown as Document)).toBe(
    true,
  );
  expect(input.value).toBe('https://youtube.com/watch?v=abc123');
  expect(rewriteShareUrlInput(window.document as unknown as Document)).toBe(
    false,
  );
});

test('share URL rewriting starts and stops with the setting', () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const input = window.document.createElement('input');
  input.id = 'share-url';
  input.value = 'https://music.youtube.com/watch?v=abc123';
  window.document.body.append(input);

  const rewriter = createShareUrlRewriter(
    document,
    window.MutationObserver as unknown as typeof MutationObserver,
  );
  rewriter.start();
  expect(input.value).toBe('https://youtube.com/watch?v=abc123');

  input.value = 'https://music.youtube.com/watch?v=def456';
  window.document.body.dispatchEvent(
    new window.Event('click', { bubbles: true }),
  );
  expect(input.value).toBe('https://youtube.com/watch?v=def456');

  rewriter.stop();
  input.value = 'https://music.youtube.com/watch?v=ghi789';
  window.document.body.dispatchEvent(
    new window.Event('click', { bubbles: true }),
  );
  expect(input.value).toBe('https://music.youtube.com/watch?v=ghi789');
});
