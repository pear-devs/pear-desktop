// One settings row per config field (Material 3 controls): switches inline,
// everything else below the label. The control is picked from the field kind
// and its `variant`.

import type { Field, ListField, MultiField, NumberField, SelectField } from "@pear/sdk";
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

export function SettingsField({ name, field, value, onChange }: FieldProps) {
  const id = `field-${name}`;
  const text = useText();
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
        {field.kind === "bool" && (
          <Switch id={id} checked={value === true} label={field.label} onChange={onChange} />
        )}
        {field.kind === "shortcut" && <ShortcutRecorder id={id} value={String(value ?? "")} onChange={onChange} />}
      </div>
      {field.kind === "number" && (
        <div class="field-control">
          <NumberControl id={id} field={field} value={Number(value)} onChange={onChange} />
        </div>
      )}
      {field.kind === "string" && (
        <div class="field-control">
          <TextControl id={id} secret={field.secret ?? false} placeholder={field.placeholder} value={value} onChange={onChange} />
        </div>
      )}
      {field.kind === "select" && (
        <div class="field-control">
          <SelectControl id={id} field={field} value={String(value)} onChange={onChange} />
        </div>
      )}
      {field.kind === "list" && (
        <div class="field-control">
          <ListControl id={id} field={field} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} />
        </div>
      )}
      {field.kind === "multi" && (
        <div class="field-control">
          <MultiControl id={id} field={field} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} />
        </div>
      )}
    </div>
  );
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

/** Commits on a short idle so dragging a slider doesn't write settings on every pixel. */
function useDebounced(onChange: (value: unknown) => void, delay = 200) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (value: unknown) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(value), delay);
  };
}

function useDraft<T>(value: T) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return [draft, setDraft] as const;
}

const MAX_SLIDER_STEPS = 1000;

function NumberControl({ id, field, value, onChange }: { id: string; field: NumberField; value: number; onChange(v: unknown): void }) {
  const text = useText();
  const [draft, setDraft] = useDraft(value);
  const commit = useDebounced(onChange);
  const step = field.step ?? 1;
  const clamp = (next: number) => Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, next));
  const update = (next: number, debounce = true) => {
    if (!Number.isFinite(next)) return;
    const clamped = clamp(next);
    setDraft(clamped);
    if (debounce) commit(clamped);
    else onChange(clamped);
  };
  const unit = field.unit ?? "";
  const bounded = field.min !== undefined && field.max !== undefined;
  const slider = field.variant === "slider" || (field.variant !== "stepper" && bounded && (field.max! - field.min!) / step <= MAX_SLIDER_STEPS);

  if (slider && bounded) {
    const progress = ((draft - field.min!) / (field.max! - field.min!)) * 100;
    return (
      <div class="slider-row">
        <div class="slider-track" style={{ "--progress": `${progress}%` }}>
          <input
            id={id}
            class="slider"
            type="range"
            min={field.min}
            max={field.max}
            step={step}
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
  return (
    <div class="stepper">
      <button type="button" class="stepper-button" aria-label={text("settings-ui.decrease", { label: field.label })} onClick={() => update(draft - step, false)}>
        −
      </button>
      <input
        id={id}
        class="stepper-input"
        type="number"
        value={draft}
        {...(field.min !== undefined ? { min: field.min } : {})}
        {...(field.max !== undefined ? { max: field.max } : {})}
        step={step}
        onInput={(e) => update(e.currentTarget.valueAsNumber)}
      />
      {unit && <span class="stepper-unit">{unit}</span>}
      <button type="button" class="stepper-button" aria-label={text("settings-ui.increase", { label: field.label })} onClick={() => update(draft + step, false)}>
        +
      </button>
    </div>
  );
}

const MAX_CHIPS = 8;

function SelectControl({ id, field, value, onChange }: { id: string; field: SelectField; value: string; onChange(v: unknown): void }) {
  const chips = field.variant === "chips" || (field.variant !== "dropdown" && field.options.length <= MAX_CHIPS);
  if (!chips) {
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

function MultiControl({ id, field, value, onChange }: { id: string; field: MultiField; value: string[]; onChange(v: unknown): void }) {
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
            onClick={() => onChange(checked ? value.filter((v) => v !== o.value) : [...value, o.value])}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** One row per entry; empty entries are dropped when saved. */
function ListControl({ id, field, value, onChange }: { id: string; field: ListField; value: string[]; onChange(v: unknown): void }) {
  const text = useText();
  const [rows, setRows] = useDraft(value);
  const commit = useDebounced((next) => onChange((next as string[]).map((v) => v.trim()).filter(Boolean)), 400);
  const update = (next: string[]) => {
    setRows(next);
    commit(next);
  };
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
            onInput={(e) => update(rows.map((v, i) => (i === index ? e.currentTarget.value : v)))}
          />
          <button type="button" class="icon-button" aria-label={text("settings-ui.remove", { item: row || text("settings-ui.entry", { number: index + 1 }) })} onClick={() => update(rows.filter((_, i) => i !== index))}>
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

function TextControl(props: { id: string; secret: boolean; placeholder: string | undefined; value: unknown; onChange(v: unknown): void }) {
  const [draft, setDraft] = useDraft(String(props.value ?? ""));
  const commit = useDebounced(props.onChange, 400);
  return (
    <input
      id={props.id}
      class="text"
      type={props.secret ? "password" : "text"}
      autocomplete="off"
      spellcheck={false}
      placeholder={props.placeholder}
      value={draft}
      onInput={(e) => {
        setDraft(e.currentTarget.value);
        commit(e.currentTarget.value);
      }}
    />
  );
}

function ShortcutRecorder({ id, value, onChange }: { id: string; value: string; onChange(v: unknown): void }) {
  const [recording, setRecording] = useState(false);
  const text = useText();
  return (
    <button
      id={id}
      type="button"
      class="outlined shortcut"
      data-recording={recording}
      title={text("settings-ui.shortcut-hint")}
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(event) => {
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
      }}
    >
      {recording ? text("settings-ui.shortcut-recording") : value || text("settings-ui.shortcut-unset")}
    </button>
  );
}
