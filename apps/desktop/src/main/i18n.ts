// The active language's strings (English underneath, for untranslated keys).
// All translation files are embedded at build time; the page gets only the
// active language's strings, in its bootstrap.

import { flatten, type Strings, type Translate, translator } from "@pear/sdk/i18n";
import { translations } from "@pear/sdk/macros" with { type: "macro" };

const RESOURCES = translations() as Record<string, unknown>;

/** The configured language if there is one, else the system's, else English. */
export function resolveLanguage(configured: string, systemLocale: string): string {
  const available = (code: string) => (Object.hasOwn(RESOURCES, code) ? code : undefined);
  if (configured && available(configured)) return configured;
  // "pt-BR" -> "pt-BR", then "pt"; "zh-Hant-TW" -> "zh-Hant-TW", "zh-Hant", "zh".
  const parts = systemLocale.split(/[-_]/);
  for (let length = parts.length; length > 0; length--) {
    const code = available(parts.slice(0, length).join("-"));
    if (code) return code;
  }
  return "en";
}

export interface I18n {
  readonly language: string;
  readonly strings: Strings;
  readonly t: Translate;
}

export function loadI18n(language: string): I18n {
  // Untranslated entries are empty strings in Weblate's files; drop them so English shows.
  const nonEmpty = (strings: Record<string, string>) => Object.fromEntries(Object.entries(strings).filter(([, value]) => value));
  const strings = { ...nonEmpty(flatten(RESOURCES.en)), ...(language === "en" ? {} : nonEmpty(flatten(RESOURCES[language]))) };
  return { language, strings, t: translator(strings) };
}
