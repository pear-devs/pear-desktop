/* eslint-disable stylistic/no-mixed-operators */
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

import {
  selectors,
  getSeekTime,
  SFont,
  normalizePlainLyrics,
  isBlank,
} from './utils';

import {
  ErrorDisplay,
  LoadingKaomoji,
  NotFoundKaomoji,
  SyncedLine,
  PlainLyrics,
} from './components';

import { currentLyrics } from './store';
import { clamp, SCROLL_DURATION, LEAD_IN_TIME_MS } from './scrolling';

import type { LineLyrics, SyncedLyricsPluginConfig } from '../types';

export const [isVisible, setIsVisible] = createSignal<boolean>(false);
export const [config, setConfig] =
  createSignal<SyncedLyricsPluginConfig | null>(null);

export const [fastScrollUntil, setFastScrollUntil] = createSignal<number>(0);
export const requestFastScroll = (windowMs = 700) =>
  setFastScrollUntil(performance.now() + windowMs);

export const [suppressFastUntil, setSuppressFastUntil] =
  createSignal<number>(0);
export const suppressFastScroll = (windowMs = 1200) =>
  setSuppressFastUntil(performance.now() + windowMs);

createEffect(() => {
  if (!config()?.enabled) return;
  const root = document.documentElement;
  const lineEffect = config()?.lineEffect || 'none';
  document.body.classList.toggle('enhanced-lyrics', lineEffect === 'enhanced');
  switch (lineEffect) {
    case 'enhanced':
      root.style.setProperty('--lyrics-font-family', 'Satoshi, sans-serif');
      root.style.setProperty('--lyrics-font-size', '3rem');
      root.style.setProperty('--lyrics-line-height', '1.333');
      root.style.setProperty('--lyrics-width', '100%');
      root.style.setProperty('--lyrics-padding', '12.5px');
      root.style.setProperty('--lyrics-will-change', 'transform, opacity');

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

      root.style.setProperty('--lyrics-hover-scale', '0.975');
      root.style.setProperty('--lyrics-hover-opacity', '0.585');
      root.style.setProperty('--lyrics-hover-empty-opacity', '1');

      root.style.setProperty('--lyrics-empty-opacity', '0.495');
      break;
    case 'fancy':
      root.style.setProperty(
        '--lyrics-font-family',
        '"Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif',
      );
      root.style.setProperty('--lyrics-font-size', '3rem');
      root.style.setProperty('--lyrics-line-height', '1.333');
      root.style.setProperty('--lyrics-width', '100%');
      root.style.setProperty('--lyrics-padding', '2rem');
      root.style.setProperty(
        '--lyrics-animations',
        'lyrics-glow var(--lyrics-glow-duration) forwards, lyrics-wobble var(--lyrics-wobble-duration) forwards',
      );
      root.style.setProperty('--lyrics-will-change', 'auto');

      root.style.setProperty('--lyrics-inactive-font-weight', '700');
      root.style.setProperty('--lyrics-inactive-opacity', '0.33');
      root.style.setProperty('--lyrics-inactive-scale', '0.95');
      root.style.setProperty('--lyrics-inactive-offset', '0');

      root.style.setProperty('--lyrics-active-font-weight', '700');
      root.style.setProperty('--lyrics-active-opacity', '1');
      root.style.setProperty('--lyrics-active-scale', '1');
      root.style.setProperty('--lyrics-active-offset', '0');

      root.style.setProperty('--lyrics-hover-scale', '0.95');
      root.style.setProperty('--lyrics-hover-opacity', '0.33');
      root.style.setProperty('--lyrics-hover-empty-opacity', '1');

      root.style.setProperty('--lyrics-empty-opacity', '1');
      break;
    case 'scale':
      root.style.setProperty(
        '--lyrics-font-family',
        '"Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif',
      );
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
      root.style.setProperty('--lyrics-will-change', 'auto');

      root.style.setProperty('--lyrics-inactive-font-weight', '400');
      root.style.setProperty('--lyrics-inactive-opacity', '0.33');
      root.style.setProperty('--lyrics-inactive-scale', '1');
      root.style.setProperty('--lyrics-inactive-offset', '0');

      root.style.setProperty('--lyrics-active-font-weight', '700');
      root.style.setProperty('--lyrics-active-opacity', '1');
      root.style.setProperty('--lyrics-active-scale', '1.2');
      root.style.setProperty('--lyrics-active-offset', '0');

      root.style.setProperty('--lyrics-hover-scale', '1');
      root.style.setProperty('--lyrics-hover-opacity', '0.33');
      root.style.setProperty('--lyrics-hover-empty-opacity', '1');

      root.style.setProperty('--lyrics-empty-opacity', '1');
      break;
    case 'offset':
      root.style.setProperty(
        '--lyrics-font-family',
        '"Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif',
      );
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
      root.style.setProperty('--lyrics-will-change', 'auto');

      root.style.setProperty('--lyrics-inactive-font-weight', '400');
      root.style.setProperty('--lyrics-inactive-opacity', '0.33');
      root.style.setProperty('--lyrics-inactive-scale', '1');
      root.style.setProperty('--lyrics-inactive-offset', '0');

      root.style.setProperty('--lyrics-active-font-weight', '700');
      root.style.setProperty('--lyrics-active-opacity', '1');
      root.style.setProperty('--lyrics-active-scale', '1');
      root.style.setProperty('--lyrics-active-offset', '5%');

      root.style.setProperty('--lyrics-hover-scale', '1');
      root.style.setProperty('--lyrics-hover-opacity', '0.33');
      root.style.setProperty('--lyrics-hover-empty-opacity', '1');

      root.style.setProperty('--lyrics-empty-opacity', '1');
      break;
    case 'focus':
      root.style.setProperty(
        '--lyrics-font-family',
        '"Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif',
      );
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
      root.style.setProperty('--lyrics-will-change', 'auto');

      root.style.setProperty('--lyrics-inactive-font-weight', '400');
      root.style.setProperty('--lyrics-inactive-opacity', '0.33');
      root.style.setProperty('--lyrics-inactive-scale', '1');
      root.style.setProperty('--lyrics-inactive-offset', '0');

      root.style.setProperty('--lyrics-active-font-weight', '700');
      root.style.setProperty('--lyrics-active-opacity', '1');
      root.style.setProperty('--lyrics-active-scale', '1');
      root.style.setProperty('--lyrics-active-offset', '0');

      root.style.setProperty('--lyrics-hover-scale', '1');
      root.style.setProperty('--lyrics-hover-opacity', '0.33');
      root.style.setProperty('--lyrics-hover-empty-opacity', '1');

      root.style.setProperty('--lyrics-empty-opacity', '1');
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
export const [scrollTargetIndex, setScrollTargetIndex] =
  createSignal<number>(0);
export const LyricsRenderer = () => {
  const [scroller, setScroller] = createSignal<VirtualizerHandle>();
  const [stickyRef, setStickRef] = createSignal<HTMLElement | null>(null);

  let prevTimeForScroll = -1;
  let prevIndexForFast = -1;

  let scrollAnimRaf: number | null = null;
  let scrollAnimActive = false;

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
    SFont();
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
  const [firstEmptyIndex, setFirstEmptyIndex] = createSignal<number | null>(
    null,
  );

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
        const lines = data.lines;
        const firstEmpty = lines.findIndex((l) => isBlank(l.text));
        setFirstEmptyIndex(firstEmpty === -1 ? null : firstEmpty);

        return lines.map((line) => ({
          kind: 'SyncedLine' as const,
          line,
        }));
      }

      if (data?.lyrics) {
        const lines = normalizePlainLyrics(data.lyrics);

        return lines.map((line) => ({
          kind: 'PlainLine' as const,
          line,
        }));
      }

      setFirstEmptyIndex(null);
      return [{ kind: 'NotFoundKaomoji' }];
    });
  });

  const [statuses, setStatuses] = createSignal<
    ('previous' | 'current' | 'upcoming')[]
  >([]);
  createEffect(() => {
    const precise = config()?.preciseTiming ?? false;
    const data = currentLyrics()?.data;
    const currentTimeMs = currentTime();

    if (!data || !data.lines) {
      setStatuses([]);
      return;
    }

    const previous = untrack(statuses);

    // find the current line index (the last line whose startTimeMs <= currentTimeMs)
    let currentIdx = -1;
    for (let i = 0; i < data.lines.length; i++) {
      const startTimeMs = getSeekTime(data.lines[i].timeInMs, precise) * 1000;
      if (currentTimeMs >= startTimeMs) {
        currentIdx = i;
      } else {
        break;
      }
    }
    const current = data.lines.map((_, i) => {
      if (i < currentIdx) return 'previous';
      if (i === currentIdx) return 'current';
      return 'upcoming';
    });

    if (previous.length !== current.length) {
      setStatuses(current);
      return;
    }

    if (!previous.every((status, idx) => status === current[idx])) {
      setStatuses(current);
    }
  });

  const [currentIndex, setCurrentIndex] = createSignal(0);
  createEffect(() => {
    const index = statuses().findIndex((status) => status === 'current');
    if (index === -1) return;
    setCurrentIndex(index);
  });

  // when lyrics tab becomes visible again, open a short fast-scroll window
  createEffect(() => {
    if (isVisible()) {
      requestFastScroll(1500);
    }
  });

  // scroll effect
  createEffect(() => {
    const visible = isVisible();
    const current = currentLyrics();
    const targetIndex = scrollTargetIndex();
    const maxIndex = untrack(statuses).length - 1;
    const scrollerInstance = scroller();
    const lineEffect = config()?.lineEffect;
    const isEnhanced = lineEffect === 'enhanced';

    if (!visible || !scrollerInstance || !current.data?.lines) return;

    // hacky way to make the "current" line scroll to the center of the screen
    const scrollIndex = Math.min(targetIndex + 1, maxIndex);

    // animation duration
    const calculateDuration = (
      distance: number,
      jumpSize: number,
      fast: boolean,
    ) => {
      if (fast) {
        return clamp(
          SCROLL_DURATION.FAST_BASE + distance * SCROLL_DURATION.FAST_MULT,
          SCROLL_DURATION.FAST_MIN,
          SCROLL_DURATION.FAST_MAX,
        );
      }

      let base: number = SCROLL_DURATION.NORMAL_BASE;
      let mult: number = SCROLL_DURATION.NORMAL_MULT;
      let min: number = SCROLL_DURATION.NORMAL_MIN;
      let max: number = SCROLL_DURATION.NORMAL_MAX;

      if (jumpSize === 1) {
        base = SCROLL_DURATION.JUMP1_BASE;
        mult = SCROLL_DURATION.JUMP1_MULT;
        min = SCROLL_DURATION.JUMP1_MIN;
        max = SCROLL_DURATION.JUMP1_MAX;
      } else if (jumpSize > 3) {
        base = SCROLL_DURATION.JUMP4_BASE;
        mult = SCROLL_DURATION.JUMP4_MULT;
        min = SCROLL_DURATION.JUMP4_MIN;
        max = SCROLL_DURATION.JUMP4_MAX;
      }

      const duration = base + distance * mult;
      return clamp(duration, min, max);
    };

    // easing function
    const easeInOutCubic = (t: number) => {
      if (t < 0.5) {
        return 4 * t ** 3;
      }
      const t1 = -2 * t + 2;
      return 1 - t1 ** 3 / 2;
    };

    // target scroll offset
    const calculateEnhancedTargetOffset = (
      scrollerInstance: VirtualizerHandle,
      scrollIndex: number,
      currentIndex: number,
    ) => {
      const viewportSize = scrollerInstance.viewportSize;
      const itemOffset = scrollerInstance.getItemOffset(scrollIndex);
      const itemSize = scrollerInstance.getItemSize(scrollIndex);
      const maxScroll = scrollerInstance.scrollSize - viewportSize;

      if (currentIndex === 0) return 0;

      const viewportCenter = viewportSize / 2;
      const itemCenter = itemSize / 2;
      const centerOffset = itemOffset - viewportCenter + itemCenter;

      return clamp(centerOffset, 0, maxScroll);
    };

    // enhanced scroll animation
    const performEnhancedScroll = (
      scrollerInstance: VirtualizerHandle,
      scrollIndex: number,
      currentIndex: number,
      fast: boolean,
    ) => {
      const targetOffset = calculateEnhancedTargetOffset(
        scrollerInstance,
        scrollIndex,
        currentIndex,
      );
      const startOffset = scrollerInstance.scrollOffset;

      if (startOffset === targetOffset) return;

      const distance = Math.abs(targetOffset - startOffset);
      const jumpSize = Math.abs(scrollIndex - currentIndex);
      const duration = calculateDuration(distance, jumpSize, fast);

      // offset start time to reduce perceived lag and make scroll feel more responsive to user actions
      const animationStartTimeOffsetMs = fast ? 15 : 170;
      const startTime = performance.now() - animationStartTimeOffsetMs;

      scrollAnimActive = false;
      if (scrollAnimRaf !== null) cancelAnimationFrame(scrollAnimRaf);

      if (distance < 0.5) {
        scrollerInstance.scrollTo(targetOffset);
        return;
      }

      const animate = (now: number) => {
        if (!scrollAnimActive) return;
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeInOutCubic(progress);
        const offsetDiff = (targetOffset - startOffset) * eased;
        const currentOffset = startOffset + offsetDiff;

        scrollerInstance.scrollTo(currentOffset);
        if (progress < 1 && scrollAnimActive) {
          scrollAnimRaf = requestAnimationFrame(animate);
        }
      };

      scrollAnimActive = true;
      scrollAnimRaf = requestAnimationFrame(animate);
    };

    // validate scroller measurements
    const isScrollerReady = (
      scrollerInstance: VirtualizerHandle,
      scrollIndex: number,
    ) => {
      const viewport = scrollerInstance.viewportSize;
      const size = scrollerInstance.getItemSize(scrollIndex);
      const offset = scrollerInstance.getItemOffset(scrollIndex);
      return viewport > 0 && size > 0 && offset >= 0;
    };

    let readyRafId: number | null = null;

    const cleanup = () => {
      if (readyRafId !== null) cancelAnimationFrame(readyRafId);
      scrollAnimActive = false;
      if (scrollAnimRaf !== null) cancelAnimationFrame(scrollAnimRaf);
    };
    onCleanup(cleanup);

    // wait for scroller ready
    const waitForReady = (tries = 0) => {
      const nonEnhanced = !isEnhanced;
      const scrollerReady = isScrollerReady(scrollerInstance, scrollIndex);
      const hasCurrentIndex = !nonEnhanced || currentIndex() >= 0;

      if ((scrollerReady && hasCurrentIndex) || tries >= 20) {
        performScroll();
      } else {
        readyRafId = requestAnimationFrame(() => waitForReady(tries + 1));
      }
    };

    const performScroll = () => {
      const now = performance.now();
      const inFastWindow = now < fastScrollUntil();
      const suppressed = now < suppressFastUntil();

      if (!isEnhanced) {
        scrollerInstance.scrollToIndex(scrollIndex, {
          smooth: true,
          align: 'center',
        });
        return;
      }

      const targetOffset = calculateEnhancedTargetOffset(
        scrollerInstance,
        scrollIndex,
        targetIndex,
      );
      const startOffset = scrollerInstance.scrollOffset;
      const distance = Math.abs(targetOffset - startOffset);
      const viewport = scrollerInstance.viewportSize;
      const largeDistance = distance > Math.max(400, viewport * 0.6);
      const fast = inFastWindow && !suppressed && largeDistance;

      performEnhancedScroll(scrollerInstance, scrollIndex, targetIndex, fast);
    };

    waitForReady();
  });

  // handle scroll target updates based on current time
  createEffect(() => {
    const data = currentLyrics()?.data;
    const currentTimeMs = currentTime();
    const idx = currentIndex();
    const lineEffect = config()?.lineEffect;

    if (!data || !data.lines) return;

    // robust fallback if no line is detected as "current" yet
    let effectiveIndex = idx;
    if (effectiveIndex < 0) {
      const lines = data.lines;
      const containing = lines.findIndex((l) => {
        const start = l.timeInMs;
        const end = l.timeInMs + l.duration;
        return currentTimeMs >= start && currentTimeMs < end;
      });
      if (containing !== -1) {
        effectiveIndex = containing;
      } else {
        let lastBefore = 0;
        for (let j = lines.length - 1; j >= 0; j--) {
          if (lines[j].timeInMs <= currentTimeMs) {
            lastBefore = j;
            break;
          }
        }
        effectiveIndex = lastBefore;
      }
    }

    const jumped =
      prevTimeForScroll >= 0 &&
      Math.abs(currentTimeMs - prevTimeForScroll) > 400;
    if (
      jumped &&
      prevTimeForScroll >= 0 &&
      performance.now() >= suppressFastUntil()
    ) {
      const timeDelta = Math.abs(currentTimeMs - prevTimeForScroll);
      const lineDelta =
        prevIndexForFast >= 0 ? Math.abs(effectiveIndex - prevIndexForFast) : 0;
      if (timeDelta > 1500 || lineDelta >= 5) {
        requestFastScroll(1500);
      }
    }
    prevTimeForScroll = currentTimeMs;

    const scrollOffset = scroller()?.scrollOffset ?? 0;
    if (
      effectiveIndex === 0 &&
      currentTimeMs > 2000 &&
      !jumped &&
      scrollOffset <= 1
    ) {
      return;
    }

    if (lineEffect === 'enhanced') {
      const nextIdx = Math.min(effectiveIndex + 1, data.lines.length - 1);
      const nextLine = data.lines[nextIdx];

      if (nextLine) {
        // start scroll early
        const timeUntilNextLine = nextLine.timeInMs - currentTimeMs;

        if (timeUntilNextLine <= LEAD_IN_TIME_MS) {
          setScrollTargetIndex(nextIdx);
          prevIndexForFast = effectiveIndex;
          return;
        }
      }
    }

    prevIndexForFast = effectiveIndex;
    setScrollTargetIndex(effectiveIndex);
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
                  isFinalLine={idx() === children().length}
                  isFirstEmptyLine={
                    firstEmptyIndex() !== null &&
                    idx() - 1 === firstEmptyIndex()
                  }
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
