import { For } from 'solid-js';

export const Switch = (props: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) => (
  <button
    aria-checked={props.checked}
    class="sui-switch"
    classList={{ 'sui-switch--on': props.checked }}
    onClick={() => props.onChange(!props.checked)}
    role="switch"
    type="button"
  >
    <span class="sui-switch__thumb" />
  </button>
);

export const RadioGroup = (props: {
  value: string;
  options: { value: string; label: () => string }[];
  onChange: (value: string) => void;
}) => (
  <div class="sui-chips">
    <For each={props.options}>
      {(opt) => (
        <button
          class="sui-chip"
          classList={{ 'sui-chip--selected': props.value === opt.value }}
          onClick={() => props.onChange(opt.value)}
          type="button"
        >
          {opt.label()}
        </button>
      )}
    </For>
  </div>
);

export const Dropdown = (props: {
  value: string;
  options: { value: string; label: () => string }[];
  onChange: (value: string) => void;
}) => (
  <select
    class="sui-select"
    onChange={(e) => props.onChange(e.currentTarget.value)}
    value={props.value}
  >
    <For each={props.options}>
      {(opt) => <option value={opt.value}>{opt.label()}</option>}
    </For>
  </select>
);

export const Slider = (props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  onInput: (value: number) => void;
}) => {
  const progress = () =>
    ((props.value - props.min) / (props.max - props.min)) * 100;

  return (
    <div class="sui-slider-row">
      <div
        class="sui-slider-track"
        style={{ '--sui-slider-progress': `${progress()}%` }}
      >
        <input
          aria-valuetext={props.display}
          class="sui-slider"
          max={props.max}
          min={props.min}
          onInput={(e) => props.onInput(Number(e.currentTarget.value))}
          step={props.step ?? 1}
          type="range"
          value={props.value}
        />
      </div>
      <span class="sui-slider__value">{props.display}</span>
    </div>
  );
};

export const TextInput = (props: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) => (
  <input
    class="sui-text"
    onChange={(e) => props.onChange(e.currentTarget.value)}
    placeholder={props.placeholder ?? ''}
    type="text"
    value={props.value}
  />
);

export const CheckGroup = (props: {
  values: string[];
  options: { value: string; label: () => string }[];
  onChange: (values: string[]) => void;
}) => {
  const toggle = (value: string) => {
    const set = new Set(props.values);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    props.onChange([...set]);
  };
  return (
    <div class="sui-chips">
      <For each={props.options}>
        {(opt) => (
          <button
            class="sui-chip"
            classList={{
              'sui-chip--selected': props.values.includes(opt.value),
            }}
            onClick={() => toggle(opt.value)}
            type="button"
          >
            {opt.label()}
          </button>
        )}
      </For>
    </div>
  );
};
