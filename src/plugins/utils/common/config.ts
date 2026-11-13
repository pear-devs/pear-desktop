// Plugin config schemas.
//
// A plugin declares its config as a record of fields. Each field carries its
// default value plus the metadata the generated menu (and, later, a settings
// UI) is built from. Values are stored as a partial object at
// `plugins.<id>` and resolved against the schema whenever they are read.

import type { Platform } from '@/types/plugins';

/**
 * A user-visible text: an i18n key, a key with interpolation variables, or a
 * literal text that needs no translation (e.g. a number).
 */
export type Label =
  | string
  | { key: string; vars?: Record<string, unknown> }
  | { text: string };

export interface FieldMeta {
  label?: Label;
  description?: Label;
  /** Only shown on these platforms (a `Platform` bit mask). Default: all. */
  platforms?: Platform;
}

interface FieldBase<K extends string, T> extends FieldMeta {
  readonly kind: K;
  readonly default: T;
}

export interface BoolField extends FieldBase<'bool', boolean> {
  /** The menu shows the opposite of the stored value (e.g. "24-hour" for `hour12`). */
  invert?: boolean;
}

export interface Option<T> {
  value: T;
  /** Defaults to the value itself. */
  label?: Label;
}

export interface NumberField extends FieldBase<'number', number> {
  min?: number;
  max?: number;
  step?: number;
  /** Fixed choices, shown as radio items. Without them the menu shows a prompt. */
  options?: readonly Option<number>[];
}

export interface StringField extends FieldBase<'string', string> {
  placeholder?: string;
  /** Prompted as a password. */
  secret?: boolean;
}

export interface SelectField<T extends string = string> extends FieldBase<
  'select',
  T
> {
  options: readonly Option<T>[];
}

/** An Electron accelerator such as "CmdOrCtrl+Shift+P"; empty means unset. */
export type ShortcutField = FieldBase<'shortcut', string>;

/** A list of strings the user adds and removes (not in the menu yet). */
export type ListField = FieldBase<'list', string[]>;

/** Any number of the given options (not in the menu yet). */
export interface MultiField<T extends string = string> extends FieldBase<
  'multi',
  T[]
> {
  options: readonly Option<T>[];
}

/**
 * Stored, never shown: runtime state the plugin writes itself, or shapes no
 * editor exists for (tuples, records, arrays of objects, unions).
 */
export interface HiddenField<T = unknown> {
  readonly kind: 'hidden';
  readonly default: T;
}

export interface GroupField<
  S extends ConfigShape = ConfigShape,
> extends FieldMeta {
  readonly kind: 'group';
  readonly fields: S;
}

export type Field =
  | BoolField
  | NumberField
  | StringField
  | SelectField
  | ShortcutField
  | ListField
  | MultiField
  | HiddenField
  | GroupField;

export type ConfigShape = { readonly [key: string]: Field };

type ValueOf<F> =
  F extends GroupField<infer S>
    ? ConfigOf<S>
    : F extends { readonly default: infer T }
      ? T
      : never;

/** The config values a schema describes. */
export type ConfigOf<S extends ConfigShape> = {
  -readonly [K in keyof S]: ValueOf<S[K]>;
};

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

type Meta<F> = Omit<F, 'kind' | 'default' | 'options' | 'fields'>;
type ValueUnion<O extends readonly Option<unknown>[]> = O[number]['value'];

export const config = {
  bool: (defaultValue: boolean, meta: Meta<BoolField> = {}): BoolField => ({
    kind: 'bool',
    default: defaultValue,
    ...meta,
  }),
  number: (
    defaultValue: number,
    meta: Meta<NumberField> & { options?: readonly Option<number>[] } = {},
  ): NumberField => ({ kind: 'number', default: defaultValue, ...meta }),
  string: (
    defaultValue: string,
    meta: Meta<StringField> = {},
  ): StringField => ({ kind: 'string', default: defaultValue, ...meta }),
  select: <const O extends readonly Option<string>[]>(
    defaultValue: ValueUnion<O>,
    options: O,
    meta: Meta<SelectField> = {},
  ): SelectField<ValueUnion<O>> => ({
    kind: 'select',
    default: defaultValue,
    options,
    ...meta,
  }),
  shortcut: (
    defaultValue: string,
    meta: Meta<ShortcutField> = {},
  ): ShortcutField => ({ kind: 'shortcut', default: defaultValue, ...meta }),
  list: (defaultValue: string[], meta: Meta<ListField> = {}): ListField => ({
    kind: 'list',
    default: defaultValue,
    ...meta,
  }),
  multi: <const O extends readonly Option<string>[]>(
    defaultValue: ValueUnion<O>[],
    options: O,
    meta: Meta<MultiField> = {},
  ): MultiField<ValueUnion<O>> => ({
    kind: 'multi',
    default: defaultValue,
    options,
    ...meta,
  }),
  group: <const S extends ConfigShape>(
    fields: S,
    meta: FieldMeta = {},
  ): GroupField<S> => ({ kind: 'group', fields, ...meta }),
  hidden: <T>(defaultValue: T): HiddenField<T> => ({
    kind: 'hidden',
    default: defaultValue,
  }),
};

