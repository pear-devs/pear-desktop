// Constructed style sheets, and the order of the document's adopted ones:
// everything else first, then the user's theme files, so themes win ties.
// The page runtime's; plugins add theirs with `ctx.addStyle`.

/** A constructed style sheet holding `css`. */
export function styleSheet(css: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  return sheet;
}

let themes: readonly CSSStyleSheet[] = [];

/** Adopts `sheet` into the document, before the themes. */
export function adoptSheet(sheet: CSSStyleSheet) {
  const others = document.adoptedStyleSheets.filter((s) => !themes.includes(s));
  document.adoptedStyleSheets = [...others, sheet, ...themes];
}

export function dropSheets(sheets: Iterable<CSSStyleSheet>) {
  const dropped = new Set(sheets);
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => !dropped.has(s));
}

/** Replaces the theme sheets with ones holding `css`, after everything else. */
export function setThemes(css: readonly string[]) {
  dropSheets(themes);
  themes = css.map(styleSheet);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, ...themes];
}
