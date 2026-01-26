import { createEffect, For, Show, createSignal, createMemo } from 'solid-js';

import { type VirtualizerHandle } from 'virtua/solid';

import { type LineLyrics } from '@/plugins/synced-lyrics/types';

import { config, currentTime } from '../renderer';
import { _ytAPI } from '..';

import {
  canonicalize,
  romanize,
  simplifyUnicode,
  getSeekTime,
  isBlank,
  timeCodeText,
} from '../utils';

interface SyncedLineProps {
  scroller: VirtualizerHandle;
  index: number;

  line: LineLyrics;
  status: 'upcoming' | 'current' | 'previous';
  isFinalLine?: boolean;
  isFirstEmptyLine?: boolean;
}

// small helpers
const END_DELAY_SECONDS = 1.0; // end delay at line end
const WORD_ANIM_DELAY_STEP = 0.05; // seconds per word index

const computeEndDelayMs = (totalMs: number): number => {
  const LONG_MS = 3000;
  const SHORT_MS = 1000;
  const SHORT_SECONDS = END_DELAY_SECONDS / 2;
  const SHORT_FRACTION = 0.8;
  const SHORT_MIN_GAP_MS = Math.round(SHORT_SECONDS * 1000 * 0.3);

  if (totalMs > LONG_MS) {
    return Math.round(END_DELAY_SECONDS * 1000);
  }
  if (totalMs >= SHORT_MS) {
    const ratio = (totalMs - SHORT_MS) / (LONG_MS - SHORT_MS);
    const endDelayDelta = (END_DELAY_SECONDS - SHORT_SECONDS) * ratio;
    const endDelaySeconds = SHORT_SECONDS + endDelayDelta;
    return Math.round(endDelaySeconds * 1000);
  }
  return Math.min(
    Math.round(totalMs * SHORT_FRACTION),
    totalMs - SHORT_MIN_GAP_MS,
  );
};

const seekToMs = (ms: number) => {
  const precise = config()?.preciseTiming ?? false;
  _ytAPI?.seekTo(getSeekTime(ms, precise));
};

const renderWordSpans = (input: string) => (
  <span>
    <For each={input.split(' ')}>
      {(word, index) => (
        <span
          style={{
            'transition-delay': `${index() * WORD_ANIM_DELAY_STEP}s`,
            'animation-delay': `${index() * WORD_ANIM_DELAY_STEP}s`,
          }}
        >
          <yt-formatted-string text={{ runs: [{ text: `${word} ` }] }} />
        </span>
      )}
    </For>
  </span>
);