export const isPlainObject = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const clone = <T>(value: T): T =>
  value === undefined ? value : (structuredClone(value) as T);

/** Merges `patch` into `base`: plain objects deeply, everything else replaced. */
export const mergeDeep = (base: unknown, patch: unknown): unknown => {
  if (!isPlainObject(base) || !isPlainObject(patch)) return clone(patch);
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = key in base ? mergeDeep(base[key], value) : clone(value);
  }
  return result;
};

export function defaultsOf<S extends ConfigShape>(shape: S): ConfigOf<S> {
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(shape)) {
    result[key] =
      field.kind === 'group' ? defaultsOf(field.fields) : clone(field.default);
  }
  return result as ConfigOf<S>;
}

const isOption = (field: { options: readonly Option<unknown>[] }, v: unknown) =>
  field.options.some((option) => option.value === v);

function isValid(field: Exclude<Field, GroupField | HiddenField>, v: unknown) {
  switch (field.kind) {
    case 'bool':
      return typeof v === 'boolean';
    case 'number':
      return (
        typeof v === 'number' &&
        Number.isFinite(v) &&
        (field.min === undefined || v >= field.min) &&
        (field.max === undefined || v <= field.max)
      );
    case 'string':
    case 'shortcut':
      return typeof v === 'string';
    case 'select':
      return isOption(field, v);
    case 'list':
      return Array.isArray(v) && v.every((item) => typeof item === 'string');
    case 'multi':
      return Array.isArray(v) && v.every((item) => isOption(field, item));
  }
}

/**
 * Resolves stored values against a schema: missing or invalid values become
 * their defaults, unknown keys are dropped. Hidden fields take any stored
 * value; plain-object hidden values are deep-merged over their default.
 */
export function normalizeConfig<S extends ConfigShape>(
  shape: S,
  stored: unknown,
): ConfigOf<S> {
  const input = isPlainObject(stored) ? stored : {};
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(shape)) {
    const value = input[key];
    if (field.kind === 'group') {
      result[key] = normalizeConfig(field.fields, value);
    } else if (field.kind === 'hidden') {
      result[key] =
        value === undefined
          ? clone(field.default)
          : mergeDeep(field.default, value);
    } else {
      result[key] = isValid(field, value) ? clone(value) : clone(field.default);
    }
  }
  return result as ConfigOf<S>;
}

const sameValue = (a: unknown, b: unknown) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

/** Whether `a` and `b` differ in any field that isn't hidden. */
export function changedOutsideHidden(
  shape: ConfigShape,
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  for (const [key, field] of Object.entries(shape)) {
    if (field.kind === 'hidden') continue;
    if (field.kind === 'group') {
      const left = isPlainObject(a[key]) ? a[key] : {};
      const right = isPlainObject(b[key]) ? b[key] : {};
      if (changedOutsideHidden(field.fields, left, right)) return true;
    } else if (!sameValue(a[key], b[key])) {
      return true;
    }
  }
  return false;
}

export interface PluginState<C = Record<string, unknown>> {
  enabled: boolean;
  config: C;
}

/** A plugin's `enabled` flag and config from what is stored at `plugins.<id>`. */
export function resolvePluginState(
  def:
    | {
        config?: ConfigShape;
        enabledByDefault?: boolean | (() => boolean);
      }
    | undefined,
  stored: unknown,
): PluginState {
  const raw = isPlainObject(stored) ? stored : {};
  const fallback = def?.enabledByDefault;
  const enabled =
    typeof raw.enabled === 'boolean'
      ? raw.enabled
      : typeof fallback === 'function'
        ? fallback()
        : (fallback ?? false);
  return {
    enabled,
    config: def?.config ? normalizeConfig(def.config, raw) : {},
  };
}
