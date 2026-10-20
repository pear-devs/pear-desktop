// Translations: pear-desktop's Weblate files (src/i18n/resources/<code>.json),
// flattened to dotted keys. English defaults live next to the code that shows
// them and are passed as the fallback; `nub run i18n` copies new ones into
// en.json so translators see them.

export type Strings = Readonly<Record<string, string>>;
export type Vars = Readonly<Record<string, unknown>>;

/** Looks a key up; falls back to `fallback` (the English text) and then to the key. */
export type Translate = (key: string, fallback?: string, vars?: Vars) => string;

/** `{{name}}` placeholders, the i18next syntax the translation files use. */
export function interpolate(text: string, vars: Vars | undefined): string {
  if (!vars) return text;
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function translator(strings: Strings): Translate {
  return (key, fallback, vars) => interpolate(strings[key] || fallback || key, vars);
}

export function flatten(tree: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof tree === "string") {
    if (prefix) out[prefix] = tree;
  } else if (typeof tree === "object" && tree !== null) {
    for (const [key, value] of Object.entries(tree)) flatten(value, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

/** Where a settings field's texts live (label, description, placeholder, options.<value>). */
export function fieldKey(owner: string, field: string) {
  return owner === "core" ? `settings-ui.core.${field}` : `plugins.${owner}.settings.${field}`;
}

/** Group headings are shared by everything in the settings dialog. */
export function groupKey(group: string) {
  return `settings-ui.groups.${group.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
