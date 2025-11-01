import { createSignal, onMount } from 'solid-js';

const states = [
  '(>_<)',
  '{ (>_<) }',
  '{{ (>_<) }}',
  '{{{ (>_<) }}}',
  '{{ (>_<) }}',
  '{ (>_<) }',
];
export const LoadingKaomoji = () => {
  const [counter, setCounter] = createSignal(0);

  onMount(() => {
    const interval = setInterval(() => setCounter((old) => old + 1), 500);
    return () => clearInterval(interval);
  });

  return (
    <yt-formatted-string
      class="text-lyrics description ytmusic-description-shelf-renderer"
      style={{
        'display': 'inline-flex',
        'justify-content': 'center',
        'width': '100%',
        'user-select': 'none',
      }}
      text={{
        runs: [{ text: states[counter() % states.length] }],
      }}
    />
  );
};
