import { createEffect, For, Show, createSignal, createMemo } from 'solid-js';
import { type VirtualizerHandle } from 'virtua/solid';

import {
  type LineLyrics,
  type LineLyricsWord,
} from '@/plugins/synced-lyrics/types';

import { _ytAPI } from '..';
import { config, currentTime } from '../renderer';
import {
  canonicalize,
  convertChineseCharacter,
  romanize,
  simplifyUnicode,
} from '../utils';

interface SyncedLineProps {
  scroller: VirtualizerHandle;
  index: number;

  line: LineLyrics;
  status: 'upcoming' | 'current' | 'previous';
}

interface AnimatedWord {
  text: string;
  delay: number;
}

const GENERIC_WORD_DELAY = 0.05;

const convertLineText = (line: string) => {
  const convertChineseText = config()?.convertChineseCharacter;
  if (convertChineseText && convertChineseText !== 'disabled') {
    return convertChineseCharacter(line, convertChineseText);
  }
  return line;
};

const toAnimatedWords = (
  text: string,
  line: LineLyrics,
  timedWords?: LineLyricsWord[],
): AnimatedWord[] => {
  if (timedWords?.length) {
    const joined = timedWords.map((item) => item.word).join('');
    const addSpaces = joined.trim() !== line.text.trim();

    return timedWords.map((item, index) => {
      let word = convertLineText(item.word);
      if (addSpaces && index < timedWords.length - 1 && !/\s$/.test(word)) {
        word += ' ';
      }

      return {
        text: word,
        delay: Math.max(0, item.timeInMs - line.timeInMs) / 1000,
      };
    });
  }

  return text.split(' ').map((word, index) => ({
    text: `${word} `,
    delay: index * GENERIC_WORD_DELAY,
  }));
};

const EmptyLine = (props: SyncedLineProps) => {
  const states = createMemo(() => {
    const defaultText = config()?.defaultTextString ?? '';
    return Array.isArray(defaultText) ? defaultText : [defaultText];
  });

  const index = createMemo(() => {
    const progress = currentTime() - props.line.timeInMs;
    const total = props.line.duration;

    const percentage = Math.min(1, progress / total);
    return Math.max(0, Math.floor((states().length - 1) * percentage));
  });

  return (
    <div
      class={`synced-line ${props.status}`}
      onClick={() => {
        _ytAPI?.seekTo((props.line.timeInMs + 10) / 1000);
      }}
    >
      <div class="description ytmusic-description-shelf-renderer" dir="auto">
        <yt-formatted-string
          text={{
            runs: [
              {
                text: config()?.showTimeCodes ? `[${props.line.time}] ` : '',
              },
            ],
          }}
        />

        <div class="text-lyrics">
          <span>
            <span>
              <Show
                fallback={
                  <yt-formatted-string
                    text={{ runs: [{ text: states()[0] }] }}
                  />
                }
                when={states().length > 1}
              >
                <yt-formatted-string
                  text={{
                    runs: [
                      {
                        text: states().at(
                          props.status === 'current' ? index() : -1,
                        )!,
                      },
                    ],
                  }}
                />
              </Show>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
};

export const SyncedLine = (props: SyncedLineProps) => {
  const text = createMemo(() => convertLineText(props.line.text).trim());

  const words = createMemo(() =>
    toAnimatedWords(text(), props.line, props.line.words),
  );

  const [romanization, setRomanization] = createSignal('');
  createEffect(() => {
    const input = canonicalize(text());
    if (!config()?.romanization) return;

    romanize(input).then((result) => {
      setRomanization(canonicalize(result));
    });
  });

  const romanizedWords = createMemo(() => {
    const delays = words().map((word) => word.delay);
    const parts = romanization().split(' ');

    return parts.map((word, index) => ({
      text: `${word} `,
      delay: delays[index] ?? index * GENERIC_WORD_DELAY,
    }));
  });

  return (
    <Show fallback={<EmptyLine {...props} />} when={text()}>
      <div
        class={`synced-line ${props.status}`}
        onClick={() => {
          _ytAPI?.seekTo((props.line.timeInMs + 10) / 1000);
        }}
      >
        <div class="description ytmusic-description-shelf-renderer" dir="auto">
          <yt-formatted-string
            text={{
              runs: [
                {
                  text: config()?.showTimeCodes ? `[${props.line.time}] ` : '',
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
            <span>
              <For each={words()}>
                {(word) => {
                  return (
                    <span
                      style={{
                        'transition-delay': `${word.delay}s`,
                        'animation-delay': `${word.delay}s`,
                      }}
                    >
                      <yt-formatted-string
                        text={{
                          runs: [{ text: word.text }],
                        }}
                      />
                    </span>
                  );
                }}
              </For>
            </span>

            <Show
              when={
                config()?.romanization &&
                simplifyUnicode(text()) !== simplifyUnicode(romanization())
              }
            >
              <span class="romaji">
                <For each={romanizedWords()}>
                  {(word) => {
                    return (
                      <span
                        style={{
                          'transition-delay': `${word.delay}s`,
                          'animation-delay': `${word.delay}s`,
                        }}
                      >
                        <yt-formatted-string
                          text={{
                            runs: [{ text: word.text }],
                          }}
                        />
                      </span>
                    );
                  }}
                </For>
              </span>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};
