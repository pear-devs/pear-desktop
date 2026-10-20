// One settings row per config field (Material 3 controls): switches inline,
// everything else below the label. The control is picked from the field kind
// and its `variant`.

import {
  type Field,
  type ListField,
  type MultiField,
  type NumberField,
  numberVariant,
  type SelectField,
  selectVariant,
  type ShortcutField,
  type StringField,
} from "@pear/sdk";
import { clamp } from "@pear/sdk/util";
import { useEffect, useRef, useState } from "preact/hooks";
import { toAccelerator } from "./accelerator.ts";
import { useText } from "./strings.ts";

interface FieldProps {
  /** Unique within the dialog; used for ids. */
  name: string;
  field: Field;
  value: unknown;
  onChange(value: unknown): void;
}

interface ControlProps<F extends Field, V> {
  id: string;
  field: F;
  value: V;
  onChange(value: V): void;
}

// Commit on a short idle, so dragging a slider or typing doesn't write settings on every change.
const SLIDER_DEBOUNCE_MS = 200;
const TEXT_DEBOUNCE_MS = 400;

/** Controls that sit next to the label instead of below it. */
const INLINE_KINDS = new Set<Field["kind"]>(["bool", "shortcut"]);

export function SettingsField({ name, field, value, onChange }: FieldProps) {
  const id = `field-${name}`;
  const text = useText();
  const control = <Control id={id} field={field} value={value} onChange={onChange} />;
  const inline = INLINE_KINDS.has(field.kind);
  return (
    <div class="field" data-field={name}>
      <div class="field-row">
        <div class="field-text">
          <div class="label-line">
            <label class="field-label" for={id} id={`${id}-label`}>
              {field.label}
            </label>
            {field.restart && (
              <span class="pill" title={text("settings-ui.restart-pill-hint")}>
                {text("settings-ui.restart-pill")}
              </span>
            )}
          </div>
          {field.description && <div class="field-desc">{field.description}</div>}
        </div>
        {inline && control}
      </div>
      {!inline && <div class="field-control">{control}</div>}
    </div>
  );
}

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value : []);

function Control({ id, field, value, onChange }: ControlProps<Field, unknown>) {
  switch (field.kind) {
    case "bool":
      return <Switch id={id} checked={value === true} label={field.label} onChange={onChange} />;
    case "shortcut":
      return <ShortcutRecorder id={id} field={field} value={String(value ?? "")} onChange={onChange} />;
    case "number":
      return <NumberControl id={id} field={field} value={Number(value)} onChange={onChange} />;
    case "string":
      return <TextControl id={id} field={field} value={String(value ?? "")} onChange={onChange} />;
    case "select":
      return <SelectControl id={id} field={field} value={String(value)} onChange={onChange} />;
    case "list":
      return <ListControl id={id} field={field} value={stringList(value)} onChange={onChange} />;
    case "multi":
      return <MultiControl id={id} field={field} value={stringList(value)} onChange={onChange} />;
  }
}

export function Switch(props: { id?: string; checked: boolean; label: string; onChange(checked: boolean): void }) {
  return (
    <button
      id={props.id}
      type="button"
      role="switch"
      class="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      onClick={() => props.onChange(!props.checked)}
    >
      <span class="switch-thumb" />
    </button>
  );
}

/** `onChange`, called once calls stop coming for `delay`, or on unmount if still pending. */
function useDebounced<V>(onChange: (value: V) => void, delay: number) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<() => void>();
  const flush = () => {
    clearTimeout(timer.current);
    const call = pending.current;
    pending.current = undefined;
    call?.();
  };
  // Closing the dialog or collapsing the card right after an edit still saves it.
  useEffect(() => flush, []);
  return (value: V) => {
    clearTimeout(timer.current);
    pending.current = () => onChange(value);
    timer.current = setTimeout(flush, delay);
  };
}

/** Local state that follows `value` when it changes from outside. */
function useDraft<T>(value: T) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return [draft, setDraft] as const;
}

function NumberControl({ id, field, value, onChange }: ControlProps<NumberField, number>) {
  const [draft, setDraft] = useDraft(value);
  const commit = useDebounced(onChange, SLIDER_DEBOUNCE_MS);
  const update = (next: number, debounce = true) => {
    if (!Number.isFinite(next)) return;
    const clamped = clamp(next, field.min ?? -Infinity, field.max ?? Infinity);
    setDraft(clamped);
    if (debounce) commit(clamped);
    else onChange(clamped);
  };
  const { min, max } = field;
  // numberVariant only picks a slider for bounded fields; the checks tell TypeScript so.
  if (numberVariant(field) === "slider" && min !== undefined && max !== undefined) {
    return <Slider id={id} field={field} min={min} max={max} draft={draft} update={update} />;
  }
  return <Stepper id={id} field={field} draft={draft} update={update} />;
}

interface NumberViewProps {
  id: string;
  field: NumberField;
  draft: number;
  /** Clamps and stores `next`; `debounce: false` commits right away. */
  update(next: number, debounce?: boolean): void;
}

