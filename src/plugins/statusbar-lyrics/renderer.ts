import { createRenderer } from '@/utils';

import type { StatusbarLyricsPluginConfig } from './index';

let activeLineText = '';
let activeLineStartedAt = 0;
let activeLineElement: HTMLElement | null = null;

const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim();

const parseDurationMs = (element: HTMLElement) => {
  const rawDuration = getComputedStyle(element).getPropertyValue(
    '--lyrics-duration',
  );
  const parsedDuration = Number.parseFloat(rawDuration);

  if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) return null;

  return parsedDuration * 1000;
};

const getLineText = (element: HTMLElement | null) => {
  if (!element) return '';

  const textElement = element.querySelector<HTMLElement>('.text-lyrics');
  if (!textElement) return '';

  return normalizeText(textElement.textContent ?? '');
};

const pollLyrics = () => {
  const currentTextElement = document.querySelector<HTMLElement>(
    '.synced-line.current .text-lyrics',
  );
  if (!currentTextElement) return '';

  const currentLine = currentTextElement.closest<HTMLElement>('.synced-line');
  const currentText = normalizeText(currentTextElement.textContent ?? '');
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
    const nextLineText = getLineText(currentLine?.nextElementSibling as HTMLElement | null);
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
      const text = pollLyrics();
      const config = (await ctx.getConfig()) as StatusbarLyricsPluginConfig;

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