const EmptyLine = (props: SyncedLineProps) => {
  const states = createMemo(() => {
    const defaultText = config()?.defaultTextString ?? '';
    return Array.isArray(defaultText) ? defaultText : [defaultText];
  });

  const isCumulative = createMemo(() => {
    const arr = states();
    if (arr.length <= 1) return false;
    return arr.every((value) => value === arr[0]);
  });

  const endDelayMsValue = createMemo(() =>
    computeEndDelayMs(props.line.duration),
  );

  const index = createMemo(() => {
    const progress = currentTime() - props.line.timeInMs;
    const total = props.line.duration;
    const stepCount = states().length;
    const precise = config()?.preciseTiming ?? false;

    if (stepCount === 1) return 0;

    const endDelayMs = endDelayMsValue();

    const effectiveTotal =
      total <= 1000
        ? total - endDelayMs
        : precise
          ? total - endDelayMs
          : Math.round((total - endDelayMs) / 1000) * 1000;

    if (effectiveTotal <= 0) return 0;

    const effectiveProgress = precise
      ? progress
      : Math.round(progress / 1000) * 1000;
    const percentage = Math.min(1, effectiveProgress / effectiveTotal);

    return Math.max(0, Math.floor((stepCount - 1) * percentage));
  });

  const shouldRenderPlaceholder = createMemo(() => {
    const isEmpty = isBlank(props.line.text);
    const showEmptySymbols = config()?.showEmptyLineSymbols ?? false;

    return isEmpty
      ? showEmptySymbols || props.status === 'current'
      : props.status === 'current';
  });

  const isHighlighted = createMemo(() => props.status === 'current');
  const isFinalEmpty = createMemo(() => {
    return props.isFinalLine && isBlank(props.line.text);
  });

  const shouldRemovePadding = createMemo(() => {
    // remove padding only when this is the first empty line and the configured label is blank (empty string or NBSP)
    if (!props.isFirstEmptyLine) return false;
    const defaultText = config()?.defaultTextString ?? '';
    const first = Array.isArray(defaultText) ? defaultText[0] : defaultText;
    return first === '' || first === '\u00A0';
  });

  // helper to build the class string for the placeholder/empty line
  function getEmptyLineClass() {
    let cls = 'synced-emptyline';
    cls += ` ${props.status}`;
    if (isFinalEmpty()) cls += ' final-empty';
    if (shouldRemovePadding()) cls += ' no-padding';
    return cls;
  }

  return (
    <div
      class={getEmptyLineClass()}
      onClick={() => {
        seekToMs(props.line.timeInMs);
      }}
    >
      <div class="description ytmusic-description-shelf-renderer" dir="auto">
        <yt-formatted-string
          text={{
            runs: [
              {
                text: timeCodeText(
                  props.line.timeInMs,
                  config()?.preciseTiming ?? false,
                  config()?.showTimeCodes ?? false,
                ),
              },
            ],
          }}
        />
        <div class="text-lyrics">
          {props.isFinalLine && isBlank(props.line.text) ? (
            <span>
              <span class={`fade ${isHighlighted() ? 'show' : ''}`}>
                <yt-formatted-string text={{ runs: [{ text: '' }] }} />
              </span>
            </span>
          ) : (
            <Show
              fallback={
                <span
                  class={`fade ${
                    shouldRenderPlaceholder()
                      ? isHighlighted()
                        ? 'show'
                        : 'placeholder'
                      : ''
                  }`}
                >
                  <yt-formatted-string
                    text={{ runs: [{ text: states()[index()] ?? '' }] }}
                  />
                </span>
              }
              when={isCumulative()}
            >
              <For each={states()}>
                {(text, i) => (
                  <span
                    class={`fade ${
                      shouldRenderPlaceholder()
                        ? i() <= index()
                          ? isHighlighted()
                            ? 'show'
                            : 'placeholder'
                          : 'dim'
                        : ''
                    }`}
                  >
                    <yt-formatted-string text={{ runs: [{ text }] }} />
                  </span>
                )}
              </For>
            </Show>
          )}
        </div>
      </div>
    </div>
  );
};

export const SyncedLine = (props: SyncedLineProps) => {
  const text = createMemo(() => props.line.text.trim());

  const [romanization, setRomanization] = createSignal('');
  createEffect(() => {
    const input = canonicalize(text());
    if (!config()?.romanization) return;

    romanize(input).then((result) => {
      setRomanization(canonicalize(result));
    });
  });

  return (
    <Show fallback={<EmptyLine {...props} />} when={text()}>
      <div
        class={`synced-line ${props.status}`}
        onClick={() => {
          seekToMs(props.line.timeInMs);
        }}
      >
        <div class="description ytmusic-description-shelf-renderer" dir="auto">
          <yt-formatted-string
            text={{
              runs: [
                {
                  text: timeCodeText(
                    props.line.timeInMs,
                    config()?.preciseTiming ?? false,
                    config()?.showTimeCodes ?? false,
                  ),
                },
              ],
            }}
          />

          <div
            class="text-lyrics"
            ref={(div: HTMLDivElement) => {
              // TODO: Investigate the animation, even though the duration is properly set, all lines have the same animation duration
              div.style.setProperty(
                '--lyrics-duration',
                `${props.line.duration / 1000}s`,
                'important',
              );
            }}
            style={{ 'display': 'flex', 'flex-direction': 'column' }}
          >
            {renderWordSpans(text())}

            <Show
              when={
                config()?.romanization &&
                simplifyUnicode(text()) !== simplifyUnicode(romanization())
              }
            >
              <span class="romaji">{renderWordSpans(romanization())}</span>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};
