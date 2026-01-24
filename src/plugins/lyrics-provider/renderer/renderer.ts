import { createSignal } from 'solid-js';

export const [config, setConfig] = createSignal({
  showLyricsEvenIfInexact: true,
  romanization: true,
});