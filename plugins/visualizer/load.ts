// The libraries are bundled into the host and sent to the page only when used,
// so the page runtime stays small.

/** An ES module from source; the page's CSP is lifted, so a blob URL can be imported. */
export async function importSource<T>(source: string): Promise<T> {
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    return (await import(/* @vite-ignore */ url)) as T;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Runs a UMD bundle (sent by the host) in the page and returns its exports. */
export async function loadUmd<T>(source: Promise<string>): Promise<T> {
  const wrapped = `const module = { exports: {} }; const exports = module.exports;\n${await source}\nexport default module.exports;`;
  return (await importSource<{ default: T }>(wrapped)).default;
}
