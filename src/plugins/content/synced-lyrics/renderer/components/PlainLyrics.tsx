import { createEffect, createSignal, Show } from 'solid-js';

import { canonicalize, romanize, simplifyUnicode } from '../utils';
import { config } from '../renderer';

interface PlainLyricsProps {
  line: string;
}

export const PlainLyrics = (props: PlainLyricsProps) => {
  const [romanization, setRomanization] = createSignal('');

  createEffect(() => {
    if (!config()?.romanization) return;

    const input = canonicalize(props.line);
    romanize(input).then((result) => {
      setRomanization(canonicalize(result));
    });
  });

  return (
    <div
      class={`${
        props.line.match(/^\[.+\]$/s) ? 'lrc-header' : ''
      } text-lyrics description ytmusic-description-shelf-renderer`}
      style={{
        'display': 'flex',
        'flex-direction': 'column',
      }}
    >
      <yt-formatted-string
        text={{
          runs: [{ text: props.line }],
        }}
      />
      <Show
        when={
          config()?.romanization &&
          simplifyUnicode(props.line) !== simplifyUnicode(romanization())
        }
      >
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