function Slider({ id, field, min, max, draft, update }: NumberViewProps & { min: number; max: number }) {
  const unit = field.unit ?? "";
  const progress = ((draft - min) / (max - min)) * 100;
  return (
    <div class="slider-row">
      <div class="slider-track" style={{ "--progress": `${progress}%` }}>
        <input
          id={id}
          class="slider"
          type="range"
          min={min}
          max={max}
          step={field.step ?? 1}
          value={draft}
          aria-valuetext={`${draft}${unit}`}
          onInput={(e) => update(e.currentTarget.valueAsNumber)}
        />
      </div>
      <output class="slider-value" for={id}>
        {draft}
        {unit && ` ${unit}`}
      </output>
    </div>
  );
}

function Stepper({ id, field, draft, update }: NumberViewProps) {
  const text = useText();
  const step = field.step ?? 1;
  const unit = field.unit ?? "";
  return (
    <div class="stepper">
      <button
        type="button"
        class="stepper-button"
        aria-label={text("settings-ui.decrease", { label: field.label })}
        onClick={() => update(draft - step, false)}
      >
        −
      </button>
      <input
        id={id}
        class="stepper-input"
        type="number"
        value={draft}
        min={field.min}
        max={field.max}
        step={step}
        onInput={(e) => update(e.currentTarget.valueAsNumber)}
      />
      {unit && <span class="stepper-unit">{unit}</span>}
      <button
        type="button"
        class="stepper-button"
        aria-label={text("settings-ui.increase", { label: field.label })}
        onClick={() => update(draft + step, false)}
      >
        +
      </button>
    </div>
  );
}

function SelectControl({ id, field, value, onChange }: ControlProps<SelectField, string>) {
  if (selectVariant(field) === "dropdown") {
    return (
      <select id={id} class="dropdown" value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div class="chips" id={id} role="radiogroup" aria-labelledby={`${id}-label`}>
      {field.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          class="chip"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MultiControl({ id, field, value, onChange }: ControlProps<MultiField, string[]>) {
  const toggle = (option: string, checked: boolean) =>
    onChange(checked ? value.filter((v) => v !== option) : [...value, option]);
  return (
    <div class="chips" id={id} role="group" aria-labelledby={`${id}-label`}>
      {field.options.map((o) => {
        const checked = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role="checkbox"
            class="chip"
            aria-checked={checked}
            onClick={() => toggle(o.value, checked)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** One row per entry; empty entries are dropped when saved. */
function ListControl({ id, field, value, onChange }: ControlProps<ListField, string[]>) {
  const text = useText();
  const [rows, setRows] = useDraft(value);
  const commit = useDebounced((next: string[]) => onChange(next.map((v) => v.trim()).filter(Boolean)), TEXT_DEBOUNCE_MS);
  const update = (next: string[]) => {
    setRows(next);
    commit(next);
  };
  const setRow = (index: number, row: string) => update(rows.map((v, i) => (i === index ? row : v)));
  const removeRow = (index: number) => update(rows.filter((_, i) => i !== index));
  const rowName = (row: string, index: number) => row || text("settings-ui.entry", { number: index + 1 });
  return (
    <div class="list" id={id} role="group" aria-labelledby={`${id}-label`}>
      {rows.map((row, index) => (
        <div class="list-row" key={index}>
          <input
            class="text"
            type="text"
            spellcheck={false}
            placeholder={field.placeholder}
            aria-label={`${field.label} ${index + 1}`}
            value={row}
            onInput={(e) => setRow(index, e.currentTarget.value)}
          />
          <button
            type="button"
            class="icon-button"
            aria-label={text("settings-ui.remove", { item: rowName(row, index) })}
            onClick={() => removeRow(index)}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" class="outlined" onClick={() => setRows([...rows, ""])}>
        {text("settings-ui.add")}
      </button>
    </div>
  );
}

function TextControl({ id, field, value, onChange }: ControlProps<StringField, string>) {
  const [draft, setDraft] = useDraft(value);
  const commit = useDebounced(onChange, TEXT_DEBOUNCE_MS);
  return (
    <input
      id={id}
      class="text"
      type={field.secret ? "password" : "text"}
      autocomplete="off"
      spellcheck={false}
      placeholder={field.placeholder}
      value={draft}
      onInput={(e) => {
        setDraft(e.currentTarget.value);
        commit(e.currentTarget.value);
      }}
    />
  );
}

function ShortcutRecorder({ id, value, onChange }: ControlProps<ShortcutField, string>) {
  const [recording, setRecording] = useState(false);
  const text = useText();
  const onKeyDown = (event: KeyboardEvent) => {
    if (!recording) return;
    event.preventDefault();
    if (event.key === "Escape") return setRecording(false);
    if (event.key === "Backspace" || event.key === "Delete") {
      setRecording(false);
      return onChange("");
    }
    const accelerator = toAccelerator(event);
    if (!accelerator) return;
    setRecording(false);
    onChange(accelerator);
  };
  return (
    <button
      id={id}
      type="button"
      class="outlined shortcut"
      data-recording={recording}
      title={text("settings-ui.shortcut-hint")}
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={onKeyDown}
    >
      {recording ? text("settings-ui.shortcut-recording") : value || text("settings-ui.shortcut-unset")}
    </button>
  );
}
