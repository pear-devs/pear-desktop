import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';

import { LyricsPicker } from './components/LyricsPicker';

import { selectors } from './utils';

import {
  ErrorDisplay,
  LoadingKaomoji,
  NotFoundKaomoji,
  SyncedLine,
  PlainLyrics,
} from './components';

import { currentLyrics } from './store';

import type { LineLyrics, SyncedLyricsPluginConfig } from '../types';

export const [isVisible, setIsVisible] = createSignal<boolean>(false);
export const [config, setConfig] =
  createSignal<SyncedLyricsPluginConfig | null>(null);

createEffect(() => {
  if (!config()?.enabled) return;
  const root = document.documentElement;

  // Set the line effect
  switch (config()?.lineEffect) {
    case 'fancy':
      root.style.setProperty('--lyrics-font-size', '3rem');
      root.style.setProperty('--lyrics-line-height', '1.333');
      root.style.setProperty('--lyrics-width', '100%');
      root.style.setProperty('--lyrics-padding', '2rem');
      root.style.setProperty(
        '--lyrics-animations',
        'lyrics-glow var(--lyrics-glow-duration) forwards, lyrics-wobble var(--lyrics-wobble-duration) forwards',
      );

      root.style.setProperty('--lyrics-inactive-font-weight', '700');
      root.style.setProperty('--lyrics-inactive-opacity', '0.33');
      root.style.setProperty('--lyrics-inactive-scale', '0.95');
      root.style.setProperty('--lyrics-inactive-offset', '0');

      root.style.setProperty('--lyrics-active-font-weight', '700');
      root.style.setProperty('--lyrics-active-opacity', '1');
      root.style.setProperty('--lyrics-active-scale', '1');
      root.style.setProperty('--lyrics-active-offset', '0');
      break;
    case 'scale':
      root.style.setProperty(
        '--lyrics-font-size',
        'clamp(1.4rem, 1.1vmax, 3rem)',
      );
      root.style.setProperty(
        '--lyrics-line-height',
        'var(--ytmusic-body-line-height)',
      );
      root.style.setProperty('--lyrics-width', '83%');
      root.style.setProperty('--lyrics-padding', '0');
      root.style.setProperty('--lyrics-animations', 'none');

      root.style.setProperty('--lyrics-inactive-font-weight', '400');
      root.style.setProperty('--lyrics-inactive-opacity', '0.33');
      root.style.setProperty('--lyrics-inactive-scale', '1');
      root.style.setProperty('--lyrics-inactive-offset', '0');

      root.style.setProperty('--lyrics-active-font-weight', '700');
      root.style.setProperty('--lyrics-active-opacity', '1');
      root.style.setProperty('--lyrics-active-scale', '1.2');
      root.style.setProperty('--lyrics-active-offset', '0');
      break;
    case 'offset':
      root.style.setProperty(
        '--lyrics-font-size',
        'clamp(1.4rem, 1.1vmax, 3rem)',
      );
      root.style.setProperty(
        '--lyrics-line-height',
        'var(--ytmusic-body-line-height)',
      );
      root.style.setProperty('--lyrics-width', '100%');
      root.style.setProperty('--lyrics-padding', '0');
      root.style.setProperty('--lyrics-animations', 'none');

      root.style.setProperty('--lyrics-inactive-font-weight', '400');
      root.style.setProperty('--lyrics-inactive-opacity', '0.33');
      root.style.setProperty('--lyrics-inactive-scale', '1');
      root.style.setProperty('--lyrics-inactive-offset', '0');

      root.style.setProperty('--lyrics-active-font-weight', '700');
      root.style.setProperty('--lyrics-active-opacity', '1');
      root.style.setProperty('--lyrics-active-scale', '1');
      root.style.setProperty('--lyrics-active-offset', '5%');
      break;
    case 'focus':
      root.style.setProperty(
        '--lyrics-font-size',
        'clamp(1.4rem, 1.1vmax, 3rem)',
      );
      root.style.setProperty(
        '--lyrics-line-height',
        'var(--ytmusic-body-line-height)',
      );
      root.style.setProperty('--lyrics-width', '100%');
      root.style.setProperty('--lyrics-padding', '0');
      root.style.setProperty('--lyrics-animations', 'none');

      root.style.setProperty('--lyrics-inactive-font-weight', '400');
      root.style.setProperty('--lyrics-inactive-opacity', '0.33');
      root.style.setProperty('--lyrics-inactive-scale', '1');
      root.style.setProperty('--lyrics-inactive-offset', '0');

      root.style.setProperty('--lyrics-active-font-weight', '700');
      root.style.setProperty('--lyrics-active-opacity', '1');
      root.style.setProperty('--lyrics-active-scale', '1');
      root.style.setProperty('--lyrics-active-offset', '0');
      break;
  }
});

type LyricsRendererChild =
  | { kind: 'LyricsPicker' }
  | { kind: 'LoadingKaomoji' }
  | { kind: 'NotFoundKaomoji' }
  | { kind: 'Error'; error: Error }
  | {
      kind: 'SyncedLine';
      line: LineLyrics;
    }
  | {
      kind: 'PlainLine';
      line: string;
    };

