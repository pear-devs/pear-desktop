import { For, Show } from 'solid-js';

import type { SettingOption } from '@/types/settings';

type OptionValue = string | number;

export const Switch = (props: {
  checked: boolean;
  label?: string;
  onChange: (value: boolean) => void;
}) => (
  <button
    aria-checked={props.checked}
    aria-label={props.label}
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
  value: OptionValue;
  options: SettingOption[];
  onChange: (value: OptionValue) => void;
}) => (
  <div class="sui-chips">
    <For each={props.options}>
      {(opt) => (
        <button
          aria-pressed={props.value === opt.value}
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
  value: OptionValue;
  options: SettingOption[];
  onChange: (value: OptionValue) => void;
}) => {
  const emit = (raw: string) => {
    const opt = props.options.find((o) => String(o.value) === raw);
    props.onChange(opt ? opt.value : raw);
  };
  return (
    <select
      class="sui-select"
      onChange={(e) => emit(e.currentTarget.value)}
      value={String(props.value)}
    >
      <For each={props.options}>
        {(opt) => <option value={String(opt.value)}>{opt.label()}</option>}
      </For>
    </select>
  );
};

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

export const NumberStepper = (props: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) => {
  const step = () => props.step ?? 1;
  const clamp = (v: number) => {
    let next = v;
    if (props.min !== undefined) next = Math.max(props.min, next);
    if (props.max !== undefined) next = Math.min(props.max, next);
    return next;
  };
  const set = (v: number) => {
    if (Number.isFinite(v)) props.onChange(clamp(v));
  };

  return (
    <div class="sui-stepper">
      <button
        aria-label="decrement"
        class="sui-stepper__btn"
        onClick={() => set(props.value - step())}
        type="button"
      >
        −
      </button>
      <input
        class="sui-stepper__input"
        max={props.max}
        min={props.min}
        onChange={(e) => set(Number(e.currentTarget.value))}
        step={step()}
        type="number"
        value={props.value}
      />
      <Show when={props.unit}>
        <span class="sui-stepper__unit">{props.unit}</span>
      </Show>
      <button
        aria-label="increment"
        class="sui-stepper__btn"
        onClick={() => set(props.value + step())}
        type="button"
      >
        +
      </button>
    </div>
  );
};

export const CheckGroup = (props: {
  values: OptionValue[];
  options: SettingOption[];
  onChange: (values: OptionValue[]) => void;
}) => {
  const toggle = (value: OptionValue) => {
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
            aria-pressed={props.values.includes(opt.value)}
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
