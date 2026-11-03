// The settings dialog's own texts: English defaults by translation key (the
// keys pear-desktop's settings UI used). `nub run i18n` copies them into en.json.

import type { Field } from "@pear/sdk";
import { fieldKey, groupKey, type Translate, type Vars } from "@pear/sdk/i18n";
import { createContext } from "preact";
import { useContext } from "preact/hooks";

export const UI_STRINGS = {
  "settings-ui.title": "Settings",
  "settings-ui.search-placeholder": "Search settings",
  "settings-ui.sections-label": "Settings sections",
  "settings-ui.search-results": "Search results",
  "settings-ui.search-matching": "Matching “{{query}}”",
  "settings-ui.no-match": "No settings match “{{query}}”.",
  "settings-ui.close": "Close settings",
  "settings-ui.show-config": "Show config.json",
  "settings-ui.restart-banner": "Some changes need a restart to take effect.",
  "settings-ui.later": "Later",
  "settings-ui.restart-now": "Restart now",
  "settings-ui.restart-pill": "restart",
  "settings-ui.restart-pill-hint": "Applies after a restart",
  "settings-ui.restart-plugin-hint": "Enabling or disabling applies after a restart",
  "settings-ui.error-pill": "error",
  "settings-ui.configure": "Configure {{name}}",
  "settings-ui.enable": "Enable {{name}}",
  "settings-ui.add": "Add",
  "settings-ui.remove": "Remove {{item}}",
  "settings-ui.entry": "entry {{number}}",
  "settings-ui.decrease": "Decrease {{label}}",
  "settings-ui.increase": "Increase {{label}}",
  "settings-ui.shortcut-recording": "Press keys…",
  "settings-ui.shortcut-unset": "Not set",
  "settings-ui.shortcut-hint": "Click, then press a key combination. Backspace clears, Escape cancels.",
  "settings-ui.open": "Pear Desktop settings",
  "settings-ui.open-hint": "Pear Desktop settings (Ctrl+,)",
  "settings-ui.api-server-status": "Listening on {{address}} · API docs at {{address}}/swagger",
  "settings-ui.blocks.tray": "Tray",
  "settings-ui.blocks.title-bar": "Title bar",
  "settings-ui.blocks.api-server": "API server",
  "settings-ui.blocks.developer": "Developer",
  "settings-ui.blocks.site-flags": "Site feature flags",
  "settings-ui.site-flags.hint":
    "The flags \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music sent this session. Switching one adds it to the overrides above, after a restart. Most only change what the server sends, so overriding them does nothing.",
  "settings-ui.site-flags.filter": "Filter flags",
  "settings-ui.site-flags.empty": "No flags match.",
  "settings-ui.site-flags.more": "{{count}} more; narrow the filter to see them.",
  "settings-ui.site-flags.overridden": "overridden",
  "settings-ui.site-flags.reset": "Remove the override of {{name}}",
  "settings-ui.toggle-devtools": "Toggle developer tools",
  "settings-ui.sections.general.label": "General",
  "settings-ui.sections.general.sub": "Startup, language and updates",
  "settings-ui.sections.appearance.label": "Appearance",
  "settings-ui.sections.appearance.sub": "Interface, window title and themes",
  "settings-ui.sections.window.label": "Window & Tray",
  "settings-ui.sections.window.sub": "Window behaviour and system tray",
  "settings-ui.sections.advanced.label": "Advanced",
  "settings-ui.sections.advanced.sub": "Performance, network and API server",
  "settings-ui.sections.developer.label": "Developer Tweaks",
  "settings-ui.sections.developer.sub": "Site feature flags and developer tools",
  "settings-ui.sections.plugins.label": "Plugins",
  "settings-ui.sections.plugins.sub": "Enable plugins and configure them",
  "settings-ui.sections.about.label": "About",
  "settings-ui.sections.about.sub": "Versions and app info",
  "settings-ui.about.tagline": "A feature-rich desktop app for \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music",
  "settings-ui.about.versions": "Versions",
  "settings-ui.about.platform": "Platform",
  "settings-ui.about.actions": "Actions",
  "settings-ui.about.copy-debug": "Copy debug info",
  "settings-ui.about.copied": "Copied!",
  "settings-ui.about.enabled-plugins": "Enabled plugins: {{plugins}}",
  "settings-ui.about.none": "none",
} as const;

export type UiKey = keyof typeof UI_STRINGS;

export type Text = (key: UiKey, vars?: Vars) => string;

const fallbackT: Translate = (key, fallback) => fallback ?? key;
export const TranslateContext = createContext<Translate>(fallbackT);

/** The dialog's texts in the active language. */
export function useText(): Text {
  const t = useContext(TranslateContext);
  return (key, vars) => t(key, UI_STRINGS[key], vars);
}

/** A field with its texts in the active language (labels live next to the code, in English). */
export function localize(t: Translate, owner: string, name: string, field: Field): Field {
  const key = fieldKey(owner, name);
  return {
    ...field,
    label: t(`${key}.label`, field.label),
    ...(field.description && { description: t(`${key}.description`, field.description) }),
    ...(field.group && { group: t(groupKey(field.group), field.group) }),
    ...("placeholder" in field && field.placeholder && { placeholder: t(`${key}.placeholder`, field.placeholder) }),
    ...("options" in field && {
      options: field.options.map((option) => ({ ...option, label: t(`${key}.options.${option.value}`, option.label) })),
    }),
  };
}