const lyricsPicker: LyricsRendererChild = { kind: 'LyricsPicker' };

export const [currentTime, setCurrentTime] = createSignal<number>(-1);
export const LyricsRenderer = () => {
  const [scroller, setScroller] = createSignal<VirtualizerHandle>();
  const [stickyRef, setStickRef] = createSignal<HTMLElement | null>(null);

  const tab = document.querySelector<HTMLElement>(selectors.body.tabRenderer)!;

  let mouseCoord = 0;
  const mousemoveListener = (e: Event) => {
    if ('clientY' in e) {
      mouseCoord = (e as MouseEvent).clientY;
    }

    const { top } = tab.getBoundingClientRect();
    const { clientHeight: height } = stickyRef()!;
    const scrollOffset = scroller()?.scrollOffset ?? -1;

    const isInView = scrollOffset <= height;
    const isMouseOver = mouseCoord - top - 5 <= height;

    const showPicker = isInView || isMouseOver;

    if (showPicker) {
      // picker visible
      stickyRef()!.style.setProperty('--lyrics-picker-top', '0');
    } else {
      // picker hidden
      stickyRef()!.style.setProperty('--lyrics-picker-top', `-${height}px`);
    }
  };

  onMount(() => {
    const vList = document.querySelector<HTMLElement>('.synced-lyrics-vlist');

    tab.addEventListener('mousemove', mousemoveListener);
    vList?.addEventListener('scroll', mousemoveListener);
    vList?.addEventListener('scrollend', mousemoveListener);

    onCleanup(() => {
      tab.removeEventListener('mousemove', mousemoveListener);
      vList?.removeEventListener('scroll', mousemoveListener);
      vList?.removeEventListener('scrollend', mousemoveListener);
    });
  });

  const [children, setChildren] = createSignal<LyricsRendererChild[]>([
    { kind: 'LoadingKaomoji' },
  ]);

  createEffect(() => {
    const current = currentLyrics();
    if (!current) {
      setChildren(() => [{ kind: 'NotFoundKaomoji' }]);
      return;
    }

    const { state, data, error } = current;

    setChildren(() => {
      if (state === 'fetching') {
        return [{ kind: 'LoadingKaomoji' }];
      }

      if (state === 'error') {
        return [{ kind: 'Error', error: error! }];
      }

      if (data?.lines) {
        return data.lines.map((line) => ({
          kind: 'SyncedLine' as const,
          line,
        }));
      }

      if (data?.lyrics) {
        const lines = data.lyrics.split('\n').filter((line) => line.trim());
        return lines.map((line) => ({
          kind: 'PlainLine' as const,
          line,
        }));
      }

      return [{ kind: 'NotFoundKaomoji' }];
    });
  });

  const [statuses, setStatuses] = createSignal<
    ('previous' | 'current' | 'upcoming')[]
  >([]);
  createEffect(() => {
    const time = currentTime();
    const data = currentLyrics()?.data;

    if (!data || !data.lines) return setStatuses([]);

    const previous = untrack(statuses);
    const current = data.lines.map((line) => {
      if (line.timeInMs >= time) return 'upcoming';
      if (time - line.timeInMs >= line.duration) return 'previous';
      return 'current';
    });

    if (previous.length !== current.length) return setStatuses(current);
    if (previous.every((status, idx) => status === current[idx])) return;

    setStatuses(current);
    return;
  });

  const [currentIndex, setCurrentIndex] = createSignal(0);
  createEffect(() => {
    const index = statuses().findIndex((status) => status === 'current');
    if (index === -1) return;
    setCurrentIndex(index);
  });

  createEffect(() => {
    const current = currentLyrics();
    const idx = currentIndex();
    const maxIdx = untrack(statuses).length - 1;

    if (!scroller() || !current.data?.lines) return;

    // hacky way to make the "current" line scroll to the center of the screen
    const scrollIndex = Math.min(idx + 1, maxIdx);

    scroller()!.scrollToIndex(scrollIndex, {
      smooth: true,
      align: 'center',
    });
  });

  return (
    <Show when={isVisible()}>
      <VList
        {...{
          ref: setScroller,
          style: { 'scrollbar-width': 'none' },
          class: 'synced-lyrics-vlist',
          keepMounted: [0],
          overscan: 4,
        }}
        data={[lyricsPicker, ...children()]}
      >
        {(props, idx) => {
          if (typeof props === 'undefined') return null;
          switch (props.kind) {
            case 'LyricsPicker':
              return <LyricsPicker setStickRef={setStickRef} />;
            case 'Error':
              return <ErrorDisplay {...props} />;
            case 'LoadingKaomoji':
              return <LoadingKaomoji />;
            case 'NotFoundKaomoji':
              return <NotFoundKaomoji />;
            case 'SyncedLine': {
              return (
                <SyncedLine
                  {...props}
                  index={idx()}
                  scroller={scroller()!}
                  status={statuses()[idx() - 1]}
                />
              );
            }
            case 'PlainLine': {
              return <PlainLyrics {...props} />;
            }
          }
        }}
      </VList>
    </Show>
  );
};
