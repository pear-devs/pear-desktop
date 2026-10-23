// "With blocklists" blocking: the tracker lists pear-desktop curates (fetched
// from its tb-list repository, like pear-desktop does) in Ghostery's engine.
// The engine (engine.ts) caches the built filter engine next to these lists.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SOURCES_URL = "https://raw.githubusercontent.com/organization/tb-list/refs/heads/main/tb.json";

/** tb.json as of this release: used until the first fetch, and when it fails. */
export const BUILTIN_SOURCES: readonly string[] = [
  "https://raw.githubusercontent.com/kbinani/adblock-\u0079\u006f\u0075\u0074\u0075\u0062\u0065-ads/master/signed.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/quick-fixes.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/unbreak.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2020.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2021.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2022.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2023.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2024.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2025.txt",
  "https://secure.fanboy.co.nz/fanboy-annoyance_ubo.txt",
  "https://filters.adtidy.org/extension/ublock/filters/122_optimized.txt",
];

/** The list URLs in a tb.json document (`{ "tb": [...] }`), or undefined if it isn't one. */
export function parseSources(document: unknown): string[] | undefined {
  const tb = (document as { tb?: unknown } | null)?.tb;
  if (!Array.isArray(tb)) return;
  const urls = tb.filter((url): url is string => typeof url === "string" && URL.canParse(url));
  return urls.length > 0 ? urls : undefined;
}

export interface ListOptions {
  disableDefaultLists: boolean;
  additionalBlockLists: readonly string[];
}

/** Which lists to load: the curated ones (unless disabled) and the user's. */
export function chooseLists(sources: readonly string[], options: ListOptions): string[] {
  const own = options.additionalBlockLists.map((url) => url.trim()).filter((url) => URL.canParse(url));
  return [...new Set([...(options.disableDefaultLists ? [] : sources), ...own])];
}

/** The curated list URLs: last known ones from the cache directory, else the built-in copy. */
export async function cachedSources(cacheDir: string | undefined): Promise<readonly string[]> {
  if (!cacheDir) return BUILTIN_SOURCES;
  try {
    return parseSources(JSON.parse(await readFile(join(cacheDir, "tb.json"), "utf8"))) ?? BUILTIN_SOURCES;
  } catch {
    return BUILTIN_SOURCES;
  }
}

/** Fetches the current curated list URLs (and remembers them); undefined when unreachable. */
export async function fetchSources(fetch: (url: string) => Promise<Response>, cacheDir: string | undefined) {
  try {
    const response = await fetch(SOURCES_URL);
    if (!response.ok) return;
    const sources = parseSources(await response.json());
    if (sources && cacheDir) {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(join(cacheDir, "tb.json"), JSON.stringify({ tb: sources }));
    }
    return sources;
  } catch {
    return;
  }
}
