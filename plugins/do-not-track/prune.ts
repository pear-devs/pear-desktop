// "In player" blocking: strips the ad and tracking placements out of YT's
// player responses before the player reads them, like pear-desktop's injector
// (itself after uBlock Origin's json-prune and set-constant scriptlets). Every
// patch is undone on cleanup, so the mode can be switched live.

const AD_KEYS = ["playerAds", "adPlacements", "adSlots"] as const;
const NESTED = ["playerResponse", "ytInitialPlayerResponse"] as const;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null;

/** Deletes the ad keys from a parsed response (and the player responses inside it); returns it. */
export function prune<T>(value: T): T {
  if (!isObject(value)) return value;
  for (const key of AD_KEYS) delete value[key];
  for (const nested of NESTED) {
    const inner = value[nested];
    if (isObject(inner)) for (const key of AD_KEYS) delete inner[key];
  }
  return value;
}

interface Target {
  JSON: { parse: typeof JSON.parse };
  Response: { prototype: { json: () => Promise<unknown> } };
  [key: string]: unknown;
}

/**
 * Patches `JSON.parse`, `Response.prototype.json` and the page's
 * `ytInitialPlayerResponse` / `playerResponse` globals. Returns the undo.
 */
export function installPruner(target: Target = globalThis as unknown as Target): () => void {
  const parse = target.JSON.parse;
  const json = target.Response.prototype.json;
  const patchedParse = new Proxy(parse, { apply: (fn, self, args) => prune(Reflect.apply(fn, self, args)) });
  const patchedJson = new Proxy(json, {
    apply: (fn, self, args) => (Reflect.apply(fn, self, args) as Promise<unknown>).then(prune),
  });
  target.JSON.parse = patchedParse;
  target.Response.prototype.json = patchedJson;

  // The first player response comes inline with the page (set as a global, never parsed).
  const restores = NESTED.map((name) => {
    const previous = Object.getOwnPropertyDescriptor(target, name);
    if (previous && !previous.configurable) return () => {};
    let current = prune(previous && "value" in previous ? previous.value : previous?.get?.call(target));
    Object.defineProperty(target, name, {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (value: unknown) => void (current = prune(value)),
    });
    return () => {
      if (!previous && current === undefined) delete target[name];
      else Object.defineProperty(target, name, { configurable: true, enumerable: true, writable: true, value: current });
    };
  });

  return () => {
    if (target.JSON.parse === patchedParse) target.JSON.parse = parse;
    if (target.Response.prototype.json === patchedJson) target.Response.prototype.json = json;
    for (const restore of restores) restore();
  };
}
