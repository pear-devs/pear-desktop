// Config schema builders. A plugin's `config` is a record of fields; each field
// carries its default and the metadata the settings UI is generated from.

interface FieldMeta {
  label: string;
  description?: string;
  /** Heading the settings UI groups consecutive fields under. */
  group?: string;
  /** Changes apply only after a restart: shown as a "restart" pill, and offered in the restart banner. */
  restart?: boolean;
  /** Only shown on these platforms (default: all). */
  platforms?: readonly ("linux" | "win32" | "darwin")[];
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

type NumberMeta = FieldMeta & Pick<NumberField, "min" | "max" | "step" | "unit" | "variant">;
type SelectMeta = FieldMeta & Pick<SelectField, "variant">;
type StringMeta = FieldMeta & Pick<StringField, "placeholder" | "secret">;

export const config = {
  bool: (defaultValue: boolean, meta: FieldMeta): BoolField => ({ kind: "bool", default: defaultValue, ...meta }),
  number: (defaultValue: number, meta: NumberMeta): NumberField => ({
    kind: "number",
    default: defaultValue,
    ...meta,
  }),
  string: (defaultValue: string, meta: StringMeta): StringField => ({
    kind: "string",
    default: defaultValue,
    ...meta,
  }),
  select: <const O extends readonly SelectOption<string>[]>(
    defaultValue: O[number]["value"],
    options: O,
    meta: SelectMeta,
  ): SelectField<O[number]["value"]> => ({ kind: "select", default: defaultValue, options, ...meta }),
  shortcut: (defaultValue: string, meta: FieldMeta): ShortcutField => ({
    kind: "shortcut",
    default: defaultValue,
    ...meta,
  }),
  list: (defaultValue: string[], meta: FieldMeta & Pick<ListField, "placeholder">): ListField => ({
    kind: "list",
    default: defaultValue,
    ...meta,
  }),
  multi: <const O extends readonly SelectOption<string>[]>(
    defaultValue: O[number]["value"][],
    options: O,
    meta: FieldMeta,
  ): MultiField<O[number]["value"]> => ({ kind: "multi", default: defaultValue, options, ...meta }),
};

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
