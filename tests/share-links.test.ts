import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import { defaultConfig } from '../src/config/defaults';
import { setupShareLinks } from '../src/providers/share-links';
import { stripMusicFromShareUrl } from '../src/utils/share-url';

const musicUrl = 'https://music.youtube.com/watch?v=DYj8OTx_rLQ&si=example';
const youtubeUrl = 'https://youtube.com/watch?v=DYj8OTx_rLQ&si=example';

test('shared link rewriting is disabled by default', () => {
  expect(defaultConfig.options.stripMusicFromSharedLinks).toBe(false);
});

for (const [input, output] of [
  [musicUrl, youtubeUrl],
  [
    'https://music.youtube.com/watch?v=video&list=PL123&t=42#fragment',
    'https://youtube.com/watch?v=video&list=PL123&t=42#fragment',
  ],
  [
    'https://music.youtube.com/playlist?list=PL123',
    'https://youtube.com/playlist?list=PL123',
  ],
  [
    'http://music.youtube.com/watch?v=video',
    'http://youtube.com/watch?v=video',
  ],
  [youtubeUrl, youtubeUrl],
  ['https://youtu.be/video', 'https://youtu.be/video'],
  [
    'https://music.youtube.com.example.org/',
    'https://music.youtube.com.example.org/',
  ],
  [
    'https://example.org/?url=https://music.youtube.com/',
    'https://example.org/?url=https://music.youtube.com/',
  ],
  ['ftp://music.youtube.com/video', 'ftp://music.youtube.com/video'],
  ['/watch?v=video', '/watch?v=video'],
  ['not a URL', 'not a URL'],
]) {
  test(`formats only Music HTTP(S) hosts: ${input}`, () => {
    expect(stripMusicFromShareUrl(input)).toBe(output);
  });
}

test.describe('Share panel', () => {
  let browser: Window;
  let setEnabled: ReturnType<typeof setupShareLinks>;
  const globals = [
    'document',
    'Element',
    'HTMLInputElement',
    'MutationObserver',
  ] as const;
  let originalDescriptors: (PropertyDescriptor | undefined)[];

  const createPanel = (url = musicUrl) => {
    const panel = document.createElement('yt-copy-link-renderer');
    const input = document.createElement('input');
    input.id = 'share-url';
    input.readOnly = true;
    input.value = url;
    panel.append(input);
    document.body.append(panel);
    return { panel, input };
  };

  test.beforeEach(() => {
    browser = new Window({ url: 'https://music.youtube.com/' });
    originalDescriptors = globals.map((key) =>
      Object.getOwnPropertyDescriptor(globalThis, key),
    );
    for (const key of globals) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        value: browser[key],
      });
    }
    setEnabled = setupShareLinks();
  });

  test.afterEach(async () => {
    setEnabled(false);
    await browser.happyDOM.close();
    globals.forEach((key, index) => {
      const descriptor = originalDescriptors[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  });

  test('toggles an already-open panel and restores its original URL', () => {
    const { input } = createPanel();
    setEnabled(false);
    expect(input.value).toBe(musicUrl);
    setEnabled(true);
    expect(input.value).toBe(youtubeUrl);
    setEnabled(false);
    expect(input.value).toBe(musicUrl);
    expect(Object.hasOwn(input, 'value')).toBe(false);
    setEnabled(true);
    expect(input.value).toBe(youtubeUrl);
    expect(browser.location.origin).toBe('https://music.youtube.com');
  });

  test('handles panels inserted after enabling', async () => {
    setEnabled(true);
    const { input } = createPanel();
    await browser.happyDOM.waitUntilComplete();
    expect(input.value).toBe(youtubeUrl);
  });

  test('updates reused inputs immediately and restores the latest source', () => {
    const { input, panel } = createPanel();
    setEnabled(true);
    const nextUrl = 'https://music.youtube.com/watch?v=second&t=30';
    input.value = nextUrl;

    // Model the observed Copy button behavior: it reads the live input value.
    const button = document.createElement('button');
    let copied = '';
    button.addEventListener('click', () => {
      copied = input.value;
    });
    panel.append(button);
    button.click();
    expect(copied).toBe('https://youtube.com/watch?v=second&t=30');

    setEnabled(false);
    expect(input.value).toBe(nextUrl);
    input.value = musicUrl;
    expect(input.value).toBe(musicUrl);
  });

  test('handles an initially empty input populated through its value attribute', async () => {
    const { input } = createPanel('');
    setEnabled(true);
    // A fresh input whose value has not been assigned is not dirty.
    const freshInput = document.createElement('input');
    freshInput.id = 'share-url';
    input.replaceWith(freshInput);
    await browser.happyDOM.waitUntilComplete();
    freshInput.setAttribute('value', musicUrl);
    await browser.happyDOM.waitUntilComplete();
    expect(freshInput.value).toBe(youtubeUrl);
  });

  test('leaves unrelated inputs and already-standard share URLs unchanged', () => {
    const unrelated = document.createElement('input');
    unrelated.id = 'share-url';
    unrelated.value = musicUrl;
    document.body.append(unrelated);
    const { input } = createPanel(youtubeUrl);
    setEnabled(true);
    expect(unrelated.value).toBe(musicUrl);
    expect(Object.hasOwn(unrelated, 'value')).toBe(false);
    expect(input.value).toBe(youtubeUrl);
    setEnabled(false);
    expect(input.value).toBe(youtubeUrl);
  });

  test('releases removed inputs and handles reopening the same panel', async () => {
    const { input, panel } = createPanel();
    setEnabled(true);
    panel.remove();
    await browser.happyDOM.waitUntilComplete();
    expect(input.value).toBe(musicUrl);
    expect(Object.hasOwn(input, 'value')).toBe(false);
    document.body.append(panel);
    await browser.happyDOM.waitUntilComplete();
    expect(input.value).toBe(youtubeUrl);
  });
});
