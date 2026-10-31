// Config schema builders. A plugin's `config` is a record of fields; each field
// carries its default and the metadata the settings UI is generated from.

import type { Platform } from "./index.ts";

interface FieldMeta {
  label: string;
  description?: string;
  /** Heading the settings UI groups consecutive fields under. */
  group?: string;
  /** Changes apply only after a restart: shown as a "restart" pill, and offered in the restart banner. */
  restart?: boolean;
  /** Only shown on these platforms (default: all). */
  platforms?: readonly Platform[];
}

interface FieldBase<K extends string, T> extends FieldMeta {
  readonly kind: K;
  readonly default: T;
}

export interface BoolField extends FieldBase<"bool", boolean> {}

export interface NumberField extends FieldBase<"number", number> {
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Default: a slider when bounded with at most 1000 steps, else a stepper. */
  variant?: "slider" | "stepper";
}

export interface StringField extends FieldBase<"string", string> {
  placeholder?: string;
  /** Rendered as a password input; never logged. */
  secret?: boolean;
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectField<T extends string = string> extends FieldBase<"select", T> {
  options: readonly SelectOption<T>[];
  /** Default: chips for up to 8 options, else a dropdown. */
  variant?: "chips" | "dropdown";
}

/** An Electron accelerator such as "CmdOrCtrl+Shift+P"; empty means unset. */
export interface ShortcutField extends FieldBase<"shortcut", string> {}

/** A list of strings the user adds and removes (URLs, file paths, ids). */
export interface ListField extends FieldBase<"list", string[]> {
  placeholder?: string;
}

/** Any number of the given options. */
export interface MultiField<T extends string = string> extends FieldBase<"multi", T[]> {
  options: readonly SelectOption<T>[];
}

export type Field = BoolField | NumberField | StringField | SelectField | ShortcutField | ListField | MultiField;

export type ConfigShape = Record<string, Field>;

export type ConfigOf<S extends ConfigShape> = { -readonly [K in keyof S]: S[K]["default"] };

/** What a builder takes besides the default (and a select's options). */
type Meta<F extends Field> = Omit<F, "kind" | "default" | "options">;

/** The builder of one field kind: `(default, meta) => field`. */
function builder<F extends Field>(kind: F["kind"]) {
  // TypeScript can't relate the spread back to the generic F; it is F by construction.
  return (defaultValue: F["default"], meta: Meta<F>) => ({ kind, default: defaultValue, ...meta }) as F;
}

type Options = readonly SelectOption<string>[];
type ValueOf<O extends Options> = O[number]["value"];

export const config = {
  bool: builder<BoolField>("bool"),
  number: builder<NumberField>("number"),
  string: builder<StringField>("string"),
  shortcut: builder<ShortcutField>("shortcut"),
  list: builder<ListField>("list"),
  select: <const O extends Options>(defaultValue: ValueOf<O>, options: O, meta: Meta<SelectField>): SelectField<ValueOf<O>> => ({
    kind: "select",
    default: defaultValue,
    options,
    ...meta,
  }),
  multi: <const O extends Options>(defaultValue: ValueOf<O>[], options: O, meta: Meta<MultiField>): MultiField<ValueOf<O>> => ({
    kind: "multi",
    default: defaultValue,
    options,
    ...meta,
  }),
};

/** A slider for at most this many steps; finer ranges get a stepper. */
const MAX_SLIDER_STEPS = 1000;
/** Chips for up to this many options; more get a dropdown. */
const MAX_CHIPS = 8;

/** How the settings UI shows a number: its `variant`, or by its range; a slider needs both bounds. */
export function numberVariant(field: NumberField): "slider" | "stepper" {
  if (field.min === undefined || field.max === undefined) return "stepper";
  if (field.variant) return field.variant;
  const steps = (field.max - field.min) / (field.step ?? 1);
  return steps <= MAX_SLIDER_STEPS ? "slider" : "stepper";
}

/** How the settings UI shows a select: its `variant`, or by its number of options. */
export function selectVariant(field: SelectField): "chips" | "dropdown" {
  if (field.variant) return field.variant;
  return field.options.length <= MAX_CHIPS ? "chips" : "dropdown";
}

/** Whether a `platforms` list (absent: every platform) includes `platform`. */
export function onPlatform(platforms: readonly Platform[] | undefined, platform: string) {
  const list: readonly string[] | undefined = platforms;
  return !list || list.includes(platform);
}

export function defaultsOf<S extends ConfigShape>(shape: S): ConfigOf<S> {
  return Object.fromEntries(Object.entries(shape).map(([key, field]) => [key, field.default])) as ConfigOf<S>;
}

/** Coerces stored values onto the schema: unknown keys dropped, invalid values reset to defaults. */
export function normalizeConfig<S extends ConfigShape>(shape: S, stored: unknown): ConfigOf<S> {
  const input = (typeof stored === "object" && stored !== null ? stored : {}) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(shape)) {
    const value = input[key];
    result[key] = isValid(field, value) ? value : field.default;
  }
  return result as ConfigOf<S>;
}

function isValid(field: Field, value: unknown): boolean {
  switch (field.kind) {
    case "bool":
      return typeof value === "boolean";
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (field.min === undefined || value >= field.min) &&
        (field.max === undefined || value <= field.max)
      );
    case "string":
    case "shortcut":
      return typeof value === "string";
    case "select":
      return field.options.some((option) => option.value === value);
    case "list":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "multi":
      return Array.isArray(value) && value.every((item) => field.options.some((option) => option.value === item));
  }
}
