import { createEffect, createMemo, createSignal, Show } from 'solid-js';

import { config } from '../renderer';
import {
  canonicalize,
  convertChineseCharacter,
  romanize,
  simplifyUnicode,
} from '../utils';

interface PlainLyricsProps {
  line: string;
}

export const PlainLyrics = (props: PlainLyricsProps) => {
  const [romanization, setRomanization] = createSignal('');
  const text = createMemo(() => {
    let line = props.line;
    const convertChineseText = config()?.convertChineseCharacter;
    if (convertChineseText && convertChineseText !== 'disabled') {
      line = convertChineseCharacter(line, convertChineseText);
    }
    return line;
  });

  createEffect(() => {
    if (!config()?.romanization) return;

    const input = canonicalize(text());
    romanize(input).then((result) => {
      setRomanization(canonicalize(result));
    });
  });

  const showRomanization = createMemo(
    () =>
      !!config()?.romanization &&
      simplifyUnicode(text()) !== simplifyUnicode(romanization()),
  );

  return (
    <div
      class={`${
        props.line.match(/^\[.+\]$/s) ? 'lrc-header' : ''
      } text-lyrics description ytmusic-description-shelf-renderer`}
      style={{
        'display': 'flex',
        'flex-direction': 'column',
        '--lyrics-original-scale':
          showRomanization() && config()?.big_romanization ? '0.7' : '1',
      }}
    >
      <yt-formatted-string
        class="original"
        text={{
          runs: [{ text: text() }],
        }}
      />
      <Show when={showRomanization()}>
        <yt-formatted-string
          class="romaji"
          text={{
            runs: [{ text: romanization() }],
          }}
        />
      </Show>
    </div>
  );
};
