/** Declarative settings schema for the in-app Settings modal. */

export interface SettingFieldBase {
  key: string;
  label: () => string;
  description?: () => string;
  /** Show a "restart" pill and flag the modal's restart banner when changed. */
  restartNeeded?: boolean;
}

export interface SwitchField extends SettingFieldBase {
  type: 'switch';
}

export interface SelectField extends SettingFieldBase {
  type: 'select';
  /** `radio` renders inline chips (default), `dropdown` a native select. */
  variant?: 'radio' | 'dropdown';
  options: { value: string; label: () => string }[];
}

export interface SliderField extends SettingFieldBase {
  type: 'slider';
  min: number;
  max: number;
  step?: number;
  /** Suffix shown next to the value readout, e.g. `%`, `ms`, `min`. */
  unit?: string;
  /** Multiplier between displayed and stored value. @default 1 */
  scale?: number;
}

export interface TextField extends SettingFieldBase {
  type: 'text';
  placeholder?: () => string;
}

export interface MultiSelectField extends SettingFieldBase {
  type: 'multiselect';
  options: { value: string; label: () => string }[];
}

export type SettingField =
  | SwitchField
  | SelectField
  | SliderField
  | TextField
  | MultiSelectField;

export interface SettingsGroup {
  title?: () => string;
  fields: SettingField[];
}

/**
 * A plugin's declared settings. Either a flat field list (rendered as one
 * untitled group) or an explicit list of titled groups.
 */
export type SettingsSchema = SettingField[] | SettingsGroup[];

export const isSettingsGroups = (
  schema: SettingsSchema,
): schema is SettingsGroup[] =>
  schema.length > 0 && 'fields' in (schema[0] as SettingsGroup);

/** Normalize a schema to a list of groups. */
export const toSettingsGroups = (schema: SettingsSchema): SettingsGroup[] =>
  isSettingsGroups(schema) ? schema : [{ fields: schema as SettingField[] }];
