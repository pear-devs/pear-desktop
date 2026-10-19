import type { Field } from "@pear/sdk";
import { useEffect, useRef, useState } from "preact/hooks";
import { toAccelerator } from "./accelerator.ts";

interface FieldProps<F extends Field = Field> {
  field: F;
  value: unknown;
  onChange(value: unknown): void;
}

export function FieldEditor({ name, ...props }: FieldProps & { name: string }) {
  const { field } = props;
  const id = `field-${name}`;
  return (
    <div class="field">
      <label class="field-label" for={id}>
        {field.label}
        {field.description && <small>{field.description}</small>}
      </label>
      <Control id={id} {...props} />
    </div>
  );
}

function Control({ id, field, value, onChange }: FieldProps & { id: string }) {
  switch (field.kind) {
    case "bool":
      return <Switch id={id} checked={value === true} onChange={onChange} label={field.label} />;
    case "number":
      return <NumberControl id={id} field={field} value={value} onChange={onChange} />;
    case "string":
      return <TextControl id={id} secret={field.secret ?? false} placeholder={field.placeholder} value={value} onChange={onChange} />;
    case "select":
      return (
        <select id={id} value={String(value)} onChange={(e) => onChange(e.currentTarget.value)}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "shortcut":
      return <ShortcutRecorder id={id} value={String(value ?? "")} onChange={onChange} />;
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
    />
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

function NumberControl({ id, field, value, onChange }: FieldProps<Extract<Field, { kind: "number" }>> & { id: string }) {
  const [draft, setDraft] = useState(Number(value));
  useEffect(() => setDraft(Number(value)), [value]);
  const commit = useDebounced(onChange);
  const update = (next: number) => {
    if (!Number.isFinite(next)) return;
    setDraft(next);
    commit(next);
  };
  const unit = field.unit ?? "";
  if (field.min !== undefined && field.max !== undefined) {
    return (
      <div class="range">
        <input
          id={id}
          type="range"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          value={draft}
          onInput={(e) => update(e.currentTarget.valueAsNumber)}
        />
        <output for={id}>
          {draft}
          {unit}
        </output>
      </div>
    );
  }
  return (
    <input
      id={id}
      type="number"
      value={draft}
      {...(field.min !== undefined ? { min: field.min } : {})}
      {...(field.max !== undefined ? { max: field.max } : {})}
      step={field.step ?? 1}
      onInput={(e) => update(e.currentTarget.valueAsNumber)}
    />
  );
}

function TextControl(props: { id: string; secret: boolean; placeholder: string | undefined; value: unknown; onChange(v: unknown): void }) {
  const [draft, setDraft] = useState(String(props.value ?? ""));
  useEffect(() => setDraft(String(props.value ?? "")), [props.value]);
  const commit = useDebounced(props.onChange, 400);
  return (
    <input
      id={props.id}
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
  return (
    <button
      id={id}
      type="button"
      class="button shortcut"
      data-recording={recording}
      title="Click, then press a key combination. Backspace clears, Escape cancels."
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
      {recording ? "Press keys…" : value || "Not set"}
    </button>
  );
}
