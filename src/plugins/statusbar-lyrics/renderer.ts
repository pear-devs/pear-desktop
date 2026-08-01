import { createRenderer } from '@/utils';

import type { StatusbarLyricsPluginConfig } from './index';

let activeLineText = '';
let activeLineStartedAt = 0;
let activeLineElement: HTMLElement | null = null;

const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim();

const isLikelyPronunciation = (element: HTMLElement | null) => {
  if (!element) return false;

  const className = element.className?.toString() ?? '';
  if (/(translation|translated|subtitle|pronunciation|romaji|romanization)/i.test(className)) return true;

  return Boolean(
    element.closest('.translation, .translated, .lyrics-translation, .pronunciation, .romaji, [data-translation], [data-romanization], [aria-label*="translation" i], [aria-label*="pronunciation" i], [aria-label*="romaji" i]'),
  );
};

const isLikelyRomaji = (element: HTMLElement | null) => {
  if (!element) return false;

  const className = element.className?.toString() ?? '';
  if (/(romaji|romanization|pronunciation)/i.test(className)) return true;

  return Boolean(element.closest('.romaji, [data-romanization], [aria-label*="romaji" i]'));
};

const getPrimaryText = (element: HTMLElement | null) => {
  if (!element) return '';

  const primaryChildren = Array.from(element.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && !isLikelyPronunciation(child) && !isLikelyRomaji(child),
  );

  const directText = primaryChildren
    .map((child) => normalizeText(child.textContent ?? ''))
    .find(Boolean);

  if (directText) return directText;

  return normalizeText(element.textContent ?? '');
};

const getPrimaryTextElement = (lineElement: HTMLElement | null) => {
  if (!lineElement) return null;

  const candidates = Array.from(lineElement.querySelectorAll<HTMLElement>('.text-lyrics'));
  const visibleCandidate = candidates.find((candidate) => !isLikelyPronunciation(candidate));

  return visibleCandidate ?? candidates[0] ?? null;
};

const parseDurationMs = (element: HTMLElement) => {
  const rawDuration = getComputedStyle(element).getPropertyValue(
    '--lyrics-duration',
  );
  const parsedDuration = Number.parseFloat(rawDuration);

  if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) return null;

  return parsedDuration * 1000;
};

const getLineText = (element: HTMLElement | null, includePronunciation: boolean) => {
  if (!element) return '';

  const textElement = getPrimaryTextElement(element);
  if (!textElement) return '';

  const text = includePronunciation
    ? normalizeText(textElement.textContent ?? '')
    : getPrimaryText(textElement);

  if (!text) return '';

  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);

  return lines[0] ?? text;
};

const pollLyrics = (includePronunciation: boolean) => {
  const currentLine = document.querySelector<HTMLElement>('.synced-line.current');
  if (!currentLine) return '';

  const currentTextElement = getPrimaryTextElement(currentLine);
  if (!currentTextElement) return '';

  const currentText = getLineText(currentLine, includePronunciation);
  const now = performance.now();

  if (activeLineElement !== currentLine || currentText !== activeLineText) {
    activeLineElement = currentLine;
    activeLineText = currentText;
    activeLineStartedAt = now;
  }

  const durationMs = parseDurationMs(currentTextElement) ?? 0;
  const leadMs = Math.max(180, Math.min(400, durationMs * 0.18));
  const switchAtMs = Math.max(0, durationMs - leadMs);

  if (now - activeLineStartedAt >= switchAtMs) {
    const nextLineText = getLineText(
      currentLine?.nextElementSibling as HTMLElement | null,
      includePronunciation,
    );
    if (nextLineText) return nextLineText;
  }

  return currentText;
};

export const renderer = createRenderer({
  async start(ctx) {
    const stop = () => {
      if (timer) {
        window.clearInterval(timer);
      }
      observer?.disconnect();
      ctx.ipc.removeAllListeners('peard:play-or-paused');
      ctx.ipc.removeAllListeners('peard:time-changed');
      void ctx.ipc.invoke('statusbar-lyrics:clear');
    };

    const send = async () => {
      const config = (await ctx.getConfig()) as StatusbarLyricsPluginConfig;
      const text = pollLyrics(config.includePronunciation);

      if (!config.enabled || !text) {
        await ctx.ipc.invoke('statusbar-lyrics:clear');
        return;
      }

      await ctx.ipc.invoke('statusbar-lyrics:set-text', text, config.maxLength);
    };

    let timer: number | undefined;
    let observer: MutationObserver | undefined;

    observer = new MutationObserver(() => {
      void send();
    });

    const target = document.querySelector('ytmusic-player-page');
    if (target) {
      observer.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    }

    timer = window.setInterval(() => {
      void send();
      }, 250);

    ctx.ipc.on('peard:play-or-paused', () => {
      void send();
    });
    ctx.ipc.on('peard:time-changed', () => {
      void send();
    });

    (this as { stop?: () => void }).stop = stop;
  },
  stop() {
    (this as { stop?: () => void }).stop?.();
  },
});
