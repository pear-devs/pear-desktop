/** @jsxImportSource @pear/sdk */
// The speed popover's body: the current speed, a slider and preset buttons.

import { format, PRESETS, SLIDER_MAX, SLIDER_MIN, SLIDER_STEP } from "./speed.ts";

export function speedPanel(title: string, setSpeed: (speed: number) => void) {
  const label = <span />;
  const slider = (
    <input
      type="range"
      min={String(SLIDER_MIN)}
      max={String(SLIDER_MAX)}
      step={String(SLIDER_STEP)}
      aria-label={title}
      onInput={(event) => setSpeed(event.currentTarget.valueAsNumber)}
    />
  ) as HTMLInputElement;
  const presets = PRESETS.map((value) => <button onClick={() => setSpeed(value)}>{format(value)}</button>);

  const body = [
    <header>
      {title}
      {label}
    </header>,
    slider,
    <div class="pear-speed-presets">{presets}</div>,
  ];
  const render = (speed: number) => {
    label.textContent = format(speed);
    slider.value = String(speed);
    for (const [i, preset] of presets.entries()) preset.setAttribute("aria-pressed", String(PRESETS[i] === speed));
  };
  return { body, render };
}
