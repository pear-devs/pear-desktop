// Build-time macros. Import with `with { type: "macro" }`: every call runs in
// Node while bundling and is replaced by its (serialized) return value, so a
// mistake here fails the build instead of a user's session.

import { readdirSync, readFileSync } from "node:fs";
import { transform } from "lightningcss";
import { isSelectorName, selectors, type SelectorName } from "./selectors.ts";

/** Resolves a selector from the registry at build time. */
export function sel(name: SelectorName): string {
  if (!isSelectorName(name)) throw new Error(unknownSelector(name));
  return selectors[name];
}

/**
 * Validates and minifies CSS at build time. `sel(name)` inside the CSS text is
 * replaced with the registry selector, e.g. css`sel(nav_bar.background) { … }`;
 * a selector list (one entry per YTM layout) becomes `:is(a, b)`, so
 * `sel(player_bar) svg` means "an svg in either". Interpolation is not
 * supported: macros only accept static input.
 */
export function css(strings: TemplateStringsArray | string, ...values: unknown[]): string {
  if (values.length > 0) throw new Error("[pear] css`` macro does not support interpolation; use sel(name) in the CSS text");
  const source = typeof strings === "string" ? strings : strings.join("");
  const resolved = source.replace(/\bsel\(\s*([\w.-]+)\s*\)/g, (_, name: string) => {
    if (!isSelectorName(name)) throw new Error(unknownSelector(name));
    const selector: string = selectors[name];
    return selector.includes(",") ? `:is(${selector})` : selector;
  });
  assertBalanced(resolved);
  const { code, warnings } = transform({
    filename: "plugin.css",
    code: new TextEncoder().encode(resolved),
    minify: true,
    errorRecovery: false,
  });
  if (warnings.length > 0) {
    throw new Error(`[pear] css: ${warnings.map((w) => w.message).join("; ")}`);
  }
  return new TextDecoder().decode(code);
}

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
/** A double- or single-quoted CSS string, escaped quotes included. */
const CSS_STRING = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;

/** CSS error recovery silently accepts unbalanced braces; a typo should fail the build instead. */
function assertBalanced(source: string) {
  // Braces in comments and strings (`content: "}"`) don't count.
  const code = source.replace(CSS_COMMENT, "").replace(CSS_STRING, '""');
  let depth = 0;
  for (const char of code) {
    if (char === "{") depth++;
    if (char === "}") depth--;
    if (depth < 0) throw new Error("[pear] css: unexpected `}`");
  }
  if (depth !== 0) throw new Error("[pear] css: unclosed `{`");
}

function unknownSelector(name: string) {
  return `[pear] unknown selector "${name}"; add it to @pear/sdk/selectors (known: ${Object.keys(selectors).join(", ")})`;
}

/**
 * Reads a file from the repository's assets/ at build time and returns it
 * base64-encoded (icons), so nothing depends on runtime asset paths.
 */
export function embed(asset: string): string {
  return readFileSync(new URL(`../../../assets/${asset}`, import.meta.url)).toString("base64");
}

const RESOURCES = new URL("../../../src/i18n/resources/", import.meta.url);

/** Every translation file (pear-desktop's Weblate resources), by language code. */
export function translations(): Record<string, unknown> {
  return Object.fromEntries(
    readdirSync(RESOURCES)
      .filter((file) => file.endsWith(".json"))
      .map((file) => [file.slice(0, -5), JSON.parse(readFileSync(new URL(file, RESOURCES), "utf8"))]),
  );
}

/** The languages to offer: "English (English)", "Ελληνικά (Greek)", … sorted by code. */
export function languages(): { value: string; label: string }[] {
  return Object.entries(translations())
    .map(([code, resource]) => {
      const meta = (resource as { language?: { name?: string; "local-name"?: string } }).language;
      const local = meta?.["local-name"] ?? code;
      return { value: code, label: meta?.name && meta.name !== local ? `${local} (${meta.name})` : local };
    })
    .sort((a, b) => a.value.localeCompare(b.value));
}
