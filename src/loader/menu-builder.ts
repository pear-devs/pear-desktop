// Builds Electron menu items from a plugin's config schema. Pure: everything
// that touches Electron or i18n comes in through `MenuEnv`.

import type {
  ConfigShape,
  Field,
  Label,
  NumberField,
  ShortcutField,
  StringField,
} from '@/plugins/utils/common/config';
import type { MenuItemConstructorOptions } from 'electron';

export type PromptField = NumberField | StringField | ShortcutField;

export interface MenuEnv {
  /** Resolves a label (translates i18n keys). */
  label(label: Label): string;
  /** The current platform's `Platform` bit. */
  platform: number;
  /** Saves `value` at `path` in the plugin's config. */
  set(path: string[], value: unknown): void;
  /** Asks for a new value of a field without fixed options. */
  prompt(field: PromptField, path: string[], current: unknown): void;
}

const visible = (field: Field, env: MenuEnv) =>
  field.kind !== 'hidden' &&
  field.kind !== 'list' &&
  field.kind !== 'multi' &&
  (field.platforms === undefined || (field.platforms & env.platform) !== 0);

export function buildConfigMenu(
  shape: ConfigShape,
  values: Record<string, unknown>,
  env: MenuEnv,
  path: string[] = [],
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];

  for (const [key, field] of Object.entries(shape)) {
    if (!visible(field, env)) continue;
    const fieldPath = [...path, key];
    const value = values[key];

    if (field.kind === 'group') {
      const children = buildConfigMenu(
        field.fields,
        (value ?? {}) as Record<string, unknown>,
        env,
        fieldPath,
      );
      if (children.length === 0) continue;
      if (field.label === undefined) items.push(...children);
      else items.push({ label: env.label(field.label), submenu: children });
      continue;
    }

    if (field.kind === 'hidden' || field.label === undefined) continue;
    const label = env.label(field.label);
    const toolTip = field.description
      ? env.label(field.description)
      : undefined;

    switch (field.kind) {
      case 'bool': {
        const checked = field.invert ? !value : Boolean(value);
        items.push({
          label,
          toolTip,
          type: 'checkbox',
          checked,
          click: (item) =>
            env.set(fieldPath, field.invert ? !item.checked : item.checked),
        });
        break;
      }
      case 'select':
      case 'number': {
        if (field.kind === 'number' && !field.options) {
          items.push({
            label,
            toolTip,
            click: () => env.prompt(field, fieldPath, value),
          });
          break;
        }
        const options = field.options ?? [];
        items.push({
          label,
          toolTip,
          submenu: options.map((option) => ({
            label:
              option.label === undefined
                ? String(option.value)
                : env.label(option.label),
            type: 'radio' as const,
            checked: option.value === value,
            click: () => env.set(fieldPath, option.value),
          })),
        });
        break;
      }
      case 'string':
      case 'shortcut':
        items.push({
          label,
          toolTip,
          click: () => env.prompt(field, fieldPath, value),
        });
        break;
    }
  }

  return items;
}

/** `{ a: { b: value } }` for the path `['a', 'b']`. */
export const patchAt = (path: string[], value: unknown) =>
  path.reduceRight<unknown>((acc, key) => ({ [key]: acc }), value) as Record<
    string,
    unknown
  >;
