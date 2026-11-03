// The blocklists' cosmetic filters, applied in the page.

import type { Ctx } from "./schema.ts";

const COSMETICS_RETRY_MS = 1000;
const DOM_SCAN_MS = 2000;

/**
 * Applies the lists' cosmetic filters to the page, as Ghostery's preload does:
 * the page's base and hostname rules, then rules for the classes, ids and links
 * that appear.
 */
export function applyCosmetics(ctx: Ctx) {
  const style = ctx.addStyle("");
  let css = "";
  const add = (styles: string) => {
    if (!styles) return;
    css += `\n${styles}`;
    style.update(css);
  };
  const runScriptlets = async (scripts: string[]) => {
    // The page's CSP is lifted: a blob module runs in the main world.
    for (const script of scripts) {
      const url = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
      await import(/* @vite-ignore */ url).catch((error: unknown) => ctx.log.warn("scriptlet failed", error));
      URL.revokeObjectURL(url);
    }
  };

  const seen = { classes: new Set<string>(), ids: new Set<string>(), hrefs: new Set<string>() };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scan = () => {
    timer = undefined;
    if (ctx.signal.aborted || !document.documentElement) return;
    const fresh = { classes: [] as string[], ids: [] as string[], hrefs: [] as string[] };
    for (const element of document.querySelectorAll("[class],[id],a[href]")) {
      for (const name of element.classList) collect(name, seen.classes, fresh.classes);
      collect(element.id, seen.ids, fresh.ids);
      if (element instanceof HTMLAnchorElement) collect(element.href, seen.hrefs, fresh.hrefs);
    }
    if (!fresh.classes.length && !fresh.ids.length && !fresh.hrefs.length) return;
    ctx.host.invoke("cosmetics", { url: location.href, base: false, ...fresh }).then(
      (result) => result && add(result.styles),
      () => {},
    );
  };
  const schedule = () => {
    timer ??= ctx.setTimeout(scan, DOM_SCAN_MS);
  };
  const observer = new MutationObserver(schedule);
  ctx.onCleanup(() => observer.disconnect());

  // The lists load in the host after startup; ask until they're there.
  const base = () => {
    if (ctx.signal.aborted) return;
    ctx.host.invoke("cosmetics", { url: location.href, base: true }).then(
      (result) => {
        if (ctx.signal.aborted) return;
        if (!result) {
          ctx.setTimeout(base, COSMETICS_RETRY_MS);
          return;
        }
        add(result.styles);
        void runScriptlets(result.scripts);
        observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "id", "href"] });
        schedule();
      },
      () => ctx.setTimeout(base, COSMETICS_RETRY_MS),
    );
  };
  base();
}

/** Adds `value` to `fresh` the first time it is seen. */
function collect(value: string, seen: Set<string>, fresh: string[]) {
  if (!value || seen.has(value)) return;
  seen.add(value);
  fresh.push(value);
}
